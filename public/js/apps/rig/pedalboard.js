import { AudioOS } from "../../core/audio.js";
import { Bus } from "../../core/bus.js";
import { Params } from "../../core/params.js";
import { FX, fxDefaults, loadCodeWorklet } from "../dawn/fx.js";

/* ================= Педали ОС — звуковой движок системной стойки =================
 * Каждая педаль из Bus.rig.pedals — узел звука ОС (core/audio.js) «pedal:<id>» со своим входом и выходом.
 * Куда она стоит, решают кабели (приложение «Звук»): например, плеер → педаль → микшер ОС.
 * Эффекты — те же, что в DAWN (dawn/fx.js), кроме сайдчейна (ему нужны ноты DAWN).
 * Выключенная педаль пропускает звук насквозь (кабели остаются на месте).
 * Параметры педалей — цели проводков: rig.<id педали>.<параметр> (провайдер Params, группа «Педали ОС»).
 */
export const RIG_FX = Object.keys(FX).filter(t => !Object.values(FX[t].params).some(p => p.kind === "channel"));

export function newPedal(type) {
  return { id: Bus.uid("p"), type, on: true, p: fxDefaults(type) };
}

export const Pedalboard = {
  units: new Map(),   // id → { inG, outG, fx, type, on }
  over: new Map(),    // адрес → значение от проводов
  booted: false,

  boot() {
    if (this.booted) return;
    this.booted = true;
    Bus.on(e => { if (e.rig) this.sync(); });
    this.sync();
  },
  find(id) { return Bus.rig.pedals.find(p => p.id === id); },
  params(pd) {
    const p = { ...pd.p };
    for (const k of Object.keys(p)) { const a = `rig.${pd.id}.${k}`; if (this.over.has(a)) p[k] = this.over.get(a); }
    return p;
  },
  /* привести узлы в соответствие со стойкой: новые — создать, удалённые — убрать, сменился тип/вкл — пересобрать внутри */
  sync() { return (this._q = (this._q || Promise.resolve()).then(() => this._sync()).catch(e => console.warn("pedals:", e))); },
  async _sync() {
    const ctx = AudioOS.context();
    if (Bus.rig.pedals.some(p => p.type === "formula" || p.type === "code")) await loadCodeWorklet(ctx).catch(() => {});
    const ids = new Set(Bus.rig.pedals.map(p => p.id));
    for (const id of [...this.units.keys()]) if (!ids.has(id)) { this.drop(id); AudioOS.unregister("pedal:" + id); }
    for (const pd of Bus.rig.pedals) {
      if (!FX[pd.type]) continue;
      let u = this.units.get(pd.id);
      if (!u) {
        u = { inG: ctx.createGain(), outG: ctx.createGain(), fx: null, type: null, on: null };
        this.units.set(pd.id, u);
        AudioOS.register({ id: "pedal:" + pd.id, title: FX[pd.type].name, icon: FX[pd.type].icon, kind: "fx", input: () => u.inG, output: u.outG, pedal: pd.id });
      }
      if (u.type !== pd.type || u.on !== pd.on) {
        try { u.inG.disconnect(); } catch {}
        if (u.fx) { try { u.fx.output.disconnect(); u.fx.dispose?.(); } catch {} u.fx = null; }
        if (pd.on) {
          u.fx = FX[pd.type].create(ctx, this.params(pd));
          u.fx.tempo?.(Bus.rig.bpm || 120);
          u.inG.connect(u.fx.input); u.fx.output.connect(u.outG);
        } else u.inG.connect(u.outG);           // выключена — насквозь
        u.type = pd.type; u.on = pd.on;
        const n = AudioOS.nodes.get("pedal:" + pd.id);
        if (n) { n.title = FX[pd.type].name; n.icon = FX[pd.type].icon; }
        AudioOS.emit();
      }
    }
  },
  drop(id) {
    const u = this.units.get(id);
    if (!u) return;
    try { u.inG.disconnect(); u.outG.disconnect(); u.fx?.output.disconnect(); u.fx?.dispose?.(); } catch {}
    this.units.delete(id);
  },
  set(id) {
    const pd = this.find(id), u = this.units.get(id);
    if (pd && u?.fx) u.fx.set(this.params(pd));
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
