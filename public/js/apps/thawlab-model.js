/* ================= THAW Lab: модель таймингов и очков =================
 * Чистые функции без DOM — их же можно гонять в node для сверки с timings.csv.
 *
 * Флипы (скрипт fliptrick в reTHAWed):
 *   speed_eff = min(speed × стат флипов, MaxSpeed | 1.3)
 *   ждём 15 кадров (или своё значение трика), у трика с вращением — всю анимацию
 *   Skater_WaitAnim framesfromend = Trickslack → DoNextTrick: тут стартует следующий трик
 *   неотменяемо = max(ожидание, (длина − Trickslack) / speed_eff) [+ вступление]
 * Трики из двух анимаций (Anim2) и грэбы от стата не зависят — берём посчитанное заранее.
 * Все величины — в кадрах 60 Гц. Данные: tricks.json (thaw_site_data.py).
 */
export const FPS = 60;
export const SPEED_CAP = 1.3;

// повторы в одном комбо: доля очков за 1-й, 2-й, 3-й… раз. ПРЕДПОЛОЖЕНИЕ, проверить в игре
export const DEFAULT_REPEAT = [100, 75, 50, 25, 10];

// стат, с которым посчитан tricks.json (meta.stat); задаёт приложение после загрузки
let BASE_STAT = 1.3;
export const setBaseStat = s => { BASE_STAT = s; };

// тайминг трика при данном стате; null — тайминг не определён
export function timing(t, stat, statOnSpecials = true) {
  if (t.ca == null) return null;
  // «?» у флипа: анимация-заглушка короче 15 кадров, трик продолжается чем-то ещё — не знаем чем.
  // У грэба своего 15-кадрового минимума нет, сомнителен только почти нулевой вход
  if (t.m === "fliptrick?" || (t.m === "grabtrick?" && (t.L ?? 0) < 6)) return null;
  const flip = t.c === "flip" && t.m === "fliptrick" && t.L;
  if (!flip) return { cancel: t.ca, total: Math.max(t.tot ?? t.ca, t.ca), intro: t.i || 0, blend: t.bl || 0, fixed: true };
  // постоянные добавки, которых нет в упрощённой формуле (доп. ожидание, своя длительность
  // вращения), — разница между точным расчётом пайплайна и формулой при базовом стате
  const ref = flipRaw(t, BASE_STAT);
  const k = t.sp && !statOnSpecials ? 1 : stat;
  const r = flipRaw(t, k);
  const cancel = r.cancel + (t.ca - ref.cancel);
  return { ...r, cancel, total: Math.max(cancel, r.total + ((t.tot ?? t.ca) - ref.total)) };
}

function flipRaw(t, k) {
  const se = Math.min((t.spd ?? 1) * k, t.mx ?? SPEED_CAP);
  const intro = t.i ? t.i * (t.se ?? se) / se : 0;
  if (t.p2) {
    // фаза с Anim2 от стата не зависит, пересчитываем только вступление
    const base = t.ca - (t.i || 0), tot = (t.tot ?? t.ca) - (t.i || 0);
    return { cancel: base + intro, total: tot + intro, intro, blend: t.bl || 0, se };
  }
  const start = t.rot ? t.L / se : (t.mw ?? 15);
  const cancel = Math.max(start, (t.L - (t.sl ?? 10)) / se) + intro;
  const total = t.L / se + intro;
  return { cancel, total, intro, blend: t.bl || 0, se };
}

export const ptsPerSec = (t, tm) => tm && tm.cancel > 0 ? t.s / (tm.cancel / FPS) : 0;

/* ---------- рейтинг трика: формула посетителя ----------
 * Переменные: s — очки, lock — неотменяемые кадры, tail — хвост, total — вся анимация,
 * pps — очки в секунду, blend — кадры входа, intro — вступление, sp — 1 у спешла.
 * Функции: min, max, pow, sqrt, log, abs, round. Больше ничего — формула не может
 * обратиться ни к странице, ни к сети (проверяем каждое слово до компиляции). */
export const RATING_VARS = ["s", "lock", "tail", "total", "pps", "blend", "intro", "sp"];
const RATING_FUNCS = ["min", "max", "pow", "sqrt", "log", "abs", "round"];
export const RATING_PRESETS = [
  ["Сбалансированный", "pps * pow(20 / max(lock, 20), 0.8)"],
  ["Очки в секунду", "pps"],
  ["Только короткие", "pps * pow(18 / max(lock, 18), 2)"],
  ["Очки за трик", "s"],
];

export function compileRating(src) {
  const code = String(src || "").trim();
  if (!code) throw new Error("пустая формула");
  if (code.length > 300) throw new Error("слишком длинная формула");
  if (!/^[\w\s.+\-*/%(),<>=!?:&|]*$/.test(code)) throw new Error("недопустимый символ");
  for (const id of code.match(/[A-Za-z_]\w*/g) || [])
    if (!RATING_VARS.includes(id) && !RATING_FUNCS.includes(id)) throw new Error(`неизвестное слово «${id}»`);
  const fn = new Function(...RATING_VARS, ...RATING_FUNCS, `"use strict"; return (${code});`);
  const M = RATING_FUNCS.map(f => Math[f]);
  return (t, tm) => {
    if (!tm) return null;
    const v = fn(t.s, tm.cancel, tm.total - tm.cancel, tm.total, ptsPerSec(t, tm), tm.blend, tm.intro || 0, t.sp ? 1 : 0, ...M);
    return Number.isFinite(v) ? v : null;
  };
}

// очки комбо: сумма с учётом повторов × множитель (число триков)
export function comboScore(list, repeat = DEFAULT_REPEAT) {
  const count = new Map();
  let base = 0;
  const parts = list.map(t => {
    const k = (count.get(t.n) || 0);
    count.set(t.n, k + 1);
    const pct = repeat[Math.min(k, repeat.length - 1)];
    const pts = t.s * pct / 100;
    base += pts;
    return { t, pct, pts };
  });
  return { parts, base, mult: list.length, total: base * list.length };
}

// время комбо в кадрах: все трики до точки отмены, последний — целиком (надо докрутить до земли)
export function comboFrames(list, stat, sos) {
  let f = 0;
  list.forEach((t, i) => {
    const tm = timing(t, stat, sos);
    if (tm) f += i === list.length - 1 ? tm.total : tm.cancel;
  });
  return f;
}

/* Жадный подбор сета под бюджет кадров (время в воздухе).
 * На каждом шаге берём трик с наибольшим приростом итоговых очков на кадр.
 * Не оптимум, но хорошо работает и объясним человеку. */
export function autoPick(pool, budget, stat, sos, repeat = DEFAULT_REPEAT, maxLen = 40) {
  const list = [];
  for (let step = 0; step < maxLen; step++) {
    const cur = comboScore(list, repeat).total;
    let best = null, bestGain = 0;
    for (const t of pool) {
      const tm = timing(t, stat, sos);
      if (!tm || tm.cancel <= 0) continue;
      const next = [...list, t];
      if (comboFrames(next, stat, sos) > budget) continue;
      const gain = (comboScore(next, repeat).total - cur) / tm.cancel;
      if (gain > bestGain) { bestGain = gain; best = t; }
    }
    if (!best) break;
    list.push(best);
  }
  return list;
}
