import { fxDefaults } from "./fx.js";
import { GF_PRESETS, gfDefaults } from "./grapefruit.js";
import { UserLib } from "./userlib.js";

/* ================= DAWN — пресеты звуков =================
 * Пресет = параметры инструмента + (необязательно) цепочка эффектов, которую он ставит на свой инсерт:
 * у басов звук делают дисторшн и OTT, поэтому «крутой звук одной кнопкой» включает и их.
 */
const o = (wave, o_vol, o_crs = 0, o_fin = 0, o_pan = 0) => ({ wave, o_vol, o_crs, o_fin, o_pan });
const fx = (type, p = {}) => ({ type, on: true, p: { ...fxDefaults(type), ...p } });

export const OSC3_PRESETS = {
  "Sub Bass": { params: { oscs: [o("sine", 0.9), o("triangle", 0.18), o("sine", 0)], att: 0.004, dec: 0.2, sus: 1, rel: 0.07, cut: 380, res: 0.7, uni: 1 },
    fx: [fx("eq", { lf: 45, lg: 4, mf: 250, mg: -6, hf: 2000, hg: -12 }), fx("dist", { drive: 0.25, shape: 0, mix: 0.3, out: 0.8 })] },
  "Reese": { params: { oscs: [o("sawtooth", 0.6, 0, -14, -0.4), o("sawtooth", 0.6, 0, 14, 0.4), o("sine", 0.75, -12)], att: 0.01, dec: 0.3, sus: 0.9, rel: 0.12, cut: 900, res: 4, uni: 2, udet: 18, uspr: 0.8 },
    fx: [fx("dist", { drive: 0.45, shape: 0, tone: 6000, mix: 0.8, out: 0.7 }), fx("ott", { depth: 0.6, high: 3 }), fx("eq", { lf: 45, lg: 2, mf: 300, mg: -3, hf: 6000, hg: -2 })] },
  "Riddim Growl": { params: { oscs: [o("square", 0.6, 0, -9, -0.3), o("sawtooth", 0.55, 0, 9, 0.3), o("square", 0.35, 12)], att: 0.002, dec: 0.18, sus: 0.75, rel: 0.05, cut: 700, res: 10, uni: 1 },
    fx: [fx("dist", { drive: 0.7, shape: 2, tone: 7000, mix: 1, out: 0.55 }), fx("ott", { depth: 0.8, time: 0.6, low: -6, high: 4 }), fx("eq", { lf: 120, lg: -9, mf: 900, mg: 3, mq: 1.5, hf: 6000, hg: -2 })] },
  "Wobble": { params: { oscs: [o("sawtooth", 0.6, 0, -6), o("square", 0.5, 0, 6), o("sine", 0.6, -12)], att: 0.005, dec: 0.2, sus: 0.9, rel: 0.08, cut: 400, res: 12, uni: 1 },
    fx: [fx("dist", { drive: 0.55, shape: 0, mix: 0.9, out: 0.6 }), fx("ott", { depth: 0.5 })] },
  "Hoover": { params: { oscs: [o("sawtooth", 0.5, 0, 0, -0.2), o("sawtooth", 0.4, -12, 7, 0.2), o("square", 0.2, 12, -7)], att: 0.03, dec: 0.4, sus: 0.8, rel: 0.25, cut: 3200, res: 2, uni: 7, udet: 60, uspr: 1 },
    fx: [fx("dist", { drive: 0.3, shape: 0, mix: 0.5 }), fx("reverb", { decay: 1.8, mix: 0.15 })] },
  "Supersaw Lead": { params: { oscs: [o("sawtooth", 0.55), o("sawtooth", 0.35, 12), o("square", 0.2, -12)], att: 0.01, dec: 0.3, sus: 0.75, rel: 0.3, cut: 7500, res: 1, uni: 7, udet: 35, uspr: 0.9 },
    fx: [fx("ott", { depth: 0.4, high: 2 }), fx("delay", { sync: 2, fb: 0.35, mix: 0.2 }), fx("reverb", { decay: 2.2, mix: 0.2 })] },
  "Neon Pluck": { params: { oscs: [o("sawtooth", 0.5, 0, -8), o("square", 0.4, 0, 8), o("sine", 0.4, 12)], att: 0.002, dec: 0.22, sus: 0, rel: 0.25, cut: 4500, res: 3, uni: 3, udet: 15, uspr: 0.7 },
    fx: [fx("delay", { sync: 2, fb: 0.4, mix: 0.3 }), fx("reverb", { decay: 2.5, mix: 0.25 })] },
  "Ambient Pad": { params: { oscs: [o("triangle", 0.5, 0, -5, -0.3), o("sawtooth", 0.25, 0, 5, 0.3), o("sine", 0.4, 12)], att: 1.2, dec: 1, sus: 0.85, rel: 2.5, cut: 2400, res: 0.8, uni: 5, udet: 25, uspr: 1 },
    fx: [fx("eq", { lf: 250, lg: -10, hf: 8000, hg: 2 }), fx("reverb", { decay: 6, pre: 0.05, mix: 0.45 })] },
  "Chip Lead": { params: { oscs: [o("square", 0.5), o("square", 0.25, 12, 3), o("triangle", 0.3, -12)], att: 0.002, dec: 0.1, sus: 0.6, rel: 0.08, cut: 9000, res: 0.7, uni: 1 },
    fx: [fx("delay", { sync: 1, fb: 0.3, mix: 0.2 })] },
  // от cojam: синус на октаву вниз + немного квадрата, crush с закрытым тоном — верха открывают Tone/Cut
  "Crush Bass Slow": { params: { oscs: [o("sawtooth", 0, 0, -6, -0.2), o("sine", 0.8944, -12, 6, 0.2), o("square", 0.0884, -12)], att: 0.3775, dec: 0.1273, sus: 0, rel: 0.01, cut: 1249, res: 1.2, uni: 1, udet: 20, uspr: 0.93 },
    fx: [fx("dist", { drive: 0.7964, shape: 3, tone: 616, mix: 1, out: 0.95 })] },
  "Crush Bass Snap": { params: { oscs: [o("sawtooth", 0, 0, -6, -0.2), o("sine", 0.8944, -12, 6, 0.2), o("square", 0.0884, -12)], att: 0.1876, dec: 0.1628, sus: 0, rel: 0.01, cut: 1249, res: 1.2, uni: 1, udet: 20, uspr: 0.93 },
    fx: [fx("dist", { drive: 0.7964, shape: 3, tone: 616, mix: 1, out: 0.95 })] },
  // от cojam: металлический — crush на Tone 500, а огибающая «по ноте» на каждой ноте приоткрывает Tone
  "Metal Crush": { params: { oscs: [o("sawtooth", 0, 0, -6, -0.2), o("sine", 0.8944, -12, 6, 0.2), o("square", 0.0884, -12)], att: 0.2926, dec: 0.22, sus: 1, rel: 0.01, cut: 1249, res: 1.2, uni: 1, udet: 20, uspr: 0.93 },
    fx: [fx("dist", { drive: 0.8744, shape: 3, tone: 500, mix: 1, out: 1.2386 })],
    mods: [{ type: "trig", name: "Metal tone", trig: { att: 72.5, hold: 77.3, rel: 250, vel: true }, wires: [{ to: "fx.0.tone", amt: 0.5 }] }] },
  "Noise Riser": { params: { oscs: [o("noise", 0.7), o("sawtooth", 0.15, 12, 7), o("sine", 0)], att: 4, dec: 0.5, sus: 1, rel: 0.4, cut: 600, res: 6, uni: 1 },
    fx: [fx("reverb", { decay: 4, mix: 0.4 })] },
};

/* Grapefruit: параметры — из GF_PRESETS, эффекты — здесь */
const GF_FX = {
  "Neuro Bass": [fx("dist", { drive: 0.6, shape: 2, tone: 8000, out: 0.6 }), fx("ott", { depth: 0.8, low: -4, high: 4 }), fx("eq", { lf: 60, lg: 2, mf: 500, mg: -3, hf: 7000, hg: 1 })],
  "Riddim FM": [fx("dist", { drive: 0.75, shape: 3, tone: 6000, out: 0.5 }), fx("ott", { depth: 0.9, time: 0.5 }), fx("eq", { lf: 120, lg: -8, mf: 800, mg: 3, hf: 5000, hg: -2 })],
  "FM Bass": [fx("dist", { drive: 0.35, mix: 0.7 }), fx("ott", { depth: 0.5 })],
  "Sub FM": [fx("eq", { lf: 45, lg: 4, mf: 300, mg: -6, hf: 2000, hg: -12 })],
  "Glass Pad": [fx("reverb", { decay: 5, mix: 0.4 })],
  "Bell": [fx("delay", { sync: 4, fb: 0.4, mix: 0.25 }), fx("reverb", { decay: 4, mix: 0.35 })],
  "Metal Pluck": [fx("delay", { sync: 2, fb: 0.35, mix: 0.25 }), fx("reverb", { decay: 2.5, mix: 0.25 })],
};

/* свои пресеты (UserLib) — с префиксом «★ » */
export const USER = "★ ";
export function presetsFor(type) {
  const own = UserLib.names("synth").filter(n => UserLib.get("synth", n).type === type).map(n => USER + n);
  if (type === "osc3") return [...own, ...Object.keys(OSC3_PRESETS)];
  if (type === "grapefruit") return [...own, ...Object.keys(GF_PRESETS)];
  return own;
}
/* применить пресет к каналу: параметры + эффекты на его инсерт (если инсерт только его) */
export function applyPreset(Engine, ch, name) {
  let fxChain = null, mods = null;
  const own = name.startsWith(USER) ? UserLib.get("synth", name.slice(USER.length)) : null;
  if (own) {
    if (own.type !== ch.type) return;
    ch.params = JSON.parse(JSON.stringify(own.params));
    fxChain = own.fx?.length ? own.fx : null; mods = own.mods || [];
  } else if (ch.type === "osc3" && OSC3_PRESETS[name]) {
    Object.assign(ch.params, JSON.parse(JSON.stringify(OSC3_PRESETS[name].params)));
    fxChain = OSC3_PRESETS[name].fx;
  } else if (ch.type === "grapefruit" && GF_PRESETS[name]) {
    Object.assign(ch.params, gfDefaults(name));
    fxChain = GF_FX[name] || [];
  } else return;
  ch.preset = name;
  const P = Engine.project, shared = i => i <= 0 || P.channels.some(c => c !== ch && (c.mix || 0) === i);
  // общий инсерт (или Master) — пересаживаем канал на свободный, чтобы эффекты пресета не задели соседей
  if (shared(ch.mix || 0)) { const free = P.mixer.findIndex((m, k) => k > 0 && !P.channels.some(c => c !== ch && c.mix === k)); if (free > 0) { ch.mix = free; P.mixer[free].name = ch.name.slice(0, 20); Engine.G.refresh(); } }
  const i = ch.mix || 0, alone = !shared(i);
  if (fxChain && alone) {
    P.mixer[i].fx = JSON.parse(JSON.stringify(fxChain));
    Engine.G.rebuildFx(i);
  }
  // модуляция пресета: старая (от прошлого пресета этого канала) уходит; «fx.N.x» — эффект на инсерте канала, «ch.x» — сам канал
  P.mods = (P.mods || []).filter(m => m.presetOf !== ch.id);
  if (!own) mods = ch.type === "osc3" ? OSC3_PRESETS[name].mods : null;
  if (mods && alone) for (const [k, m] of mods.entries()) {
    P.mods.push({ id: `p${ch.id}${k}`.slice(0, 24), presetOf: ch.id, type: m.type, name: m.name, color: ch.color, value: m.value ?? 0.5,
      trig: { ch: ch.id, att: 5, hold: 40, rel: 250, vel: true, ...m.trig }, meter: { mix: i, gain: 1.5 },
      env: m.env ? JSON.parse(JSON.stringify(m.env)) : { len: 16, loop: true, pts: [[0, 0], [16, 1]] }, lfo: m.lfo ? { ...m.lfo } : { sync: 3, shape: "sine", phase: 0 },
      wires: m.wires.map(w => ({ to: w.to.replace(/^fx\./, `mix.${i}.`).replace(/^ch\./, `ch.${ch.id}.`), amt: w.amt })) });
  }
  Engine.touch({ channels: true, mixer: true, mods: true });
}
