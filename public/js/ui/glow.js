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

export const Glow = {
  cfg: { ...DEF, ...store.get("bg.lights", {}) },
  over: {},                // временные значения от модуляции
  orbs: [], flashes: [], cv: null, raf: 0, t: 0,
  get(k) { return this.over[k] ?? this.cfg[k]; },
  set(k, v) { this.cfg[k] = v; store.set("bg.lights", this.cfg); this.sync(); },

  init() {
    this.cv = el("canvas", { className: "bg-lights" });
    $("#wallpaper").after(this.cv);
    addEventListener("resize", () => this.fit());
    addEventListener("nos-pulse", e => this.pulse(e.detail || {}));
    this.fit(); this.sync();
  },
  fit() { if (!this.cv) return; const d = Math.min(devicePixelRatio || 1, 1.5); this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; },
  sync() {
    const on = this.cfg.on;
    this.cv.hidden = !on;
    if (!on) { cancelAnimationFrame(this.raf); this.raf = 0; return; }
    if (!this.raf) { let last = performance.now(); const f = now => { this.frame((now - last) / 1000); last = now; this.raf = requestAnimationFrame(f); }; this.raf = requestAnimationFrame(f); }
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
export { SPEC as GLOW_SPEC };
