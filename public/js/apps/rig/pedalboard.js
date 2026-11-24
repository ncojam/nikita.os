import { Bus } from "../../core/bus.js";
import { Params } from "../../core/params.js";
import { FX, fxDefaults, loadCodeWorklet } from "../dawn/fx.js";

/* ================= Педали ОС — звуковой движок системной стойки =================
 * Педали из Bus.rig.pedals стоят цепочкой в гнезде плеера ОС (apps/player.js: fxIn → педали → fxOut),
 * сверху вниз. Эффекты — те же, что в DAWN (dawn/fx.js), кроме сайдчейна (ему нужны ноты DAWN).
 * Параметры педалей — цели проводков: rig.<id педали>.<параметр> (провайдер Params, группа «Педали ОС»).
 * Пока плеер не играл, звукового графа нет — педали ждут события nos-player-graph.
 */
export const RIG_FX = Object.keys(FX).filter(t => !Object.values(FX[t].params).some(p => p.kind === "channel"));

export function newPedal(type) {
  return { id: Bus.uid("p"), type, on: true, p: fxDefaults(type) };
}

export const Pedalboard = {
  chain: new Map(),   // id → эффект Web Audio
  over: new Map(),    // адрес → значение от проводов
  sig: "",
  booted: false,

  boot() {
    if (this.booted) return;
    this.booted = true;
    addEventListener("nos-player-graph", () => { this.sig = ""; this.rebuild(); });
    Bus.on(e => { if (e.rig) this.rebuild(); });
    this.rebuild();
  },
  graph() { return globalThis.nosPlayerGraph || null; },
  find(id) { return Bus.rig.pedals.find(p => p.id === id); },
  params(pd) {
    const p = { ...pd.p };
    for (const k of Object.keys(p)) { const a = `rig.${pd.id}.${k}`; if (this.over.has(a)) p[k] = this.over.get(a); }
    return p;
  },
  /* цепочка перестраивается, только когда поменялся её состав (типы, порядок, вкл/выкл) */
  async rebuild(force = false) {
    const g = this.graph();
    const sig = Bus.rig.pedals.map(p => p.id + ":" + p.type + ":" + (p.on ? 1 : 0)).join("|");
    if (!g || (!force && sig === this.sig)) return;
    this.sig = sig;
    if (Bus.rig.pedals.some(p => p.on && (p.type === "formula" || p.type === "code"))) await loadCodeWorklet(g.ctx).catch(() => {});
    try { g.fxIn.disconnect(); } catch {}
    for (const fx of this.chain.values()) { try { fx.output.disconnect(); fx.dispose(); } catch {} }
    this.chain.clear();
    let node = g.fxIn;
    for (const pd of Bus.rig.pedals) {
      if (!pd.on || !FX[pd.type]) continue;
      const fx = FX[pd.type].create(g.ctx, this.params(pd));
      fx.tempo?.(Bus.rig.bpm || 120);
      node.connect(fx.input);
      node = fx.output;
      this.chain.set(pd.id, fx);
    }
    node.connect(g.fxOut);
  },
  set(id) {
    const pd = this.find(id), fx = this.chain.get(id);
    if (pd && fx) fx.set(this.params(pd));
  },
};

/* цели для проводков: ручки педалей ОС */
Params.addProvider({
  prefix: "rig.",
  label: "Педали ОС",
  list() {
    const out = [];
    for (const pd of Bus.rig.pedals) {
      const fx = FX[pd.type];
      if (!fx) continue;
      for (const [k, s] of Object.entries(fx.params)) if (!s.kind) out.push({ addr: `rig.${pd.id}.${k}`, label: `${fx.icon} ${fx.name} · ${s.label}`, group: "Педали" });
    }
    return out;
  },
  resolve(addr) {
    const [, id, k] = addr.split(".");
    const pd = Pedalboard.find(id), s = pd && FX[pd.type]?.params[k];
    if (!s || s.kind) return null;
    return { label: `${FX[pd.type].icon} ${FX[pd.type].name} · ${s.label}`, spec: s,
      base: () => pd.p[k],
      apply: v => { Pedalboard.over.set(addr, v); Pedalboard.set(id); },
      restore: () => { Pedalboard.over.delete(addr); Pedalboard.set(id); } };
  },
});
