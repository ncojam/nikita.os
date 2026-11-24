import { Params } from "./params.js";
import { srcValue } from "./signals.js";
import { store } from "./util.js";

/* ================= Шина сигналов ОС =================
 * «Всё — параметр, всё — сигнал» (см. docs/philosophy.md). Источники (ручки, LFO, огибающие, ветер, курсор,
 * громкость плеера…) тянут провода к любым параметрам: регуляторам окон, эффектам окон, CSS-переменным ОС,
 * педалям, крутилкам DAWN. Шина — служба ОС: она живёт без DAWN, а DAWN — лишь один из её клиентов.
 *
 * Системная стойка (Bus.rig) — источники и педали самой ОС, хранятся у посетителя (localStorage "rig"):
 *   { v: 1, bpm, mods: [источник…], pedals: [{ id, type, on, p }] }   источник — как в DAWN (core/signals.js)
 *
 * Клиент — модуль со своими источниками и своими целями (DAWN: project.mods и адреса ch./mix./pedal.):
 *   Bus.attach(id, { mods(), value(src), owns(addr), param(addr) → { spec, get() }, apply(Map), targets(), label(addr) })
 *   Bus.detach(id)
 * Провода из системной стойки могут идти и в цели клиента (пока он подключён), и наоборот — провод из DAWN в ОС.
 *
 * Тик — 30 раз в секунду, только пока есть провода или клиенты. Цель = база + Σ amt · (v − центр) · (max − min).
 * Сохранённые значения шина не меняет: снял провод — параметр вернулся (Params.restore).
 *
 * Bus.on(fn) — подписка: fn({ rig: true }) когда стойка поменялась, fn({ tick: over }) каждый тик.
 */
const KEY = "rig";
const blank = () => ({ v: 1, bpm: 120, mods: [], pedals: [] });
function load() {
  const r = store.get(KEY, null);
  if (!r || typeof r !== "object") return blank();
  return { ...blank(), ...r, mods: Array.isArray(r.mods) ? r.mods : [], pedals: Array.isArray(r.pedals) ? r.pedals : [] };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const Bus = {
  rig: load(),
  clients: new Map(),
  applied: new Set(),
  over: new Map(),
  timer: null,
  subs: new Set(),
  mouse: { x: 0.5, y: 0.5 },
  analyser: null, _buf: null,

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit(e) { for (const f of [...this.subs]) { try { f(e); } catch (err) { console.warn("bus:", err); } } },

  /* стойка поменялась: сохранить у посетителя, разбудить/усыпить тик, сказать окнам */
  _saveT: 0,
  changed(what = {}) {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => store.set(KEY, this.rig), what.param ? 400 : 0);
    if (!what.param) this.emit({ rig: true, ...what });
    this.ensure();
  },
  reset() { this.rig = blank(); this.changed({ all: true }); },
  uid(p = "s") { return p + Math.random().toString(36).slice(2, 7); },

  attach(id, client) { this.clients.set(id, client); this.ensure(); this.emit({ rig: true, clients: true }); },
  detach(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    try { c.apply(new Map()); } catch {}
    this.ensure();
    this.emit({ rig: true, clients: true });
  },
  owner(addr) { for (const c of this.clients.values()) if (c.owns(addr)) return c; return null; },

  /* ---------- часы и «живые» данные системной стойки ---------- */
  beat(now = performance.now() / 1000) { return now * (this.rig.bpm || 120) / 60; },
  level() {
    const a = this.analyser || globalThis.nosPlayerGraph?.analyser;
    if (!a) return 0;
    const buf = this._buf ||= new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let m = 0; for (const x of buf) { const y = Math.abs(x); if (y > m) m = y; }
    return m;
  },
  rt(now, beat) {
    const r = { now, mouse: ax => this.mouse[ax] ?? 0.5, level: () => this.level() };
    r.srcVal = id => { const s = this.rig.mods.find(m => m.id === id); return s && s.type !== "wind" ? srcValue(s, beat, r) : 0; };
    return r;
  },
  value(src) {
    const now = performance.now() / 1000, beat = this.beat(now);
    return srcValue(src, beat, this.rt(now, beat));
  },
  isSys(src) { return this.rig.mods.includes(src); },

  /* ---------- тик ---------- */
  ensure() {
    const need = this.clients.size > 0 || this.rig.mods.some(m => m.wires?.length);
    if (need && !this.timer) this.timer = setInterval(() => this.tick(), 33);
    if (!need && this.timer) { clearInterval(this.timer); this.timer = null; this.restoreAll(); }
  },
  restoreAll() {
    for (const a of this.applied) Params.resolve(a)?.restore();
    this.applied.clear();
    this.over = new Map();
    this.emit({ tick: this.over });
  },
  tick() {
    const acc = new Map();
    const add = (mods, val) => {
      for (const s of mods || []) {
        if (!s.wires?.length) continue;
        const v = val(s), c = s.type === "lfo" ? 0.5 : 0;
        for (const w of s.wires) acc.set(w.to, (acc.get(w.to) || 0) + (w.amt ?? 1) * (v - c));
      }
    };
    add(this.rig.mods, s => this.value(s));
    for (const c of this.clients.values()) add(c.mods(), s => c.value(s));
    const over = new Map(), per = new Map(), seen = new Set();
    for (const [addr, sum] of acc) {
      const cl = this.owner(addr);
      const p = cl ? cl.param(addr) : Params.resolve(addr);
      if (!p?.spec) continue;
      const base = p.get ? p.get() : p.base?.();
      if (typeof base !== "number" || Number.isNaN(base)) continue;
      const { min, max } = p.spec;
      let v = clamp(base + sum * (max - min), min, max);
      if (p.spec.step) v = Math.round(v / p.spec.step) * p.spec.step;
      over.set(addr, v);
      if (cl) { if (!per.has(cl)) per.set(cl, new Map()); per.get(cl).set(addr, v); continue; }
      if (Math.abs(v - base) < 1e-6) continue;   // на базе — не трогаем (без лишних фильтров на окнах)
      p.apply(v);
      this.applied.add(addr); seen.add(addr);
    }
    for (const a of [...this.applied]) if (!seen.has(a)) { Params.resolve(a)?.restore(); this.applied.delete(a); }
    for (const c of this.clients.values()) c.apply(per.get(c) || new Map());
    this.over = over;
    this.emit({ tick: over });
  },

  /* ---------- цели: всё, что можно крутить ---------- */
  targets() {
    const out = [];
    for (const c of this.clients.values()) out.push(...(c.targets?.() || []));
    for (const x of Params.list()) out.push({ ...x, group: (x.provider || "ОС") + ": " + x.group });
    return out;
  },
  label(addr) {
    const c = this.owner(addr);
    if (c) return c.label?.(addr) || addr;
    const r = Params.resolve(addr), pre = /^(ui|win|rig)\./.test(addr) ? "" : addr.startsWith("bg.") ? "Фон · " : "ОС · ";
    return r?.label ? pre + r.label.replace(/^Фон · /, "") : addr;
  },
  known(addr) { return !!(this.owner(addr) || Params.resolve(addr)); },
};

addEventListener("pointermove", e => { Bus.mouse.x = e.clientX / innerWidth; Bus.mouse.y = e.clientY / innerHeight; }, { passive: true });
/* плеер ОС сообщает свой анализатор — источник «Громкость плеера» и педали ОС берут звук отсюда */
addEventListener("nos-player-graph", e => { Bus.analyser = e.detail?.analyser || null; });

/* запуск из main.js: стойка не пустая — тик и педали поднимаются сами после перезагрузки */
export async function init_bus() {
  Bus.ensure();
  if (Bus.rig.pedals.length) (await import("../apps/rig/pedalboard.js")).Pedalboard.boot();
}
