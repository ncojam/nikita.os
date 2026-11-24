/* ================= Сигналы — значения источников модуляции =================
 * Общее для DAWN (project.mods) и шины ОС (core/bus.js, системная стойка). Без UI, без звука, без DAWN.
 *
 * Источник: { id, type, name, color, wires: [{ to: адрес, amt: −1..1 }], …настройки типа }
 *   knob  { value }                 — ручка 0..1
 *   env   { env: { len, loop, pts } } — огибающая во времени (доли)
 *   lfo   { lfo: { sync, shape, phase } } — качание в такт
 *   wind  { wind: { input, strength, gust } } — ветер: качает провода, вход — другой источник
 *   trig  { trig: { ch, att, hold, rel, vel } } — по ноте канала DAWN (только в проекте)
 *   meter { meter: { mix, gain } }  — уровень инсерта микшера DAWN (только в проекте)
 *   mouse { mouse: { axis: "x" | "y" } } — положение курсора на экране
 *   level { level: { gain } }       — громкость плеера ОС
 * rt — «живые» данные: now (сек), notes(ch), meter(i), srcVal(id), mouse(axis), level().
 */
export const SYNC = [["1/16", 0.25], ["1/8", 0.5], ["1/8.", 0.75], ["1/4", 1], ["1/4.", 1.5], ["1/2", 2], ["1 такт", 4]];
export const LFO_SHAPES = ["sine", "triangle", "saw", "square", "random"];
export const LFO_SYNC = [...SYNC, ["2 такта", 8], ["4 такта", 16]];

/* rt — «живые» данные, которых нет в проекте: rt.meter(i) — уровень инсерта, rt.notes(chId) — [{t, v}] начала нот, rt.now — время звука */
export function srcValue(src, beat, rt) {
  if (src.type === "knob") return clamp01(src.value ?? 0.5);
  if (src.type === "meter") return clamp01((rt?.meter?.(src.meter?.mix ?? 1) || 0) * (src.meter?.gain ?? 1));
  if (src.type === "wind") {   // ветер: вход (другой источник или 1) × сила × порывы
    const w = src.wind || {}, inp = w.input ? (rt?.srcVal?.(w.input) ?? 0) : 1, t = (rt?.now ?? 0) * (0.3 + 3 * (w.gust ?? 0.4));
    const gust = 0.55 + 0.25 * Math.sin(t * 1.3) + 0.12 * Math.sin(t * 3.7 + 1) + 0.08 * Math.sin(t * 7.9 + 2);
    return clamp01((w.strength ?? 0.5) * inp * gust);
  }
  if (src.type === "mouse") return clamp01(rt?.mouse?.(src.mouse?.axis || "x") ?? 0.5);   // курсор: 0 — левый/верхний край
  if (src.type === "level") return clamp01((rt?.level?.() || 0) * (src.level?.gain ?? 1.5));     // громкость плеера ОС
  if (src.type === "trig") return trigValue(src.trig || {}, rt?.notes?.(src.trig?.ch) || [], rt?.now ?? 0);
  if (src.type === "env") {
    const e = src.env || {}, pts = (e.pts || []).slice().sort((a, b) => a[0] - b[0]), len = Math.max(0.25, e.len || 16);
    if (!pts.length) return 0;
    const x = e.loop === false ? Math.min(beat, len) : ((beat % len) + len) % len;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      if (x <= x2) return x2 === x1 ? y2 : y1 + (y2 - y1) * (x - x1) / (x2 - x1);
    }
    return pts.at(-1)[1];
  }
  if (src.type === "lfo") {
    const l = src.lfo || {}, per = LFO_SYNC[Math.round(l.sync ?? 3)]?.[1] || 1;
    const ph = beat / per + (l.phase || 0), f = ((ph % 1) + 1) % 1;
    switch (l.shape) {
      case "triangle": return f < 0.5 ? f * 2 : 2 - f * 2;
      case "saw": return f;
      case "square": return f < 0.5 ? 1 : 0;
      case "random": { const k = Math.floor(ph); const x = Math.sin(k * 12.9898 + (src.id?.length || 1) * 78.233) * 43758.5453; return x - Math.floor(x); }
      default: return 0.5 + 0.5 * Math.sin(f * Math.PI * 2);
    }
  }
  return 0;
}
/* огибающая по ноте: атака → удержание → спад (мс); стартует от каждой ноты канала-источника */
export function trigValue(tr, notes, now) {
  let last = null;
  for (const n of notes) if (n.t <= now && (!last || n.t > last.t)) last = n;
  if (!last) return 0;
  const dt = (now - last.t) * 1000, a = Math.max(0, tr.att ?? 5), h = Math.max(0, tr.hold ?? 40), r = Math.max(1, tr.rel ?? 250);
  const k = tr.vel === false ? 1 : last.v ?? 1;
  if (dt < a) return k * dt / a;
  if (dt < a + h) return k;
  return k * Math.max(0, 1 - (dt - a - h) / r) ** 2;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
