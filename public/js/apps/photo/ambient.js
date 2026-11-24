import { FX } from "../dawn/fx.js";

/* ================= Эмбиент и шаги для 3D-прогулки =================
 * Индустриальный меланхоличный дарк-эмбиент, но мягкий — чтобы звучал фоном:
 *   — пары расстроенных пил (sawtooth) на аккордах минора, под низким фильтром, который медленно дышит (LFO);
 *   — суб-синус на корне; аккорды сменяются раз в ~16 с с долгим перекрёстным затуханием;
 *   — «отсечки»: изредка ритмичные провалы громкости (как гейт), мягкие;
 *   — индустриальная фактура: шум через узкий полосовой фильтр, медленно гуляющий по частоте;
 *   — редкие «металлические» удары — негармонические синусы с долгим хвостом.
 * Реверберация и задержка — эффекты DAWN (dawn/fx.js: reverb, delay). Финальный компрессор срезает пики.
 *
 * Жизнь: enter() — сцена 3D открыта: через DELAY секунд начинаем (тихо вплываем); leave() — фото/параллакс:
 * затихаем; close() — окно закрыто: источники глушатся сразу, звучит только хвост реверберации.
 * step(power) — звук шага (шум + глухой удар), идёт в ту же реверберацию чуть-чуть.
 */
const DELAY = 15;
const PROG = [   // аккорды (полутоны от D2): Dm(add9) → B♭maj7 → Gm9 → Asus2 — мягкий минор без резких интервалов
  [0, 12, 15, 19, 26], [-4, 8, 12, 15, 21], [-7, 5, 10, 14, 17], [-5, 7, 12, 14, 19],
];
const D2 = 73.42;
const hz = st => D2 * Math.pow(2, st / 12);

export class Ambient {
  constructor() { this.ctx = null; this.vol = 0.6; this.playing = false; this.timer = 0; this.loops = []; this.voices = []; }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.02; comp.release.value = 0.4;
    this.rev = FX.reverb.create(ctx, { decay: 8, pre: 0.04, damp: 3200, low: 90, mix: 0.55 });
    this.dly = FX.delay.create(ctx, { sync: 4, fb: 0.45, mix: 0.22, damp: 1800, pp: 1 });
    this.dly.tempo?.(70);
    this.music = ctx.createGain(); this.music.gain.value = 0;          // общий фейдер музыки (вплыть/затихнуть)
    this.duck = ctx.createGain();                                     // «отсечки»
    this.music.connect(this.duck).connect(this.dly.input);
    this.dly.output.connect(this.rev.input);
    this.rev.output.connect(comp).connect(this.master).connect(ctx.destination);
    this.steps = ctx.createGain(); this.steps.gain.value = 0.9;       // шаги: сухо + капля в реверб
    this.steps.connect(comp);
    const send = ctx.createGain(); send.gain.value = 0.12; this.steps.connect(send).connect(this.rev.input);
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return ctx;
  }
  setVolume(v) { this.vol = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  enter() {
    clearTimeout(this.timer);
    if (this.playing) { this.fadeTo(1, 4); return; }
    this.timer = setTimeout(() => this.start(), DELAY * 1000);
  }
  leave() {
    clearTimeout(this.timer);
    if (!this.playing) return;
    this.fadeTo(0, 6);
    this.timer = setTimeout(() => this.stopMusic(), 7000);
  }
  fadeTo(v, sec) { const t = this.ctx.currentTime; this.music.gain.cancelScheduledValues(t); this.music.gain.setTargetAtTime(v * 0.32, t, sec / 3); }

  start() {
    const ctx = this.ensure();
    ctx.resume?.();
    this.playing = true;
    this.fadeTo(1, 10);
    let ci = 0;
    const chord = () => { this.chord(PROG[ci++ % PROG.length]); };
    chord();
    this.loops.push(setInterval(chord, 16000));
    this.loops.push(setInterval(() => this.gate(), 4000));
    this.loops.push(setInterval(() => { if (Math.random() < 0.45) this.clank(); }, 7000));
    this.texture();
  }
  stopMusic() {
    this.loops.forEach(clearInterval); this.loops = [];
    const t = this.ctx?.currentTime || 0;
    for (const v of this.voices) { try { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 0.05); v.stop(t + 0.4); } catch {} }
    this.voices = [];
    this.playing = false;
  }
  /* окно закрыто: источники — сразу в тишину, реверберация договаривает хвост */
  close() {
    clearTimeout(this.timer);
    if (!this.ctx) return;
    this.stopMusic();
    const ctx = this.ctx;
    setTimeout(() => ctx.close().catch(() => {}), 10000);
    this.ctx = null;
  }

  /* ---------- голоса ---------- */
  chord(notes) {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const v of this.voices) { v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, 3); v.stop(t + 14); }
    this.voices = [];
    notes.forEach((st, i) => {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2.2; lp.frequency.value = 420 + i * 70;
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      lfo.frequency.value = 0.03 + Math.random() * 0.06; lfoG.gain.value = 260 + i * 40;
      lfo.connect(lfoG).connect(lp.frequency);
      const oscs = (i === 0 ? [0] : [-7, 7]).map(det => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "sawtooth";
        o.frequency.value = hz(i === 0 ? st - 12 : st); o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(lp); return o;
      });
      const pan = ctx.createStereoPanner(); pan.pan.value = i === 0 ? 0 : (i % 2 ? -1 : 1) * (0.25 + i * 0.12);
      lp.connect(g).connect(pan).connect(this.music);
      const level = i === 0 ? 0.55 : 0.16 / Math.sqrt(i);
      g.gain.setTargetAtTime(level, t, 2.5);
      [...oscs, lfo].forEach(o => o.start(t));
      this.voices.push({ g, stop: at => [...oscs, lfo].forEach(o => { try { o.stop(at); } catch {} }) });
    });
  }
  /* «отсечки»: иногда 1–2 такта ритмичных провалов (как гейт), мягкие края */
  gate() {
    if (Math.random() > 0.4 || !this.ctx) return;
    const ctx = this.ctx, g = this.duck.gain, t0 = ctx.currentTime + 0.05, beat = 60 / 70;
    const pat = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0];
    pat.forEach((on, i) => {
      if (!on) return;
      const t = t0 + i * beat / 4;
      g.setTargetAtTime(0.3, t, 0.012);
      g.setTargetAtTime(1, t + beat / 8, 0.05);
    });
  }
  /* фактура: шум в узкой полосе, полоса медленно гуляет */
  texture() {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 9; bp.frequency.value = 600;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.021; lg.gain.value = 380;
    lfo.connect(lg).connect(bp.frequency);
    const g = ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(0.09, t, 6);
    src.connect(bp).connect(g).connect(this.music);
    src.start(t); lfo.start(t);
    this.voices.push({ g, stop: at => { try { src.stop(at); lfo.stop(at); } catch {} } });
  }
  /* металлический удар: негармонические призвуки, тихо, далеко */
  clank() {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, f = 160 + Math.random() * 140, pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.music);
    for (const [k, a] of [[1, 0.05], [2.76, 0.03], [5.4, 0.015], [8.9, 0.007]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f * k; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 2.6);
    }
  }

  /* шаг: короткий шум (хруст) + глухой удар; power — 1 шаг, 1.4 — бег, приземление */
  step(power = 1, crunchy = false) {
    if (this.vol <= 0) return;
    const ctx = this.ensure(); ctx.resume?.();
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = crunchy ? "highpass" : "bandpass"; f.frequency.value = crunchy ? 1400 + Math.random() * 600 : 500 + Math.random() * 400; f.Q.value = crunchy ? 0.7 : 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22 * power, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + (crunchy ? 0.16 : 0.12));
    src.connect(f).connect(g).connect(this.steps);
    src.start(t, Math.random() * 1.5); src.stop(t + 0.25);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    og.gain.setValueAtTime(0.28 * power, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.steps); o.start(t); o.stop(t + 0.12);
  }
}
