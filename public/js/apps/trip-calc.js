/* ================= поездки: расчёты по вариантам пути =================
 * Чистые функции без DOM — их используют trip-routes.js (карточки и сравнение) и trip-todo.js (чек-лист).
 * Время в перегонах — местное, у каждого конца свой пояс (UTC+N): всё считаем через UTC-минуты.
 * Стыковка между перегонами: разрыв < 0 — не стыкуется, < TIGHT — впритык.
 */
export const MODES = {
  train: ["🚆", "Поезд", "#8ab4ff"],
  plane: ["✈️", "Самолёт", "#ff9ecf"],
  bus: ["🚌", "Автобус", "#8fe8cf"],
  car: ["🚗", "Машина", "#ffc59e"],
  ship: ["⛴️", "Паром", "#9fd3ff"],
  other: ["🧭", "Другое", "#c3a6ff"],
};
export const TIGHT = 90;      // минут: короче — пересадка «впритык»
export const KINDS = { ticket: ["🎫", "Билеты"], stay: ["🛏", "Ночлег"], docs: ["📄", "Документы"], other: ["✔️", "Другое"] };
export const ZONES = [[2, "Калининград"], [3, "Москва"], [4, "Самара"], [5, "Екатеринбург, Сургут"], [6, "Омск"], [7, "Новосибирск"], [8, "Иркутск"],
  [9, "Токио"], [10, "Владивосток"], [0, "Лондон"], [1, "Берлин"]];

/** Минуты от эпохи в UTC для местного «2027-05-12T18:30» в поясе UTC+tz. */
export const utcMin = (dt, tz) => Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10), +dt.slice(11, 13), +dt.slice(14, 16)) / 60000 - tz * 60;

export const stepRange = s => [utcMin(s.dep, s.tzd), utcMin(s.arr, s.tza)];
export const validDt = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && !isNaN(Date.parse(s));

/**
 * Итоги варианта: старт и финиш (UTC-минуты), длительность «от двери до двери», сумма, пересадки и разрывы.
 * Перегоны с нечитаемым временем пропускаются: форма может считать на лету, пока поля не заполнены.
 */
export function routeStats(route) {
  const steps = route.steps.filter(s => validDt(s.dep) && validDt(s.arr)).map(s => {
    const [d, a] = stepRange(s);
    return { step: s, d, a, mins: a - d };
  });
  const gaps = steps.slice(1).map((x, i) => {
    const mins = x.d - steps[i].a;
    return { mins, bad: mins < 0, tight: mins >= 0 && mins < TIGHT, from: steps[i], to: x };
  });
  const priced = route.steps.filter(s => s.price !== null && s.price !== undefined && s.price !== "");
  const start = steps[0]?.d ?? 0, end = steps.at(-1)?.a ?? 0;
  return {
    steps, gaps, start, end,
    mins: end - start,
    price: priced.reduce((n, s) => n + +s.price, 0),
    allPriced: priced.length === route.steps.length,
    transfers: Math.max(0, route.steps.length - 1),
    bad: gaps.some(g => g.bad) || steps.some(x => x.mins <= 0),
    tight: gaps.some(g => g.tight),
    wait: gaps.reduce((n, g) => n + Math.max(0, g.mins), 0),
  };
}

export const fmtDur = n => {
  n = Math.round(Math.abs(n));
  const d = Math.floor(n / 1440), h = Math.floor(n % 1440 / 60), m = n % 60;
  return d ? `${d} д` + (h ? ` ${h} ч` : "") : h ? `${h} ч` + (m ? ` ${m} мин` : "") : `${m} мин`;
};
export const fmtMoney = (n, cur = "₽") => Math.round(n).toLocaleString("ru-RU") + " " + cur;
export const fmtDelta = (n, fmt) => n === 0 ? "=" : (n > 0 ? "+" : "−") + fmt(Math.abs(n));

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
/** «пн 12.05 18:30» из местной строки. */
export const fmtLocal = dt => {
  const wd = WD[new Date(Date.UTC(+dt.slice(0, 4), +dt.slice(5, 7) - 1, +dt.slice(8, 10))).getUTCDay()];
  return `${wd} ${dt.slice(8, 10)}.${dt.slice(5, 7)} ${dt.slice(11, 16)}`;
};
/** Подпись UTC-минут в поясе tz: «пн 12.05» или с часами. */
export const fmtAxis = (min, tz, withTime) => {
  const d = new Date((min + tz * 60) * 60000), p = n => String(n).padStart(2, "0");
  return `${WD[d.getUTCDay()]} ${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}` + (withTime ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : "");
};
export const fmtZone = tz => "UTC" + (tz >= 0 ? "+" : "−") + Math.abs(tz);

/** Сравнение вариантов с эталоном: разницы в цене и времени, лучшие по времени и по цене. */
export function compare(routes, baseId) {
  const rows = routes.map(r => ({ route: r, st: routeStats(r) }));
  const base = rows.find(x => x.route.id === baseId) || rows[0] || null;
  const timed = rows.filter(x => x.st.steps.length && !x.st.bad), priced = rows.filter(x => x.st.allPriced && x.st.price > 0);
  const fastest = timed.length ? Math.min(...timed.map(x => x.st.mins)) : null;
  const cheapest = priced.length ? Math.min(...priced.map(x => x.st.price)) : null;
  for (const x of rows) {
    x.isBase = x === base;
    x.dPrice = base && x.st.allPriced && base.st.allPriced ? x.st.price - base.st.price : null;
    x.dMins = base && x.st.steps.length && base.st.steps.length ? x.st.mins - base.st.mins : null;
    x.fastest = fastest !== null && !x.st.bad && x.st.mins === fastest && timed.length > 1;
    x.cheapest = cheapest !== null && x.st.allPriced && x.st.price === cheapest && priced.length > 1;
  }
  return { rows, base };
}

/** Варианты собранной поездки по порядку (path — id вариантов). */
export const pathRoutes = t => (t.path || []).map(id => t.routes.find(r => r.id === id)).filter(Boolean);
/** Все перегоны собранной поездки по порядку: [{route, step}]. */
export const pathSteps = t => pathRoutes(t).flatMap(route => route.steps.map(step => ({ route, step })));
/** Итоги всей поездки — как у одного большого варианта; стыки между вариантами — тоже пересадки. */
export function pathStats(t) {
  const list = pathSteps(t), st = routeStats({ steps: list.map(x => x.step) });
  st.bought = list.filter(x => x.step.bought).length;
  st.count = list.length;
  return st;
}
/** Стык между соседними вариантами поездки: сколько ждать между концом a и началом b. */
export function joinGap(a, b) {
  const x = a.steps.at(-1), y = b.steps[0];
  if (!x || !y || !validDt(x.arr) || !validDt(y.dep)) return null;
  const mins = utcMin(y.dep, y.tzd) - utcMin(x.arr, x.tza);
  return { mins, bad: mins < 0, tight: mins >= 0 && mins < TIGHT };
}

/** Чек-лист: свои пункты + билеты, то есть перегоны собранной поездки. */
export function todoStats(trip) {
  const tickets = pathSteps(trip).map(x => x.step);
  const priced = tickets.filter(s => s.price != null);
  return {
    total: trip.todos.length + tickets.length,
    done: trip.todos.filter(x => x.done).length + tickets.filter(s => s.bought).length,
    price: priced.reduce((n, s) => n + +s.price, 0),
    bought: priced.filter(s => s.bought).reduce((n, s) => n + +s.price, 0),
  };
}
