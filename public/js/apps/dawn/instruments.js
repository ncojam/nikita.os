import { hz } from "./tuning.js";
import { gfDefaults } from "./grapefruit.js";

/* ================= DAWN — инструменты =================
 * Голос = функция (ctx, out, params, t, dur, n, v, edo, bend) → ручка голоса
 *   { end — когда голос можно глушить, kill(t) — быстро заглушить (кража при полифонии), flt — фильтр (для модуляции) }.
 * bend — изгиб высоты к концу ноты, в ступенях строя (как slide в FL).
 * Работает в любом (Offline)AudioContext — живой звук и рендер в WAV идут через одни и те же функции.
 * Высота n — в ступенях строя канала (см. tuning.js), частота — hz(n, edo).
 */
/* ---------- описания параметров (для крутилок и, в этапе 3, для огибающих) ---------- */
export const SPECS = {
  vol:   { min: 0, max: 1.25, def: 0.8, label: "Vol" },
  pan:   { min: -1, max: 1, def: 0, label: "Pan", bipolar: true },
  // 3XOSC
  o_vol: { min: 0, max: 1, def: 0.6, label: "Vol" },
  o_crs: { min: -24, max: 24, def: 0, label: "Crs", step: 1, bipolar: true },
  o_fin: { min: -100, max: 100, def: 0, label: "Fine", bipolar: true },
  o_pan: { min: -1, max: 1, def: 0, label: "Pan", bipolar: true },
  att:   { min: 0.001, max: 2, def: 0.005, label: "Att", curve: 3 },
  dec:   { min: 0.01, max: 3, def: 0.25, label: "Dec", curve: 3 },
  sus:   { min: 0, max: 1, def: 0.7, label: "Sus" },
  rel:   { min: 0.01, max: 4, def: 0.25, label: "Rel", curve: 3 },
  // закругление участков ADSR: < 0 — быстро в начале (выпукло), > 0 — медленно в начале (изинг «вверх»)
  ac:    { min: -1, max: 1, def: 0, label: "A~", bipolar: true },
  dc:    { min: -1, max: 1, def: 0, label: "D~", bipolar: true },
  rc:    { min: -1, max: 1, def: 0, label: "R~", bipolar: true },
  cut:   { min: 40, max: 18000, def: 9000, label: "Cut", curve: 4 },
  res:   { min: 0.1, max: 18, def: 0.8, label: "Res", curve: 2 },
  // сэмплер
  root:  { min: 24, max: 96, def: 60, label: "Root", step: 1 },
  tune:  { min: -12, max: 12, def: 0, label: "Tune", bipolar: true },
  start: { min: 0, max: 0.95, def: 0, label: "Start" },
  // unison у 3XOSC: сколько голосов на осциллятор, их разброс по высоте и по панораме
  uni:   { min: 1, max: 8, def: 1, label: "Voices", step: 1 },
  udet:  { min: 0, max: 100, def: 20, label: "Detune" },
  uspr:  { min: 0, max: 1, def: 0.6, label: "Spread" },
  // общие для любого инструмента
  poly:  { min: 1, max: 32, def: 16, label: "Poly", step: 1 },
};

export const WAVES = ["sine", "triangle", "sawtooth", "square", "noise"];
export const WAVE_GLYPH = { sine: "∿", triangle: "⋀", sawtooth: "⊿", square: "⊓", noise: "≋" };

/* ---------- инструменты ---------- */
export const DEFAULT_PARAMS = {
  osc3: () => ({
    oscs: [
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: -6, o_pan: -0.2 },
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: 6, o_pan: 0.2 },
      { wave: "square", o_vol: 0.3, o_crs: -12, o_fin: 0, o_pan: 0 },
    ],
    att: 0.005, dec: 0.3, sus: 0.6, rel: 0.3, cut: 6000, res: 1.2, uni: 1, udet: 20, uspr: 0.6,
  }),
  sampler: () => ({ path: null, root: 60, tune: 0, start: 0, att: 0.001, rel: 0.08, oneshot: true, rev: false }),
  grapefruit: () => gfDefaults(),
};

export const TYPES = {
  osc3: { name: "3XOSC", icon: "🌈", color: "#c3a6ff" },
  grapefruit: { name: "Grapefruit", icon: "🍊", color: "#ffb3b3" },
  sampler: { name: "Sampler", icon: "🎧", color: "#8fe8cf" },
};

let noiseBuf = null;
function getNoise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* огибающая громкости: A → D → S, на note-off — R. Возвращает время, когда голос можно глушить */
/* кривая участка: x 0..1 → 0..1; c — изгиб (-1..1), 0 — прямая */
export function ease(x, c = 0) {
  if (Math.abs(c) < 0.01) return x;
  const k = c * 6;
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}
/* ADSR с закруглёнными участками: ломаная из 16 отрезков на участок (setValueCurve нельзя прервать на note-off) */
function adsrCurved(g, t, dur, p, peak) {
  const a = Math.max(0.001, p.att), d = p.dec ?? 0.001, s = p.sus ?? 1, r = p.rel, off = t + Math.max(dur, a), SEG = 16;
  const seg = (t0, len, v0, v1, c) => { for (let i = 1; i <= SEG; i++) { const tt = t0 + len * i / SEG; if (tt > off) break; g.gain.linearRampToValueAtTime(v0 + (v1 - v0) * ease(i / SEG, c), tt); } };
  const at = x => x < t + a ? peak * ease((x - t) / a, p.ac || 0) : x < t + a + d ? peak + (peak * s - peak) * ease((x - t - a) / Math.max(1e-4, d), p.dc || 0) : peak * s;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0, t);
  seg(t, a, 0, peak, p.ac || 0);
  if (t + a < off) seg(t + a, d, peak, peak * s, p.dc || 0);
  const v = at(off);
  g.gain.linearRampToValueAtTime(v, off);
  for (let i = 1; i <= SEG; i++) g.gain.linearRampToValueAtTime(v * (1 - ease(i / SEG, p.rc || 0)), off + r * i / SEG);
  return off + r + 0.05;
}
export function adsr(g, t, dur, p, peak) {
  if (p.ac || p.dc || p.rc) return adsrCurved(g, t, dur, p, peak);
  const a = p.att, d = p.dec ?? 0.001, s = p.sus ?? 1, r = p.rel;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  const off = t + Math.max(dur, a);
  g.gain.cancelScheduledValues(off);
  g.gain.setTargetAtTime(0, off, Math.max(0.001, r / 4));
  return off + r * 1.2 + 0.05;
}
/* ручка голоса: kill — быстрый спад и остановка источников (кража голоса, стоп) */
export function handle(ctx, env, srcs, end, extra = {}) {
  return {
    end, ...extra,
    kill(t = ctx.currentTime) {
      if (t >= this.end) return;
      try {
        env.gain.cancelScheduledValues(t);
        env.gain.setTargetAtTime(0, t, 0.006);
        for (const s of srcs) s.stop(t + 0.05);
      } catch { /* уже остановлен */ }
      this.end = t + 0.05;
    },
  };
}
/* изгиб: detune в центах от a к a + bend к концу ноты */
export function bendDetune(param, t, dur, base, bend, edo) {
  param.setValueAtTime(base, t);
  if (bend) param.linearRampToValueAtTime(base + bend * 1200 / edo, t + Math.max(0.01, dur));
}

export function playOsc3(ctx, out, p, t, dur, n, v, edo = 12, bend = 0) {
  const env = ctx.createGain();
  const flt = ctx.createBiquadFilter();
  flt.type = "lowpass"; flt.frequency.value = p.cut; flt.Q.value = p.res;
  flt.connect(env); env.connect(out);
  const end = adsr(env, t, dur, p, v * 0.35);
  const srcs = [];
  const uni = Math.max(1, Math.round(p.uni || 1));
  for (const o of p.oscs) {
    if (o.o_vol <= 0.001) continue;
    const voices = o.wave === "noise" ? 1 : uni;
    for (let u = 0; u < voices; u++) {
      const spread = voices > 1 ? u / (voices - 1) - 0.5 : 0;      // -0.5..0.5
      const g = ctx.createGain(); g.gain.value = o.o_vol / Math.sqrt(voices);
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, o.o_pan + spread * 2 * (p.uspr ?? 0.6)));
      let src;
      if (o.wave === "noise") { src = ctx.createBufferSource(); src.buffer = getNoise(ctx); src.loop = true; }
      else {
        src = ctx.createOscillator(); src.type = o.wave;
        src.frequency.value = hz(n, edo) * 2 ** (o.o_crs / 12);
        bendDetune(src.detune, t, dur, o.o_fin + spread * (p.udet ?? 20), bend, edo);
      }
      src.connect(g); g.connect(pan); pan.connect(flt);
      src.start(t + (u ? Math.random() * 0.003 : 0)); src.stop(end);   // крошечный разброс старта — фазы не совпадают
      srcs.push(src);
    }
  }
  return handle(ctx, env, srcs, end, { flt });
}

/* ---------- встроенные ударные (рендерятся при первом обращении, путь "builtin:имя") ---------- */
export const BUILTIN = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat", openhat: "Open hat", tom: "Tom",
  kickhard: "Kick punch", kick808: "808", snarefat: "Snare fat", rim: "Rim", snap: "Snap", shaker: "Shaker",
  crash: "Crash", ride: "Ride", cowbell: "Cowbell", conga: "Conga", metal: "Metal hit", impact: "Impact", revcrash: "Reverse crash" };
const BUILTIN_DUR = { kick: 0.6, snare: 0.35, clap: 0.4, hat: 0.08, openhat: 0.45, tom: 0.5, kickhard: 0.5, kick808: 1.5, snarefat: 0.45, rim: 0.1,
  snap: 0.2, shaker: 0.15, crash: 2, ride: 1.3, cowbell: 0.4, conga: 0.3, metal: 0.35, impact: 2.5, revcrash: 2 };
/* новые ударные: из простых генераторов, с насыщением (tanh) — сразу «жирные» */
function extraDrum(oc, name, out, noise, env, sr) {
  const sat = (k = 2) => { const ws = oc.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } ws.curve = c; ws.connect(out); return ws; };
  const osc = (type, f, dest, g0, dec, t = 0) => { const o = oc.createOscillator(), g = oc.createGain(); o.type = type; o.frequency.value = f; env(g, g0, dec, t); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + 0.02); return o; };
  const nz = (type, f, q, dest, g0, dec, t = 0) => { const n = noise(), fl = oc.createBiquadFilter(), g = oc.createGain(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, g0, dec, t); n.connect(fl); fl.connect(g); g.connect(dest); n.start(t); return n; };
  const metal = (dest, g0, dec, freqs = [205, 304, 369, 522, 540, 800]) => { const bus = oc.createGain(); bus.gain.value = 1 / freqs.length; bus.connect(dest); freqs.forEach(f => osc("square", f * 1.71, bus, g0, dec)); };
  if (name === "kickhard" || name === "kick808" || name === "impact") {
    const [f0, f1, sweep, dec, drive] = { kickhard: [230, 48, 0.07, 0.42, 3], kick808: [120, 46, 0.06, 1.35, 1.6], impact: [90, 28, 0.9, 2.3, 2.5] }[name];
    const s = sat(drive), o = osc("sine", f0, s, 1, dec);
    o.frequency.setValueAtTime(f0, 0); o.frequency.exponentialRampToValueAtTime(f1, sweep);
    if (name !== "kick808") nz("highpass", name === "impact" ? 200 : 2500, 0.7, s, name === "impact" ? 0.5 : 0.35, name === "impact" ? 1.6 : 0.015);
    if (name === "impact") nz("lowpass", 400, 0.7, out, 0.6, 2.2);
  } else if (name === "snarefat") {
    const s = sat(2.2);
    nz("bandpass", 1900, 0.7, s, 0.9, 0.3); nz("highpass", 6000, 0.7, s, 0.35, 0.12);
    const b = osc("triangle", 200, s, 0.8, 0.12); b.frequency.setValueAtTime(240, 0); b.frequency.exponentialRampToValueAtTime(170, 0.08); osc("sine", 330, s, 0.35, 0.08);
  } else if (name === "rim") { const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 3; bp.connect(out); osc("triangle", 820, bp, 1, 0.05); osc("square", 1650, bp, 0.5, 0.03); }
  else if (name === "snap") { for (const t of [0, 0.008, 0.016]) nz("bandpass", 2600, 2, out, 0.9, 0.012, t); nz("bandpass", 2400, 1.2, out, 0.6, 0.11, 0.022); }
  else if (name === "shaker") { const n = noise(), hp = oc.createBiquadFilter(), g = oc.createGain(); hp.type = "highpass"; hp.frequency.value = 5500; g.gain.setValueAtTime(0.001, 0); g.gain.linearRampToValueAtTime(0.5, 0.025); g.gain.exponentialRampToValueAtTime(0.001, 0.13); n.connect(hp); hp.connect(g); g.connect(out); n.start(); }
  else if (name === "crash" || name === "revcrash") { const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000; hp.connect(out); metal(hp, 0.6, 1.8); nz("highpass", 4000, 0.7, out, 0.55, 1.9); }
  else if (name === "ride") { const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000; hp.connect(out); metal(hp, 0.5, 1.2, [310, 435, 520, 690]); osc("sine", 5200, out, 0.12, 0.6); nz("highpass", 9000, 0.7, out, 0.15, 0.5); }
  else if (name === "cowbell") { const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 1.5; const s = sat(1.5); bp.connect(s); osc("square", 545, bp, 0.8, 0.32); osc("square", 815, bp, 0.8, 0.32); }
  else if (name === "conga") { const o = osc("sine", 320, out, 0.9, 0.25); o.frequency.setValueAtTime(330, 0); o.frequency.exponentialRampToValueAtTime(230, 0.05); nz("bandpass", 2000, 1, out, 0.15, 0.02); }
  else if (name === "metal") { const s = sat(3); metal(s, 0.9, 0.3, [610, 870, 1131, 1420]); nz("bandpass", 3500, 2, s, 0.4, 0.06); }
}
async function renderBuiltin(name, sr) {
  const dur = BUILTIN_DUR[name] || 0.4;
  const oc = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
  const noise = () => { const b = oc.createBuffer(1, oc.length, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = oc.createBufferSource(); s.buffer = b; return s; };
  const env = (g, peak, decay, t = 0) => { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + decay); };
  const out = oc.createGain(); out.connect(oc.destination);
  if (name === "kick" || name === "tom") {
    const o = oc.createOscillator(), g = oc.createGain();
    const [f0, f1] = name === "kick" ? [150, 45] : [220, 110];
    o.frequency.setValueAtTime(f0, 0); o.frequency.exponentialRampToValueAtTime(f1, 0.12);
    env(g, 1, dur * 0.9); o.connect(g); g.connect(out); o.start(); o.stop(dur);
    const c = noise(), cg = oc.createGain(), hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    env(cg, 0.25, 0.012); c.connect(hp); hp.connect(cg); cg.connect(out); c.start();
  } else if (name === "snare") {
    const n = noise(), g = oc.createGain(), bp = oc.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = 1500;
    env(g, 0.8, 0.22); n.connect(bp); bp.connect(g); g.connect(out); n.start();
    const o = oc.createOscillator(), og = oc.createGain(); o.frequency.value = 190; env(og, 0.6, 0.1);
    o.connect(og); og.connect(out); o.start(); o.stop(dur);
  } else if (name === "clap") {
    const n = noise(), g = oc.createGain(), bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
    for (const t of [0, 0.012, 0.024]) { g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); }
    g.gain.setValueAtTime(0.7, 0.036); g.gain.exponentialRampToValueAtTime(0.0008, 0.3);
    n.connect(bp); bp.connect(g); g.connect(out); n.start();
  } else if (name === "hat" || name === "openhat") {
    const n = noise(), g = oc.createGain(), hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    env(g, 0.6, name === "hat" ? 0.06 : 0.4); n.connect(hp); hp.connect(g); g.connect(out); n.start();
  } else extraDrum(oc, name, out, noise, env, sr);
  const buf = await oc.startRendering();
  if (name === "revcrash") { const d = buf.getChannelData(0); d.reverse(); }   // тарелка задом наперёд — «засос» перед дропом
  return buf;
}

/* ---------- кэш сэмплов ---------- */
const buffers = new Map();      // путь -> Promise<AudioBuffer>
const reversed = new Map();     // путь -> AudioBuffer задом наперёд
const fsUrl = p => "/fs" + p.split("/").map(encodeURIComponent).join("/");
export function loadSample(ctx, path) {
  if (!path) return Promise.resolve(null);
  if (!buffers.has(path) && path.startsWith("builtin:"))
    buffers.set(path, renderBuiltin(path.slice(8), ctx.sampleRate).catch(() => null));
  if (!buffers.has(path))
    buffers.set(path, fetch(fsUrl(path)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(a => ctx.decodeAudioData(a)).catch(e => { buffers.delete(path); console.warn("DAWN sample", path, e); return null; }));
  return buffers.get(path);
}
export function sampleNow(path) { return buffers.get(path)?._v || null; }   // уже загруженный (для отрисовки волны)
/* загрузить и запомнить декодированный буфер (sampleNow отдаёт его синхронно) */
export async function ensureSample(ctx, path) {
  const b = await loadSample(ctx, path);
  if (b && buffers.get(path)) buffers.get(path)._v = b;
  return b;
}
function rev(buf, path) {
  if (reversed.has(path)) return reversed.get(path);
  const r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set([...buf.getChannelData(c)].reverse());
  reversed.set(path, r);
  return r;
}

export function playSampler(ctx, out, p, t, dur, n, v, buf, edo = 12, bend = 0) {
  if (!buf) return null;
  const b = p.rev ? rev(buf, p.path) : buf;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const rate = 2 ** (n / edo - p.root / 12 + p.tune / 12);   // root — MIDI-нота сэмпла
  src.playbackRate.setValueAtTime(rate, t);
  if (bend) src.playbackRate.exponentialRampToValueAtTime(rate * 2 ** (bend / edo), t + Math.max(0.01, dur));
  const env = ctx.createGain();
  src.connect(env); env.connect(out);
  const len = (b.duration * (1 - p.start)) / rate;
  const hold = p.oneshot ? len : Math.min(len, dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + p.att);
  const off = t + Math.max(hold, p.att);
  env.gain.setTargetAtTime(0, off, Math.max(0.001, p.rel / 4));
  const end = off + p.rel * 1.2 + 0.02;
  src.start(t, b.duration * p.start);
  src.stop(end);
  return handle(ctx, env, [src], end);
}

