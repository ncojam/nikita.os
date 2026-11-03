import { buildGraph } from "../dawn/graph.js";
import { loadCodeWorklet } from "../dawn/fx.js";
import { barLen, fromFile, patLen } from "../dawn/format.js";
import { ensureSample } from "../dawn/instruments.js";
import { store } from "../../core/util.js";
import { arrangement, planBar } from "./arrange.js";
import { benchSynth } from "./stems.js";

/* ================= Clown Dungeon — боевая музыка =================
 * Играет один паттерн проекта DAWN по кругу. Что именно звучит в такте, решает arrange.js, а звук бывает двух видов:
 *  • кеш: заранее отрендеренные дорожки (stems.js), зацикленные и включаемые по тактам. Почти не нагружает процессор;
 *  • синтез: тот же граф, что в самом DAWN (graph.js). Звучит лучше, но слабым телефонам не под силу.
 * Выбор: короткий замер рендера (benchSynth), результат запоминается. Если синтез всё же не успевает в бою,
 * переходим на кеш на ходу и больше на этом устройстве синтез не включаем.
 *
 * Время. Сервер объявляет t0 — момент доли 0 по своим часам. Шаг сетки — 1/16 (как в DAWN). Участники боя
 * считают шаг от t0, поэтому присоединившийся попадает в ту же долю, а не начинает трек сначала.
 * Попадание в такт судит клиент: только он знает, что слышит игрок. Задержке, которую сообщает браузер, верить нельзя:
 * на телефонах настоящая 100–250 мс при заявленных 8, а завышенная сдвигает окно позже ноты. Поэтому задержка здесь
 * одна — поправка (calib): она считается по тому, где игрок стабильно нажимает, и запоминается на устройстве.
 */
const LOOKAHEAD = 0.2, TIMER_MS = 25, STEP = 0.25;
const OPEN = 22000;
const WINDOW = 0.055;      // допуск тапа, с: в обе стороны от ноты; у трека можно задать свой (window)
const WINDOW_WEAK = 0.06;   // на слабых устройствах: задержка там больше и плавает
const TOUCH_CALIB = 0.13;  // с: типичная задержка телефона, пока поправка не выучена
const CALIB_MIN = -0.05, CALIB_MAX = 0.4, CALIB_MAX_DESK = 0.2;
const CALIB_KEY = "dungeon.calib2";   // новый ключ: старая поправка считалась поверх заявленной задержки
const LEARN_TAPS = 7, LEARN_FROM = 3, LEARN_RATE = 0.6;   // медиана последних нажатий: случайный тап её не сдвинет
const BENCH_WAIT = 800;    // мс: дольше ждать замер нельзя, бой уже идёт; слабое устройство сюда и упрётся
const SLOW_SPEED = 0.9, SLOW_CHECKS = 2;   // время звука идёт медленнее реального: столько проверок подряд — и на кеш
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class BattleMusic {
  constructor() {
    this.ctx = null; this.cache = new Map(); this.G = null; this.timer = null; this.taps = [];
    this.touch = navigator.maxTouchPoints > 0;
    this.calib = store.get(CALIB_KEY, this.touch ? TOUCH_CALIB : 0);
  }

  /* разбудить звук: только из обработчика нажатия, иначе браузер не даст.
   * Пустой звук нужен iOS: там контекст оживает, только если в момент нажатия что-то запущено */
  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      this.ctx.onstatechange = () => this.onWake?.();
    }
    if (this.ctx.state === "running") return;
    this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    s.connect(this.ctx.destination);
    s.start();
  }
  get running() { return !!this.timer; }
  get audible() { return this.ctx?.state === "running"; }

  async fetchTrack(track) {
    if (!this.cache.has(track.file)) this.cache.set(track.file, await (await fetch(track.file)).json());
    return this.cache.get(track.file);
  }

  /* тянет ли устройство синтез: ответ запоминается, замер не дольше BENCH_WAIT */
  async useSynth(raw, track) {
    const known = store.get("dungeon.synth", null);
    if (known !== null) return known;
    this.bench ||= benchSynth(raw, track).then(ok => { store.set("dungeon.synth", ok); return ok; }, () => false);
    return Promise.race([this.bench, sleep(BENCH_WAIT).then(() => false)]);
  }

  /* b: { music (правила трека от сервера), t0, seed }; clock() — часы сервера, мс */
  async start(b, clock) {
    this.stop(0.05);
    this.unlock();
    const token = this.token = {};
    this.current = { b, clock };
    const track = b.music, raw = await this.fetchTrack(track);
    if (token !== this.token) return;
    const P = fromFile(JSON.parse(JSON.stringify(raw)));
    if (track.pattern) P.cur = track.pattern;
    const pat = P.patterns.find(p => p.id === P.cur) || P.patterns[0];
    const synth = !track.stems || await this.useSynth(raw, track);
    if (token !== this.token) return;
    const bank = synth ? null : await this.loadStems(track).catch(e => { console.warn("кеш музыки", e); return null; });
    if (!bank) {
      await Promise.all(P.channels.filter(c => c.type === "sampler" && c.params.path).map(c => ensureSample(this.ctx, c.params.path)));
      if (P.mixer.some(m => m.fx.some(f => f.type === "math" || f.type === "code"))) await loadCodeWorklet(this.ctx);
    }
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

    const G = bank ? null : buildGraph(this.ctx, P);
    const beatSec = 60 / P.bpm;
    this.P = P; this.G = G; this.A = A; this.pat = pat;
    this.steps = steps; this.barSteps = barSteps; this.buckets = buckets; this.strong = strong;
    this.beatSec = beatSec; this.stepSec = beatSec * STEP; this.seed = b.seed; this.window = track.window || (bank ? WINDOW_WEAK : WINDOW);
    this.weak = !!bank;
    this.filters = new Map();
    this.plan = null;
    this.state ||= { enemyHp: 1, myHp: 1, combo: 0 };
    this.lead = P.channels.find(c => A.roleOf(c.id) === "lead") || null;

    this.aT0 = this.ctx.currentTime + (b.t0 - clock()) / 1000;   // доля 0 на часах аудио; часы читаем здесь: загрузка заняла время
    this.watch = { at: 0, ct: 0, slow: 0 };
    this.step = Math.max(0, Math.ceil((this.ctx.currentTime - this.aT0) / this.stepSec));
    if (bank) this.mountStems(bank, track.stems);
    this.timer = setInterval(() => this.tick(), TIMER_MS);
    this.tick();
  }

  stop(fade = 0.6) {
    this.token = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.dropStems(fade);
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
    if (this.mix) this.launchStems();
  }

  /* ---------- кеш: дорожки ---------- */
  /* скачать и распаковать дорожки трека; держим только последний трек, память телефона не резиновая */
  async loadStems(track) {
    const m = track.stems;
    if (!m) return null;
    if (this.bank?.base === m.base) return this.bank;
    const names = [...m.stems.map(s => s.name), ...(m.hit ? [m.hit.name] : [])], buffers = {};
    await Promise.all(names.map(async n => {
      const r = await fetch(m.base + n);
      if (!r.ok) throw new Error(`дорожка ${n}: ${r.status}`);
      buffers[n] = await this.ctx.decodeAudioData(await r.arrayBuffer());
    }));
    return (this.bank = { base: m.base, buffers });
  }

  mountStems(bank, m) {
    const c = this.ctx, out = c.createGain(), lim = c.createDynamicsCompressor(), meter = c.createAnalyser();
    lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
    out.gain.value = 1; out.connect(lim); lim.connect(meter); meter.connect(c.destination);
    const filters = new Map(), have = new Map();
    const stems = m.stems.map(s => {
      if (!filters.has(s.role)) {
        const f = c.createBiquadFilter();
        f.type = "lowpass"; f.Q.value = 0.7; f.frequency.value = OPEN; f.connect(out);
        filters.set(s.role, f);
      }
      (have.get(s.role) || have.set(s.role, new Set()).get(s.role)).add(s.shift);
      const gain = c.createGain();
      gain.gain.value = 0; gain.connect(filters.get(s.role));
      return { ...s, buffer: bank.buffers[s.name], gain, src: null };
    });
    this.mix = { out, lim, meter, filters, have, stems, hit: m.hit && { ...m.hit, buffer: bank.buffers[m.hit.name] } };
    this.launchStems();
  }

  /* все петли стартуют одной фразой, в нужном месте: присоединившийся попадает в ту же долю */
  launchStems() {
    const { stems } = this.mix, loop = this.steps * this.stepSec;
    const when = Math.max(this.ctx.currentTime + 0.06, this.aT0), at = (((when - this.aT0) % loop) + loop) % loop;
    for (const s of stems) {
      try { s.src?.stop(); } catch { /* уже остановлен */ }
      const src = this.ctx.createBufferSource(), rate = s.buffer.duration / loop;   // длина буфера округлена до сэмпла
      src.buffer = s.buffer; src.loop = true; src.playbackRate.value = rate;
      src.connect(s.gain);
      src.start(when, at * rate);
      s.src = src;
    }
  }

  mixStems(t) {
    const { stems, filters, have } = this.mix, { active, shift, filter } = this.plan;
    for (const s of stems) {
      const want = shift[s.role] || 0, use = have.get(s.role).has(want) ? want : 0;
      s.gain.gain.setTargetAtTime(active.has(s.role) && s.shift === use ? 1 : 0, t, 0.006);
    }
    for (const [role, f] of filters) f.frequency.setTargetAtTime(filter[role] ?? OPEN, t, 0.25);
  }

  dropStems(fade) {
    const m = this.mix;
    if (!m) return;
    this.mix = null;
    const t = this.ctx.currentTime, g = m.out.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => {
      for (const s of m.stems) { try { s.src?.stop(); } catch { /* уже остановлен */ } s.gain.disconnect(); }
      for (const f of m.filters.values()) f.disconnect();
      m.out.disconnect(); m.lim.disconnect(); m.meter.disconnect();
    }, (fade + 0.2) * 1000);
  }

  /* для диагностики на экране боя: идёт ли время звука, есть ли сигнал, не опаздывает ли расписание */
  stats() {
    if (!this.ctx) return "нет контекста";
    const now = performance.now(), at = this.ctx.currentTime, last = this.statAt;
    const speed = last ? (at - last.at) * 1000 / Math.max(1, now - last.now) : 1;
    this.statAt = { now, at };
    let peak = 0;
    const an = this.mix?.meter || this.G?.analyser;
    if (an) {
      const b = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(b);
      for (const x of b) if (Math.abs(x) > peak) peak = Math.abs(x);
    }
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return `${this.mix ? "кеш" : "синтез"} · ${this.ctx.state} · ход ${speed.toFixed(2)} · сигнал ${peak.toFixed(2)} · задержка ${Math.round(lat * 1000)} мс · поправка ${Math.round(this.calib * 1000)} мс`;
  }

  setState(s) { this.state = { ...this.state, ...s }; }

  tick() {
    const until = this.ctx.currentTime + LOOKAHEAD;
    for (let t = this.timeOf(this.step); t < until; t = this.timeOf(this.step)) {
      if (t >= this.ctx.currentTime) this.playStep(this.step, t);
      this.step++;
    }
    if (this.G && this.current.b.music.stems) this.watchSynth();
  }

  /* синтез не успевает: время звука отстаёт от настоящего. Дальше на этом устройстве только кеш */
  watchSynth() {
    const w = this.watch, now = performance.now(), ct = this.ctx.currentTime;
    if (now - w.at < 1000) return;
    const speed = w.at ? (ct - w.ct) * 1000 / (now - w.at) : 1;
    w.at = now; w.ct = ct;
    if (document.hidden || this.ctx.state !== "running") { w.slow = 0; return; }
    w.slow = speed < SLOW_SPEED ? w.slow + 1 : 0;
    if (w.slow < SLOW_CHECKS) return;
    store.set("dungeon.synth", false);
    this.start(this.current.b, this.current.clock).catch(e => console.warn("кеш музыки", e));
  }
  timeOf(step) { return this.aT0 + step * this.stepSec; }

  playStep(step, t) {
    const local = step % this.steps;
    if (!this.plan || local % this.barSteps === 0) this.replan(step, t);
    if (this.mix) return;
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
    const w = this.state.wail, dark = !!w && step >= w.quiet && step < w.end;
    this.plan = planBar(this.A, { ...this.state, dark, loop, bar, bars: Math.round(this.steps / this.barSteps), seed: this.seed });
    (this.mix?.out || this.G?.final)?.gain.setTargetAtTime(this.plan.duck, t, 0.25);
    for (const ch of this.P.channels) {
      const role = this.A.roleOf(ch.id);
      if (!this.mix) this.setFilter(ch, this.plan.filter[role] ?? OPEN, t);
    }
    if (this.mix) this.mixStems(t);
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
    return (this.ctx.currentTime - this.calib - this.aT0) / this.stepSec;
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
  /* поправка — медиана того, где игрок нажимал на самом деле, и по попаданиям, и по промахам:
   * при задержке больше окна он иначе никогда бы не попал и выучить было бы нечего */
  learn(err) {
    this.taps.push(this.calib + err);
    if (this.taps.length > LEARN_TAPS) this.taps.shift();
    if (this.taps.length < LEARN_FROM) return;
    const mid = [...this.taps].sort((a, b) => a - b)[this.taps.length >> 1];
    const top = this.touch ? CALIB_MAX : CALIB_MAX_DESK;
    this.calib = Math.max(CALIB_MIN, Math.min(top, this.calib + (mid - this.calib) * LEARN_RATE));
    store.set(CALIB_KEY, this.calib);
  }

  /* удар в комбо — тихая копия колокольчиков этой доли октавой выше того, что звучит сейчас */
  hitTone(step) {
    if ((!this.G && !this.mix) || !this.lead) return;
    const local = ((step % this.steps) + this.steps) % this.steps;
    const hit = this.buckets[local].find(b => b.ch === this.lead) || this.buckets.find(l => l.some(b => b.ch === this.lead))?.[0];
    if (!hit) return;
    const edo = this.lead.edo || 12, shift = this.plan?.shift[this.A.roleOf(this.lead.id)] || 0;
    if (this.mix) return this.hitStem(hit.n.n + edo + Math.round(shift * edo / 12));
    this.G.voice(this.lead, this.ctx.currentTime + 0.005, 0.25, hit.n.n + edo + Math.round(shift * edo / 12), 0.4);
  }
  /* в режиме кеша нота одна, нужная высота — через скорость проигрывания */
  hitStem(note) {
    const h = this.mix.hit;
    if (!h) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = h.buffer; src.playbackRate.value = 2 ** ((note - h.n) / h.edo);
    g.gain.value = 0.47;     // 0.4 / 0.85: нота отрендерена с силой 0.85
    src.connect(g); g.connect(this.mix.out);
    src.start();
    src.onended = () => g.disconnect();
  }
}
