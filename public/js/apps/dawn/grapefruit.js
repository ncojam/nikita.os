import { adsr, bendDetune, handle } from "./instruments.js";
import { hz } from "./tuning.js";

/* ================= DAWN — Grapefruit, FM-синтезатор (в духе Sytrus) =================
 * 4 оператора. Оператор = генератор (sine/triangle/saw/square) с частотой f·ratio·fine, своей ADSR-огибающей
 * и уровнем. Матрица модуляции: оператор j может модулировать частоту оператора i (только j > i —
 * так в графе нет петель, Web Audio петли без задержки глушит). Глубина: index = mod · 6 · f_j (Гц).
 * Out — сколько оператора идёт в звук (несущая); модуляторам обычно ставят 0.
 */
export const GF_SPECS = {
  ratio: { min: 0.25, max: 16, def: 1, label: "Ratio", curve: 2 },
  fine:  { min: -50, max: 50, def: 0, label: "Fine", bipolar: true },
  level: { min: 0, max: 1, def: 1, label: "Level" },
  out:   { min: 0, max: 1, def: 0, label: "Out" },
  mod:   { min: 0, max: 1, def: 0, label: "Mod", curve: 2 },
};
export const GF_WAVES = ["sine", "triangle", "sawtooth", "square"];
const INDEX = 6;

const op = (o = {}) => ({ wave: "sine", ratio: 1, fine: 0, level: 1, out: 0, att: 0.003, dec: 0.4, sus: 0.6, rel: 0.3, ...o });
/* mod: [[2→1, 3→1, 4→1], [3→2, 4→2], [4→3]] — плоско: m21, m31, m41, m32, m42, m43 */
export const GF_PRESETS = {
  "E-Piano": { ops: [op({ out: 1, dec: 1.4, sus: 0.15, rel: 0.5 }), op({ ratio: 1, level: 0.9, dec: 0.6, sus: 0.05 }),
    op({ ratio: 14, level: 0.6, dec: 0.08, sus: 0 }), op({ ratio: 1, out: 0.35, dec: 1.2, sus: 0.2, rel: 0.4 })],
    mod: { m21: 0.38, m31: 0.08, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 9000, res: 0.7 },
  "Bell": { ops: [op({ out: 1, dec: 3, sus: 0, rel: 2 }), op({ ratio: 3.5, level: 0.8, dec: 2.2, sus: 0 }),
    op({ ratio: 1.0015, out: 0.5, dec: 2.5, sus: 0, rel: 2 }), op({ ratio: 5.19, level: 0.6, dec: 1, sus: 0 })],
    mod: { m21: 0.5, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0.35 }, cut: 14000, res: 0.6 },
  "FM Bass": { ops: [op({ out: 1, dec: 0.5, sus: 0.6, rel: 0.12 }), op({ ratio: 1, level: 1, dec: 0.25, sus: 0.25 }),
    op({ ratio: 2, level: 0.7, dec: 0.15, sus: 0.1 }), op({ ratio: 0.5, out: 0.5, dec: 0.4, sus: 0.7, rel: 0.1 })],
    mod: { m21: 0.6, m31: 0, m41: 0, m32: 0.3, m42: 0, m43: 0 }, cut: 2400, res: 2 },
  "Glass Pad": { ops: [op({ out: 0.8, att: 0.8, dec: 1, sus: 0.8, rel: 1.6 }), op({ ratio: 2, level: 0.6, att: 1.2, dec: 1, sus: 0.7, rel: 1.6 }),
    op({ ratio: 1.003, out: 0.6, att: 0.9, sus: 0.8, rel: 1.8 }), op({ ratio: 4, level: 0.4, att: 1.5, sus: 0.6, rel: 1.6 })],
    mod: { m21: 0.25, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0.2 }, cut: 7000, res: 0.8 },
  "Pluck": { ops: [op({ out: 1, dec: 0.35, sus: 0, rel: 0.2 }), op({ ratio: 2, level: 1, dec: 0.15, sus: 0 }),
    op({ ratio: 3, level: 0.5, dec: 0.08, sus: 0 }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0.7, m31: 0, m41: 0, m32: 0.4, m42: 0, m43: 0 }, cut: 8000, res: 1 },
};
export const MOD_KEYS = [["m21", 2, 1], ["m31", 3, 1], ["m41", 4, 1], ["m32", 3, 2], ["m42", 4, 2], ["m43", 4, 3]];
export const gfDefaults = (name = "E-Piano") => ({ preset: name, ...JSON.parse(JSON.stringify(GF_PRESETS[name])) });

export function playGrapefruit(ctx, out, p, t, dur, n, v, edo = 12, bend = 0) {
  const f = hz(n, edo);
  const flt = ctx.createBiquadFilter(), env = ctx.createGain();
  flt.type = "lowpass"; flt.frequency.value = p.cut ?? 9000; flt.Q.value = p.res ?? 0.7;
  flt.connect(env); env.connect(out);
  env.gain.value = v * 0.3;
  const oscs = [], gains = [], srcs = [];
  let end = t + dur;
  p.ops.forEach((o, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.wave;
    osc.frequency.value = f * o.ratio;
    bendDetune(osc.detune, t, dur, o.fine, bend, edo);
    end = Math.max(end, adsr(g, t, dur, o, o.level));
    osc.connect(g);
    if (o.out > 0.001) { const og = ctx.createGain(); og.gain.value = o.out; g.connect(og); og.connect(flt); }
    oscs.push(osc); gains.push(g); srcs.push(osc);
  });
  for (const [key, from, to] of MOD_KEYS) {
    const m = p.mod?.[key] || 0;
    if (m < 0.001) continue;
    const mg = ctx.createGain();
    mg.gain.value = m * INDEX * f * p.ops[from - 1].ratio;
    gains[from - 1].connect(mg); mg.connect(oscs[to - 1].frequency);
  }
  for (const o of oscs) { o.start(t); o.stop(end); }
  return handle(ctx, env, srcs, end, { flt });
}
