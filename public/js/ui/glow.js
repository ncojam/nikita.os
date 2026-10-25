import { $, el, store } from "../core/util.js";
import { Params } from "../core/params.js";

/* ================= живой фон: светяшки =================
 * Canvas поверх обоев (режим «screen» — на чёрном фоне светится, на картинке подсвечивает).
 * Светяшки плавают; на событие "nos-pulse" ({ color, strength }) вспыхивают — так DAWN подсвечивает
 * фон от бочки и малого (у каналов стойки есть цвет вспышки ✦).
 *
 * Настройки посетителя — в localStorage (Настройки → «Живой фон»), а для модуляции (проводки DAWN)
 * фон выставляет параметры bg.* в общий реестр core/params.js.
 */
const DEF = { on: true, count: 9, hue: 0, speed: 1, glow: 1, size: 1, flash: 1, react: true };
const SPEC = {
  hue: { label: "Фон · оттенок светяшек", min: -180, max: 180 },
  speed: { label: "Фон · скорость", min: 0, max: 4 },
  glow: { label: "Фон · яркость", min: 0, max: 2.5 },
  size: { label: "Фон · размер светяшек", min: 0.3, max: 2.5 },
  flash: { label: "Фон · сила вспышек", min: 0, max: 3 },
  count: { label: "Фон · количество", min: 0, max: 24, step: 1 },
};
const BASE_HUES = [265, 190, 320, 160, 30, 220];

/* Качество подстраивается само. Светяшки размыты, так что маленький холст, растянутый браузером, выглядит почти
 * так же. Дороже всего не сам холст, а стекло окон: пока фон за ним двигается, backdrop-filter пересчитывается
 * каждый кадр — поэтому на нижних ступенях стекло перестаёт размывать (класс fx-lite на <html>).
 * Мерило — интервалы requestAnimationFrame: если браузер не успевает, они растягиваются, чьей бы ни была нагрузка. */
const LEVELS = [
  { scale: 0.5, fps: 60 },
  { scale: 0.33, fps: 30 },
  { scale: 0.25, fps: 24, lite: true },
  { scale: 0.18, fps: 15, lite: true },
];

export const Glow = {
  cfg: { ...DEF, ...store.get("bg.lights", {}) },
  over: {},                // временные значения от модуляции
  orbs: [], flashes: [], cv: null, raf: 0, t: 0,
  level: 0, auto: true, offered: false, perf: { n: 0, sum: 0, best: 1000, t0: 0 },
  get(k) { return this.over[k] ?? this.cfg[k]; },
  set(k, v) { this.cfg[k] = v; store.set("bg.lights", this.cfg); this.sync(); },

  init() {
    this.cv = el("canvas", { className: "bg-lights" });
    $("#wallpaper").after(this.cv);
    addEventListener("resize", () => this.fit());
    addEventListener("nos-pulse", e => this.pulse(e.detail || {}));
    const q = store.get("bg.quality", null);   // { auto, level, offered } — запоминаем ступень для этого устройства
    const coarse = matchMedia("(pointer: coarse)").matches, calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.auto = q?.auto ?? true; this.offered = !!q?.offered;
    this.level = q ? Math.min(LEVELS.length - 1, q.level | 0) : coarse ? 2 : 0;   // телефон — сразу экономно
    if (!q && calm) this.cfg.on = false;                                          // «уменьшить движение» в системе
    this.fit(); this.sync();
  },
  fit() {
    if (!this.cv) return;
    const s = LEVELS[this.level].scale;
    this.cv.width = Math.max(32, Math.round(innerWidth * s)); this.cv.height = Math.max(32, Math.round(innerHeight * s));
    document.documentElement.classList.toggle("fx-lite", !!LEVELS[this.level].lite && this.cfg.on);
  },
  saveQ() { store.set("bg.quality", { auto: this.auto, level: this.level, offered: this.offered }); },
  setLevel(l, save = true) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, l));
    this.perf = { n: 0, sum: 0, best: this.perf.best, t0: 0 };
    this.fit(); if (save) this.saveQ();
  },
  /* замер: средний интервал кадров за ~3 с против лучшего (частота экрана); тормозит — ступень ниже */
  measure(dt, now) {
    if (!this.auto || dt > 250) return;          // вкладка была скрыта — не в счёт
    const p = this.perf;
    p.best = Math.min(p.best, Math.max(4, dt));
    if (!p.t0) p.t0 = now;
    p.n++; p.sum += dt;
    if (now - p.t0 < 3000 || p.n < 30) return;
    const avg = p.sum / p.n, slow = avg > p.best * 1.6 && avg > 22;
    p.n = 0; p.sum = 0; p.t0 = now;
    if (!slow) return;
    if (this.level < LEVELS.length - 1) { this.setLevel(this.level + 1); return; }
    if (!this.offered) this.offer();
  },
  /* совсем не вывозит — предлагаем выключить (один раз) */
  offer() {
    this.offered = true; this.saveQ();
    const box = document.querySelector("#notify") || document.body.appendChild(el("div", { id: "notify" }));
    const n = el("div", { className: "note glass fx-offer" },
      el("div", { textContent: "Живой фон тормозит на этом устройстве. Выключить его? Включить обратно — Настройки → Живой фон." }),
      el("div", { className: "fx-offer-btns" },
        el("button", { className: "btn", textContent: "Выключить", onclick: () => { this.set("on", false); n.remove(); } }),
        el("button", { className: "btn", textContent: "Оставить", onclick: () => n.remove() })));
    box.append(n);
  },
  sync() {
    const on = this.cfg.on;
    this.cv.hidden = !on;
    if (!on) { cancelAnimationFrame(this.raf); this.raf = 0; document.documentElement.classList.remove("fx-lite"); return; }
    this.fit();
    if (!this.raf) {
      let last = performance.now(), prev = last;
      const f = now => {
        this.measure(now - prev, now); prev = now;
        this.raf = requestAnimationFrame(f);
        if (now - last < 1000 / LEVELS[this.level].fps - 2) return;   // меньше кадров на нижних ступенях
        this.frame(Math.min(0.1, (now - last) / 1000)); last = now;
      };
      this.raf = requestAnimationFrame(f);
    }
  },
  orb(i) {
    return { x: Math.random(), y: Math.random(), r: 0.12 + Math.random() * 0.18, hue: BASE_HUES[i % BASE_HUES.length] + Math.random() * 30 - 15,
      vx: (Math.random() - 0.5) * 0.02, vy: (Math.random() - 0.5) * 0.02, ph: Math.random() * 6.28, boost: 0, boostHue: null };
  },
  /* вспышка: ближайшая к случайной точке светяшка разгорается цветом + общий отблеск */
  pulse({ color = "#ff9ecf", strength = 1 }) {
    if (!this.cfg.on || !this.cfg.react) return;
    const k = strength * this.get("flash");
    if (this.orbs.length) {
      const o = this.orbs[Math.floor(Math.random() * this.orbs.length)];
      o.boost = Math.min(2.5, o.boost + k); o.boostColor = color;
    }
    this.flashes.push({ color, a: 0.22 * k, x: Math.random(), y: Math.random() });
    if (this.flashes.length > 8) this.flashes.shift();
  },
  frame(dt) {
    const g = this.cv.getContext("2d"), W = this.cv.width, H = this.cv.height, m = Math.max(W, H);
    const n = Math.round(this.get("count"));
    while (this.orbs.length < n) this.orbs.push(this.orb(this.orbs.length));
    if (this.orbs.length > n) this.orbs.length = n;
    const sp = this.get("speed"), glow = this.get("glow"), size = this.get("size"), hue = this.get("hue");
    this.t += dt * sp;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    for (const o of this.orbs) {
      o.x += o.vx * dt * sp; o.y += o.vy * dt * sp;
      if (o.x < -0.2 || o.x > 1.2) o.vx *= -1;
      if (o.y < -0.2 || o.y > 1.2) o.vy *= -1;
      o.boost *= Math.exp(-dt * 4);
      const breathe = 0.6 + 0.4 * Math.sin(this.t * 0.8 + o.ph);
      const r = o.r * m * size * (1 + o.boost * 0.25);
      const a = Math.min(1, (0.10 * breathe + o.boost * 0.22) * glow);
      const col = o.boost > 0.05 && o.boostColor ? o.boostColor : `hsl(${o.hue + hue} 80% 55%)`;
      const grd = g.createRadialGradient(o.x * W, o.y * H, 0, o.x * W, o.y * H, r);
      grd.addColorStop(0, withAlpha(col, a)); grd.addColorStop(1, withAlpha(col, 0));
      g.fillStyle = grd; g.fillRect(o.x * W - r, o.y * H - r, r * 2, r * 2);
    }
    for (const f of this.flashes) {
      f.a *= Math.exp(-dt * 6);
      if (f.a < 0.004) continue;
      const r = m * 0.7, grd = g.createRadialGradient(f.x * W, f.y * H, 0, f.x * W, f.y * H, r);
      grd.addColorStop(0, withAlpha(f.color, f.a * glow)); grd.addColorStop(1, withAlpha(f.color, 0));
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
    }
    this.flashes = this.flashes.filter(f => f.a >= 0.004);
    g.globalCompositeOperation = "source-over";
  },
};

/* цвет с прозрачностью: #rrggbb или hsl(...) */
function withAlpha(c, a) {
  a = Math.max(0, Math.min(1, a));
  if (c[0] === "#") { const v = parseInt(c.slice(1, 7), 16); return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a})`; }
  return c.replace(")", ` / ${a})`);
}

/* параметры фона — для проводков DAWN */
Params.addProvider({
  prefix: "bg.",
  label: "Фон",
  list: () => Object.entries(SPEC).map(([k, s]) => ({ addr: "bg." + k, label: s.label, group: "Живой фон" })),
  resolve(addr) {
    const k = addr.slice(3), s = SPEC[k];
    if (!s) return null;
    return { label: s.label, spec: { min: s.min, max: s.max, def: DEF[k], step: s.step },
      base: () => Glow.cfg[k], apply: v => { Glow.over[k] = v; }, restore: () => { delete Glow.over[k]; } };
  },
});

export function init_ui_glow() { Glow.init(); }
export { SPEC as GLOW_SPEC, LEVELS as GLOW_LEVELS };
