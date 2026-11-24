import { AudioOS } from "../../core/audio.js";
import { Bus } from "../../core/bus.js";
import { Params } from "../../core/params.js";
import { FX as DAWN_FX, fxDefaults, loadCodeWorklet } from "../dawn/fx.js";
import { UTIL } from "./utilfx.js";

/* ================= Педали ОС — звуковой движок системной стойки =================
 * Каждая педаль из Bus.rig.pedals — узел звука ОС (core/audio.js) «pedal:<id>» со своим входом и выходом.
 * Куда она стоит, решают кабели (приложение «Звук»): например, плеер → педаль → микшер ОС.
 * Эффекты — те же, что в DAWN (dawn/fx.js), кроме сайдчейна (ему нужны ноты DAWN).
 * Выключенная педаль пропускает звук насквозь (кабели остаются на месте).
 * Параметры педалей — цели проводков: rig.<id педали>.<параметр> (провайдер Params, группа «Педали ОС»).
 */
/* все педали ОС: эффекты DAWN (кроме сайдчейна) + служебные (уровень, разветвитель, смеситель, формула) */
export const FX = { ...Object.fromEntries(Object.entries(DAWN_FX).filter(([, f]) => !Object.values(f.params).some(p => p.kind === "channel"))), ...UTIL };
export const RIG_FX = Object.keys(FX);
export const portsOf = type => FX[type]?.ports || { ins: [""], outs: [""] };

export function newPedal(type) {
  const p = UTIL[type] ? Object.fromEntries(Object.entries(UTIL[type].params).map(([k, s]) => [k, s.def])) : fxDefaults(type);
  return { id: Bus.uid("p"), type, on: true, p };
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
      const ports = portsOf(pd.type), sig = ports.ins.join(",") + "|" + ports.outs.join(",");
      if (u && u.sig !== sig) { this.drop(pd.id); AudioOS.unregister("pedal:" + pd.id); u = null; }   // другие гнёзда — новый узел
      if (!u) {
        // постоянные гнёзда: кабели держатся за них, а эффект внутри можно менять и выключать
        u = { ins: Object.fromEntries(ports.ins.map(k => [k, ctx.createGain()])), outs: Object.fromEntries(ports.outs.map(k => [k, ctx.createGain()])), fx: null, type: null, on: null, sig };
        this.units.set(pd.id, u);
        const multiIn = ports.ins.length > 1 || ports.ins[0] !== "", multiOut = ports.outs.length > 1 || ports.outs[0] !== "";
        const unit = u;
        AudioOS.register({ id: "pedal:" + pd.id, title: FX[pd.type].name, icon: FX[pd.type].icon, kind: "fx", pedal: pd.id,
          input: (from, port) => unit.ins[port] ?? unit.ins[ports.ins[0]],
          ...(multiIn ? { ins: ports.ins } : {}),
          ...(multiOut ? { outs: unit.outs } : { output: unit.outs[""] }),
          get meters() { return unit.fx?.meters; } });
      }
      if (u.type !== pd.type || u.on !== pd.on) {
        for (const g of Object.values(u.ins)) { try { g.disconnect(); } catch {} }
        if (u.fx) { try { for (const o of Object.values(u.fx.outs || { "": u.fx.output })) o.disconnect(); u.fx.dispose?.(); } catch {} u.fx = null; }
        if (pd.on) {
          const fx = u.fx = FX[pd.type].create(ctx, this.params(pd));
          fx.tempo?.(Bus.rig.bpm || 120);
          const fi = fx.ins || { "": fx.input }, fo = fx.outs || { "": fx.output };
          for (const k of ports.ins) u.ins[k].connect(fi[k]);
          for (const k of ports.outs) fo[k].connect(u.outs[k]);
        } else for (const k of ports.outs) u.ins[ports.ins[0]].connect(u.outs[k]);   // выключена — первый вход насквозь на все выходы
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
    try { for (const g of [...Object.values(u.ins), ...Object.values(u.outs)]) g.disconnect(); u.fx?.dispose?.(); } catch {}
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
