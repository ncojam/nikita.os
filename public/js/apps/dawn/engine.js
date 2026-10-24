/* ================= DAWN — движок =================
 * Один на всё приложение: окна модулей (транспорт, стойка, пиано ролл, панели инструментов…)
 * только смотрят на Engine.project и зовут его методы. Закрыли окно — звук и данные живут дальше.
 *
 * Время: шаг (step) = 1/16 такта = 1/4 доли. Ноты: { s: начало в шагах (дробное), l: длина в шагах,
 * n: MIDI-нота, v: громкость 0..1 }. Шаги стойки и пиано ролл — одни и те же ноты (как в FL).
 *
 * Планировщик — классический lookahead: таймер раз в 25 мс досылает в Web Audio всё, что должно
 * прозвучать в ближайшие 120 мс, с точным временем ctx.currentTime.
 *
 * События (Engine.on(имя, cb)): "change" — изменилась модель (перерисовать), "play"/"stop",
 * "pattern" — выбрали другой паттерн, "tick" — для плейхеда (из rAF, не из таймера).
 */
const LOOKAHEAD = 0.12, TIMER_MS = 25;
export const STEPS_PER_BAR = 16;
export const PASTEL = ["#ff9ecf", "#c3a6ff", "#8fe8cf", "#ffc59e", "#9fd3ff", "#fff09e", "#ffb3b3", "#b8f59e"];

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mtof = n => 440 * 2 ** ((n - 69) / 12);

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
};

export const WAVES = ["sine", "triangle", "sawtooth", "square", "noise"];
export const WAVE_GLYPH = { sine: "∿", triangle: "⋀", sawtooth: "⊿", square: "⊓", noise: "≋" };

/* ---------- инструменты ---------- */
const DEFAULT_PARAMS = {
  osc3: () => ({
    oscs: [
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: -6, o_pan: -0.2 },
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: 6, o_pan: 0.2 },
      { wave: "square", o_vol: 0.3, o_crs: -12, o_fin: 0, o_pan: 0 },
    ],
    att: 0.005, dec: 0.3, sus: 0.6, rel: 0.3, cut: 6000, res: 1.2,
  }),
  sampler: () => ({ path: null, root: 60, tune: 0, start: 0, att: 0.001, rel: 0.08, oneshot: true, rev: false }),
};

export const TYPES = {
  osc3: { name: "3XOSC", icon: "🌈", color: "#c3a6ff" },
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
function adsr(g, t, dur, p, peak) {
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

function playOsc3(ctx, out, p, t, dur, n, v) {
  const env = ctx.createGain();
  const flt = ctx.createBiquadFilter();
  flt.type = "lowpass"; flt.frequency.value = p.cut; flt.Q.value = p.res;
  flt.connect(env); env.connect(out);
  const end = adsr(env, t, dur, p, v * 0.35);
  for (const o of p.oscs) {
    if (o.o_vol <= 0.001) continue;
    const g = ctx.createGain(); g.gain.value = o.o_vol;
    const pan = ctx.createStereoPanner(); pan.pan.value = o.o_pan;
    let src;
    if (o.wave === "noise") { src = ctx.createBufferSource(); src.buffer = getNoise(ctx); src.loop = true; }
    else {
      src = ctx.createOscillator(); src.type = o.wave;
      src.frequency.value = mtof(n + o.o_crs);
      src.detune.value = o.o_fin;
    }
    src.connect(g); g.connect(pan); pan.connect(flt);
    src.start(t); src.stop(end);
  }
  return end;
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
function rev(buf, path) {
  if (reversed.has(path)) return reversed.get(path);
  const r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set([...buf.getChannelData(c)].reverse());
  reversed.set(path, r);
  return r;
}

function playSampler(ctx, out, p, t, dur, n, v, buf) {
  if (!buf) return t;
  const b = p.rev ? rev(buf, p.path) : buf;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = 2 ** ((n - p.root + p.tune) / 12);
  const env = ctx.createGain();
  src.connect(env); env.connect(out);
  const len = (b.duration * (1 - p.start)) / src.playbackRate.value;
  const hold = p.oneshot ? len : Math.min(len, dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + p.att);
  const off = t + Math.max(hold, p.att);
  env.gain.setTargetAtTime(0, off, Math.max(0.001, p.rel / 4));
  const end = off + p.rel * 1.2 + 0.02;
  src.start(t, b.duration * p.start);
  src.stop(end);
  return end;
}

/* ---------- проект ---------- */
export function newProject() {
  const pat = { id: uid(), name: "Pattern 1", color: PASTEL[0] };
  const kick = newChannel("sampler", "Kick"), clap = newChannel("sampler", "Clap"), hat = newChannel("sampler", "Hat"),
    lead = newChannel("osc3", "3XOSC");
  kick.params.path = "builtin:kick"; clap.params.path = "builtin:clap"; hat.params.path = "builtin:hat";
  const notes = { [pat.id]: { [kick.id]: [0, 4, 8, 12].map(s => note(s, 60)), [clap.id]: [4, 12].map(s => note(s, 60, 0.8)),
    [hat.id]: [2, 6, 10, 14].map(s => note(s, 60, 0.6)),
    [lead.id]: [[0, 64, 3], [4, 67, 3], [8, 71, 2], [12, 69, 4]].map(([s, n, l]) => ({ s, n, l, v: 0.8 })) } };
  return { v: 1, name: "Новый трек", bpm: 128, swing: 0, master: 0.85, patterns: [pat], channels: [kick, clap, hat, lead],
    notes, cur: pat.id, layout: {} };
}
export function newChannel(type, name) {
  return { id: uid(), type, name: name || TYPES[type].name, color: PASTEL[Math.floor(Math.random() * PASTEL.length)],
    vol: 0.8, pan: 0, mute: false, solo: false, params: DEFAULT_PARAMS[type]() };
}
const note = (s, n, v = 0.85) => ({ s, l: 1, n, v });

/* миграции/починка загруженного файла — пусть битый .dawn не роняет приложение */
export function sanitize(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.channels) || !Array.isArray(p.patterns) || !p.patterns.length) throw new Error("это не проект DAWN");
  p.bpm = clamp(+p.bpm || 128, 40, 300);
  p.master = clamp(+p.master || 0.85, 0, 1.25);
  p.notes ||= {}; p.layout ||= {};
  for (const ch of p.channels) {
    if (!TYPES[ch.type]) ch.type = "osc3";
    ch.params = { ...DEFAULT_PARAMS[ch.type](), ...(ch.params || {}) };
    ch.id ||= uid(); ch.vol ??= 0.8; ch.pan ??= 0;
  }
  if (!p.patterns.some(x => x.id === p.cur)) p.cur = p.patterns[0].id;
  return p;
}

/* ================= Engine ================= */
export const Engine = {
  ctx: null, master: null, analyser: null,
  project: null, path: null, dirty: false,
  playing: false, startTime: 0, startStep: 0, nextStep: 0, timer: null,
  strips: new Map(),      // channel id -> { gain, pan }
  listeners: {},

  on(ev, cb) { (this.listeners[ev] ||= new Set()).add(cb); return () => this.listeners[ev].delete(cb); },
  emit(ev, d) { for (const cb of this.listeners[ev] || []) try { cb(d); } catch (e) { console.error(e); } },

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    const lim = this.ctx.createDynamicsCompressor();          // мягкий предохранитель на мастере
    lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024;
    this.master.connect(lim); lim.connect(this.analyser); this.analyser.connect(this.ctx.destination);
  },

  load(project, path = null) {
    this.stop();
    for (const s of this.strips.values()) { s.gain.disconnect(); }
    this.strips.clear();
    this.project = sanitize(project); this.path = path; this.dirty = false;
    this.master.gain.value = this.project.master;
    for (const ch of this.project.channels) this.strip(ch);
    this.preload();
    this.emit("change", { all: true });
    this.emit("pattern");
  },

  /* канальная полоса: gain → pan → master (в этапе 2 сюда встанет микшер с эффектами) */
  strip(ch) {
    let s = this.strips.get(ch.id);
    if (!s) {
      const gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
      gain.connect(pan); pan.connect(this.master);
      s = { gain, pan };
      this.strips.set(ch.id, s);
    }
    s.gain.gain.value = this.audible(ch) ? ch.vol : 0;
    s.pan.pan.value = ch.pan;
    return s;
  },
  audible(ch) {
    const anySolo = this.project.channels.some(c => c.solo);
    return !ch.mute && (!anySolo || ch.solo);
  },
  refreshStrips() { for (const ch of this.project.channels) this.strip(ch); },

  preload() {
    for (const ch of this.project.channels) if (ch.type === "sampler" && ch.params.path)
      loadSample(this.ctx, ch.params.path).then(b => { if (b) { buffers.get(ch.params.path)._v = b; this.emit("change", { sample: ch.id }); } });
  },

  /* ---------- правка модели ---------- */
  touch(what = {}) { this.dirty = true; this.emit("change", what); },
  chan(id) { return this.project.channels.find(c => c.id === id); },
  pat(id = this.project.cur) { return this.project.patterns.find(p => p.id === id); },
  notesOf(chId, patId = this.project.cur) {
    const pn = (this.project.notes[patId] ||= {});
    return (pn[chId] ||= []);
  },
  patLength(patId = this.project.cur) {   // в шагах, кратно такту; bars — сколько тактов задал пользователь
    let end = STEPS_PER_BAR * Math.max(1, this.pat(patId)?.bars || 1);
    const pn = this.project.notes[patId] || {};
    for (const list of Object.values(pn)) for (const nt of list) end = Math.max(end, nt.s + nt.l);
    return Math.ceil(end / STEPS_PER_BAR) * STEPS_PER_BAR;
  },
  addChannel(type, name, params) {
    const ch = newChannel(type, name);
    if (params) Object.assign(ch.params, params);
    this.project.channels.push(ch);
    this.strip(ch);
    if (type === "sampler") this.preload();
    this.touch({ channels: true });
    return ch;
  },
  removeChannel(id) {
    const i = this.project.channels.findIndex(c => c.id === id);
    if (i < 0) return;
    this.project.channels.splice(i, 1);
    for (const pn of Object.values(this.project.notes)) delete pn[id];
    this.strips.get(id)?.gain.disconnect(); this.strips.delete(id);
    this.touch({ channels: true });
  },
  setSample(ch, path) {
    ch.params.path = path;
    ch.name = path.startsWith("builtin:") ? BUILTIN[path.slice(8)] || "Drum" : path.split("/").pop().replace(/\.[^.]+$/, "").slice(0, 24);
    loadSample(this.ctx, path).then(b => { if (b) { buffers.get(path)._v = b; this.emit("change", { sample: ch.id }); } });
    this.touch({ channels: true });
  },
  addPattern() {
    const n = this.project.patterns.length + 1;
    const p = { id: uid(), name: "Pattern " + n, color: PASTEL[(n - 1) % PASTEL.length] };
    this.project.patterns.push(p);
    this.selectPattern(p.id);
    this.touch({ patterns: true });
    return p;
  },
  clonePattern() {
    const src = this.pat();
    const p = this.addPattern();
    p.name = src.name + " copy";
    this.project.notes[p.id] = JSON.parse(JSON.stringify(this.project.notes[src.id] || {}));
    this.touch({ patterns: true });
  },
  selectPattern(id) {
    if (!this.pat(id)) return;
    this.project.cur = id;
    if (this.playing) { this.startStep = 0; this.startTime = this.ctx.currentTime + 0.05; this.nextStep = 0; }
    this.emit("pattern");
  },

  /* ---------- звук ---------- */
  stepDur() { return 60 / this.project.bpm / 4; },
  voice(ch, t, durSec, n, v) {
    if (!this.audible(ch)) return;
    const out = this.strip(ch).gain;
    if (ch.type === "osc3") playOsc3(this.ctx, out, ch.params, t, durSec, n, v);
    else playSampler(this.ctx, out, ch.params, t, durSec, n, v, sampleNow(ch.params.path));
  },
  /* пощупать звук: клик по клавише/шагу, превью в браузере сэмплов */
  preview(ch, n = 60, v = 0.85, len = 0.25) {
    this.init();
    if (!ch) return;
    const t = this.ctx.currentTime + 0.01;
    if (ch.type === "osc3") playOsc3(this.ctx, this.strip(ch).gain, ch.params, t, len, n, v);
    else playSampler(this.ctx, this.strip(ch).gain, ch.params, t, len, n, v, sampleNow(ch.params.path));
  },
  async previewPath(path) {
    this.init();
    const b = await loadSample(this.ctx, path);
    if (!b) return false;
    buffers.get(path)._v = b;
    this.previewSrc?.stop();
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = 0.8;
    s.connect(g); g.connect(this.master); s.start();
    this.previewSrc = s;
    return true;
  },

  play() {
    this.init();
    if (this.playing) return;
    this.playing = true;
    this.startStep = 0; this.nextStep = 0;
    this.startTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
    this.emit("play");
  },
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer); this.timer = null;
    // мягко глушим хвосты: на мгновение опускаем мастер
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.04);
    g.linearRampToValueAtTime(this.project.master, t + 0.25);
    this.emit("stop");
  },
  toggle() { this.playing ? this.stop() : this.play(); },

  /* текущая позиция в шагах (для плейхеда), с учётом зацикливания паттерна */
  position() {
    if (!this.playing) return -1;
    const s = (this.ctx.currentTime - this.startTime) / this.stepDur();
    return s < 0 ? 0 : s % this.patLength();
  },

  schedule() {
    const sd = this.stepDur(), len = this.patLength();
    const until = this.ctx.currentTime + LOOKAHEAD;
    // nextStep — абсолютный счётчик шагов с начала воспроизведения
    while (this.startTime + this.nextStep * sd < until) {
      const abs = this.nextStep, loopStart = Math.floor(abs / len) * len, inPat = abs - loopStart;
      const tStep = this.startTime + abs * sd;
      const swing = (inPat % 2 === 1) ? (this.project.swing || 0) * sd * 0.5 : 0;
      const pn = this.project.notes[this.project.cur] || {};
      for (const ch of this.project.channels) {
        for (const nt of pn[ch.id] || []) {
          if (nt.s >= inPat && nt.s < inPat + 1) {
            const t = tStep + (nt.s - inPat) * sd + swing;
            if (t >= this.ctx.currentTime - 0.01) this.voice(ch, Math.max(t, this.ctx.currentTime), nt.l * sd, nt.n, nt.v);
          }
        }
      }
      this.nextStep++;
    }
  },

  /* ---------- проект ↔ JSON ---------- */
  serialize() { return JSON.stringify(this.project); },
};
