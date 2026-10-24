import { FX, fxDefaults } from "./fx.js";
import { PASTEL, barLen, fromFile, newInsert, patLen, slug, toFile } from "./format.js";
import { BUILTIN, DEFAULT_PARAMS, TYPES, ensureSample, playOsc3, playSampler, sampleNow } from "./instruments.js";
import { c4 } from "./tuning.js";

export { SPECS, WAVES, WAVE_GLYPH, TYPES, BUILTIN, sampleNow } from "./instruments.js";
export { PASTEL, barLen } from "./format.js";

/* ================= DAWN — движок =================
 * Один на всё приложение: окна модулей только смотрят на Engine.project и зовут его методы.
 *
 * Время — в ДОЛЯХ (четвертях). Тик планировщика — 1/16 (0.25 доли). Ноты: { s, l (доли), n (ступень строя
 * канала, см. tuning.js), v (0..1) }. Шаги стойки и пиано ролл — одни и те же ноты.
 * Режимы: "pat" — по кругу текущий паттерн; "song" — плейлист (клипы паттернов на дорожках).
 *
 * Звук: голос → полоса канала (gain → pan) → вход инсерта микшера → FX → громкость/пан инсерта → Master
 * (инсерт 0) → предохранитель → выход. Граф строится функцией buildGraph(ctx, project) — одной и той же
 * для живого звука и для рендера в WAV (OfflineAudioContext).
 *
 * События Engine.on(...): "change" (модель; { param: true } — правка крутилки, окна не перестраиваются),
 * "play" / "stop", "pattern", "mode", "theme".
 */
const LOOKAHEAD = 0.12, TIMER_MS = 25, TICK = 0.25;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ======================= граф (микшер) ======================= */
function buildGraph(ctx, P) {
  const lim = ctx.createDynamicsCompressor();          // мягкий предохранитель на выходе
  lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
  const final = ctx.createGain(), analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  final.connect(lim); lim.connect(analyser); analyser.connect(ctx.destination);

  const G = {
    ctx, P, final, analyser, inserts: [], strips: new Map(), bpm: P.bpm,

    ensureInserts() {
      while (G.inserts.length < P.mixer.length) {
        const i = G.inserts.length;
        const input = ctx.createGain(), post = ctx.createGain(), pan = ctx.createStereoPanner(), meter = ctx.createAnalyser();
        meter.fftSize = 256;
        post.connect(pan); pan.connect(meter);
        meter.connect(i === 0 ? final : G.inserts[0].input);
        G.inserts.push({ input, post, pan, meter, fx: [] });
        G.rebuildFx(i); G.applyInsert(i);
      }
    },
    /* цепочка эффектов инсерта: input → fx (вкл.) → post */
    rebuildFx(i) {
      const ins = G.inserts[i], m = P.mixer[i];
      ins.input.disconnect();
      ins.fx.forEach(f => f?.dispose());
      ins.fx = m.fx.map(f => {
        const n = FX[f.type].create(ctx, f.p);
        n.tempo(G.bpm);
        return n;
      });
      let node = ins.input;
      m.fx.forEach((f, k) => { if (f.on) { node.connect(ins.fx[k].input); node = ins.fx[k].output; } });
      node.connect(ins.post);
    },
    applyInsert(i) {
      const m = P.mixer[i], ins = G.inserts[i];
      ins.post.gain.value = m.mute ? 0 : m.vol;
      ins.pan.pan.value = m.pan;
    },
    fxSet(i, k) { const f = P.mixer[i].fx[k]; G.inserts[i]?.fx[k]?.set(f.p); },
    tempo(bpm) { G.bpm = bpm; for (const ins of G.inserts) for (const f of ins.fx) f.tempo(bpm); },
    audible(ch) {
      const anySolo = P.channels.some(c => c.solo);
      return !ch.mute && (!anySolo || ch.solo);
    },
    /* полоса канала; если канал переназначили на другой инсерт — переподключаем */
    strip(ch) {
      let s = G.strips.get(ch.id);
      const mix = clamp(ch.mix || 0, 0, P.mixer.length - 1);
      if (!s) {
        const gain = ctx.createGain(), pan = ctx.createStereoPanner();
        gain.connect(pan);
        s = { gain, pan, mix: -1 };
        G.strips.set(ch.id, s);
      }
      if (s.mix !== mix) { s.pan.disconnect(); s.pan.connect(G.inserts[mix].input); s.mix = mix; }
      s.gain.gain.value = G.audible(ch) ? ch.vol : 0;
      s.pan.pan.value = ch.pan;
      return s;
    },
    refresh() {
      G.ensureInserts();
      for (let i = 0; i < P.mixer.length; i++) G.applyInsert(i);
      for (const ch of P.channels) G.strip(ch);
      for (const [id, s] of G.strips) if (!P.channels.some(c => c.id === id)) { s.gain.disconnect(); s.pan.disconnect(); G.strips.delete(id); }
    },
    voice(ch, t, durSec, n, v) {
      if (!G.audible(ch)) return;
      const out = G.strip(ch).gain, edo = ch.edo || 12;
      if (ch.type === "osc3") playOsc3(ctx, out, ch.params, t, durSec, n, v, edo);
      else playSampler(ctx, out, ch.params, t, durSec, n, v, sampleNow(ch.params.path), edo);
    },
    dispose() {
      for (const ins of G.inserts) { ins.input.disconnect(); ins.meter.disconnect(); ins.fx.forEach(f => f.dispose()); }
      for (const s of G.strips.values()) { s.gain.disconnect(); s.pan.disconnect(); }
      final.disconnect(); lim.disconnect(); analyser.disconnect();
    },
  };
  G.ensureInserts();
  for (const ch of P.channels) G.strip(ch);
  return G;
}

/* ноты, начинающиеся в тике [beat, beat + 0.25): cb(канал, нота, смещение от начала тика в долях) */
function collect(P, mode, beat, cb) {
  if (mode === "pat") {
    const pat = P.patterns.find(p => p.id === P.cur);
    if (pat) emitPattern(P, pat, beat, beat + TICK, cb);
    return;
  }
  for (const c of P.playlist) {
    if (beat < c.s || beat >= c.s + c.l) continue;
    const pat = P.patterns.find(p => p.id === c.p);
    if (!pat) continue;
    const len = patLen(P, pat.id), local = (beat - c.s) % len;
    const until = Math.min(local + TICK, local + (c.s + c.l - beat));   // нота должна начаться внутри клипа
    emitPattern(P, pat, local, until, cb);
  }
}
function emitPattern(P, pat, from, to, cb) {
  for (const ch of P.channels) for (const n of pat.notes[ch.id] || []) if (n.s >= from - 1e-9 && n.s < to - 1e-9) cb(ch, n, n.s - from);
}
const songLen = P => P.playlist.reduce((m, c) => Math.max(m, c.s + c.l), 0);

/* ======================= проект ======================= */
/* новый проект собирается из того же формата, что пишется в файл (заодно — живой пример формата) */
export function newProject() {
  return fromFile({
    format: "dawn/2", name: "Новый трек", bpm: 128,
    channels: [
      { id: "kick", type: "sampler", name: "Kick", sample: "builtin:kick", mixer: 1, color: "#ffc59e" },
      { id: "clap", type: "sampler", name: "Clap", sample: "builtin:clap", mixer: 2, color: "#b8f59e" },
      { id: "hat", type: "sampler", name: "Hat", sample: "builtin:hat", mixer: 3, vol: 0.6, color: "#9fd3ff" },
      { id: "lead", type: "osc3", name: "3XOSC", mixer: 4, color: "#ff9ecf", scale: { root: "A", mode: "minor" } },
    ],
    patterns: [{ id: "drums", name: "Drums", sig: "4/4", notes: {
      kick: [0, 1, 2, 3].map(s => [s, 0.25, "C4", 0.9]), clap: [[1, 0.25, "C4", 0.8], [3, 0.25, "C4", 0.8]],
      hat: [0.5, 1.5, 2.5, 3.5].map(s => [s, 0.25, "C4", 0.6]) } },
      { id: "melody", name: "Melody", sig: "4/4", color: "#c3a6ff", notes: {
        lead: [[0, 0.75, "A4", 0.8], [1, 0.75, "C5", 0.8], [2, 0.5, "E5", 0.8], [3, 1, "D5", 0.8]] } }],
    playlist: [{ pattern: "drums", track: 1, start: 0, length: 16 }, { pattern: "melody", track: 2, start: 4, length: 12 }],
    mixer: [{ name: "Master" }, { name: "Kick" }, { name: "Clap", fx: [{ type: "reverb", mix: 0.2 }] }, { name: "Hat" },
      { name: "Lead", fx: [{ type: "delay", mix: 0.25 }, { type: "reverb", mix: 0.2 }] }],
    current: "drums",
  });
}

export const Engine = {
  ctx: null, G: null, project: null, path: null, dirty: false,
  playing: false, beat: 0, nextT: 0, hist: [], timer: null,
  listeners: {},

  on(ev, cb) { (this.listeners[ev] ||= new Set()).add(cb); return () => this.listeners[ev].delete(cb); },
  emit(ev, d) { for (const cb of this.listeners[ev] || []) try { cb(d); } catch (e) { console.error(e); } },

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  },
  get analyser() { return this.G?.analyser; },

  load(project, path = null) {
    this.init();
    this.stop();
    this.G?.dispose();
    this.project = project.channels && project.patterns && project.mixer ? project : fromFile(project);
    this.path = path; this.dirty = false;
    this.G = buildGraph(this.ctx, this.project);
    this.preload();
    this.emit("change", { all: true });
    this.emit("pattern");
  },
  preload() {
    return Promise.all(this.project.channels.filter(c => c.type === "sampler" && c.params.path)
      .map(c => ensureSample(this.ctx, c.params.path).then(b => { if (b) this.emit("change", { sample: c.id, param: true }); })));
  },

  /* ---------- правка модели ---------- */
  touch(what = {}) { this.dirty = true; this.emit("change", what); },
  refreshStrips() { this.G.refresh(); },
  chan(id) { return this.project.channels.find(c => c.id === id); },
  pat(id = this.project.cur) { return this.project.patterns.find(p => p.id === id); },
  notesOf(chId, patId = this.project.cur) { const p = this.pat(patId); return p ? (p.notes[chId] ||= []) : []; },
  patLength(id = this.project.cur) { return patLen(this.project, id); },
  barLen(p = this.pat()) { return barLen(p); },
  songLength() { return songLen(this.project); },
  stepDur() { return 60 / this.project.bpm / 4; },
  beatDur() { return 60 / this.project.bpm; },

  addChannel(type, name, params) {
    const P = this.project, ids = new Set(P.channels.map(c => c.id));
    const used = new Set(P.channels.map(c => c.mix));
    let mix = 0;
    for (let i = 1; i < P.mixer.length; i++) if (!used.has(i)) { mix = i; break; }
    const ch = { id: slug(name || TYPES[type].name, ids), type, name: (name || TYPES[type].name).slice(0, 24),
      color: PASTEL[P.channels.length % PASTEL.length], vol: 0.8, pan: 0, mute: false, solo: false, mix, edo: 12,
      scale: { root: 0, mode: "chromatic", snap: false }, params: { ...DEFAULT_PARAMS[type](), ...(params || {}) } };
    if (mix) P.mixer[mix].name = ch.name.slice(0, 20);
    P.channels.push(ch);
    this.G.refresh();
    this.touch({ channels: true, mixer: true });
    return ch;
  },
  removeChannel(id) {
    const P = this.project, i = P.channels.findIndex(c => c.id === id);
    if (i < 0) return;
    P.channels.splice(i, 1);
    for (const p of P.patterns) delete p.notes[id];
    this.G.refresh();
    this.touch({ channels: true });
  },
  setSample(ch, path) {
    ch.params.path = path;
    ch.name = path.startsWith("builtin:") ? BUILTIN[path.slice(8)] || "Drum" : path.split("/").pop().replace(/\.[^.]+$/, "").slice(0, 24);
    ensureSample(this.ctx, path).then(b => { if (b) this.emit("change", { sample: ch.id, param: true }); });
    this.touch({ channels: true });
  },
  /* сменить строй канала: ноты переносим на ближайшие по высоте ступени нового строя */
  setEdo(ch, edo) {
    const from = ch.edo || 12;
    if (from === edo) return;
    for (const p of this.project.patterns) for (const n of p.notes[ch.id] || []) n.n = Math.round(n.n * edo / from);
    ch.edo = edo;
    ch.scale = { root: 0, mode: "chromatic", snap: false };
    this.touch({ channels: true, notes: true });
  },
  defaultPitch(ch) { return c4(ch.edo || 12); },

  addPattern(name) {
    const P = this.project, ids = new Set(P.patterns.map(p => p.id)), n = P.patterns.length + 1;
    const cur = this.pat();
    const p = { id: slug(name || "pattern" + n, ids), name: name || "Pattern " + n, color: PASTEL[(n - 1) % PASTEL.length],
      sig: cur ? [...cur.sig] : [4, 4], len: null, notes: {} };
    P.patterns.push(p);
    this.selectPattern(p.id);
    this.touch({ patterns: true });
    return p;
  },
  clonePattern() {
    const src = this.pat(), p = this.addPattern(src.name + " copy");
    p.sig = [...src.sig]; p.len = src.len;
    p.notes = JSON.parse(JSON.stringify(src.notes));
    this.touch({ patterns: true, notes: true });
  },
  removePattern(id) {
    const P = this.project;
    if (P.patterns.length < 2) return false;
    P.patterns = P.patterns.filter(p => p.id !== id);
    P.playlist = P.playlist.filter(c => c.p !== id);
    if (P.cur === id) P.cur = P.patterns[0].id;
    this.touch({ patterns: true, playlist: true });
    this.emit("pattern");
    return true;
  },
  selectPattern(id) {
    if (!this.pat(id)) return;
    this.project.cur = id;
    if (this.playing && this.project.mode === "pat") this.beat = this.beat % this.patLength();
    this.emit("pattern");
  },
  setMode(m) {
    if (this.project.mode === m) return;
    this.project.mode = m;
    if (this.playing) { this.beat = m === "song" ? this.project.songStart || 0 : 0; this.hist = []; }
    this.emit("mode");
    this.touch({ param: true });
  },
  setBpm(v) { this.project.bpm = clamp(Math.round(v * 10) / 10, 40, 300); this.G.tempo(this.project.bpm); },

  /* ---------- микшер ---------- */
  addInsert() {
    const P = this.project;
    if (P.mixer.length >= 17) return null;
    P.mixer.push(newInsert(P.mixer.length));
    this.G.refresh();
    this.touch({ mixer: true });
    return P.mixer.length - 1;
  },
  setFx(i, k, type) {
    const fx = this.project.mixer[i].fx;
    if (!type) fx.splice(k, 1);
    else if (k >= fx.length) fx.push({ type, on: true, p: fxDefaults(type) });
    else fx[k] = { type, on: true, p: fxDefaults(type) };
    this.G.rebuildFx(i);
    this.touch({ mixer: true });
  },
  fxToggle(i, k) { const f = this.project.mixer[i].fx[k]; f.on = !f.on; this.G.rebuildFx(i); this.touch({ mixer: true, param: true }); },
  fxParam(i, k) { this.G.fxSet(i, k); },
  applyInsert(i) { this.G.applyInsert(i); },
  meter(i) {   // пик последнего окна, 0..1+
    const a = this.G?.inserts[i]?.meter;
    if (!a) return 0;
    const buf = this._mbuf ||= new Float32Array(256);
    a.getFloatTimeDomainData(buf);
    let m = 0; for (const x of buf) { const y = Math.abs(x); if (y > m) m = y; }
    return m;
  },

  /* ---------- звук ---------- */
  preview(ch, n, v = 0.85, len = 0.25) {
    this.init();
    if (!ch) return;
    if (n == null) n = this.defaultPitch(ch);
    this.G.voice(ch, this.ctx.currentTime + 0.01, len, n, v);
  },
  async previewPath(path) {
    this.init();
    const b = await ensureSample(this.ctx, path);
    if (!b) return false;
    this.previewSrc?.stop();
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = 0.8;
    s.connect(g); g.connect(this.G.final); s.start();
    this.previewSrc = s;
    return true;
  },

  play() {
    this.init();
    if (this.playing) return;
    this.playing = true;
    this.beat = this.project.mode === "song" ? Math.min(this.project.songStart || 0, Math.max(0, songLen(this.project) - TICK)) : 0;
    this.nextT = this.ctx.currentTime + 0.06;
    this.hist = [];
    const g = this.G.final.gain; g.cancelScheduledValues(this.ctx.currentTime); g.setValueAtTime(1, this.ctx.currentTime);
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
    this.emit("play");
  },
  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer); this.timer = null;
    // мягко глушим хвосты: на мгновение опускаем выход
    const g = this.G.final.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.04); g.linearRampToValueAtTime(1, t + 0.3);
    this.emit("stop");
  },
  toggle() { this.playing ? this.stop() : this.play(); },

  schedule() {
    const P = this.project, until = this.ctx.currentTime + LOOKAHEAD;
    while (this.nextT < until) {
      const td = this.stepDur();
      playTick(this.G, P, P.mode, this.beat, this.nextT);
      this.hist.push([this.nextT, this.beat]);
      if (this.hist.length > 64) this.hist.shift();
      this.nextT += td;
      this.beat += TICK;
      if (P.mode === "pat") { if (this.beat >= this.patLength() - 1e-9) this.beat = 0; }
      else if (this.beat >= songLen(P) - 1e-9) this.beat = 0;   // песня по кругу
    }
  },

  /* где сейчас играет (в долях): song — позиция песни, pattern — внутри текущего паттерна */
  position() {
    if (!this.playing || !this.hist.length) return -1;
    const now = this.ctx.currentTime;
    let h = null;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i][0] <= now) { h = this.hist[i]; break; }
    if (!h) return -1;
    return h[1] + Math.min(TICK, (now - h[0]) / this.beatDur());
  },
  positionSong() { return this.playing && this.project.mode === "song" ? this.position() : -1; },
  positionPattern() {
    const b = this.position();
    if (b < 0) return -1;
    const P = this.project;
    if (P.mode === "pat") return b;
    const c = P.playlist.find(c => c.p === P.cur && b >= c.s && b < c.s + c.l);
    return c ? (b - c.s) % this.patLength(c.p) : -1;
  },

  /* ---------- рендер в WAV ---------- */
  async render(onProgress) {
    this.init();
    await this.preload();
    const P = this.project, song = P.playlist.length > 0;
    const lenBeats = song ? songLen(P) : this.patLength();
    const tail = 3, sec = lenBeats * this.beatDur() + tail, sr = 44100;
    const oc = new OfflineAudioContext(2, Math.ceil(sr * sec), sr);
    const G = buildGraph(oc, P);
    const td = this.stepDur();
    for (let k = 0, beat = 0; beat < lenBeats - 1e-9; k++, beat += TICK) playTick(G, P, song ? "song" : "pat", beat, 0.02 + k * td);
    onProgress?.("рендер…");
    const buf = await oc.startRendering();
    return encodeWav(buf);
  },

  serialize() { return stringifyFile(toFile(this.project)); },
};

function playTick(G, P, mode, beat, t) {
  const bd = 60 / P.bpm, td = bd / 4;
  const swing = (Math.round(beat * 4) % 2 === 1) ? (P.swing || 0) * td * 0.5 : 0;
  collect(P, mode, beat, (ch, n, off) => G.voice(ch, Math.max(t + off * bd + swing, G.ctx.currentTime), n.l * bd, n.n, n.v));
}

/* JSON, где короткие массивы (ноты) — в одну строку: и человеку, и нейросети читать удобнее */
export function stringifyFile(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (m, inner) =>
    inner.length < 140 ? "[" + inner.split(/,\s*\n\s*/).join(", ").trim() + "]" : m);
}

/* 16-бит PCM WAV */
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, "data"); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([data], { type: "audio/wav" });
}
