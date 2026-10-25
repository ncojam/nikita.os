/* ================= DAWN — эффекты микшера =================
 * Эффект = { input, output, set(p), tempo(bpm), dispose() } поверх любого (Offline)AudioContext.
 * Параметры описаны как у крутилок (min/max/def/label/curve/step/names) — UI строится сам.
 */
export const SYNC = [["1/16", 0.25], ["1/8", 0.5], ["1/8.", 0.75], ["1/4", 1], ["1/4.", 1.5], ["1/2", 2], ["1 такт", 4]];

export const FX = {
  delay: {
    name: "Delay", icon: "⟲", color: "#9fd3ff",
    params: {
      sync: { min: 0, max: SYNC.length - 1, def: 2, step: 1, label: "Time", names: SYNC.map(s => s[0]) },
      fb: { min: 0, max: 0.92, def: 0.38, label: "Feedback" },
      mix: { min: 0, max: 1, def: 0.3, label: "Mix" },
      damp: { min: 500, max: 16000, def: 5000, label: "Damp", curve: 3 },
      pp: { min: 0, max: 1, def: 1, step: 1, label: "Ping-pong", names: ["off", "on"] },
    },
    create(ctx, p) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
      const dA = ctx.createDelay(4), dB = ctx.createDelay(4), fA = ctx.createGain(), fB = ctx.createGain();
      const lpA = ctx.createBiquadFilter(), lpB = ctx.createBiquadFilter(), pA = ctx.createStereoPanner(), pB = ctx.createStereoPanner();
      lpA.type = lpB.type = "lowpass";
      input.connect(dry); dry.connect(output);
      input.connect(dA);
      dA.connect(lpA); lpA.connect(fA); fA.connect(dB);      // A → B → A: пинг-понг
      dB.connect(lpB); lpB.connect(fB); fB.connect(dA);
      dA.connect(pA); dB.connect(pB); pA.connect(wet); pB.connect(wet); wet.connect(output);
      let bpm = 120;
      const n = {
        input, output,
        set(q) {
          p = q;
          const t = SYNC[Math.round(p.sync)]?.[1] * 60 / bpm || 0.375;
          dA.delayTime.value = t; dB.delayTime.value = t;
          fA.gain.value = p.fb; fB.gain.value = p.fb;
          lpA.frequency.value = lpB.frequency.value = p.damp;
          pA.pan.value = p.pp ? -0.8 : 0; pB.pan.value = p.pp ? 0.8 : 0;
          dry.gain.value = 1 - p.mix * 0.5; wet.gain.value = p.mix;
        },
        tempo(b) { bpm = b; n.set(p); },
        dispose() { for (const x of [input, output, dry, wet, dA, dB, fA, fB, lpA, lpB, pA, pB]) x.disconnect(); },
      };
      n.set(p);
      return n;
    },
  },

  reverb: {
    name: "Reverb", icon: "◌", color: "#c3a6ff",
    params: {
      decay: { min: 0.3, max: 8, def: 2.2, label: "Decay", curve: 2 },
      pre: { min: 0, max: 0.2, def: 0.02, label: "Pre-dly" },
      damp: { min: 800, max: 18000, def: 7000, label: "Damp", curve: 3 },
      low: { min: 20, max: 1000, def: 120, label: "Low cut", curve: 3 },
      mix: { min: 0, max: 1, def: 0.25, label: "Mix" },
    },
    create(ctx, p) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
      const pre = ctx.createDelay(1), conv = ctx.createConvolver(), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
      lp.type = "lowpass"; hp.type = "highpass";
      input.connect(dry); dry.connect(output);
      input.connect(pre); pre.connect(conv); conv.connect(hp); hp.connect(lp); lp.connect(wet); wet.connect(output);
      let irFor = -1, timer = 0;
      const makeIR = decay => {   // стерео-шум с экспоненциальным спадом: −60 дБ к концу decay
        const len = Math.ceil(ctx.sampleRate * decay), ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * i / len) * (i < 64 ? i / 64 : 1);
        }
        conv.buffer = ir; irFor = decay;
      };
      const n = {
        input, output,
        set(q) {
          p = q;
          pre.delayTime.value = p.pre; lp.frequency.value = p.damp; hp.frequency.value = p.low;
          dry.gain.value = 1 - p.mix * 0.4; wet.gain.value = p.mix * 1.4;
          if (Math.abs(irFor - p.decay) > 0.05) {
            if (irFor < 0 || ctx instanceof OfflineAudioContext) makeIR(p.decay);
            else { clearTimeout(timer); timer = setTimeout(() => makeIR(p.decay), 120); }   // не пересчитываем на каждом движении
          }
        },
        tempo() {},
        dispose() { clearTimeout(timer); for (const x of [input, output, dry, wet, pre, conv, lp, hp]) x.disconnect(); },
      };
      n.set(p);
      return n;
    },
  },

  eq: {
    name: "EQ", icon: "≈", color: "#8fe8cf",
    params: {
      lf: { min: 30, max: 600, def: 120, label: "Low Hz", curve: 2.5 },
      lg: { min: -18, max: 18, def: 0, label: "Low dB", bipolar: true },
      mf: { min: 150, max: 8000, def: 1000, label: "Mid Hz", curve: 3 },
      mg: { min: -18, max: 18, def: 0, label: "Mid dB", bipolar: true },
      mq: { min: 0.3, max: 8, def: 1, label: "Mid Q", curve: 2 },
      hf: { min: 1500, max: 16000, def: 6000, label: "High Hz", curve: 2.5 },
      hg: { min: -18, max: 18, def: 0, label: "High dB", bipolar: true },
    },
    create(ctx, p) {
      const lo = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), hi = ctx.createBiquadFilter();
      lo.type = "lowshelf"; mid.type = "peaking"; hi.type = "highshelf";
      lo.connect(mid); mid.connect(hi);
      const n = {
        input: lo, output: hi,
        set(q) {
          p = q;
          lo.frequency.value = p.lf; lo.gain.value = p.lg;
          mid.frequency.value = p.mf; mid.gain.value = p.mg; mid.Q.value = p.mq;
          hi.frequency.value = p.hf; hi.gain.value = p.hg;
        },
        tempo() {},
        dispose() { lo.disconnect(); mid.disconnect(); hi.disconnect(); },
      };
      n.set(p);
      return n;
    },
  },
  dist: {
    name: "Distortion", icon: "⚡", color: "#ff7aa8",
    params: {
      drive: { min: 0, max: 1, def: 0.5, label: "Drive" },
      shape: { min: 0, max: 3, def: 0, step: 1, label: "Shape", names: ["soft", "hard", "fold", "crush"] },
      tone: { min: 500, max: 18000, def: 9000, label: "Tone", curve: 3 },
      mix: { min: 0, max: 1, def: 1, label: "Mix" },
      out: { min: 0, max: 1.5, def: 0.7, label: "Out" },
    },
    create(ctx, p) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
      const pre = ctx.createGain(), ws = ctx.createWaveShaper(), lp = ctx.createBiquadFilter();
      ws.oversample = "4x"; lp.type = "lowpass";
      input.connect(dry); dry.connect(output);
      input.connect(pre); pre.connect(ws); ws.connect(lp); lp.connect(wet); wet.connect(output);
      let key = "";
      const curve = (shape, drive) => {   // таблица передачи x ∈ [-1, 1] → y
        const N = 2048, c = new Float32Array(N), k = 1 + drive * 40, steps = 2 + (1 - drive) * 30;
        for (let i = 0; i < N; i++) {
          const x = i / (N - 1) * 2 - 1;
          c[i] = shape === 0 ? Math.tanh(k * x) / Math.tanh(k)              // мягкое насыщение
            : shape === 1 ? Math.max(-1, Math.min(1, x * k * 0.5))           // жёсткий клип
            : shape === 2 ? Math.sin(x * (1 + drive * 8) * Math.PI / 2)      // складывание (wavefold)
            : Math.round(x * steps) / steps;                                 // крош: ступеньки
        }
        return c;
      };
      const n = {
        input, output,
        set(q) {
          p = q;
          const sh = Math.round(p.shape), k = sh + ":" + p.drive.toFixed(3);
          if (k !== key) { ws.curve = curve(sh, p.drive); key = k; }
          pre.gain.value = 1 + p.drive * 2;
          lp.frequency.value = p.tone;
          dry.gain.value = 1 - p.mix; wet.gain.value = p.mix * p.out;
        },
        tempo() {},
        dispose() { for (const x of [input, output, dry, wet, pre, ws, lp]) x.disconnect(); },
      };
      n.set(p);
      return n;
    },
  },

  comp: {
    name: "Compressor", icon: "▤", color: "#fff09e",
    params: {
      thresh: { min: -60, max: 0, def: -18, label: "Thresh" },
      ratio: { min: 1, max: 20, def: 4, label: "Ratio", curve: 2 },
      attack: { min: 0.001, max: 0.3, def: 0.01, label: "Attack", curve: 3 },
      release: { min: 0.02, max: 1, def: 0.15, label: "Release", curve: 2 },
      gain: { min: 0, max: 24, def: 4, label: "Makeup" },
    },
    create(ctx, p) {
      const c = ctx.createDynamicsCompressor(), g = ctx.createGain();
      c.knee.value = 6; c.connect(g);
      const n = {
        input: c, output: g,
        set(q) { p = q; c.threshold.value = p.thresh; c.ratio.value = p.ratio; c.attack.value = p.attack; c.release.value = p.release; g.gain.value = 10 ** (p.gain / 20); },
        tempo() {}, dispose() { c.disconnect(); g.disconnect(); },
      };
      n.set(p);
      return n;
    },
  },

  /* «OTT»: три полосы (до 120 Гц, середина, от 2.5 кГц), каждая жёстко сжата и поднята — тихое громче, громкое прижато */
  ott: {
    name: "OTT", icon: "▦", color: "#c3a6ff",
    params: {
      depth: { min: 0, max: 1, def: 0.5, label: "Depth" },
      time: { min: 0.2, max: 3, def: 1, label: "Time", curve: 2 },
      low: { min: -12, max: 12, def: 0, label: "Low", bipolar: true },
      mid: { min: -12, max: 12, def: 0, label: "Mid", bipolar: true },
      high: { min: -12, max: 12, def: 2, label: "High", bipolar: true },
      out: { min: 0, max: 1.5, def: 0.9, label: "Out" },
    },
    create(ctx, p) {
      const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
      input.connect(dry); dry.connect(output); wet.connect(output);
      const filt = (type, f) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.frequency.value = b.frequency.value = f; a.connect(b); return [a, b]; };
      const [l1, l2] = filt("lowpass", 120), [h1, h2] = filt("highpass", 2500), [m1, m2] = filt("highpass", 120), [m3, m4] = filt("lowpass", 2500);
      m2.connect(m3);
      const bands = [[l1, l2], [m1, m4], [h1, h2]].map(([inp, out]) => {
        input.connect(inp);
        const c = ctx.createDynamicsCompressor(), g = ctx.createGain();
        c.ratio.value = 8; c.knee.value = 10;
        out.connect(c); c.connect(g); g.connect(wet);
        return { c, g };
      });
      const n = {
        input, output,
        set(q) {
          p = q;
          const gains = [p.low, p.mid, p.high];
          bands.forEach((b, i) => {
            b.c.attack.value = 0.003 * p.time; b.c.release.value = 0.08 * p.time;
            b.c.threshold.value = -12 - p.depth * 30;
            b.g.gain.value = 10 ** ((gains[i] + p.depth * 14) / 20);
          });
          dry.gain.value = 1 - p.depth; wet.gain.value = p.depth * p.out;
        },
        tempo() {},
        dispose() { for (const x of [input, output, dry, wet, l1, l2, h1, h2, m1, m2, m3, m4]) x.disconnect(); bands.forEach(b => { b.c.disconnect(); b.g.disconnect(); }); },
      };
      n.set(p);
      return n;
    },
  },

  /* сайдчейн: громкость ныряет на каждой ноте канала-источника (обычно бочки) — точно по сетке, и в WAV тоже */
  side: {
    name: "Sidechain", icon: "⤓", color: "#8fe8cf",
    params: {
      src: { kind: "channel", def: "kick", label: "Source" },
      amount: { min: 0, max: 1, def: 0.7, label: "Amount" },
      attack: { min: 0.001, max: 0.05, def: 0.004, label: "Attack", curve: 2 },
      release: { min: 0.03, max: 0.8, def: 0.22, label: "Release", curve: 2 },
    },
    create(ctx, p) {
      const g = ctx.createGain();
      return {
        input: g, output: g,
        set(q) { p = q; },
        duck(t) {
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(1 - p.amount, t, p.attack / 3);
          g.gain.setTargetAtTime(1, t + p.attack * 2, p.release / 3);
        },
        tempo() {}, dispose() { g.disconnect(); },
      };
    },
  },
  /* формула над каждым сэмплом: y = f(x, t, a, b) — пишется в поле «y =» */
  math: {
    name: "Formula", icon: "ƒ", color: "#c3a6ff",
    params: {
      expr: { kind: "text", def: "tanh(x * (1 + a * 9))", label: "y =" },
      a: { min: 0, max: 1, def: 0.3, label: "a" },
      b: { min: 0, max: 1, def: 0.5, label: "b" },
      mix: { min: 0, max: 1, def: 1, label: "Mix" },
    },
    create: (ctx, p) => codeFx(ctx, p, q => `return (${q.expr || "x"});`),
  },
  /* свой код: тело функции (x, t, a, b, ch, state, sr) → y; state — объект, живёт между сэмплами */
  code: {
    name: "Code", icon: "{}", color: "#b8f59e",
    params: {
      code: { kind: "text", multiline: true, label: "JS", def: "// x — сэмпл, t — время (с), a/b — ручки 0..1, ch — канал, state — память\nstate.y = (state.y || 0) + (x - (state.y || 0)) * (0.02 + a * 0.5);   // фильтр\nreturn state.y * (1 + b * 3);" },
      a: { min: 0, max: 1, def: 0.2, label: "a" },
      b: { min: 0, max: 1, def: 0.3, label: "b" },
      mix: { min: 0, max: 1, def: 1, label: "Mix" },
    },
    create: (ctx, p) => codeFx(ctx, p, q => q.code || "return x;"),
  },
};

/* ---------- педали с формулой и кодом: AudioWorklet, код пользователя — по сэмплу ----------
 * Код выполняется в AudioWorkletGlobalScope (без DOM и сети), ошибка → звук идёт как есть и событие "dawn-code".
 * Модуль грузится один раз на контекст: loadCodeWorklet(ctx); до загрузки педаль просто пропускает звук. */
const CODE_SRC = `
const PRE = "const {sin,cos,tan,tanh,atan,abs,sign,min,max,pow,sqrt,exp,log,floor,ceil,round,random,PI,E}=Math;" +
  "const clip=(v,l=1)=>v<-l?-l:v>l?l:v; const fold=v=>Math.abs(((v+1)%4+4)%4-2)-1; const crush=(v,s=8)=>Math.round(v*s)/s;";
class NosCode extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: "a", defaultValue: 0 }, { name: "b", defaultValue: 0 }]; }
  constructor() {
    super(); this.fn = null; this.st = {}; this.err = false;
    this.port.onmessage = e => {
      try { this.fn = new Function("x", "t", "a", "b", "ch", "state", "sr", PRE + e.data.code); this.st = {}; this.err = false; this.port.postMessage({ ok: true }); }
      catch (err) { this.fn = null; this.port.postMessage({ error: String(err.message || err) }); }
    };
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0], A = params.a, B = params.b;
    for (let c = 0; c < out.length; c++) {
      const i = inp[c] || inp[0], o = out[c];
      if (!i) { o.fill(0); continue; }
      if (!this.fn) { o.set(i); continue; }
      for (let n = 0; n < o.length; n++) {
        let y;
        try { y = this.fn(i[n], (currentFrame + n) / sampleRate, A.length > 1 ? A[n] : A[0], B.length > 1 ? B[n] : B[0], c, this.st, sampleRate); }
        catch (err) { y = i[n]; if (!this.err) { this.err = true; this.port.postMessage({ error: String(err.message || err) }); } }
        o[n] = y === y && y > -8 && y < 8 ? y : 0;   // NaN и взрывы глушим
      }
    }
    return true;
  }
}
registerProcessor("nos-code", NosCode);`;
export function loadCodeWorklet(ctx) {
  if (!ctx.__nosCodeP) {
    const url = URL.createObjectURL(new Blob([CODE_SRC], { type: "application/javascript" }));
    ctx.__nosCodeP = ctx.audioWorklet ? ctx.audioWorklet.addModule(url).then(() => { ctx.__nosCode = true; }, e => console.warn("code worklet", e)) : Promise.resolve();
  }
  return ctx.__nosCodeP;
}
function codeFx(ctx, p, template) {
  const input = ctx.createGain(), output = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  let node = null, last = null;
  if (ctx.__nosCode) {
    node = new AudioWorkletNode(ctx, "nos-code", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    input.connect(node); node.connect(wet);
    node.port.onmessage = e => { if (e.data.error) dispatchEvent(new CustomEvent("dawn-code", { detail: e.data })); };
  }
  const n = {
    input, output,
    set(q) {
      if (!node) { dry.gain.value = 1; wet.gain.value = 0; return; }
      dry.gain.value = 1 - q.mix; wet.gain.value = q.mix;
      node.parameters.get("a").value = q.a; node.parameters.get("b").value = q.b;
      const src = template(q);
      if (src !== last) { last = src; node.port.postMessage({ code: src }); }
    },
    tempo() {},
    dispose() { input.disconnect(); dry.disconnect(); wet.disconnect(); if (node) { node.disconnect(); node.port.close(); } },
  };
  n.set(p);
  return n;
}

export const fxDefaults = type => Object.fromEntries(Object.entries(FX[type].params).map(([k, s]) => [k, s.def]));
/* числовые параметры эффекта (для крутилок и модуляции; src сайдчейна — выбор канала) */
export const fxNumeric = type => Object.entries(FX[type].params).filter(([, s]) => !s.kind);
