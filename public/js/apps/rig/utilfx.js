/* ================= Служебные педали ОС (только для звука ОС, не для DAWN) =================
 * Тот же вид, что у эффектов DAWN (dawn/fx.js): { name, icon, color, params, ports, create(ctx, p) }, но
 * у педали может быть несколько входов и выходов: ports = { ins: [...], outs: [...] } ("" — единственный).
 * create(ctx, p) → { ins: { порт: AudioNode }, outs: { порт: AudioNode }, set(p), dispose(), meters? }
 *
 *   meter  📶 Уровень       — пропускает звук как есть и меряет: всё, низ (<150 Гц), середина, верх (>4 кГц).
 *                             Цифры — на педали; как источник для проводков — «Громкость» в «Автоматизации».
 *   split  🔀 Разветвитель  — один вход, четыре выхода, у каждого своя громкость.
 *   blend  ⊕ Смеситель      — два входа (A, B), один выход. Режимы, как наложение в графике, только для звука:
 *            Сумма · Разность (B в противофазе гасит A) · Умножение (кольцевая модуляция A×B) ·
 *            Гашение (громкость B давит A — сайдчейн) · Насыщение (чем громче B, тем сильнее перегружен A) ·
 *            Переключение (быстро щёлкает A ↔ B с заданной частотой — из двух звуков одна волна).
 *   eqf    ƒ Эквалайзер-формула — усиление в дБ как формула от частоты f (Гц): например
 *            -24*(f<120)  ·  6*exp(-(log(f/3000))^2/0.2)  ·  -abs(sin(f/400))*12. Делается КИХ-фильтром.
 */
const BLEND = ["Сумма", "Разность", "Умножение", "Гашение", "Насыщение", "Переключение"];

/* ---------- формула → функция: свой маленький разборщик (без eval) ----------
 * числа, f, PI, E, + − * / ^ (степень, правая), сравнения < > <= >= == != (дают 1/0), скобки,
 * функции: sin cos tan exp log log2 log10 sqrt abs min max pow tanh floor ceil round sign */
const FN = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10, sqrt: Math.sqrt,
  abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, tanh: Math.tanh, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign };
export function compileFormula(src) {
  const s = String(src ?? "0").slice(0, 300);
  const toks = s.match(/\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_]\w*|<=|>=|==|!=|[-+*/^(),<>]|\S/g) || [];
  let i = 0;
  const peek = () => toks[i], eat = t => { if (toks[i] !== t) throw new Error(`ожидалось «${t}»`); i++; };
  const cmp = () => {
    let a = add();
    while (["<", ">", "<=", ">=", "==", "!="].includes(peek())) {
      const op = toks[i++], b = add(), x = a;
      a = { "<": f => +(x(f) < b(f)), ">": f => +(x(f) > b(f)), "<=": f => +(x(f) <= b(f)), ">=": f => +(x(f) >= b(f)), "==": f => +(x(f) === b(f)), "!=": f => +(x(f) !== b(f)) }[op];
    }
    return a;
  };
  const add = () => { let a = mul(); while (peek() === "+" || peek() === "-") { const op = toks[i++], b = mul(), x = a; a = op === "+" ? f => x(f) + b(f) : f => x(f) - b(f); } return a; };
  const mul = () => { let a = un(); while (peek() === "*" || peek() === "/") { const op = toks[i++], b = un(), x = a; a = op === "*" ? f => x(f) * b(f) : f => x(f) / b(f); } return a; };
  const un = () => { if (peek() === "-") { i++; const a = un(); return f => -a(f); } if (peek() === "+") { i++; return un(); } return powr(); };
  const powr = () => { const a = prim(); if (peek() === "^") { i++; const b = un(); return f => Math.pow(a(f), b(f)); } return a; };
  const prim = () => {
    const t = toks[i++];
    if (t === undefined) throw new Error("формула оборвалась");
    if (/^\d|^\./.test(t)) { const v = +t; return () => v; }
    if (t === "(") { const a = cmp(); eat(")"); return a; }
    if (t === "f") return f => f;
    if (t === "PI") return () => Math.PI;
    if (t === "E") return () => Math.E;
    if (FN[t]) {
      eat("(");
      const args = [cmp()];
      while (peek() === ",") { i++; args.push(cmp()); }
      eat(")");
      const fn = FN[t];
      return f => fn(...args.map(a => a(f)));
    }
    throw new Error("непонятное: " + t);
  };
  const root = cmp();
  if (i < toks.length) throw new Error("лишнее в конце: " + toks[i]);
  root(1000);
  return f => { const v = +root(f); return Number.isFinite(v) ? v : 0; };
}

function eqIR(ctx, gainDb, N = 2048) {
  const sr = ctx.sampleRate, H = new Float32Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) H[k] = Math.pow(10, Math.max(-60, Math.min(24, gainDb(Math.max(1, k * sr / N)))) / 20);
  const h = new Float32Array(N);
  for (let n = 0; n < N; n++) {   // нулевая фаза: обратное ДПФ симметричного спектра (косинусы), сдвиг на N/2, окно Ханна
    const m = n - N / 2;
    let s = H[0];
    for (let k = 1; k < N / 2; k++) s += 2 * H[k] * Math.cos(2 * Math.PI * k * m / N);
    s += H[N / 2] * Math.cos(Math.PI * m);
    h[n] = s / N * (0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)));
  }
  const b = ctx.createBuffer(1, N, sr);
  b.copyToChannel(h, 0);
  return b;
}

const curve = (n, f) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = f(i / (n - 1) * 2 - 1); return c; };

export const UTIL = {
  meter: {
    name: "Уровень", icon: "📶", color: "#b8f59e", params: {},
    create(ctx) {
      const io = ctx.createGain(), mk = (type, f, q) => {
        const an = ctx.createAnalyser(); an.fftSize = 1024;
        if (!type) { io.connect(an); return an; }
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q;
        io.connect(fl).connect(an); return an;
      };
      const meters = { all: mk(), low: mk("lowpass", 150, 0.7), mid: mk("bandpass", 1000, 0.7), high: mk("highpass", 4000, 0.7) };
      return { ins: { "": io }, outs: { "": io }, meters, set() {}, dispose() {} };
    },
  },
  split: {
    name: "Разветвитель", icon: "🔀", color: "#ffd36e",
    ports: { ins: [""], outs: ["1", "2", "3", "4"] },
    params: Object.fromEntries(["1", "2", "3", "4"].map(k => ["g" + k, { min: 0, max: 1.5, def: 1, label: "Выход " + k }])),
    create(ctx, p) {
      const inp = ctx.createGain(), outs = {};
      for (const k of ["1", "2", "3", "4"]) { const g = ctx.createGain(); g.gain.value = p["g" + k]; inp.connect(g); outs[k] = g; }
      return { ins: { "": inp }, outs,
        set(q) { for (const k of ["1", "2", "3", "4"]) outs[k].gain.setTargetAtTime(q["g" + k], ctx.currentTime, 0.01); },
        dispose() { inp.disconnect(); } };
    },
  },
  blend: {
    name: "Смеситель", icon: "⊕", color: "#c3a6ff",
    ports: { ins: ["A", "B"], outs: [""] },
    params: {
      mode: { min: 0, max: BLEND.length - 1, def: 0, step: 1, label: "Режим", names: BLEND },
      bal: { min: -1, max: 1, def: 0, label: "A ↔ B" },
      amt: { min: 0, max: 1, def: 0.7, label: "Сила" },
      rate: { min: 0.5, max: 4000, def: 8, label: "Частота", curve: 4 },
      smooth: { min: 0, max: 1, def: 0.2, label: "Плавность" },
    },
    create(ctx, p) {
      const A = ctx.createGain(), B = ctx.createGain(), out = ctx.createGain();
      let parts = [], mode = -1, update = () => {};
      const node = n => (parts.push(n), n);
      const clear = () => { for (const n of parts) { try { n.stop?.(); } catch {} try { n.disconnect(); } catch {} } parts = []; try { A.disconnect(); B.disconnect(); } catch {} };
      const tgt = (prm, v) => prm.setTargetAtTime(v, ctx.currentTime, 0.015);
      const bal = q => [Math.min(1, 1 - q.bal), Math.min(1, 1 + q.bal)];
      const envOf = src => {   // огибающая: |x| → НЧ-фильтр (плавность — частота среза)
        const rect = node(ctx.createWaveShaper()); rect.curve = curve(1025, x => Math.abs(x));
        const lp = node(ctx.createBiquadFilter()); lp.type = "lowpass";
        src.connect(rect).connect(lp);
        return lp;
      };
      /* каждый режим собирает свой граф и возвращает update(q) — подкрутить ручки без пересборки */
      const build = q => {
        clear(); mode = Math.round(q.mode);
        if (mode === 0 || mode === 1) {   // сумма / разность (B в противофазе)
          const x = node(ctx.createGain()), y = node(ctx.createGain());
          A.connect(x).connect(out); B.connect(y).connect(out);
          update = q => { const [ga, gb] = bal(q); tgt(x.gain, ga); tgt(y.gain, mode === 1 ? -gb * q.amt : gb); };
        } else if (mode === 2) {   // умножение (кольцевая модуляция) + немного сухого A
          const vca = node(ctx.createGain()), sc = node(ctx.createGain()), dry = node(ctx.createGain());
          vca.gain.value = 0;
          A.connect(vca).connect(out); B.connect(sc).connect(vca.gain); A.connect(dry).connect(out);
          update = q => { tgt(sc.gain, 2 * q.amt); tgt(dry.gain, 1 - q.amt); };
        } else if (mode === 3 || mode === 4) {   // гашение / насыщение A огибающей B
          const vca = node(ctx.createGain()), k = node(ctx.createGain()), env = envOf(B);
          vca.gain.value = 1;
          env.connect(k).connect(vca.gain);
          if (mode === 3) A.connect(vca).connect(out);
          else { const sh = node(ctx.createWaveShaper()); sh.curve = curve(2049, x => Math.tanh(x * 3) / Math.tanh(3)); sh.oversample = "2x"; A.connect(vca).connect(sh).connect(out); }
          update = q => { tgt(k.gain, mode === 3 ? -2 * q.amt : 6 * q.amt); tgt(env.frequency, 60 * Math.pow(0.05, q.smooth)); };
        } else {   // переключение A ↔ B меандром заданной частоты
          const osc = node(ctx.createOscillator()); osc.type = "square";
          const lp = node(ctx.createBiquadFilter()); lp.type = "lowpass";
          const ca = node(ctx.createGain()), cb = node(ctx.createGain());
          const va = node(ctx.createGain()), vb = node(ctx.createGain()); va.gain.value = 0; vb.gain.value = 0;
          osc.connect(lp); lp.connect(ca).connect(va.gain); lp.connect(cb).connect(vb.gain);
          A.connect(va).connect(out); B.connect(vb).connect(out);
          osc.start();
          update = q => {
            const [ga, gb] = bal(q);
            tgt(osc.frequency, q.rate);
            tgt(lp.frequency, Math.max(q.rate * 2, 20000 * Math.pow(0.002, q.smooth)));
            // меандр −1..1 → 0..1 для A и 1..0 для B: база 0.5 ± половина
            tgt(va.gain, 0.5 * ga); tgt(ca.gain, 0.5 * ga); tgt(vb.gain, 0.5 * gb); tgt(cb.gain, -0.5 * gb);
          };
        }
        update(q);
      };
      build(p);
      return { ins: { A, B }, outs: { "": out },
        set(q) { if (Math.round(q.mode) !== mode) build(q); else update(q); },
        dispose() { clear(); } };
    },
  },
  eqf: {
    name: "Эквалайзер-формула", icon: "ƒ", color: "#9fd3ff",
    params: {
      expr: { kind: "text", def: "6*exp(-(log(f/3000))^2/0.2) - 18*(f<80)", label: "Усиление, дБ (f — частота, Гц)" },
      mix: { min: 0, max: 1, def: 1, label: "Mix" },
    },
    create(ctx, p) {
      const inp = ctx.createGain(), out = ctx.createGain(), conv = ctx.createConvolver(), wet = ctx.createGain(), dry = ctx.createGain();
      conv.normalize = false;
      const delay = ctx.createDelay(1); delay.delayTime.value = 1024 / ctx.sampleRate;   // сухой — с той же задержкой, что у фильтра
      inp.connect(conv).connect(wet).connect(out); inp.connect(delay).connect(dry).connect(out);
      let last = null;
      const set = q => {
        if (q.expr !== last) {
          last = q.expr;
          try { conv.buffer = eqIR(ctx, compileFormula(q.expr)); }
          catch (e) { import("../../ui/notify.js").then(m => m.notify("ƒ " + e.message)); }
        }
        wet.gain.setTargetAtTime(q.mix, ctx.currentTime, 0.02); dry.gain.setTargetAtTime(1 - q.mix, ctx.currentTime, 0.02);
      };
      set(p);
      return { ins: { "": inp }, outs: { "": out }, set, dispose() { inp.disconnect(); } };
    },
  },
};
