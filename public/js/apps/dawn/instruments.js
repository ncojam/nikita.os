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
  cut:   { min: 40, max: 18000, def: 9000, label: "Cut", curve: 4 },
  res:   { min: 0.1, max: 18, def: 0.8, label: "Res", curve: 2 },
  // сэмплер
  root:  { min: 24, max: 96, def: 60, label: "Root", step: 1 },
  tune:  { min: -12, max: 12, def: 0, label: "Tune", bipolar: true },
  start: { min: 0, max: 0.95, def: 0, label: "Start" },
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
    att: 0.005, dec: 0.3, sus: 0.6, rel: 0.3, cut: 6000, res: 1.2,
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
export function adsr(g, t, dur, p, peak) {
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
  for (const o of p.oscs) {
    if (o.o_vol <= 0.001) continue;
    const g = ctx.createGain(); g.gain.value = o.o_vol;
    const pan = ctx.createStereoPanner(); pan.pan.value = o.o_pan;
    let src;
    if (o.wave === "noise") { src = ctx.createBufferSource(); src.buffer = getNoise(ctx); src.loop = true; }
    else {
      src = ctx.createOscillator(); src.type = o.wave;
      src.frequency.value = hz(n, edo) * 2 ** (o.o_crs / 12);
      bendDetune(src.detune, t, dur, o.o_fin, bend, edo);
    }
    src.connect(g); g.connect(pan); pan.connect(flt);
    src.start(t); src.stop(end);
    srcs.push(src);
  }
  return handle(ctx, env, srcs, end, { flt });
}

/* ---------- встроенные ударные (рендерятся при первом обращении, путь "builtin:имя") ---------- */
export const BUILTIN = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat", openhat: "Open hat", tom: "Tom" };
async function renderBuiltin(name, sr) {
  const dur = { kick: 0.6, snare: 0.35, clap: 0.4, hat: 0.08, openhat: 0.45, tom: 0.5 }[name] || 0.4;
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
  } else {   // hat / openhat
    const n = noise(), g = oc.createGain(), hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    env(g, 0.6, name === "hat" ? 0.06 : 0.4); n.connect(hp); hp.connect(g); g.connect(out); n.start();
  }
  return oc.startRendering();
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

