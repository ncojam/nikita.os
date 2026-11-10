import { adsr, bendDetune, handle } from "./instruments.js";
import { hz } from "./tuning.js";
import { GF_PRESETS, GF_WAVES_ALL, INDEX, MOD_KEYS, SHAPE_DEF, drawEnv, folder, setWave, shapeAt, waveKey } from "./grapefruit.js";

/* ================= DAWN — Bitter Lemon, живой FM-синтезатор =================
 * Те же 4 оператора и матрица, что у Grapefruit, но голос хранит свои узлы и умеет set(p):
 * ручки, матрица, фильтр и форма волны (в том числе нарисованная) меняют уже звучащие ноты.
 * Огибающие (ADSR и нарисованные) по-прежнему задаются в начале ноты.
 * Цепочка оператора: osc ─┬─ dry ──────────────────────┬─ envG (ADSR) → lvl (Level) ─┬→ out → pan → фильтр
 *                         └─ pre → foldEnv → фолдер → wet ┘                            └→ модуляция других операторов
 */
export const blWaves = () => [...GF_WAVES_ALL, "draw"];   // функцией: модули импортируют друг друга по кругу

const op = (o = {}) => ({ wave: "sine", ratio: 1, fine: 0, level: 1, out: 0, att: 0.003, dec: 0.4, sus: 0.6, rel: 0.3, ...o });
const shape = pts => ({ pts });
/* свои пресеты — с нарисованными волнами; остальные берутся из Grapefruit */
export const BL_OWN = {
  "Lemon Draw": { ops: [op({ wave: "draw", out: 0.9, att: 0.004, dec: 0.3, sus: 0.9, rel: 0.12,
      shape: shape([[0, 0, 0], [0.12, 0.95, -0.4], [0.4, 0.3, 0.5], [0.5, 0, 0], [0.62, -0.85, 0.3], [0.85, -0.4, -0.3], [1, 0, 0]]) }),
    op({ ratio: 2, level: 0.5, sus: 0.6 }), op({ ratio: 1, level: 0, sus: 1 }), op({ ratio: 0.5, out: 0.4, sus: 1, rel: 0.1 })],
    mod: { m21: 0.3, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0 }, cut: 6000, res: 1.5 },
  // крути Mod 2→1 и Fold руками, пока держишь ноту — вуб «говорит» вживую
  "Bitter Wub": { ops: [op({ wave: "draw", out: 0.9, att: 0.004, dec: 0.1, sus: 1, rel: 0.05, wfold: 0.2,
      shape: shape([[0, 0, 0], [0.05, 1, 0], [0.45, 0.7, 0.6], [0.5, -0.2, 0], [0.55, -1, 0], [1, 0, -0.6]]) }),
    op({ ratio: 1, level: 1, sus: 1 }), op({ ratio: 2, level: 0.4, sus: 1 }), op({ ratio: 0.5, out: 0.5, sus: 1, rel: 0.05 })],
    mod: { m21: 0.45, m31: 0, m41: 0, m32: 0.25, m42: 0, m43: 0 }, cut: 4000, res: 3 },
  "Sour Pad": { ops: [op({ wave: "draw", out: 0.7, att: 0.6, dec: 1, sus: 0.8, rel: 1.5,
      shape: shape([[0, 0, 0], [0.2, 0.8, -0.6], [0.5, 0, 0.6], [0.7, -0.6, -0.5], [1, 0, 0.5]]) }),
    op({ ratio: 2, level: 0.3, att: 0.8, sus: 0.7, rel: 1.5 }), op({ ratio: 1.003, out: 0.5, att: 0.7, sus: 0.8, rel: 1.6 }), op({ ratio: 3, level: 0.2, sus: 0.5 })],
    mod: { m21: 0.2, m31: 0, m41: 0, m32: 0, m42: 0, m43: 0.15 }, cut: 5000, res: 0.8 },
};
export const blPresetNames = () => [...Object.keys(BL_OWN), ...Object.keys(GF_PRESETS)];
export const blHas = name => !!(BL_OWN[name] || GF_PRESETS[name]);
export const blDefaults = (name = "Lemon Draw") => ({ preset: name, ...JSON.parse(JSON.stringify(BL_OWN[name] || GF_PRESETS[name] || BL_OWN["Lemon Draw"])) });

/* нарисовать волну из текущей формы оператора (чтобы переход на ✏ не сбрасывал звук) */
export function shapeFrom(o, n = 12) {
  if (o.wave === "draw") return o.shape || SHAPE_DEF();
  const src = { ...o, wsk: 0, wcrush: 0, wfold: 0 };
  return { pts: Array.from({ length: n + 1 }, (_, i) => [+(i / n).toFixed(3), +Math.max(-1, Math.min(1, shapeAt(src, (i / n) % 1, 0))).toFixed(3), 0]) };
}

const toG = x => (1 + Math.min(1, Math.max(0, x)) * 7) / 8;       // усиление перед фолдером (как в Grapefruit)
const wetOf = (o, envFold) => envFold ? 1 : Math.min(1, (o.wfold || 0) * 12);   // плавный вход в Fold от нуля
const mulOf = o => (o.ratio || 1) * Math.pow(2, o.oct || 0);
const T = 0.012;                                                   // сглаживание живых изменений, с

export function playBitterLemon(ctx, out, p, t, dur, n, v, edo = 12, bend = 0) {
  const f = hz(n, edo);
  const flt = ctx.createBiquadFilter(), env = ctx.createGain();
  flt.type = "lowpass"; flt.frequency.value = p.cut ?? 9000; flt.Q.value = p.res ?? 0.7;
  flt.connect(env); env.connect(out);
  env.gain.value = v * 0.3;
  const N = [], srcs = [];
  let end = t + dur;
  p.ops.forEach(o => {
    const E = o.env || {}, osc = ctx.createOscillator(), fineCS = ctx.createConstantSource();
    setWave(ctx, osc, o);
    osc.frequency.value = f * mulOf(o);
    bendDetune(osc.detune, t, dur, 0, bend, edo);
    fineCS.offset.value = o.fine || 0; fineCS.connect(osc.detune);
    srcs.push(osc, fineCS);
    if (E.pitch?.on) {
      const cs = ctx.createConstantSource(), range = (E.pitch.range ?? 12) * 100;
      drawEnv(cs.offset, t, dur, E.pitch, x => (x - 0.5) * 2 * range);
      cs.connect(osc.detune); srcs.push(cs);
    }
    const envG = ctx.createGain(), lvl = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), pre = ctx.createGain(), foldEnv = ctx.createGain(), ws = folder(ctx);
    const envFold = !!E.fold?.on;
    end = Math.max(end, E.vol?.on ? drawEnv(envG.gain, t, dur, E.vol, x => x) : adsr(envG, t, dur, o, 1));
    lvl.gain.value = o.level;
    pre.gain.value = toG(o.wfold || 0);
    if (envFold) { const base = toG(o.wfold || 0); end = Math.max(end, drawEnv(foldEnv.gain, t, dur, E.fold, x => toG(Math.max(o.wfold || 0, x)) / base)); }
    const w = wetOf(o, envFold); wet.gain.value = w; dry.gain.value = 1 - w;
    osc.connect(dry); dry.connect(envG);
    osc.connect(pre); pre.connect(foldEnv); foldEnv.connect(ws); ws.connect(wet); wet.connect(envG);
    envG.connect(lvl);
    const og = ctx.createGain(), pn = ctx.createStereoPanner();
    og.gain.value = o.out || 0; pn.pan.value = o.pan || 0;
    if (E.pan?.on) drawEnv(pn.pan, t, dur, E.pan, x => Math.max(-1, Math.min(1, (o.pan || 0) + x * 2 - 1)));
    lvl.connect(og); og.connect(pn); pn.connect(flt);
    N.push({ osc, fineCS, lvl, dry, wet, pre, og, pn, envFold, panEnv: !!E.pan?.on, wk: waveKey(o) });
  });
  // все клетки матрицы — сразу, даже пустые: их можно открыть, пока нота звучит
  const mg = {};
  for (const [key, from, to] of MOD_KEYS) {
    const g = ctx.createGain();
    g.gain.value = (p.mod?.[key] || 0) * INDEX * f * mulOf(p.ops[from - 1]);
    N[from - 1].lvl.connect(g);
    if (from > to) g.connect(N[to - 1].osc.frequency);
    else { const d = ctx.createDelay(0.01); d.delayTime.value = 128 / ctx.sampleRate; g.connect(d); d.connect(N[to - 1].osc.frequency); }
    mg[key] = g;
  }
  for (const s of srcs) { s.start(t); s.stop(end + 0.05); }
  const h = handle(ctx, env, srcs, end + 0.05, { flt });
  /* живое обновление: всё, кроме огибающих */
  h.set = q => {
    const now = ctx.currentTime;
    if (now >= h.end || now < t) return;
    const to = (param, x) => param.setTargetAtTime(x, now, T);
    q.ops.forEach((o, i) => {
      const X = N[i];
      if (!X) return;
      to(X.osc.frequency, f * mulOf(o));
      to(X.fineCS.offset, o.fine || 0);
      to(X.lvl.gain, o.level);
      to(X.og.gain, o.out || 0);
      if (!X.panEnv) to(X.pn.pan, o.pan || 0);
      if (!X.envFold) { const w = wetOf(o, false); to(X.pre.gain, toG(o.wfold || 0)); to(X.wet.gain, w); to(X.dry.gain, 1 - w); }
      const k = waveKey(o);
      if (k !== X.wk) { X.wk = k; setWave(ctx, X.osc, o); }
    });
    for (const [key, from] of MOD_KEYS) to(mg[key].gain, (q.mod?.[key] || 0) * INDEX * f * mulOf(q.ops[from - 1]));
    to(flt.frequency, q.cut ?? 9000); to(flt.Q, q.res ?? 0.7);
  };
  return h;
}
