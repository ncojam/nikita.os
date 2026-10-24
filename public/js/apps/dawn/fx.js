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
};

export const fxDefaults = type => Object.fromEntries(Object.entries(FX[type].params).map(([k, s]) => [k, s.def]));
