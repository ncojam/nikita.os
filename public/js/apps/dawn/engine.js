import { FX, fxDefaults, loadCodeWorklet } from "./fx.js";
import { fitParams, stretchParams } from "./wubs.js";
import { PASTEL, barLen, fromFile, newInsert, patLen, slug, toFile } from "./format.js";
import { BUILTIN, DEFAULT_PARAMS, TYPES, ensureSample, playOsc3, playSampler, sampleNow } from "./instruments.js";
import { playGrapefruit } from "./grapefruit.js";
import { computeOver, effOf, effParams } from "./modcore.js";
import { DEMO } from "./demo.js";
import { c4 } from "./tuning.js";

export { SPECS, WAVES, WAVE_GLYPH, TYPES, BUILTIN, sampleNow } from "./instruments.js";
export { PASTEL, barLen } from "./format.js";

/* ================= DAWN — движок =================
 * Один на всё приложение: окна модулей только смотрят на Engine.project и зовут его методы.
 *
 * Время — в ДОЛЯХ (четвертях). Тик планировщика — 1/16 (0.25 доли). Ноты: { s, l (доли), n (ступень строя
 * канала, см. tuning.js), v (0..1) }. Шаги стойки и пиано ролл — одни и те же ноты.
 * Режимы: "pat" — по кругу текущий паттерн; "song" — плейлист (клипы паттернов на дорожках).
 *
 * Звук: голос → полоса канала (gain → pan) → вход инсерта микшера → FX → громкость/пан инсерта → Master
 * (инсерт 0) → предохранитель → выход. Граф строится функцией buildGraph(ctx, project) — одной и той же
 * для живого звука и для рендера в WAV (OfflineAudioContext).
 *
 * События Engine.on(...): "change" (модель; { param: true } — правка крутилки, окна не перестраиваются),
 * "play" / "stop", "pattern", "mode", "theme".
 */
const LOOKAHEAD = 0.12, TIMER_MS = 25, TICK = 0.25;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ======================= граф (микшер) ======================= */
function buildGraph(ctx, P) {
  const lim = ctx.createDynamicsCompressor();          // мягкий предохранитель на выходе
  lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
  const final = ctx.createGain(), analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  final.connect(lim); lim.connect(analyser); analyser.connect(ctx.destination);

  const G = {
    ctx, P, final, analyser, inserts: [], strips: new Map(), bpm: P.bpm,
    over: new Map(),       // текущие значения модулируемых параметров (адрес → значение), см. modcore.js
    active: {},            // канал → звучащие голоса (для полифонии и живой модуляции фильтра)
    fxSig: "",

    ensureInserts() {
      while (G.inserts.length < P.mixer.length) {
        const i = G.inserts.length;
        const input = ctx.createGain(), post = ctx.createGain(), pan = ctx.createStereoPanner(), meter = ctx.createAnalyser();
        meter.fftSize = 256;
        post.connect(pan); pan.connect(meter);
        meter.connect(i === 0 ? final : G.inserts[0].input);
        G.inserts.push({ input, post, pan, meter, fx: [] });
        G.rebuildFx(i); G.applyInsert(i);
      }
    },
    /* цепочка эффектов инсерта: input → fx (вкл.) → post */
    rebuildFx(i) {
      const ins = G.inserts[i], m = P.mixer[i];
      ins.input.disconnect();
      ins.fx.forEach(f => f?.dispose());
      ins.fx = m.fx.map((f, k) => {
        const n = FX[f.type].create(ctx, G.fxParams(i, k));
        n.tempo(G.bpm);
        return n;
      });
      let node = ins.input;
      m.fx.forEach((f, k) => { if (f.on) { node.connect(ins.fx[k].input); node = ins.fx[k].output; } });
      node.connect(ins.post);
    },
    applyInsert(i) {
      const m = P.mixer[i], ins = G.inserts[i];
      ins.post.gain.value = m.mute ? 0 : effOf(G.over, `mix.${i}.vol`, m.vol);
      ins.pan.pan.value = effOf(G.over, `mix.${i}.pan`, m.pan);
    },
    fxParams(i, k) {
      const f = P.mixer[i].fx[k], pre = `mix.${i}.${k}.`;
      let p = f.p;
      for (const [a, v] of G.over) if (a.startsWith(pre)) { if (p === f.p) p = { ...f.p }; p[a.slice(pre.length)] = v; }
      return p;
    },
    fxSet(i, k) { G.inserts[i]?.fx[k]?.set(G.fxParams(i, k)); },
    /* ---------- педали: эффекты вне микшера. Вход — канал (ch:id) или инсерт (mix:i, после фейдера),
     * выход — инсерт (mix:i) или Master. Петли не даём: вход-инсерт ≠ выход, Master как вход нельзя. ---------- */
    pedals: new Map(),
    pedalParams(pd) {
      const pre = `pedal.${pd.id}.`;
      let p = pd.p;
      for (const [a, v] of G.over) if (a.startsWith(pre)) { if (p === pd.p) p = { ...pd.p }; p[a.slice(pre.length)] = v; }
      return p;
    },
    pedalSrc(ref) {
      const [k, id] = String(ref || "").split(":");
      if (k === "ch") { const ch = P.channels.find(c => c.id === id); return ch ? G.strip(ch).pan : null; }
      if (k === "mix" && +id > 0) return G.inserts[+id]?.meter || null;
      return null;
    },
    pedalDst(ref) {
      const [k, id] = String(ref || "mix:0").split(":");
      return k === "mix" ? G.inserts[clamp(+id || 0, 0, P.mixer.length - 1)]?.input : G.inserts[0].input;
    },
    rebuildPedals() {
      for (const g of G.pedals.values()) { try { g.src.disconnect(g.fx.input); } catch { /* уже отключён */ } g.fx.output.disconnect(); g.fx.dispose(); }
      G.pedals.clear();
      for (const pd of P.pedals || []) {
        if (!pd.on || !FX[pd.type]) continue;
        const src = G.pedalSrc(pd.in), dst = G.pedalDst(pd.out);
        if (!src || !dst || (pd.in.startsWith("mix:") && pd.in === pd.out)) continue;
        const fx = FX[pd.type].create(ctx, G.pedalParams(pd));
        fx.tempo(G.bpm);
        src.connect(fx.input); fx.output.connect(dst);
        G.pedals.set(pd.id, { fx, src });
      }
    },
    pedalSet(id) { const pd = (P.pedals || []).find(x => x.id === id); if (pd) G.pedals.get(id)?.fx.set(G.pedalParams(pd)); },
    /* модуляция: новые значения целей; непрерывные параметры (громкость, пан, фильтр, эффекты) — сразу */
    applyOver(over) {
      const prev = G.over;
      G.over = over;
      const changed = new Set([...prev.keys(), ...over.keys()].filter(a => prev.get(a) !== over.get(a)));
      if (!changed.size) return;
      for (const ch of P.channels) {
        const pre = `ch.${ch.id}.`;
        if (changed.has(pre + "vol") || changed.has(pre + "pan")) G.strip(ch);
        if (changed.has(pre + "cut") || changed.has(pre + "res")) {
          const p = effParams(ch, over), now = ctx.currentTime;
          for (const h of G.active[ch.id] || []) if (h.flt && h.end > now) { h.flt.frequency.value = p.cut; h.flt.Q.value = p.res; }
        }
      }
      P.mixer.forEach((m, i) => {
        if (changed.has(`mix.${i}.vol`) || changed.has(`mix.${i}.pan`)) G.applyInsert(i);
        m.fx.forEach((f, k) => { if ([...changed].some(a => a.startsWith(`mix.${i}.${k}.`))) G.fxSet(i, k); });
      });
      for (const pd of P.pedals || []) if ([...changed].some(a => a.startsWith(`pedal.${pd.id}.`))) G.pedalSet(pd.id);
    },
    tempo(bpm) { G.bpm = bpm; for (const ins of G.inserts) for (const f of ins.fx) f.tempo(bpm); for (const g of G.pedals.values()) g.fx.tempo(bpm); },
    audible(ch) {
      const anySolo = P.channels.some(c => c.solo);
      return !ch.mute && (!anySolo || ch.solo);
    },
    /* полоса канала; если канал переназначили на другой инсерт — переподключаем */
    strip(ch) {
      let s = G.strips.get(ch.id);
      const mix = clamp(ch.mix || 0, 0, P.mixer.length - 1);
      if (!s) {
        const gain = ctx.createGain(), pan = ctx.createStereoPanner(), out = ctx.createGain();
        gain.connect(pan); pan.connect(out);       // педали берут звук канала с pan (до инсерта)
        s = { gain, pan, out, mix: -1 };
        G.strips.set(ch.id, s);
      }
      if (s.mix !== mix) { s.out.disconnect(); s.out.connect(G.inserts[mix].input); s.mix = mix; }
      s.gain.gain.value = G.audible(ch) ? effOf(G.over, `ch.${ch.id}.vol`, ch.vol) : 0;
      s.pan.pan.value = effOf(G.over, `ch.${ch.id}.pan`, ch.pan);
      return s;
    },
    refresh() {
      G.ensureInserts();
      for (let i = 0; i < P.mixer.length; i++) G.applyInsert(i);
      for (const ch of P.channels) G.strip(ch);
      for (const [id, s] of G.strips) if (!P.channels.some(c => c.id === id)) { s.gain.disconnect(); s.pan.disconnect(); s.out.disconnect(); G.strips.delete(id); }
    },
    /* нота: параметры с учётом модуляции, изгиб, полифония (лишний старый голос крадём) */
    voice(ch, t, durSec, n, v, bend = 0, stretch = 1) {
      if (!G.audible(ch)) return;
      const out = G.strip(ch).gain, edo = ch.edo || 12;
      let p = effParams(ch, G.over);
      if (stretch !== 1 && ch.type !== "sampler") p = stretchParams(p, ch.type, stretch);   // удлинённая нота: атака растянута так же
      if (p.fit && ch.type !== "sampler") p = fitParams(p, ch.type, durSec);   // ⇔ огибающая под длину ноты
      const h = ch.type === "osc3" ? playOsc3(ctx, out, p, t, durSec, n, v, edo, bend)
        : ch.type === "grapefruit" ? playGrapefruit(ctx, out, p, t, durSec, n, v, edo, bend)
        : playSampler(ctx, out, p, t, durSec, n, v, sampleNow(p.path), edo, bend);
      // сайдчейн: эффекты Sidechain, слушающие этот канал, ныряют ровно в момент ноты
      P.mixer.forEach((m, i) => m.fx.forEach((f, k) => { if (f.on && f.type === "side" && f.p.src === ch.id) G.inserts[i]?.fx[k]?.duck?.(t); }));
      for (const pd of P.pedals || []) if (pd.on && pd.type === "side" && pd.p.src === ch.id) G.pedals.get(pd.id)?.fx.duck?.(t);
      G.onNote?.(ch, t, v);
      if (!h) return;
      const now = ctx.currentTime, list = (G.active[ch.id] = (G.active[ch.id] || []).filter(x => x.end > now));
      const sounding = list.filter(x => x.end > t);
      for (let k = sounding.length - Math.max(1, ch.poly || 16) + 1; k > 0; k--) sounding.shift().kill(t);
      list.push(h);
    },
    dispose() {
      for (const ins of G.inserts) { ins.input.disconnect(); ins.meter.disconnect(); ins.fx.forEach(f => f.dispose()); }
      for (const s of G.strips.values()) { s.gain.disconnect(); s.pan.disconnect(); s.out.disconnect(); }
      for (const g of G.pedals.values()) { g.fx.output.disconnect(); g.fx.dispose(); }
      final.disconnect(); lim.disconnect(); analyser.disconnect();
    },
  };
  G.ensureInserts();
  for (const ch of P.channels) G.strip(ch);
  G.rebuildPedals();
  return G;
}

/* ноты, начинающиеся в тике [beat, beat + 0.25): cb(канал, нота, смещение от начала тика в долях) */
function collect(P, mode, beat, cb) {
  if (mode === "pat") {
    const pat = P.patterns.find(p => p.id === P.cur);
    if (pat) emitPattern(P, pat, beat, beat + TICK, cb);
    return;
  }
  for (const c of P.playlist) {
    if (beat < c.s || beat >= c.s + c.l) continue;
    const pat = P.patterns.find(p => p.id === c.p);
    if (!pat) continue;
    const len = patLen(P, pat.id), local = (beat - c.s) % len;
    const until = Math.min(local + TICK, local + (c.s + c.l - beat));   // нота должна начаться внутри клипа
    emitPattern(P, pat, local, until, cb);
  }
}
function emitPattern(P, pat, from, to, cb) {   // cb(канал, нота{s,l,n,v,b?}, смещение)
  for (const ch of P.channels) for (const n of pat.notes[ch.id] || []) if (n.s >= from - 1e-9 && n.s < to - 1e-9) cb(ch, n, n.s - from);
}
/* цвет вспышки фона: задан на канале (null — выкл), иначе — бочке и малому по умолчанию */
export const FLASH_COLORS = ["#ff5fa8", "#5fffd0", "#b58cff", "#ffb25f", "#5fb8ff", "#fff05f"];
export function flashOf(ch) {
  if (ch.flash !== undefined) return ch.flash;
  const p = ch.params?.path || "";
  if (p === "builtin:kick") return FLASH_COLORS[0];
  if (p === "builtin:snare" || p === "builtin:clap") return FLASH_COLORS[1];
  return null;
}
const songLen = P => P.playlist.reduce((m, c) => Math.max(m, c.s + c.l), 0);

/* ======================= проект ======================= */
/* новый проект — демо-трек (собирается из того же формата, что пишется в файл) */
export function demoProject() { return fromFile(JSON.parse(JSON.stringify(DEMO))); }
/* новый трек — пустой: три ударных, синт, микшер */
export function newProject() {
  return fromFile({ format: "dawn/2", name: "Новый трек", bpm: 140, mode: "pattern",
    channels: [{ id: "kick", type: "sampler", name: "Kick", sample: "builtin:kick", mixer: 1 },
      { id: "snare", type: "sampler", name: "Snare", sample: "builtin:snare", mixer: 2 },
      { id: "hat", type: "sampler", name: "Hat", sample: "builtin:hat", mixer: 3, vol: 0.55 },
      { id: "synth", type: "osc3", name: "Synth", mixer: 4 }],
    patterns: [{ id: "pattern", name: "Pattern 1", sig: "4/4", notes: {} }],
    mixer: [{ name: "Master" }, { name: "Kick" }, { name: "Snare" }, { name: "Hat" }, { name: "Synth" }] });
}
/* журнал начал нот — для огибающих «по ноте» */
export function logNote(log, id, t, v) { const l = (log[id] ||= []); l.push({ t, v }); if (l.length > 12) l.shift(); }

export const Engine = {
  ctx: null, G: null, project: null, path: null, dirty: false,
  playing: false, beat: 0, nextT: 0, hist: [], timer: null, queued: null,
  listeners: {},

  on(ev, cb) { (this.listeners[ev] ||= new Set()).add(cb); return () => this.listeners[ev].delete(cb); },
  emit(ev, d) { for (const cb of this.listeners[ev] || []) try { cb(d); } catch (e) { console.error(e); } },

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    // модуль педалей «Formula» и «Code»: как загрузится — пересобираем эффекты, где они есть
    loadCodeWorklet(this.ctx).then(() => {
      const P = this.project, G = this.G, uses = f => f.type === "math" || f.type === "code";
      if (!P || !G) return;
      P.mixer.forEach((m, i) => { if (m.fx.some(uses)) G.rebuildFx(i); });
      if ((P.pedals || []).some(uses)) G.rebuildPedals();
    });
  },
  get analyser() { return this.G?.analyser; },

  load(project, path = null) {
    this.init();
    this.stop();
    this.G?.dispose();
    this.project = project.channels && project.patterns && project.mixer ? project : fromFile(project);
    this.path = path; this.dirty = false;
    this.G = buildGraph(this.ctx, this.project);
    // живой фон ОС вспыхивает в момент ноты канала, у которого задан цвет вспышки (✦)
    this.noteLog = {};
    this.G.onNote = (ch, t, v) => {
      logNote(this.noteLog, ch.id, t, v);
      const color = flashOf(ch);
      if (!color) return;
      setTimeout(() => dispatchEvent(new CustomEvent("nos-pulse", { detail: { color, strength: v, ch: ch.id } })), Math.max(0, (t - this.ctx.currentTime) * 1000));
    };
    this.preload();
    this.emit("change", { all: true });
    this.emit("pattern");
  },
  preload() {
    return Promise.all(this.project.channels.filter(c => c.type === "sampler" && c.params.path)
      .map(c => ensureSample(this.ctx, c.params.path).then(b => { if (b) this.emit("change", { sample: c.id, param: true }); })));
  },

  /* ---------- правка модели ---------- */
  touch(what = {}) { this.dirty = true; this.emit("change", what); },
  refreshStrips() { this.G.refresh(); },
  chan(id) { return this.project.channels.find(c => c.id === id); },
  pat(id = this.project.cur) { return this.project.patterns.find(p => p.id === id); },
  notesOf(chId, patId = this.project.cur) { const p = this.pat(patId); return p ? (p.notes[chId] ||= []) : []; },
  patLength(id = this.project.cur) { return patLen(this.project, id); },
  barLen(p = this.pat()) { return barLen(p); },
  songLength() { return songLen(this.project); },
  stepDur() { return 60 / this.project.bpm / 4; },
  beatDur() { return 60 / this.project.bpm; },

  addChannel(type, name, params) {
    const P = this.project, ids = new Set(P.channels.map(c => c.id));
    const used = new Set(P.channels.map(c => c.mix));
    let mix = 0;
    for (let i = 1; i < P.mixer.length; i++) if (!used.has(i)) { mix = i; break; }
    const ch = { id: slug(name || TYPES[type].name, ids), type, name: (name || TYPES[type].name).slice(0, 24),
      color: PASTEL[P.channels.length % PASTEL.length], vol: 0.8, pan: 0, mute: false, solo: false, mix, edo: 12,
      scale: { root: 0, mode: "chromatic", snap: false }, params: { ...DEFAULT_PARAMS[type](), ...(params || {}) } };
    if (mix) P.mixer[mix].name = ch.name.slice(0, 20);
    P.channels.push(ch);
    this.G.refresh();
    this.touch({ channels: true, mixer: true });
    return ch;
  },
  removeChannel(id) {
    const P = this.project, i = P.channels.findIndex(c => c.id === id);
    if (i < 0) return;
    P.channels.splice(i, 1);
    for (const p of P.patterns) delete p.notes[id];
    this.G.refresh();
    this.touch({ channels: true });
  },
  setSample(ch, path) {
    ch.params.path = path;
    ch.name = path.startsWith("builtin:") ? BUILTIN[path.slice(8)] || "Drum" : path.split("/").pop().replace(/\.[^.]+$/, "").slice(0, 24);
    ensureSample(this.ctx, path).then(b => { if (b) this.emit("change", { sample: ch.id, param: true }); });
    this.touch({ channels: true });
  },
  /* сменить строй канала: ноты переносим на ближайшие по высоте ступени нового строя */
  setEdo(ch, edo) {
    const from = ch.edo || 12;
    if (from === edo) return;
    for (const p of this.project.patterns) for (const n of p.notes[ch.id] || []) n.n = Math.round(n.n * edo / from);
    ch.edo = edo;
    ch.scale = { root: 0, mode: "chromatic", snap: false };
    this.touch({ channels: true, notes: true });
  },
  defaultPitch(ch) { return c4(ch.edo || 12); },

  addPattern(name) {
    const P = this.project, ids = new Set(P.patterns.map(p => p.id)), n = P.patterns.length + 1;
    const cur = this.pat();
    const p = { id: slug(name || "pattern" + n, ids), name: name || "Pattern " + n, color: PASTEL[(n - 1) % PASTEL.length],
      sig: cur ? [...cur.sig] : [4, 4], len: null, notes: {} };
    P.patterns.push(p);
    this.selectPattern(p.id);
    this.touch({ patterns: true });
    return p;
  },
  clonePattern() {
    const src = this.pat(), p = this.addPattern(src.name + " copy");
    p.sig = [...src.sig]; p.len = src.len;
    p.notes = JSON.parse(JSON.stringify(src.notes));
    this.touch({ patterns: true, notes: true });
  },
  removePattern(id) {
    const P = this.project;
    if (P.patterns.length < 2) return false;
    P.patterns = P.patterns.filter(p => p.id !== id);
    P.playlist = P.playlist.filter(c => c.p !== id);
    if (P.cur === id) P.cur = P.patterns[0].id;
    this.touch({ patterns: true, playlist: true });
    this.emit("pattern");
    return true;
  },
  /* LIVE: во время игры паттерн переключается только на конце текущего (как в живом сете) */
  selectPattern(id) {
    if (!this.pat(id)) return;
    if (this.playing && this.project.mode === "pat" && this.project.live && id !== this.project.cur) {
      this.queued = id;
      this.emit("pattern");
      return;
    }
    this.queued = null;
    this.project.cur = id;
    if (this.playing && this.project.mode === "pat") this.beat = this.beat % this.patLength();
    this.emit("pattern");
  },
  cloneChannel(id) {
    const src = this.chan(id);
    if (!src) return null;
    const ch = this.addChannel(src.type, src.name + " 2", JSON.parse(JSON.stringify(src.params)));
    Object.assign(ch, { vol: src.vol, pan: src.pan, edo: src.edo, scale: { ...src.scale }, poly: src.poly, color: src.color });
    const P = this.project, i = P.channels.indexOf(ch);
    P.channels.splice(i, 1); P.channels.splice(P.channels.indexOf(src) + 1, 0, ch);   // клон — сразу под оригиналом
    this.G.refresh();
    this.touch({ channels: true, mixer: true });
    return ch;
  },
  setMode(m) {
    if (this.project.mode === m) return;
    this.project.mode = m;
    if (this.playing) { this.beat = m === "song" ? this.project.songStart || 0 : 0; this.hist = []; }
    this.emit("mode");
    this.touch({ param: true });
  },
  setBpm(v) { this.project.bpm = clamp(Math.round(v * 10) / 10, 40, 300); this.G.tempo(this.project.bpm); },

  /* ---------- микшер ---------- */
  addInsert() {
    const P = this.project;
    if (P.mixer.length >= 17) return null;
    P.mixer.push(newInsert(P.mixer.length));
    this.G.refresh();
    this.touch({ mixer: true });
    return P.mixer.length - 1;
  },
  setFx(i, k, type) {
    const fx = this.project.mixer[i].fx;
    if (!type) fx.splice(k, 1);
    else {
      const p = fxDefaults(type);
      if (type === "side") {   // источник сайдчейна — бочка, если есть
        const C = this.project.channels;
        p.src = (C.find(c => /kick|бочк/i.test(c.id + c.name)) || C.find(c => c.type === "sampler") || C[0])?.id || "";
      }
      if (k >= fx.length) fx.push({ type, on: true, p }); else fx[k] = { type, on: true, p };
    }
    this.G.rebuildFx(i);
    this.touch({ mixer: true });
  },
  /* ⏏ эффект из микшера → педаль (вход — этот инсерт, выход — Master); и обратно */
  detachFx(i, k) {
    const f = this.project.mixer[i].fx.splice(k, 1)[0];
    if (!f) return;
    (this.project.pedals ||= []).push({ id: "pd" + Date.now().toString(36).slice(-5), type: f.type, on: f.on, p: f.p, in: `mix:${i}`, out: "mix:0" });
    this.G.rebuildFx(i); this.G.rebuildPedals();
    this.touch({ mixer: true, pedals: true });
  },
  attachPedal(id, i) {
    const P = this.project, pd = (P.pedals || []).find(x => x.id === id);
    if (!pd || !P.mixer[i] || P.mixer[i].fx.length >= 4) return false;
    P.mixer[i].fx.push({ type: pd.type, on: pd.on, p: pd.p });
    P.pedals = P.pedals.filter(x => x !== pd);
    this.G.rebuildFx(i); this.G.rebuildPedals();
    this.touch({ mixer: true, pedals: true });
    return true;
  },
  addPedal(type) {
    const p = fxDefaults(type);
    if (type === "side") p.src = (this.project.channels.find(c => /kick/i.test(c.id)) || this.project.channels[0])?.id || "";
    const src = this.project.channels.find(c => c.type !== "sampler") || this.project.channels[0];
    (this.project.pedals ||= []).push({ id: "pd" + Date.now().toString(36).slice(-5), type, on: true, p, in: src ? "ch:" + src.id : "mix:1", out: "mix:0" });
    this.G.rebuildPedals(); this.touch({ pedals: true });
  },
  pedalsChanged() { this.G.rebuildPedals(); this.touch({ pedals: true }); },
  fxToggle(i, k) { const f = this.project.mixer[i].fx[k]; f.on = !f.on; this.G.rebuildFx(i); this.touch({ mixer: true, param: true }); },
  fxParam(i, k) { this.G.fxSet(i, k); },
  applyInsert(i) { this.G.applyInsert(i); },
  /* живые данные для модуляции: уровни, ноты, время */
  rt() { return { now: this.ctx?.currentTime || 0, notes: id => this.noteLog?.[id] || [], meter: i => this.meter(i) }; },
  meter(i) {   // пик последнего окна, 0..1+
    const a = this.G?.inserts[i]?.meter;
    if (!a) return 0;
    const buf = this._mbuf ||= new Float32Array(256);
    a.getFloatTimeDomainData(buf);
    let m = 0; for (const x of buf) { const y = Math.abs(x); if (y > m) m = y; }
    return m;
  },

  /* ---------- звук ---------- */
  /* пощупать звук. В LIVE во время игры — в ровный момент: на ближайшую 1/16 сетки */
  preview(ch, n, v = 0.85, len = 0.25) {
    this.init();
    if (!ch) return;
    if (n == null) n = this.defaultPitch(ch);
    let t = this.ctx.currentTime + 0.01;
    if (this.playing && this.project.live) {
      const now = this.ctx.currentTime, next = this.hist.find(h => h[0] > now + 0.005);
      t = next ? next[0] : this.nextT;
    }
    this.G.voice(ch, t, len, n, v);
  },
  async previewPath(path) {
    this.init();
    const b = await ensureSample(this.ctx, path);
    if (!b) return false;
    this.previewSrc?.stop();
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = 0.8;
    s.connect(g); g.connect(this.G.final); s.start();
    this.previewSrc = s;
    return true;
  },

  play() {
    this.init();
    if (this.playing) return;
    this.playing = true;
    this.beat = this.project.mode === "song" ? Math.min(this.project.songStart || 0, Math.max(0, songLen(this.project) - TICK)) : 0;
    this.nextT = this.ctx.currentTime + 0.06;
    this.hist = [];
    const g = this.G.final.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(1, this.ctx.currentTime);
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
    this.emit("play");
  },
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer); this.timer = null;
    // мягко глушим хвосты: на мгновение опускаем выход
    const g = this.G.final.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.04); g.linearRampToValueAtTime(1, t + 0.3);
    this.emit("stop");
  },
  toggle() { this.playing ? this.stop() : this.play(); },

  schedule() {
    const P = this.project, until = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextT < until) {
      const td = this.stepDur();
      playTick(this.G, P, P.mode, this.beat, this.nextT);
      this.hist.push([this.nextT, this.beat]);
      if (this.hist.length > 64) this.hist.shift();
      this.nextT += td;
      this.beat += TICK;
      if (P.mode === "pat") {
        if (this.beat >= this.patLength() - 1e-9) {
          this.beat = 0;
          if (this.queued && this.pat(this.queued)) { P.cur = this.queued; this.queued = null; setTimeout(() => this.emit("pattern"), Math.max(0, (this.nextT - this.ctx.currentTime) * 1000)); }
        }
      }
      else if (this.beat >= songLen(P) - 1e-9) this.beat = 0;   // песня по кругу
    }
  },

  /* где сейчас играет (в долях): song — позиция песни, pattern — внутри текущего паттерна */
  position() {
    if (!this.playing || !this.hist.length) return -1;
    const now = this.ctx.currentTime;
    let h = null;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i][0] <= now) { h = this.hist[i]; break; }
    if (!h) return -1;
    return h[1] + Math.min(TICK, (now - h[0]) / this.beatDur());
  },
  positionSong() { return this.playing && this.project.mode === "song" ? this.position() : -1; },
  positionPattern() {
    const b = this.position();
    if (b < 0) return -1;
    const P = this.project;
    if (P.mode === "pat") return b;
    const c = P.playlist.find(c => c.p === P.cur && b >= c.s && b < c.s + c.l);
    return c ? (b - c.s) % this.patLength(c.p) : -1;
  },

  /* ---------- рендер в WAV ---------- */
  async render(onProgress) {
    this.init();
    await this.preload();
    const P = this.project, song = P.playlist.length > 0;
    const lenBeats = song ? songLen(P) : this.patLength();
    const tail = 3, sec = lenBeats * this.beatDur() + tail, sr = 44100;
    const oc = new OfflineAudioContext(2, Math.ceil(sr * sec), sr);
    await loadCodeWorklet(oc);
    const G = buildGraph(oc, P), log = {};
    G.onNote = (ch, t, v) => logNote(log, ch.id, t, v);
    const rt = q => ({ now: q, notes: id => log[id] || [], meter: () => 0 });
    const td = this.stepDur(), mode = song ? "song" : "pat", hasMods = (P.mods || []).some(m => m.wires?.length);
    // каждый тик рендер приостанавливается: считаем модуляцию (огибающие, LFO) и ставим ноты — как вживую
    for (let k = 0, beat = 0; beat < lenBeats - 1e-9; k++, beat += TICK) {
      const t = 0.02 + k * td, b = beat;
      if (!hasMods) { playTick(G, P, mode, b, t); continue; }
      const q = Math.floor(Math.max(0, t - 0.005) * sr / 128) * 128 / sr;   // кратно 128 сэмплам
      oc.suspend(q).then(() => { G.applyOver(computeOver(P, b, null, b, rt(q))); playTick(G, P, mode, b, t); oc.resume(); });
    }
    onProgress?.("рендер…");
    const buf = await oc.startRendering();
    return encodeWav(buf);
  },

  serialize() { return stringifyFile(toFile(this.project)); },
};

function playTick(G, P, mode, beat, t) {
  const bd = 60 / P.bpm, td = bd / 4;
  const swing = (Math.round(beat * 4) % 2 === 1) ? (P.swing || 0) * td * 0.5 : 0;
  collect(P, mode, beat, (ch, n, off) => G.voice(ch, Math.max(t + off * bd + swing, G.ctx.currentTime), n.l * bd, n.n, n.v, n.b || 0, n.x || 1));
}

/* JSON, где короткие массивы (ноты) — в одну строку: и человеку, и нейросети читать удобнее */
export function stringifyFile(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (m, inner) =>
    inner.length < 140 ? "[" + inner.split(/,\s*\n\s*/).join(", ").trim() + "]" : m);
}

/* 16-бит PCM WAV */
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, "data"); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: "audio/wav" });
}
