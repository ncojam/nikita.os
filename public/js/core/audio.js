import { store } from "./util.js";

/* ================= Звук ОС: граф с кабелями =================
 * Один AudioContext на всю ОС. Узлы — источники (плеер, деки пульта…), обработка (педали) и выход (микшер ОС).
 * Кабель — маршрут { from, to, fp, tp }: выход fp узла from → вход tp узла to (fp/tp — порты, "" — единственный). Кабели хранятся у посетителя (localStorage
 * "audio.routes") и переживают перезагрузку: узел пропал (окно закрыто) — кабель ждёт, появился — снова звучит.
 *
 * По умолчанию новый источник при первом появлении подключается в микшер (как будто так и было всегда).
 * Дальше — как на пульте: вытащил кабель — тишина, провёл плеер → педаль → микшер — звук через педаль.
 *
 *   AudioOS.context()                     — общий контекст (создаётся по первому требованию, просыпается по жесту)
 *   AudioOS.register({ id, title, icon, kind: "source"|"fx"|"sink", input(from, port) → AudioNode, output | outs: { порт: AudioNode },
 *                      ins: ["a", "b"] — имена входов, если их несколько })
 *   Гнёзда прямо в окнах приложений и кабели поверх экрана — core/aucables.js.
 *   AudioOS.unregister(id)
 *   AudioOS.connect(from, to) / disconnect(from, to)   — циклы и дубли не пускает
 *   AudioOS.on(fn)                        — fn() при любом изменении узлов или кабелей
 *
 * Микшер ОС (id "mixer") — полоса на каждый входящий кабель (громкость, выкл, индикатор) и общий мастер;
 * настройки — store "audio.mix". Полоса создаётся по первому кабелю от источника.
 */
const RKEY = "audio.routes", SKEY = "audio.seen", MKEY = "audio.mix";

export const AudioOS = {
  ctx: null,
  nodes: new Map(),
  routes: (store.get(RKEY, []) || []).filter(r => r && r.from && r.to),
  seen: new Set(store.get(SKEY, [])),
  mix: { master: 0.9, strips: {}, ...(store.get(MKEY, {}) || {}) },
  subs: new Set(),

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit() { for (const f of [...this.subs]) { try { f(); } catch (e) { console.warn("audio:", e); } } },
  save() { store.set(RKEY, this.routes); store.set(SKEY, [...this.seen]); },
  saveMix() { store.set(MKEY, this.mix); },

  context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.makeMixer();
      // браузер будит звук только по жесту — будим при первом же клике
      const wake = () => { this.ctx.resume?.(); };
      import("./aucables.js").then(m => m.AuCables.start());   // кабели между окнами
      addEventListener("pointerdown", wake, { capture: true });
      addEventListener("keydown", wake, { capture: true });
    }
    if (this.ctx.state === "suspended") this.ctx.resume?.().catch(() => {});
    return this.ctx;
  },

  /* ---------- микшер ОС ---------- */
  makeMixer() {
    const ctx = this.ctx, master = ctx.createGain(), meter = ctx.createAnalyser();
    master.gain.value = this.mix.master;
    meter.fftSize = 512;
    master.connect(meter); master.connect(ctx.destination);
    const strips = new Map();
    const mixer = {
      id: "mixer", title: "Микшер ОС", icon: "🎚", kind: "sink", master, meter, strips,
      input: from => {
        let s = strips.get(from);
        if (!s) {
          const g = ctx.createGain(), an = ctx.createAnalyser();
          an.fftSize = 512;
          const set = this.mix.strips[from] || { vol: 1, mute: false };
          g.gain.value = set.mute ? 0 : set.vol;
          g.connect(an); g.connect(master);
          strips.set(from, s = { gain: g, meter: an });
        }
        return s.gain;
      },
      output: null,
    };
    this.nodes.set("mixer", mixer);
  },
  strip(from) { return this.mix.strips[from] ||= { vol: 1, mute: false }; },
  setStrip(from, patch) {
    const s = Object.assign(this.strip(from), patch);
    const st = this.nodes.get("mixer")?.strips.get(from);
    if (st) st.gain.gain.setTargetAtTime(s.mute ? 0 : s.vol, this.ctx.currentTime, 0.02);
    this.saveMix();
  },
  setMaster(v) {
    this.mix.master = v;
    this.nodes.get("mixer")?.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    this.saveMix();
  },
  level(an) {   // пик 0..1 по анализатору
    if (!an) return 0;
    const b = an._buf ||= new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(b);
    let m = 0; for (const x of b) { const y = x < 0 ? -x : x; if (y > m) m = y; }
    return m;
  },

  /* ---------- узлы ---------- */
  register(node) {
    this.context();
    this.nodes.set(node.id, node);
    if (node.kind === "source" && !this.seen.has(node.id)) {
      this.seen.add(node.id);
      if (!this.routes.some(r => r.from === node.id)) this.routes.push({ from: node.id, to: "mixer" });
      this.save();
    }
    this.apply();
  },
  outsOf(n) { return n.outs ? Object.values(n.outs) : n.output ? [n.output] : []; },
  outPort(n, port) { return n.outs ? n.outs[port] ?? null : n.output || null; },
  ports(n, dir) { return dir === "out" ? (n.outs ? Object.keys(n.outs) : n.output ? [""] : []) : (n.ins ? n.ins : n.input ? [""] : []); },
  unregister(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    for (const o of this.outsOf(n)) { try { o.disconnect(); } catch {} }
    this.nodes.delete(id);
    this.apply();
  },
  /* кабели: всё снять и заново провести по списку — просто и без рассинхрона */
  apply() {
    for (const n of this.nodes.values()) for (const o of this.outsOf(n)) { try { o.disconnect(); } catch {} }
    for (const r of this.routes) {
      const a = this.nodes.get(r.from), b = this.nodes.get(r.to);
      const out = a && this.outPort(a, r.fp || ""), inp = b?.input?.(r.from, r.tp || "");
      if (!out || !inp) continue;
      try { out.connect(inp); } catch (e) { console.warn("audio route:", r, e); }
    }
    this.emit();
  },
  reaches(from, to) {   // есть ли путь from → … → to (для защиты от петель)
    const seen = new Set(), st = [from];
    while (st.length) {
      const x = st.pop();
      if (x === to) return true;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const r of this.routes) if (r.from === x) st.push(r.to);
    }
    return false;
  },
  same(r, from, to, fp, tp) { return r.from === from && r.to === to && (r.fp || "") === fp && (r.tp || "") === tp; },
  connect(from, to, fp = "", tp = "") {
    if (from === to) throw new Error("кабель сам в себя не воткнуть");
    if (this.routes.some(r => this.same(r, from, to, fp, tp))) return false;
    if (this.reaches(to, from)) throw new Error("так получится петля");
    const a = this.nodes.get(from), b = this.nodes.get(to);
    if (a && !this.outPort(a, fp)) throw new Error("у «" + a.title + "» нет такого выхода");
    if (b && !b.input) throw new Error("у «" + b.title + "» нет входа");
    this.seen.add(from);
    const r = { from, to };
    if (fp) r.fp = fp;
    if (tp) r.tp = tp;
    this.routes.push(r);
    this.save(); this.apply();
    return true;
  },
  disconnect(from, to, fp = "", tp = "") {
    this.routes = this.routes.filter(r => !this.same(r, from, to, fp, tp));
    this.save(); this.apply();
  },
  /* уровень узла (пик 0..1): у педали «Уровень» — по полосам all/low/mid/high */
  nodeLevel(id, band = "all") { const n = this.nodes.get(id); return this.level(n?.meters?.[band] || n?.meters?.all); },
  title(id) { const n = this.nodes.get(id); return n ? `${n.icon || ""} ${n.title}`.trim() : id; },
};
