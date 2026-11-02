import { buildGraph } from "../dawn/graph.js";
import { loadCodeWorklet } from "../dawn/fx.js";
import { barLen, fromFile, patLen } from "../dawn/format.js";
import { ensureSample } from "../dawn/instruments.js";
import { arrangement, planBar } from "./arrange.js";

/* ================= Clown Dungeon — боевая музыка =================
 * Играет один паттерн проекта DAWN по кругу через тот же граф, что и сам DAWN (graph.js): те же синты и эффекты.
 * Что именно звучит в такте, решает arrange.js, здесь — только расписание нот.
 *
 * Время. Сервер объявляет t0 — момент доли 0 по своим часам. Шаг сетки — 1/16 (как в DAWN). Участники боя
 * считают шаг от t0, поэтому присоединившийся попадает в ту же долю, а не начинает трек сначала.
 * Попадание в такт судит клиент: только он знает, что слышит игрок. Задержку наушников учитываем через
 * ctx.outputLatency и подстраиваем на лету по тому, куда игрок на самом деле стабильно попадает.
 */
const LOOKAHEAD = 0.2, TIMER_MS = 25, STEP = 0.25;
const OPEN = 22000;
const WINDOW = 0.055;      // допуск тапа, с: в обе стороны от ноты; у трека можно задать свой (window)
const LEARN_LIMIT = 0.16;  // промах дальше этого — ошибка игрока, а не задержка наушников

export class BattleMusic {
  constructor() { this.ctx = null; this.cache = new Map(); this.G = null; this.timer = null; this.calib = 0; }

  /* разбудить звук: только из обработчика нажатия, иначе браузер не даст */
  unlock() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
    if (this.ctx.state === "suspended") this.ctx.resume();
  }
  get running() { return !!this.timer; }
  get audible() { return this.ctx?.state === "running"; }

  async fetchTrack(track) {
    if (!this.cache.has(track.file)) this.cache.set(track.file, await (await fetch(track.file)).json());
    return this.cache.get(track.file);
  }

  /* b: { music (правила трека от сервера), t0, seed }; now — часы сервера, мс */
  async start(b, now) {
    this.stop(0.05);
    this.unlock();
    const token = this.token = {};
    const track = b.music, raw = await this.fetchTrack(track);
    if (token !== this.token) return;
    const P = fromFile(JSON.parse(JSON.stringify(raw)));
    if (track.pattern) P.cur = track.pattern;
    const pat = P.patterns.find(p => p.id === P.cur) || P.patterns[0];
    await Promise.all(P.channels.filter(c => c.type === "sampler" && c.params.path).map(c => ensureSample(this.ctx, c.params.path)));
    if (P.mixer.some(m => m.fx.some(f => f.type === "math" || f.type === "code"))) await loadCodeWorklet(this.ctx);
    if (token !== this.token) return;

    const A = arrangement(track, P.channels);
    const steps = Math.round(patLen(P, pat.id) / STEP), barSteps = Math.round(barLen(pat) / STEP);
    const buckets = Array.from({ length: steps }, () => []);
    for (const ch of P.channels) for (const n of pat.notes[ch.id] || []) {
      const i = Math.floor(n.s / STEP + 1e-6);
      if (i < steps) buckets[i].push({ ch, n, off: n.s - i * STEP });
    }
    // сильные ноты — те же, что считает сервер (dungeon.py, load_track)
    const grid = track.strong?.grid || 1, strong = new Set();
    for (const id of track.strong?.channels || []) for (const n of pat.notes[id] || [])
      if (Math.abs(n.s / grid - Math.round(n.s / grid)) < 1e-6) strong.add(Math.round(n.s / STEP));
    if (!strong.size) for (let i = 0; i < steps; i += 4) strong.add(i);

    const G = buildGraph(this.ctx, P);
    const beatSec = 60 / P.bpm;
    this.P = P; this.G = G; this.A = A; this.pat = pat;
    this.steps = steps; this.barSteps = barSteps; this.buckets = buckets; this.strong = strong;
    this.beatSec = beatSec; this.stepSec = beatSec * STEP; this.seed = b.seed; this.window = track.window || WINDOW;
    this.filters = new Map();
    this.plan = null;
    this.state ||= { enemyHp: 1, myHp: 1, combo: 0 };
    this.lead = P.channels.find(c => A.roleOf(c.id) === "lead") || null;

    this.aT0 = this.ctx.currentTime + (b.t0 - now) / 1000;   // доля 0 на часах аудио
    this.step = Math.max(0, Math.ceil((this.ctx.currentTime - this.aT0) / this.stepSec));
    this.timer = setInterval(() => this.tick(), TIMER_MS);
    this.tick();
  }

  stop(fade = 0.6) {
    this.token = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const G = this.G;
    if (!G) return;
    this.G = null;
    const f = this.filters, t = this.ctx.currentTime, g = G.final.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { G.dispose(); for (const n of f.values()) n.disconnect(); }, (fade + 0.2) * 1000);
  }

  /* вкладку свернули или контекст проснулся позже: возвращаемся на общую сетку боя */
  resync(t0, now) {
    if (!this.running) return;
    const a = this.ctx.currentTime + (t0 - now) / 1000;
    if (Math.abs(a - this.aT0) < 0.04) return;
    this.aT0 = a;
    this.step = Math.max(0, Math.ceil((this.ctx.currentTime - a) / this.stepSec));
    this.plan = null;
  }

  setState(s) { this.state = { ...this.state, ...s }; }

  tick() {
    const until = this.ctx.currentTime + LOOKAHEAD;
    for (let t = this.timeOf(this.step); t < until; t = this.timeOf(this.step)) {
      if (t >= this.ctx.currentTime) this.playStep(this.step, t);
      this.step++;
    }
  }
  timeOf(step) { return this.aT0 + step * this.stepSec; }

  playStep(step, t) {
    const local = step % this.steps;
    if (!this.plan || local % this.barSteps === 0) this.replan(step, t);
    const { active, shift } = this.plan, { A, G } = this;
    for (const { ch, n, off } of this.buckets[local]) {
      const role = A.roleOf(ch.id);
      if (!active.has(role)) continue;
      const pitch = n.n + Math.round((shift[role] || 0) * (ch.edo || 12) / 12);
      G.voice(ch, t + off * this.beatSec, n.l * this.beatSec, pitch, n.v, n.b || 0, n.x || 1);
    }
  }

  replan(step, t) {
    const loop = Math.floor(step / this.steps), bar = Math.floor((step % this.steps) / this.barSteps);
    this.plan = planBar(this.A, { ...this.state, loop, bar, bars: Math.round(this.steps / this.barSteps), seed: this.seed });
    for (const ch of this.P.channels) {
      const role = this.A.roleOf(ch.id);
      this.setFilter(ch, this.plan.filter[role] ?? OPEN, t);
    }
  }

  /* срез ставим после инсерта, а не перед ним: так глохнут и хвосты реверба с дилеем */
  setFilter(ch, hz, t) {
    const i = ch.mix || 0;
    if (!i) return;
    let f = this.filters.get(i);
    if (!f) {
      if (hz >= OPEN) return;
      f = this.ctx.createBiquadFilter();
      f.type = "lowpass"; f.Q.value = 0.7; f.frequency.value = OPEN;
      const ins = this.G.inserts[i];
      ins.meter.disconnect(); ins.meter.connect(f); f.connect(this.G.inserts[0].input);
      this.filters.set(i, f);
    }
    f.frequency.setTargetAtTime(hz, t, 0.25);
  }

  /* ---------- ритм ---------- */
  /* где сейчас слышит игрок, в шагах 1/16: аудио уходит в наушники с задержкой */
  heardStep() {
    if (!this.running) return -1;
    const lat = (this.ctx.outputLatency || this.ctx.baseLatency || 0) + this.calib;
    return (this.ctx.currentTime - lat - this.aT0) / this.stepSec;
  }
  isStrong(step) { return this.strong.has(((step % this.steps) + this.steps) % this.steps); }

  /* ближайшая сильная нота к текущему моменту: { step, err (с, + — опоздал) } */
  judge() {
    const pos = this.heardStep();
    if (pos < 0) return null;
    const c = Math.round(pos);
    let best = null;
    for (let s = Math.max(0, c - this.steps); s <= c + this.steps; s++)
      if (this.isStrong(s) && (best === null || Math.abs(pos - s) < Math.abs(pos - best))) best = s;
    return best === null ? null : { step: best, err: (pos - best) * this.stepSec };
  }
  /* подтягиваем поправку к стабильной ошибке игрока, и по попаданиям, и по близким промахам:
   * иначе с задержкой наушников больше окна он никогда бы не попал и поправка не сработала */
  learn(err) { if (Math.abs(err) > LEARN_LIMIT) return; this.calib = Math.max(-0.05, Math.min(0.3, this.calib + err * 0.15)); }

  /* удар в комбо — тихая копия колокольчиков этой доли октавой выше того, что звучит сейчас */
  hitTone(step) {
    if (!this.G || !this.lead) return;
    const local = ((step % this.steps) + this.steps) % this.steps;
    const hit = this.buckets[local].find(b => b.ch === this.lead) || this.buckets.find(l => l.some(b => b.ch === this.lead))?.[0];
    if (!hit) return;
    const edo = this.lead.edo || 12, shift = this.plan?.shift[this.A.roleOf(this.lead.id)] || 0;
    this.G.voice(this.lead, this.ctx.currentTime + 0.005, 0.25, hit.n.n + edo + Math.round(shift * edo / 12), 0.4);
  }
}
