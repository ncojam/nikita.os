import { adsr, bendDetune, handle } from "./instruments.js";
import { hz } from "./tuning.js";

/* ================= DAWN — Grapefruit, FM-синтезатор (в духе Sytrus) =================
 * 4 оператора. Оператор = генератор (sine/triangle/saw/square) с частотой f·ratio·fine, своей ADSR-огибающей
 * и уровнем. Матрица модуляции: оператор j может модулировать частоту оператора i (только j > i —
 * так в графе нет петель, Web Audio петли без задержки глушит). Глубина: index = mod · 6 · f_j (Гц).
 * Out — сколько оператора идёт в звук (несущая); модуляторам обычно ставят 0.
 */
export const GF_SPECS = {
  ratio: { min: 0.01, max: 32, def: 1, label: "Ratio", curve: 2 },
  oct:   { min: -4, max: 4, def: 0, label: "Oct", step: 1, bipolar: true },
  fine:  { min: -50, max: 50, def: 0, label: "Fine", bipolar: true },
  level: { min: 0, max: 1, def: 1, label: "Level" },
  out:   { min: 0, max: 1, def: 0, label: "Out" },
  pan:   { min: -1, max: 1, def: 0, label: "Pan", bipolar: true },
  mod:   { min: 0, max: 1, def: 0, label: "Mod", curve: 2 },
  // форма волны (как редактор волны в Sytrus): перекос фазы, складывание, ступеньки
  wsk:   { min: -1, max: 1, def: 0, label: "Skew", bipolar: true },
  wfold: { min: 0, max: 1, def: 0, label: "Fold" },
  wcrush:{ min: 0, max: 1, def: 0, label: "Crush" },
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
  "Neuro Bass": { ops: [op({ out: 1, dec: 0.4, sus: 0.9, rel: 0.1 }), op({ ratio: 1, level: 1, dec: 0.3, sus: 0.8 }),
    op({ ratio: 2, level: 0.7, att: 0.01, dec: 0.5, sus: 0.6 }), op({ ratio: 0.5, out: 0.7, dec: 0.3, sus: 1, rel: 0.08 })],
    mod: { m21: 0.75, m31: 0, m41: 0, m32: 0.55, m42: 0, m43: 0 }, cut: 3200, res: 3 },
  "Riddim FM": { ops: [op({ wave: "square", out: 0.8, dec: 0.2, sus: 0.85, rel: 0.05 }), op({ ratio: 1.5, level: 1, dec: 0.15, sus: 0.7 }),
    op({ ratio: 3, level: 0.6, dec: 0.1, sus: 0.4 }), op({ ratio: 0.5, out: 0.6, sus: 1, rel: 0.05 })],
    mod: { m21: 0.6, m31: 0, m41: 0, m32: 0.45, m42: 0, m43: 0 }, cut: 2200, res: 6 },
  "Metal Pluck": { ops: [op({ out: 1, dec: 0.35, sus: 0, rel: 0.25 }), op({ ratio: 3.5, level: 0.9, dec: 0.2, sus: 0 }),
    op({ ratio: 7.13, level: 0.5, dec: 0.08, sus: 0 }), op({ ratio: 1, out: 0.3, dec: 0.5, sus: 0, rel: 0.3 })],
    mod: { m21: 0.6, m31: 0.2, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 12000, res: 0.8 },
  "Digital Keys": { ops: [op({ out: 0.9, dec: 0.8, sus: 0.4, rel: 0.4 }), op({ ratio: 2, level: 0.7, dec: 0.4, sus: 0.2 }),
    op({ ratio: 1, out: 0.5, dec: 0.9, sus: 0.3, rel: 0.4 }), op({ ratio: 5, level: 0.4, dec: 0.15, sus: 0 })],
    mod: { m21: 0.3, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0.25 }, cut: 9000, res: 0.7 },
  // ---- риддим: простые гармоничные ratio (1, 2, ½), злость — от формы волны, огибающих модуляторов и модуляции ----
  // «Yoi»: огибающая громкости модулятора = глубина FM внутри ноты — вуб «говорит» йо-о-ой
  "Riddim Yoi": { ops: [op({ wave: "square", out: 0.9, att: 0.004, dec: 0.2, sus: 1, rel: 0.04 }),
    op({ ratio: 1, level: 1, env: { vol: { on: true, sus: 3, pts: [[0, 0.15], [0.09, 1], [0.22, 0.35], [0.4, 0.8], [0.5, 0.2]] } } }),
    op({ ratio: 2, level: 0.55, dec: 0.25, sus: 0.3 }), op({ ratio: 0.5, out: 0.45, sus: 1, rel: 0.04 })],
    mod: { m21: 0.65, m31: 0, m41: 0, m32: 0.35, m42: 0, m43: 0 }, cut: 4200, res: 3 },
  // складывание волны: пила + Fold, огибающая Fold «раскрывает» ноту
  "Riddim Fold": { ops: [op({ wave: "sawtooth", out: 0.9, att: 0.003, dec: 0.2, sus: 1, rel: 0.04, wfold: 0.35,
      env: { fold: { on: true, sus: 2, pts: [[0, 0.1], [0.12, 0.9], [0.3, 0.45], [0.45, 0.1]] } } }),
    op({ ratio: 1, level: 0.6, dec: 0.3, sus: 0.5 }), op({ ratio: 0.5, out: 0.5, sus: 1, rel: 0.04 }), op({ ratio: 2, level: 0.3, sus: 0.2 })],
    mod: { m21: 0.3, m31: 0, m41: 0.2, m32: 0, m42: 0, m43: 0 }, cut: 5200, res: 2 },
  // перекос фазы: квадрат «гнётся» в пилу — гнусавый робот; LFO в 1/8 крутит Skew от ноты к ноте
  "Riddim Skew": { ops: [op({ wave: "square", out: 1, att: 0.003, dec: 0.15, sus: 1, rel: 0.04, wsk: 0.55 }),
    op({ ratio: 2, level: 0.8, dec: 0.18, sus: 0.45 }), op({ ratio: 1, level: 0.5, sus: 0.8 }), op({ ratio: 0.5, out: 0.4, sus: 1, rel: 0.04 })],
    mod: { m21: 0.45, m31: 0.25, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 3800, res: 4 },
  // ступеньки: Crush + низкий модулятор — цифровой «рык»
  "Riddim Crush": { ops: [op({ wave: "square", out: 0.9, att: 0.003, dec: 0.1, sus: 1, rel: 0.03, wcrush: 0.55 }),
    op({ ratio: 0.5, level: 1, dec: 0.2, sus: 0.7 }), op({ ratio: 1, out: 0.4, sus: 1, rel: 0.03 }), op({ ratio: 3, level: 0.4, dec: 0.08, sus: 0 })],
    mod: { m21: 0.55, m31: 0, m41: 0.3, m32: 0, m42: 0, m43: 0 }, cut: 3000, res: 5 },
  // ratio модулятора качает LFO — металлический «лазер» на каждой ноте
  "Riddim Laser": { ops: [op({ wave: "sawtooth", out: 0.9, att: 0.003, dec: 0.2, sus: 1, rel: 0.04 }),
    op({ ratio: 3, level: 0.9, dec: 0.15, sus: 0.6, env: { pitch: { on: true, sus: -1, range: 12, pts: [[0, 1], [0.08, 0.5], [0.4, 0.5]] } } }),
    op({ ratio: 1, level: 0.4, sus: 0.6 }), op({ ratio: 0.5, out: 0.45, sus: 1, rel: 0.04 })],
    mod: { m21: 0.55, m31: 0.2, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 7000, res: 2 },
  // обратная связь 1→2 и 2→1: грязный «скрежет» tearout
  "Tearout Screech": { ops: [op({ wave: "square", out: 0.85, att: 0.002, dec: 0.15, sus: 1, rel: 0.03, wfold: 0.2 }),
    op({ ratio: 2, level: 1, dec: 0.25, sus: 0.8 }), op({ ratio: 1, level: 0.6, sus: 0.6 }), op({ ratio: 0.5, out: 0.4, sus: 1, rel: 0.03 })],
    mod: { m21: 0.6, m31: 0.3, m41: 0, m32: 0, m42: 0, m43: 0, m12: 0.35 }, cut: 6000, res: 3 },
  // полый вуб: hollow + Fold, высота модулятора ныряет в атаке
  "Riddim Hollow": { ops: [op({ wave: "hollow", out: 1, att: 0.004, dec: 0.2, sus: 1, rel: 0.04, wfold: 0.5 }),
    op({ ratio: 1, level: 0.7, env: { vol: { on: true, sus: 2, pts: [[0, 1], [0.05, 0.6], [0.3, 0.9], [0.45, 0]] } } }),
    op({ ratio: 0.5, out: 0.5, sus: 1, rel: 0.04 }), op({ ratio: 4, level: 0.25, dec: 0.1, sus: 0 })],
    mod: { m21: 0.5, m31: 0, m41: 0.15, m32: 0, m42: 0, m43: 0 }, cut: 4500, res: 6 },
  // медленный тяжёлый вуб: атака закруглена (ease), модуляция нарастает за всю ноту
  "Riddim Heavy Slow": { ops: [op({ wave: "square", out: 0.95, att: 0.28, dec: 0.05, sus: 1, rel: 0.02, ac: 0.6, wsk: 0.3 }),
    op({ ratio: 1, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0], [0.25, 0.8], [0.32, 1], [0.4, 0]] } } }),
    op({ ratio: 0.5, out: 0.5, att: 0.2, sus: 1, rel: 0.02, ac: 0.5 }), op({ ratio: 2, level: 0.4, sus: 0.4 })],
    mod: { m21: 0.7, m31: 0, m41: 0.25, m32: 0, m42: 0, m43: 0 }, cut: 3600, res: 3, fit: true },
  // Metal Crush на FM: синус октавой ниже + чуть квадрата; во «Creak» глубина FM растёт внутри ноты — скрип
  "Metal Crush FM": { ops: [op({ ratio: 0.5, out: 0.9, att: 0.05, dec: 0.2, sus: 1, rel: 0.02 }), op({ wave: "square", ratio: 0.5, out: 0.12, att: 0.05, sus: 1, rel: 0.02 }),
    op({ ratio: 1, level: 0.4, dec: 0.3, sus: 0.6 }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.15, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 2400, res: 1.2 },
  "Metal Creak FM": { ops: [op({ ratio: 0.5, out: 0.9, att: 0.04, dec: 0.2, sus: 1, rel: 0.02 }), op({ wave: "square", ratio: 0.5, out: 0.12, sus: 1, rel: 0.02 }),
    op({ ratio: 1.5, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0], [0.25, 0.7], [0.4, 1], [0.55, 0]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.3, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 2600, res: 2 },
  // ---- экстрим (от «Metal Creak FM» и «Metal Screech»): басовая основа, а металл и скрип растут к концу ноты ----
  "Extreme Creak FM": { ops: [op({ ratio: 0.5, out: 0.9, att: 0.03, dec: 0.2, sus: 1, rel: 0.02, env: { fold: { on: true, sus: 2, pts: [[0, 0], [0.3, 0.4], [0.5, 0.9], [0.6, 0]] } } }),
    op({ wave: "square", ratio: 0.5, out: 0.15, sus: 1, rel: 0.02 }),
    op({ ratio: 1.5, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0], [0.3, 0.6], [0.5, 1], [0.6, 0]] } } }), op({ ratio: 3, level: 0.6, env: { vol: { on: true, sus: 2, pts: [[0, 0], [0.35, 0.2], [0.5, 1], [0.6, 0]] } } })],
    mod: { m21: 0, m31: 0.6, m41: 0, m32: 0, m42: 0, m43: 0.4 }, cut: 6000, res: 2 },
  "Metal Scream FM": { ops: [op({ wave: "square", ratio: 0.5, out: 0.8, att: 0.02, sus: 1, rel: 0.02, env: { fold: { on: true, sus: 2, pts: [[0, 0.1], [0.4, 0.6], [0.55, 1], [0.65, 0]] } } }),
    op({ ratio: 0.5, out: 0.5, sus: 1, rel: 0.02 }),
    op({ ratio: 3, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0.05], [0.45, 1], [0.6, 0]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.75, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 7000, res: 3 },
  "Metal Howl FM": { ops: [op({ ratio: 0.5, out: 0.85, att: 0.03, sus: 1, rel: 0.02 }), op({ wave: "square", ratio: 0.5, out: 0.15, sus: 1, rel: 0.02 }),
    op({ ratio: 2, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0], [0.4, 0.8], [0.5, 1], [0.6, 0]] }, pitch: { on: true, sus: -1, range: 12, pts: [[0, 0.5], [0.5, 0.75]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.55, m41: 0, m32: 0, m42: 0, m43: 0, m13: 0.25 }, cut: 6500, res: 4 },
  "Shred FM": { ops: [op({ wave: "square", ratio: 0.5, out: 0.85, att: 0.02, sus: 1, rel: 0.02, wcrush: 0.5 }), op({ ratio: 0.5, out: 0.4, sus: 1, rel: 0.02 }),
    op({ ratio: 2, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0.1], [0.35, 0.5], [0.5, 1], [0.6, 0]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.6, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 5000, res: 3 },
  "Iron Yoi FM": { ops: [op({ ratio: 0.5, out: 0.9, att: 0.02, sus: 1, rel: 0.02, wfold: 0.2 }), op({ wave: "square", ratio: 0.5, out: 0.15, sus: 1, rel: 0.02 }),
    op({ ratio: 1.5, level: 1, env: { vol: { on: true, sus: 3, pts: [[0, 0.6], [0.1, 0.1], [0.3, 0.5], [0.45, 1], [0.6, 0]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.7, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 6000, res: 2 },
  "Creak Glide FM": { ops: [op({ ratio: 0.5, out: 0.9, att: 0.03, sus: 1, rel: 0.02 }), op({ wave: "square", ratio: 0.5, out: 0.12, sus: 1, rel: 0.02 }),
    op({ ratio: 1, level: 1, env: { vol: { on: true, sus: 2, pts: [[0, 0.2], [0.4, 0.8], [0.5, 1], [0.6, 0]] }, pitch: { on: true, sus: -1, range: 24, pts: [[0, 0.5], [0.55, 1]] } } }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0, m31: 0.5, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 6000, res: 3 },
  "Sub FM": { ops: [op({ out: 1, dec: 0.3, sus: 1, rel: 0.08 }), op({ ratio: 1, level: 0.4, dec: 0.1, sus: 0.1 }),
    op({ ratio: 1, out: 0, level: 0 }), op({ ratio: 1, out: 0, level: 0 })],
    mod: { m21: 0.15, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 900, res: 0.7 },
};
/* «гармонично»: ratio прилипает к целым и простым дробям — обертоны ложатся в гармонический ряд, без диссонанса */
export const HARMONIC = [0.25, 1 / 3, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
export function snapRatio(v, dir = 0) {
  if (dir > 0) return HARMONIC.find(h => h > v - 1e-9 && h >= v) ?? HARMONIC.at(-1);
  if (dir < 0) return [...HARMONIC].reverse().find(h => h <= v + 1e-9) ?? HARMONIC[0];
  return HARMONIC.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
}

/* матрица модуляции: m<от><кому> для любой пары. Старший → младшему — напрямую; младший → старшему (обратная связь)
 * идёт через задержку в один блок (~3 мс) — иначе Web Audio глушит петлю. */
export const MOD_KEYS = [];
for (let to = 1; to <= 4; to++) for (let from = 1; from <= 4; from++) if (from !== to) MOD_KEYS.push(["m" + from + to, from, to]);
export const gfDefaults = (name = "E-Piano") => ({ preset: name, ...JSON.parse(JSON.stringify(GF_PRESETS[name])) });

/* формы волны: базовые + PeriodicWave; custom — 8 гармоник, нарисованных в редакторе */
export const GF_WAVES_ALL = ["sine", "triangle", "sawtooth", "square", "organ", "pulse", "hollow", "custom"];
const HARM = { organ: [1, 0.6, 0, 0.35, 0, 0, 0, 0.2], pulse: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3], hollow: [1, 0, 0.5, 0, 0.3, 0, 0.2, 0] };
const waveCache = new WeakMap();
function periodic(ctx, harm) {
  const key = harm.map(x => (+x).toFixed(2)).join(","), m = waveCache.get(ctx) || new Map();
  waveCache.set(ctx, m);
  if (!m.has(key)) {
    const re = new Float32Array(harm.length + 1), im = new Float32Array(harm.length + 1);
    harm.forEach((a, i) => { im[i + 1] = +a || 0; });
    m.set(key, ctx.createPeriodicWave(re, im));
  }
  return m.get(key);
}
/* один период базовой волны в точке x ∈ [0, 1) */
function baseAt(o, x) {
  switch (o.wave) {
    case "triangle": return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
    case "sawtooth": return 2 * ((x + 0.5) % 1) - 1;
    case "square": return x < 0.5 ? 1 : -1;
    case "sine": case undefined: return Math.sin(2 * Math.PI * x);
  }
  const h = o.wave === "custom" ? (o.harm || [1]) : HARM[o.wave] || [1];
  let y = 0, n = 0;
  h.forEach((a, i) => { y += (+a || 0) * Math.sin(2 * Math.PI * (i + 1) * x); n += Math.abs(+a || 0); });
  return n ? y / n * 1.6 : 0;
}
/* форма волны оператора: перекос фазы (Skew), складывание (Fold), ступеньки (Crush) */
export function shapeAt(o, x, fold = o.wfold || 0) {
  const sk = o.wsk || 0;
  if (sk) { const m = 0.5 + 0.45 * sk; x = x < m ? 0.5 * x / m : 0.5 + 0.5 * (x - m) / (1 - m); }
  let y = baseAt(o, x);
  if (fold > 0.001) y = Math.sin(y * (1 + fold * 7) * Math.PI / 2);
  const cr = o.wcrush || 0;
  if (cr > 0.001) { const q = Math.max(1, Math.round(2 + (1 - cr) * 24)); y = Math.round(y * q) / q; }
  return y;
}
const shapedCache = new Map();   // ключ формы → [re, im] (ctx не нужен)
function shapedCoef(o) {
  const key = [o.wave, o.wave === "custom" ? (o.harm || []).join(",") : "", (+o.wsk || 0).toFixed(2), (+o.wcrush || 0).toFixed(2)].join("|");
  if (shapedCache.has(key)) return [key, shapedCache.get(key)];
  const NS = 1024, NH = 48, y = new Float32Array(NS), re = new Float32Array(NH + 1), im = new Float32Array(NH + 1);
  for (let i = 0; i < NS; i++) y[i] = shapeAt(o, i / NS, 0);   // Fold — отдельно, живым шейпером (его можно вести огибающей)
  for (let k = 1; k <= NH; k++) { let a = 0, b = 0; for (let i = 0; i < NS; i++) { const ph = 2 * Math.PI * k * i / NS; a += y[i] * Math.cos(ph); b += y[i] * Math.sin(ph); } re[k] = 2 * a / NS; im[k] = 2 * b / NS; }
  if (shapedCache.size > 400) shapedCache.clear();
  shapedCache.set(key, [re, im]);
  return [key, [re, im]];
}
const shapedWaves = new WeakMap();
function setWave(ctx, osc, o) {
  if (o.wsk || o.wcrush) {
    const [key, [re, im]] = shapedCoef(o), m = shapedWaves.get(ctx) || new Map();
    shapedWaves.set(ctx, m);
    if (!m.has(key)) m.set(key, ctx.createPeriodicWave(re, im));
    return osc.setPeriodicWave(m.get(key));
  }
  const h = o.wave === "custom" ? (o.harm || [1, 0, 0, 0, 0, 0, 0, 0]) : HARM[o.wave];
  if (h) osc.setPeriodicWave(periodic(ctx, h)); else osc.type = o.wave || "sine";
}
/* складывание волны: синус-фолдер; вход усиливается (1 + fold·7) раз — чем больше, тем больше складок */
let foldCurve = null;
function folder(ctx) {
  if (!foldCurve) { foldCurve = new Float32Array(2049); for (let i = 0; i < 2049; i++) { const x = (i / 1024 - 1) * 8; foldCurve[i] = Math.sin(x * Math.PI / 2); } }
  const ws = ctx.createWaveShaper(); ws.curve = foldCurve; ws.oversample = "2x";
  return ws;
}

/* нарисованная огибающая: pts [[секунды, 0..1]], sus — индекс точки, на которой держим, пока нажата нота (-1 — без удержания).
 * map(v) → значение параметра. Возвращает момент конца огибающей. */
export const ENV_KINDS = { vol: "Громкость", pan: "Панорама", pitch: "Высота", fold: "Fold (форма)" };
export function envDefault(kind) {
  return kind === "vol" ? { on: false, sus: 2, pts: [[0, 0], [0.01, 1], [0.3, 0.6], [0.6, 0]] }
    : kind === "fold" ? { on: false, sus: 2, pts: [[0, 0], [0.1, 0.8], [0.3, 0.4], [0.5, 0]] }
    : kind === "pan" ? { on: false, sus: -1, pts: [[0, 0.5], [0.5, 0.5]] }
    : { on: false, sus: -1, range: 12, pts: [[0, 0.5], [0.5, 0.5]] };
}
function drawEnv(param, t0, dur, env, map) {
  const pts = [...env.pts].sort((a, b) => a[0] - b[0]);
  if (!pts.length) return t0 + dur;
  const sus = env.sus >= 0 && env.sus < pts.length ? env.sus : -1;
  param.cancelScheduledValues(t0);
  param.setValueAtTime(map(pts[0][1]), t0);
  const upto = sus >= 0 ? sus : pts.length - 1;
  for (let i = 1; i <= upto; i++) param.linearRampToValueAtTime(map(pts[i][1]), t0 + pts[i][0]);
  if (sus < 0) return t0 + Math.max(dur, pts.at(-1)[0]);
  // отпустили ноту: держим значение и доигрываем хвост после точки удержания
  const off = t0 + Math.max(dur, pts[sus][0]), st = pts[sus][0];
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(off); else { param.cancelScheduledValues(off); param.setValueAtTime(map(pts[sus][1]), off); }
  for (let i = sus + 1; i < pts.length; i++) param.linearRampToValueAtTime(map(pts[i][1]), off + (pts[i][0] - st));
  return off + (pts.at(-1)[0] - st);
}

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
    setWave(ctx, osc, o);
    osc.frequency.value = f * o.ratio * Math.pow(2, o.oct || 0);
    bendDetune(osc.detune, t, dur, o.fine, bend, edo);
    const E = o.env || {};
    end = Math.max(end, E.vol?.on ? drawEnv(g.gain, t, dur, E.vol, x => x * o.level) : adsr(g, t, dur, o, o.level));
    if (E.pitch?.on) {   // высота: добавка к detune через постоянный источник
      const cs = ctx.createConstantSource(), range = (E.pitch.range ?? 12) * 100;
      drawEnv(cs.offset, t, dur, E.pitch, x => (x - 0.5) * 2 * range);
      cs.connect(osc.detune); srcs.push(cs);
    }
    // Fold: осциллятор → усиление → синус-фолдер; огибающая Fold ведёт усиление внутри ноты (форма волны меняется во времени)
    if ((o.wfold || 0) > 0.001 || E.fold?.on) {
      const pre = ctx.createGain(), ws = folder(ctx), base = o.wfold || 0, toG = x => (1 + Math.min(1, x) * 7) / 8;
      if (E.fold?.on) end = Math.max(end, drawEnv(pre.gain, t, dur, E.fold, x => toG(Math.max(base, x))));
      else pre.gain.value = toG(base);
      osc.connect(pre); pre.connect(ws); ws.connect(g);
    } else osc.connect(g);
    if (o.out > 0.001) {
      const og = ctx.createGain(), pn = ctx.createStereoPanner();
      og.gain.value = o.out; pn.pan.value = o.pan || 0;
      if (E.pan?.on) drawEnv(pn.pan, t, dur, E.pan, x => Math.max(-1, Math.min(1, (o.pan || 0) + x * 2 - 1)));
      g.connect(og); og.connect(pn); pn.connect(flt);
    }
    oscs.push(osc); gains.push(g); srcs.push(osc);
  });
  for (const [key, from, to] of MOD_KEYS) {
    const m = p.mod?.[key] || 0;
    if (m < 0.001) continue;
    const mg = ctx.createGain();
    mg.gain.value = m * INDEX * f * p.ops[from - 1].ratio * Math.pow(2, p.ops[from - 1].oct || 0);
    gains[from - 1].connect(mg);
    if (from > to) mg.connect(oscs[to - 1].frequency);
    else { const d = ctx.createDelay(0.01); d.delayTime.value = 128 / ctx.sampleRate; mg.connect(d); d.connect(oscs[to - 1].frequency); }
  }
  for (const s of srcs) { s.start(t); s.stop(end + 0.05); }
  return handle(ctx, env, srcs, end + 0.05, { flt });
}
