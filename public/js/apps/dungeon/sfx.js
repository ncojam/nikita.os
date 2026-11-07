/* ================= Clown Dungeon — звуки =================
 * Всё синтезируется на месте, файлов нет: приставочные шумы и квадраты плюс эхо пещеры.
 * Звук живёт на том же AudioContext, что и музыка, но мимо её графа: музыка затихает отдельно от него.
 * До первого нажатия контекста нет, и звуки молча пропускаются.
 */
const ECHO_TIME = 0.17, ECHO_BACK = 0.38, ECHO_TONE = 1700;
const LAUGH_HZ = 150, LAUGH_LEN = 0.2;
const WAIL_FROM = 180, WAIL_TO = 820, WAIL_VOL = 0.09, WAIL_OUT = 1.2;
const WAIL_DETUNE = [-17, -8, 0, 9, 18];   // центы: юнисон из пяти расстроенных голосов
const pick = (a, b) => a + Math.random() * (b - a);

export class Sfx {
  constructor(getCtx) { this.getCtx = getCtx; this.c = null; }

  get ctx() {
    const c = this.getCtx();
    if (!c) return null;
    if (c !== this.c) this.build(c);
    return c;
  }

  build(c) {
    this.c = c;
    this.master = c.createGain(); this.master.gain.value = 0.6;
    this.master.connect(c.destination);
    // эхо: вход → задержка → приглушение → обратно в задержку и на выход
    this.echo = c.createGain();
    const d = c.createDelay(1), lp = c.createBiquadFilter(), back = c.createGain(), wet = c.createGain();
    d.delayTime.value = ECHO_TIME; lp.type = "lowpass"; lp.frequency.value = ECHO_TONE;
    back.gain.value = ECHO_BACK; wet.gain.value = 0.5;
    this.echo.connect(d); d.connect(lp); lp.connect(back); back.connect(d); lp.connect(wet); wet.connect(this.master);
    this.white = this.noise(c, 1);
    this.chip = this.noise(c, 14);    // держим значение по 14 сэмплов: грубый шум, как у приставок
  }
  noise(c, hold) {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate), o = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < o.length; i++) { if (i % hold === 0) v = Math.random() * 2 - 1; o[i] = v; }
    return b;
  }

  /* нота с резкой огибающей; dest — куда идёт (сухой выход и/или эхо) */
  tone(type, hz, t, dur, vol, { to = hz, echo = 0.25 } = {}) {
    const c = this.c, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    if (to !== hz) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.master);
    if (echo) { const e = this.c.createGain(); e.gain.value = echo; g.connect(e); e.connect(this.echo); }
    o.start(t); o.stop(t + dur + 0.02);
  }
  /* всплеск шума; filter: [тип, Гц] */
  burst(buf, t, dur, vol, { rate = 1, rateTo = rate, filter = null, echo = 0 } = {}) {
    const c = this.c, s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; s.loop = true;
    s.playbackRate.setValueAtTime(rate, t);
    if (rateTo !== rate) s.playbackRate.exponentialRampToValueAtTime(rateTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let n = s;
    if (filter) { const f = c.createBiquadFilter(); f.type = filter[0]; f.frequency.value = filter[1]; s.connect(f); n = f; }
    n.connect(g); g.connect(this.master);
    if (echo) { const e = c.createGain(); e.gain.value = echo; g.connect(e); e.connect(this.echo); }
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  /* шаги: заглушённые хеты с эхом, три за одну прогулку */
  steps(sec) {
    const c = this.ctx;
    if (!c) return;
    for (let i = 0; i < 3; i++) {
      const t = c.currentTime + i * sec / 3 + pick(0.005, 0.03);
      this.burst(this.white, t, 0.05, i % 2 ? 0.3 : 0.38, { filter: ["lowpass", pick(1500, 2100)], echo: 0.8 });
    }
  }
  /* урон: быстрый грубый шум с питчем вниз */
  hurt(strong = true) {
    const c = this.ctx;
    if (!c) return;
    this.burst(this.chip, c.currentTime, strong ? 0.26 : 0.14, strong ? 0.6 : 0.26, { rate: 1.6, rateTo: 0.12 });
  }
  coin() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.tone("square", 988, t, 0.07, 0.18);
    this.tone("square", 1319, t + 0.07, 0.22, 0.18);
  }
  item() {
    const c = this.ctx;
    if (!c) return;
    [659, 880, 1109, 1319].forEach((hz, i) => this.tone("triangle", hz, c.currentTime + i * 0.065, 0.11, 0.34));
  }
  /* хихиканье где-то вдалеке: череда коротких «хи» сквозь узкий фильтр, почти одно эхо */
  giggle() {
    const c = this.ctx;
    if (!c) return;
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = "bandpass"; f.frequency.value = pick(1300, 1700); f.Q.value = 5;
    g.gain.value = 1.2;
    f.connect(g); g.connect(this.echo);
    const out = c.createGain(); out.gain.value = 0.7; g.connect(out); out.connect(this.master);
    const base = pick(760, 980), count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const t = c.currentTime + 0.02 + i * pick(0.1, 0.125), o = c.createOscillator(), e = c.createGain();
      const hz = base * (1 - i * 0.035) * pick(0.97, 1.03);
      o.type = "sawtooth";
      o.frequency.setValueAtTime(hz * 1.12, t);
      o.frequency.exponentialRampToValueAtTime(hz * 0.86, t + 0.08);
      e.gain.setValueAtTime(0, t);
      e.gain.linearRampToValueAtTime(0.5, t + 0.012);
      e.gain.exponentialRampToValueAtTime(0.01, t + 0.085);
      o.connect(e); e.connect(f);
      o.start(t); o.stop(t + 0.1);
    }
  }
  /* плач: три всхлипа вниз с дрожью, голос сквозь полосовой фильтр */
  cry() {
    const c = this.ctx;
    if (!c) return;
    const f = c.createBiquadFilter(), g = c.createGain(), e = c.createGain();
    f.type = "bandpass"; f.frequency.value = 1150; f.Q.value = 3;
    g.gain.value = 0.9; e.gain.value = 0.45;
    f.connect(g); g.connect(this.master); g.connect(e); e.connect(this.echo);
    [[0, 0.42, 620], [0.46, 0.42, 560], [0.92, 0.75, 500]].forEach(([at, dur, hz]) => {
      const t = c.currentTime + 0.02 + at, o = c.createOscillator(), v = c.createOscillator(), depth = c.createGain(), env = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(hz, t);
      o.frequency.exponentialRampToValueAtTime(hz * 0.62, t + dur);
      v.frequency.value = 9; depth.gain.value = hz * 0.05;
      v.connect(depth); depth.connect(o.frequency);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.03);
      env.gain.setValueAtTime(0.5, t + dur * 0.6);
      env.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(env); env.connect(f);
      o.start(t); v.start(t); o.stop(t + dur + 0.02); v.stop(t + dur + 0.02);
    });
  }
  /* искра: быстрый свист вверх и хлопок шума */
  spell() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.tone("sawtooth", 300, t, 0.2, 0.14, { to: 2400, echo: 0.5 });
    this.burst(this.white, t + 0.18, 0.2, 0.3, { filter: ["highpass", 1800], echo: 0.6 });
  }
  /* завывание: синус ползёт вверх унисоном с расстройкой, к тишине тонет в реверберации.
   * Времена — на часах звука: границы тактов из музыки */
  wail(from, quiet, end) {
    const c = this.ctx;
    if (!c) return;
    this.wailStop();
    const t0 = Math.max(c.currentTime, from), up = Math.max(0.2, quiet - t0);
    const g = c.createGain(), dry = c.createGain(), wet = c.createGain(), rev = c.createConvolver();
    rev.buffer = this.hall ||= this.impulse(c);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(WAIL_VOL, t0 + up * 0.7);
    g.gain.setValueAtTime(WAIL_VOL, end - WAIL_OUT);
    g.gain.linearRampToValueAtTime(0, end);
    dry.gain.setValueAtTime(1, t0);
    dry.gain.setValueAtTime(1, quiet - up * 0.4);
    dry.gain.linearRampToValueAtTime(0.2, quiet + 0.6);
    wet.gain.setValueAtTime(0, t0);
    wet.gain.setValueAtTime(0, quiet - up * 0.4);
    wet.gain.linearRampToValueAtTime(1.6, quiet + 0.6);
    g.connect(dry); dry.connect(this.master);
    g.connect(rev); rev.connect(wet); wet.connect(this.master);
    const vib = c.createOscillator(), depth = c.createGain();
    vib.frequency.value = 5.5; depth.gain.value = 7;
    vib.connect(depth);
    const voices = WAIL_DETUNE.map(cents => {
      const o = c.createOscillator();
      o.type = "sine"; o.detune.value = cents;
      o.frequency.setValueAtTime(WAIL_FROM, t0);
      o.frequency.exponentialRampToValueAtTime(WAIL_TO, quiet);
      o.frequency.exponentialRampToValueAtTime(WAIL_TO * 1.12, end);
      depth.connect(o.detune);
      o.connect(g);
      o.start(t0); o.stop(end + 0.05);
      return o;
    });
    vib.start(t0); vib.stop(end + 0.05);
    this.wailing = { g, voices: [...voices, vib] };
  }
  /* оборвать завывание: сбился, комбо кончилось или вышли из боя */
  wailStop() {
    const w = this.wailing;
    if (!w) return;
    this.wailing = null;
    const t = this.c.currentTime;
    w.g.gain.cancelScheduledValues(t);
    w.g.gain.setValueAtTime(w.g.gain.value, t);
    w.g.gain.linearRampToValueAtTime(0, t + 0.2);
    for (const o of w.voices) { try { o.stop(t + 0.25); } catch { /* уже остановлен */ } }
  }
  /* зал: затухающий шум вместо записанной реверберации */
  impulse(c) {
    const n = Math.round(c.sampleRate * 2.4), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    return b;
  }
  /* смешок клоуна: всегда один и тот же звук — от повторения и жутко.
   * Низкий «хе» из двух расстроенных пил, звук дрожит амплитудной модуляцией и тонет в эхе. Времена — на часах звука */
  laugh(times) {
    const c = this.ctx;
    if (!c) return;
    this.laughStop();
    const out = c.createGain(), f = c.createBiquadFilter(), e = c.createGain();
    f.type = "bandpass"; f.frequency.value = 820; f.Q.value = 2.5;
    out.gain.value = 0.9; e.gain.value = 0.7;
    f.connect(out); out.connect(this.master); out.connect(e); e.connect(this.echo);
    const nodes = [];
    for (const t0 of times) {
      const t = Math.max(c.currentTime, t0);
      const am = c.createGain(), lfo = c.createOscillator(), depth = c.createGain(), env = c.createGain();
      lfo.frequency.value = 34; depth.gain.value = 0.5; am.gain.value = 0.5;
      lfo.connect(depth); depth.connect(am.gain);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.55, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.01, t + LAUGH_LEN);
      for (const cents of [0, 38]) {
        const o = c.createOscillator();
        o.type = "sawtooth"; o.detune.value = cents;
        o.frequency.setValueAtTime(LAUGH_HZ, t);
        o.frequency.exponentialRampToValueAtTime(LAUGH_HZ * 0.68, t + LAUGH_LEN);
        o.connect(am);
        o.start(t); o.stop(t + LAUGH_LEN + 0.02);
        nodes.push(o);
      }
      am.connect(env); env.connect(f);
      lfo.start(t); lfo.stop(t + LAUGH_LEN + 0.02);
      nodes.push(lfo);
      this.burst(this.white, t, 0.06, 0.12, { filter: ["bandpass", 2600], echo: 0.3 });   // выдох перед смешком
    }
    this.laughing = { out, nodes };
  }
  laughStop() {
    const l = this.laughing;
    if (!l) return;
    this.laughing = null;
    const t = this.c.currentTime;
    l.out.gain.setTargetAtTime(0, t, 0.05);
    for (const o of l.nodes) { try { o.stop(t + 0.2); } catch { /* уже остановлен */ } }
  }
  /* клоунская машина: двухтональный гудок с проседающей высотой */
  honk() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    for (const [at, hz] of [[0, 415], [0.28, 330]]) {
      this.tone("square", hz, t + at, 0.24, 0.13, { to: hz * 0.94, echo: 0.4 });
      this.tone("square", hz * 1.26, t + at, 0.24, 0.08, { to: hz * 1.18, echo: 0.4 });
    }
  }
  /* победа: восходящая фанфара в ре, как в боевых треках */
  win() {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + 0.05;
    [[587, 0, 0.1], [740, 0.1, 0.1], [880, 0.2, 0.1], [1175, 0.3, 0.16], [880, 0.46, 0.08], [1175, 0.54, 0.5]]
      .forEach(([hz, at, d]) => this.tone("square", hz, t + at, d, 0.16, { echo: 0.35 }));
    [[294, 0, 0.3], [440, 0.3, 0.24], [294, 0.54, 0.5]].forEach(([hz, at, d]) => this.tone("triangle", hz, t + at, d, 0.3, { echo: 0 }));
  }
  /* рюкзак: шорох и щелчок застёжки; при закрытии — наоборот, вниз */
  bag(open = true) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    this.burst(this.white, t, 0.07, 0.16, { rate: open ? 0.6 : 1.2, rateTo: open ? 1.2 : 0.6, filter: ["bandpass", 2400] });
    this.tone("triangle", open ? 520 : 780, t + 0.05, 0.05, 0.2, { to: open ? 780 : 520, echo: 0 });
  }
}
