import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { WALL_CAPS, WALL_COLORS, WALL_COLOR_NAMES } from "./data.js";
import { clack, hiss } from "./sfx.js";

/* ================= NETWORK — общая стена граффити =================
 * Три холста друг над другом (их сводит браузер, мы ничего не смешиваем покадрово):
 *   base   — бетон: цвет, пятна, швы между плитами;
 *   paint  — краска (все штрихи);
 *   relief — рельеф стены поверх краски: блики на бугорках, тени в ямках. Поэтому шероховатости видно и сквозь краску.
 * Рельеф и бетон — из сида, у всех одинаковые. В ямки краска ложится хуже: по рамке штриха вычитаем маску ямок.
 *
 * Штрих = цвет, кэп, сид, точки [x, y, dt…] (dt — мс от предыдущей точки). Краска кладётся «пшиками» по времени,
 * а не по расстоянию, как у настоящего баллона: ведёшь быстро — тонко, держишь на месте — густо и потечёт.
 * Подтёки считаются из самого штриха (сид + порядок пшиков), поэтому у всех получаются одинаковые.
 * Одинаковый код рисует штрих вживую (StrokeRenderer.push по мере движения) и при загрузке стены.
 * Сервер хранит последние ~1600 штрихов (network.py) — старые «закрашиваются».
 */
const W = 1600, H = 900;
const DAB_MS = 10;            // пшик каждые 10 мс времени нажатия
const SAMPLE_MS = 28;         // держим кнопку на месте — всё равно пишем точку раз в 28 мс
const MAX_PTS = 250, MAX_DUR = 8500;
const CELL = 6;               // клетка «мокроты» для подтёков
const WALL_SEED = 1337;

/* ---------- детерминированный случай ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/* ---------- бетон: шум и рельеф ---------- */
function valueNoise(r, cell, w, h) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), i = iy * gw + ix;
    const a = g[i] + (g[i + 1] - g[i]) * sx, b = g[i + gw] + (g[i + gw + 1] - g[i + gw]) * sx;
    return a + (b - a) * sy;
  };
}

function buildWall() {
  const r = rng(WALL_SEED);
  const n1 = valueNoise(r, 260, W, H), n2 = valueNoise(r, 70, W, H), n3 = valueNoise(r, 18, W, H), n4 = valueNoise(r, 5, W, H);
  const hgt = new Float32Array(W * H);
  // швы плит: горизонтальные через 300, вертикальные со сдвигом через ряд
  const seam = (x, y) => {
    const row = Math.floor(y / 300), dy = Math.min(y % 300, 300 - y % 300);
    const off = row % 2 ? 260 : 0, dx = Math.min((x + off) % 520, 520 - (x + off) % 520);
    const d = Math.min(dy, dx);
    return d < 3 ? (3 - d) / 3 : 0;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    hgt[y * W + x] = n2(x, y) * 0.35 + n3(x, y) * 0.3 + n4(x, y) * 0.22 + r() * 0.13 - seam(x, y) * 0.9;
  }
  // ямки-раковины бетона
  const pits = new Uint8ClampedArray(W * H);
  for (let k = 0; k < 2600; k++) {
    const cx = r() * W, cy = r() * H, rad = 0.8 + r() ** 3 * 4.5;
    for (let y = Math.max(0, cy - rad | 0); y < Math.min(H, cy + rad + 1); y++)
      for (let x = Math.max(0, cx - rad | 0); x < Math.min(W, cx + rad + 1); x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d < 1) { hgt[y * W + x] -= (1 - d) * 0.6; pits[y * W + x] = Math.max(pits[y * W + x], (1 - d) * 255); }
      }
  }
  const base = new ImageData(W, H), rel = new ImageData(W, H), pitMask = new ImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    const tone = 72 + n1(x, y) * 34 + n2(x, y) * 10;      // пятна и разводы
    base.data[o] = tone + 4; base.data[o + 1] = tone + 1; base.data[o + 2] = tone - 3; base.data[o + 3] = 255;
    const a = hgt[Math.max(0, i - W - 1)], b = hgt[Math.min(W * H - 1, i + W + 1)];
    let s = (a - b) * 2.4;                                 // свет слева сверху
    s += (hgt[i] - 0.45) * 0.35;
    if (s > 0) { rel.data[o] = rel.data[o + 1] = rel.data[o + 2] = 255; rel.data[o + 3] = Math.min(150, s * 230); }
    else { rel.data[o + 3] = Math.min(210, -s * 300); }
    pitMask.data[o + 3] = pits[i];
  }
  return { base, rel, pitMask };
}

/* ---------- пшики: заготовки-штампы ---------- */
const VARIANTS = 6;
const stampCache = new Map();
function stamps(k) {
  if (stampCache.has(k)) return stampCache.get(k);
  const { r: rad } = WALL_CAPS[k], size = Math.ceil(rad * 2.8) * 2 + 4, c = size / 2, out = [];
  const R = rng(4242 + k);
  for (let v = 0; v < VARIANTS; v++) {
    const cv = el("canvas"); cv.width = cv.height = size;
    const g = cv.getContext("2d");
    const grad = g.createRadialGradient(c, c, 0, c, c, rad * 1.1);    // мягкое ядро струи
    grad.addColorStop(0, "rgba(255,255,255,0.32)"); grad.addColorStop(0.6, "rgba(255,255,255,0.12)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    const n = Math.round(14 + rad * rad * 0.75);                       // капельки: гаусс вокруг центра + редкий «перепыл»
    for (let i = 0; i < n; i++) {
      const far = R() < 0.12, sd = rad * (far ? 0.95 : 0.45);
      const x = c + gauss(R) * sd, y = c + gauss(R) * sd, s = 0.35 + R() * (far ? 0.6 : 1.05);
      g.fillStyle = `rgba(255,255,255,${(far ? 0.25 : 0.45) + R() * 0.5})`;
      g.beginPath(); g.arc(x, y, s, 0, 6.283); g.fill();
    }
    out.push(cv);
  }
  stampCache.set(k, out);
  return out;
}
const tinted = new Map();
function stamp(c, k, v) {
  const key = c * 100 + k * 10 + v;
  if (!tinted.has(key)) {
    const src = stamps(k)[v], cv = el("canvas");
    cv.width = src.width; cv.height = src.height;
    const g = cv.getContext("2d");
    g.drawImage(src, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = WALL_COLORS[c]; g.fillRect(0, 0, cv.width, cv.height);
    tinted.set(key, cv);
  }
  return tinted.get(key);
}

/* ---------- штрих ---------- */
class StrokeRenderer {
  constructor(g, { c, k, s }, live = false) {
    this.g = g; this.c = c; this.k = k; this.cap = WALL_CAPS[k]; this.r = rng(s);
    this.live = live; this.prev = null; this.acc = 0; this.wet = new Map(); this.drips = [];
    this.box = [Infinity, Infinity, -Infinity, -Infinity];
  }
  push(x, y, dt) {
    if (!this.prev) { this.prev = [x, y]; this.dab(x, y, 1); return; }
    const [px, py] = this.prev;
    // пшики по времени (сколько краски вылетело) и по расстоянию (чтобы быстрый штрих не рвался в точки):
    // краски за отрезок — столько, сколько успело вылететь, она размазывается по всем пшикам отрезка
    this.acc += dt;
    const nT = Math.floor(this.acc / DAB_MS);
    this.acc -= nT * DAB_MS;
    const n = Math.max(nT, Math.ceil(Math.hypot(x - px, y - py) / (this.cap.r * 0.5)));
    const fade = n ? Math.max(0.22, Math.min(1, nT / n)) : 1;
    for (let i = 1; i <= n; i++) this.dab(px + (x - px) * i / n, py + (y - py) * i / n, fade);
    this.prev = [x, y];
  }
  dab(x, y, fade) {
    const R = this.r, s = stamp(this.c, this.k, Math.floor(R() * VARIANTS)), h = s.width / 2;
    const jx = gauss(R) * this.cap.r * 0.06, jy = gauss(R) * this.cap.r * 0.06;
    this.g.globalAlpha = this.cap.flow * fade * (0.75 + R() * 0.5);
    this.g.drawImage(s, x - h + jx, y - h + jy);
    const b = this.box, e = h;
    b[0] = Math.min(b[0], x - e); b[1] = Math.min(b[1], y - e); b[2] = Math.max(b[2], x + e); b[3] = Math.max(b[3], y + e);
    // мокрота: долго в одной клетке — потечёт (у тонкого кэпа течь труднее)
    const key = (Math.floor(y / CELL) << 12) | Math.floor(x / CELL);
    const w = (this.wet.get(key) || 0) + this.cap.flow * fade;
    this.wet.set(key, w);
    if (w > [6, 4.2, 3.4][this.k] && w < 1e3) {
      this.wet.set(key, 1e9);
      const len = (18 + R() * 70) * (0.6 + this.k * 0.35), wd = 0.9 + this.cap.r * 0.09 + R() * 0.8;
      this.drip(x + gauss(R) * this.cap.r * 0.25, y + this.cap.r * 0.3, len, wd, R() * 2 - 1);
    }
  }
  drip(x, y, len, wd, wob) {
    const g = this.g, col = WALL_COLORS[this.c];
    const draw = (from, to) => {
      g.globalAlpha = 0.92; g.strokeStyle = col; g.lineCap = "round"; g.lineWidth = wd;
      g.beginPath(); g.moveTo(x + Math.sin(from / 23) * wob, y + from); g.lineTo(x + Math.sin(to / 23) * wob, y + to); g.stroke();
    };
    const bulb = () => { g.globalAlpha = 0.95; g.fillStyle = col; g.beginPath(); g.ellipse(x + Math.sin(len / 23) * wob, y + len, wd * 0.85, wd * 1.15, 0, 0, 6.283); g.fill(); };
    const b = this.box; b[2] = Math.max(b[2], x + wd + 3); b[3] = Math.max(b[3], y + len + wd * 2);
    if (!this.live) { draw(0, len); bulb(); return; }
    // вживую подтёк ползёт вниз ~1.5 с
    const t0 = performance.now(), dur = 600 + len * 12;
    let at = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur), to = len * (1 - (1 - k) ** 2);
      if (to > at) { draw(at, to); at = to; }
      if (k < 1) requestAnimationFrame(step); else bulb();
    };
    requestAnimationFrame(step);
  }
}

function eatPits(g, pitMask, box) {
  // краска хуже ложится в ямки: стираем немного по маске ямок в рамке штриха
  const x = Math.max(0, Math.floor(box[0])), y = Math.max(0, Math.floor(box[1]));
  const w = Math.min(W, Math.ceil(box[2])) - x, h = Math.min(H, Math.ceil(box[3])) - y;
  if (w <= 0 || h <= 0) return;
  g.save(); g.globalAlpha = 0.55; g.globalCompositeOperation = "destination-out";
  g.drawImage(pitMask, x, y, w, h, x, y, w, h); g.restore();
}

function replay(g, s, pitMask) {
  const R = new StrokeRenderer(g, s, false), p = s.p;
  for (let i = 0; i < p.length; i += 3) R.push(p[i], p[i + 1], i ? p[i + 2] : 0);
  return R.box;
}

/* ---------- окно стены ---------- */
let wallCache = null;   // бетон считается один раз за сессию (~0.2 с)

export function mountWall(host, { getMe, askLogin, deny }) {
  let color = 2, cap = 1, last = 0, alive = true, poll = 0;
  const mine = new Set();
  const mk = cls => { const c = el("canvas", { className: "nw-wall-cv " + cls }); c.width = W; c.height = H; return c; };
  const base = mk("base"), paint = mk("paint"), relief = mk("relief");
  const g = paint.getContext("2d");
  const ring = el("div", { className: "nw-wall-ring" });
  const status = el("div", { className: "nw-wall-status", textContent: "Штукатурим стену…" });
  const stage = el("div", { className: "nw-wall-stage" }, base, paint, relief, ring, status);

  const swatches = WALL_COLORS.map((c, i) => el("button", { className: "nw-can" + (i === color ? " on" : ""), title: WALL_COLOR_NAMES[i],
    style: `--c:${c}`, onclick: () => { color = i; swatches.forEach((b, j) => b.classList.toggle("on", j === i)); clack(); paintRing(); } }));
  const caps = WALL_CAPS.map((c, i) => el("button", { className: "nw-cap" + (i === cap ? " on" : ""), title: c.ru,
    onclick: () => { cap = i; caps.forEach((b, j) => b.classList.toggle("on", j === i)); clack(); paintRing(); } },
    el("i", { style: `--s:${6 + i * 7}px` }), el("span", { textContent: c.name })));
  host.append(el("div", { className: "nw-wall" },
    el("div", { className: "nw-wall-tools" }, el("div", { className: "nw-cans" }, ...swatches), el("div", { className: "nw-caps" }, ...caps)),
    stage,
    el("p", { className: "nw-hint", textContent: "Зажми и веди — краска ложится по времени: быстро — тонко, задержишься — потечёт. Стена общая: видят все. Старые слои со временем закрашиваются." })));

  const paintRing = () => {
    const k = stage.clientWidth / W || 1;
    ring.style.setProperty("--d", Math.max(6, WALL_CAPS[cap].r * 2.2 * k) + "px");
    ring.style.setProperty("--c", WALL_COLORS[color]);
  };
  new ResizeObserver(paintRing).observe(stage);

  // бетон, потом краска со всех штрихов кусками (не замораживаем окно)
  (async () => {
    await new Promise(r => setTimeout(r, 30));
    wallCache ||= buildWall();
    if (!alive) return;
    base.getContext("2d").putImageData(wallCache.base, 0, 0);
    relief.getContext("2d").putImageData(wallCache.rel, 0, 0);
    wallCache.pitCv ||= (() => { const c = el("canvas"); c.width = W; c.height = H; c.getContext("2d").putImageData(wallCache.pitMask, 0, 0); return c; })();
    status.textContent = "Краска сохнет…";
    let d;
    try { d = await (await fetch("/api/net/wall", { cache: "no-store" })).json(); }
    catch { status.textContent = "Стена не загрузилась"; return; }
    const list = d.strokes || [];
    let i = 0;
    while (alive && i < list.length) {
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 14) replay(g, list[i++]);
      status.textContent = `Краска сохнет… ${Math.round(i / list.length * 100)}%`;
      await new Promise(r => requestAnimationFrame(r));
    }
    if (!alive) return;
    eatPits(g, wallCache.pitCv, [0, 0, W, H]);
    last = d.last || 0;
    status.remove();
    stage.classList.add("ready");
    poll = setInterval(pull, 3500);
  })();

  async function pull() {
    if (!alive || document.hidden || !stage.isConnected) return;
    try {
      const d = await (await fetch("/api/net/wall?since=" + last, { cache: "no-store" })).json();
      for (const s of d.strokes || []) if (!mine.has(s.id)) eatPits(g, wallCache.pitCv, replay(g, s));
      last = Math.max(last, d.last || 0);
    } catch {}
  }

  /* ---------- рисуем ---------- */
  let cur = null, sampler = 0, sound = null;
  const toWorld = e => { const r = paint.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * W / r.width), Math.round((e.clientY - r.top) * H / r.height)]; };
  const begin = async e => {
    if (!stage.classList.contains("ready")) return;
    if (!getMe()) { if (await askLogin("Чтобы рисовать на стене, нужен аккаунт")) notify("Теперь можно бомбить ✌"); return; }
    paint.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);
    startStroke(x, y);
    sound = hiss(); sound.level(0.9);
    sampler = setInterval(() => cur && add(cur.lx, cur.ly), SAMPLE_MS);
  };
  const startStroke = (x, y) => {
    const s = { c: color, k: cap, s: Math.floor(Math.random() * 2 ** 31), p: [x, y, 0] };
    cur = { s, R: new StrokeRenderer(g, s, true), t: performance.now(), dur: 0, lx: x, ly: y };
    cur.R.push(x, y, 0);
  };
  const add = (x, y) => {
    const now = performance.now(), dt = Math.min(1000, Math.round(now - cur.t));
    if (dt < 4) return;
    cur.t = now; cur.dur += dt; cur.lx = x; cur.ly = y;
    cur.s.p.push(x, y, dt); cur.R.push(x, y, dt);
    if (cur.s.p.length / 3 >= MAX_PTS || cur.dur >= MAX_DUR) { finish(); startStroke(x, y); }   // длинный штрих — режем на куски
  };
  const finish = () => {
    if (!cur) return;
    const done = cur; cur = null;
    eatPits(g, wallCache.pitCv, done.R.box);
    send(done.s);
  };
  const end = () => {
    if (!cur) return;
    clearInterval(sampler); sound?.stop(); sound = null;
    finish();
  };
  paint.addEventListener("pointerdown", begin);
  paint.addEventListener("pointermove", e => {
    const r = stage.getBoundingClientRect();
    ring.style.translate = `${e.clientX - r.left}px ${e.clientY - r.top}px`;
    if (!cur) return;
    for (const ev of e.getCoalescedEvents?.() || [e]) { const [x, y] = toWorld(ev); add(x, y); }
  });
  paint.addEventListener("pointerup", end);
  paint.addEventListener("pointercancel", end);
  paint.addEventListener("pointerenter", () => ring.classList.add("on"));
  paint.addEventListener("pointerleave", () => ring.classList.remove("on"));

  async function send(s) {
    try {
      const r = await fetch("/api/net/wall", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Ошибка " + r.status);
      mine.add(d.id);
    } catch (e) { deny("Штрих не сохранился: " + e.message); }
  }

  return { destroy() { alive = false; clearInterval(poll); clearInterval(sampler); sound?.stop(); } };
}
