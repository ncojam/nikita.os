import { Juice } from "../core/juice.js";
import { el } from "../core/util.js";
import "../i18n/trip.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { labelExpression, poiLayers } from "./trip-labels.js";

/* ================= поездка: менеджер + карта =================
 * Два окна на одно состояние. Менеджер — карточки по дням и варианты ночлега, карта (MapLibre) — маршрут.
 * День → маршрут дня; карточка → зум на её точку; точка → её карточка, а если карточек несколько —
 * меню с ними; «Весь маршрут» → все дни разными цветами.
 * Пешие отрезки идут по дорогам: геометрию, длину, время и высоты отдаёт сервер (trip.py). Нет ответа —
 * рисуем прямую. Отрезки на транспорте — пунктир без цифр. Между днями — тоже пунктир.
 * Читать могут все. Кнопки правки — только для удобства: право проверяет СЕРВЕР.
 * Закрыли одно окно — второе работает, а нужное окно откроется снова при следующем переходе.
 * Карта: OpenFreeMap, без ключа. Новая карточка появляется через шаблон Juice.spawn.
 */
const DAY_COLORS = ["#8ab4ff", "#ff9ecf", "#8fe8cf", "#ffc59e", "#c3a6ff", "#fff09e", "#9fd3ff"];
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const VENDOR = "/vendor/maplibre/maplibre-gl";
const ZOOM_CARD = 15.5;
const NARROW = "(max-width: 640px)";   // как в style.css: окна на весь экран, видно только верхнее
const PICK_HINT = "Кликни по карте, чтобы поставить точку";

let doc = { days: {}, places: [], cards: [], stays: [], owner: false };
let view = { all: true, date: null };  // что показывает карта
let selected = null;                   // id выбранной карточки или варианта ночлега
let editing = null;                    // {key, node} — открытая форма
let picking = null;                    // (lat, lng) => void — ждём клик по карте
let listWin = null, mapWin = null, listBox = null, addBtn = null, allBtn = null;
let map = null, styleReady = false, fitted = false;
let pins = [];                         // маркеры на карте
let fresh = new Set();                 // id только что созданного: им — анимация появления
let freshDays = new Set();             // то же для дней
const openStays = new Set();           // раскрытые списки ночлега
const legs = new Map();                // «a>b» → путь, null — сервис не ответил, "wait" — запрошен
let legTimer = 0;

const placeOf = id => doc.places.find(p => p.id === id);
const dates = () => [...new Set(doc.cards.map(c => c.date))].sort();
const dayCards = d => doc.cards.filter(c => c.date === d).sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
const colorOf = d => DAY_COLORS[Math.max(0, dates().indexOf(d)) % DAY_COLORS.length];
const dayName = d => new Date(d + "T12:00:00").toLocaleDateString(globalThis.NOS_LOCALE, { weekday: "short", day: "numeric", month: "long" });
const orderedCards = () => dates().flatMap(dayCards);
const dayStays = d => doc.stays.filter(s => s.dates.includes(d));
const shownStays = () => view.all ? doc.stays : dayStays(view.date);
const lngLat = p => [p.lng, p.lat];
const legKey = (a, b) => a.place + ">" + b.place;

async function api(path, body) {
  const r = await fetch(path, { cache: "no-store", ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
async function change(path, body) {
  try {
    const ids = new Set([...doc.cards, ...doc.stays].map(x => x.id)), days = new Set(dates());
    doc = await api(path, body);
    editing = null;
    const made = [...doc.cards, ...doc.stays].filter(x => !ids.has(x.id));
    fresh = new Set(made.map(x => x.id));
    freshDays = new Set(dates().filter(d => !days.has(d)));
    if (made[0]) {
      selected = made[0].id;
      const date = made[0].date || made[0].dates[0];
      if (!view.all) view = { all: false, date };
      if (made[0].dates) openStays.add(date);
    }
    refresh();
    return true;
  } catch (e) { notify("⚠ " + e.message, 3000); return false; }
}

/* ----- окна ----- */
export async function openTrip() {
  try { doc = await api("/api/trip"); } catch (e) { return notify("⚠ Не загрузилось: " + e.message); }
  if (!dates().includes(view.date)) view = { all: true, date: null };
  await ensureMap();
  ensureList();
  refresh();
}

function ensureList() {
  if (listWin) return WM.restore(listWin);
  listWin = WM.open({ title: "Менеджер поездки", icon: "🧳", width: 430, height: 560, key: "trip:list", render(c, w) {
    addBtn = el("button", { className: "trp-btn", textContent: "+ Карточка", onclick: () => cardForm(null) });
    allBtn = el("button", { className: "trp-btn", textContent: "🧭 Весь маршрут", onclick: showAll });
    listBox = el("div", { className: "trp-list" });
    c.append(el("div", { className: "trp" }, el("div", { className: "trp-head" }, el("div", { className: "trp-title", textContent: "Поездка" }), allBtn, addBtn), listBox));
    w.onClose = () => { listWin = listBox = addBtn = allBtn = editing = null; stopPick(); };
  }});
  beside(listWin, "left");
}

const loadScript = src => new Promise((res, rej) => {
  const s = el("script", { src, onload: res, onerror: () => rej(new Error("нет файла карты")) });
  document.head.append(s);
});

async function ensureMap() {
  if (mapWin) return WM.restore(mapWin);
  let style;
  try {
    if (!globalThis.maplibregl) {
      document.head.append(el("link", { rel: "stylesheet", href: VENDOR + ".css" }));
      await loadScript(VENDOR + ".js");
    }
    const r = await fetch(STYLE_URL);
    if (!r.ok) throw new Error("стиль карты: " + r.status);
    style = prepareStyle(await r.json());
  } catch (e) { return notify("⚠ Карта не загрузилась: " + e.message, 4000); }
  mapWin = WM.open({ title: "Карта поездки", icon: "🗺️", width: 760, height: 560, key: "trip:map", render(c, w) {
    const box = el("div", { className: "trp-map no-i18n" });
    c.append(box);
    map = new maplibregl.Map({ container: box, style, center: [135.55, 34.85], zoom: 8, dragRotate: false, pitchWithRotate: false,
      attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.on("load", () => {
      styleReady = true;
      map.addSource("trp-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "trp-solid", type: "line", source: "trp-route", filter: ["==", ["get", "kind"], "walk"],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.95 } });
      map.addLayer({ id: "trp-dashed", type: "line", source: "trp-route", filter: ["!=", ["get", "kind"], "walk"],
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.65, "line-dasharray": [1.5, 2.5] } });
      drawMap();
    });
    map.on("click", e => {
      if (!picking) return;
      const done = picking;
      stopPick();
      done(+e.lngLat.lat.toFixed(6), +e.lngLat.lng.toFixed(6));
    });
    const ro = new ResizeObserver(() => map?.resize());
    ro.observe(box);
    w.onClose = () => { ro.disconnect(); map.remove(); map = mapWin = null; styleReady = fitted = false; pins = []; stopPick(); };
    w.onRestore = () => setTimeout(() => map?.resize(), 400);
  }});
  beside(mapWin, "right");
}

// подписи: русский или латиница + японский; плюс станции, храмы и парки, которых нет в тёмном стиле
function prepareStyle(style) {
  for (const l of style.layers) {
    if (l.type === "symbol" && l.layout?.["text-field"] && l.id !== "highway_name_motorway") l.layout["text-field"] = labelExpression;
  }
  style.layers.push(...poiLayers(labelExpression));
  return style;
}

// два окна рядом; на телефоне они и так во весь экран
function beside(w, side) {
  if (matchMedia(NARROW).matches || w.placed) return;
  w.placed = true;
  const b = WM.area();
  const gap = 10, H = Math.min(620, b.bottom - b.top - 40), top = b.top + 20;
  const lw = 430, mw = Math.min(760, b.right - b.left - lw - gap - 40);
  const left = b.left + Math.max(20, (b.right - b.left - lw - gap - mw) / 2);
  Object.assign(w.node.style, side === "left"
    ? { left: left + "px", top: top + "px", width: lw + "px", height: H + "px" }
    : { left: left + lw + gap + "px", top: top + "px", width: mw + "px", height: H + "px" });
  map?.resize();
}

/* ----- состояние и переходы ----- */
function refresh() {
  if (selected && ![...doc.cards, ...doc.stays].some(x => x.id === selected)) selected = null;
  if (view.date && !dates().includes(view.date)) view = { all: true, date: null };
  renderList();
  drawMap();
  loadLegs();
  fresh = new Set();
  freshDays = new Set();
}

function showAll() {
  view = { all: true, date: null };
  refresh();
  fit();
  raise("map");
}

function showDay(date) {
  view = { all: false, date };
  refresh();
  fit();
  raise("map");
}

async function zoomTo(item, date) {
  selected = item.id;
  if (!view.all && view.date !== date) view = { all: false, date };
  await ensureMap();
  refresh();
  const p = item.place ? placeOf(item.place) : item;
  if (p) map?.flyTo({ center: lngLat(p), zoom: Math.max(ZOOM_CARD, map.getZoom()), duration: 600 });
  raise("map");
}

// переход с карты: показать карточку или вариант ночлега в менеджере
function goTo(item, date) {
  selected = item.id;
  if (!view.all && view.date !== date) view = { all: false, date };
  if (item.dates) openStays.add(date);
  ensureList();
  refresh();
  raise("list");
  const node = listBox?.querySelector(`[data-item="${item.id}"]`);
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 900);
}

function raise(which) {
  if (!matchMedia(NARROW).matches) return;
  const w = which === "map" ? mapWin : listWin;
  if (w) WM.restore(w);
}

/* ----- пути между карточками ----- */
function walkPairs() {
  const out = [];
  for (const d of dates()) {
    const list = dayCards(d);
    list.slice(1).forEach((c, i) => { if (c.leg !== "transit" && c.place !== list[i].place) out.push([list[i], c]); });
  }
  return out;
}

async function loadLegs() {
  for (const [a, b] of walkPairs()) {
    const key = legKey(a, b);
    if (legs.has(key)) continue;
    legs.set(key, "wait");
    try { legs.set(key, await api(`/api/trip/leg/${a.place}/${b.place}`)); }
    catch { legs.set(key, null); }
    clearTimeout(legTimer);
    legTimer = setTimeout(() => { renderList(); drawMap(); }, 150);
  }
}

const legOf = (a, b) => { const l = legs.get(legKey(a, b)); return l && l !== "wait" ? l : null; };
const fmtKm = m => m < 1000 ? m + " м" : (m / 1000).toLocaleString(globalThis.NOS_LOCALE, { maximumFractionDigits: 1 }) + " км";
const fmtMins = n => n < 60 ? n + " мин" : Math.floor(n / 60) + " ч " + (n % 60) + " мин";

// маленький профиль высот: видно, где подъём
function sparkline(prof) {
  if (prof.length < 2) return null;
  const W = 92, H = 22, lo = Math.min(...prof), hi = Math.max(...prof), range = Math.max(hi - lo, 20);
  const pts = prof.map((h, i) => `${(i / (prof.length - 1) * W).toFixed(1)},${(H - 2 - (h - lo) / range * (H - 4)).toFixed(1)}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "trp-spark");
  const path = document.createElementNS(svg.namespaceURI, "polygon");
  path.setAttribute("points", `0,${H} ${pts.join(" ")} ${W},${H}`);
  svg.append(path);
  const title = document.createElementNS(svg.namespaceURI, "title");
  title.textContent = `${lo}–${hi} м над морем`;
  svg.append(title);
  return svg;
}

function legNode(prev, card) {
  if (prev.place === card.place) return null;
  if (card.leg === "transit") return el("div", { className: "trp-leg no-i18n", textContent: "🚆 на транспорте" });
  const key = legKey(prev, card), leg = legOf(prev, card);
  if (!leg) return legs.get(key) === "wait" ? el("div", { className: "trp-leg no-i18n", textContent: "🚶 считаю путь…" }) : null;
  const text = `🚶 ${fmtKm(leg.dist)} · ~${fmtMins(leg.mins)}` + (leg.up === null ? "" : ` · ↑${leg.up} ↓${leg.down} м`);
  const node = el("button", { className: "trp-leg no-i18n", title: "Показать отрезок", textContent: text, onclick: () => fitLine(leg.geo) });
  const spark = sparkline(leg.prof);
  if (spark) node.append(spark);
  return node;
}

function dayTotal(d) {
  const list = dayCards(d);
  let dist = 0, up = 0;
  list.slice(1).forEach((c, i) => { const l = c.leg !== "transit" && legOf(list[i], c); if (l) { dist += l.dist; up += l.up || 0; } });
  return dist ? `🚶 ${fmtKm(dist)}` + (up ? ` ↑${up} м` : "") : "";
}

/* ----- менеджер ----- */
function renderList() {
  if (!listBox) return;
  addBtn.hidden = !doc.owner;
  allBtn.classList.toggle("on", view.all);
  const scroll = listBox.scrollTop, kids = [];
  if (editing?.key === "new") kids.push(editing.node);
  for (const d of dates()) {
    const head = el("button", { className: "trp-day" + (view.date === d ? " on" : ""), title: "Показать маршрут дня", onclick: () => showDay(d) },
      el("b", { textContent: dayName(d) }));
    head.dataset.day = d;
    head.style.setProperty("--day", colorOf(d));
    if (doc.days[d]) head.append(el("span", { className: "no-i18n", textContent: doc.days[d] }));
    if (doc.owner) head.append(el("span", { className: "trp-edit", textContent: "✎", title: "Подпись дня", onclick: e => { e.stopPropagation(); renameDay(d); } }));
    kids.push(head);
    const total = dayTotal(d);
    if (total) kids.push(el("div", { className: "trp-total no-i18n", textContent: total }));
    kids.push(staysNode(d));
    dayCards(d).forEach((c, i, list) => {
      const leg = i && legNode(list[i - 1], c);
      if (leg) kids.push(leg);
      kids.push(editing?.key === c.id ? editing.node : cardNode(c, i + 1));
    });
  }
  if (!kids.length) kids.push(el("div", { className: "trp-empty", textContent: "Пока нет карточек." }));
  listBox.replaceChildren(...kids);
  listBox.scrollTop = scroll;
  const born = [...listBox.querySelectorAll("[data-item], [data-day]")].filter(n => fresh.has(n.dataset.item) || freshDays.has(n.dataset.day));
  born.at(-1)?.scrollIntoView({ block: "nearest" });
  Juice.spawn(born);
}

function actions(items) {
  return el("div", { className: "trp-actions" }, ...items.map(([text, run]) =>
    el("button", { className: "trp-btn", textContent: text, onclick: e => { e.stopPropagation(); run(); } })));
}

function cardNode(c, n) {
  const p = placeOf(c.place), on = selected === c.id;
  const node = el("div", { className: "trp-card" + (on ? " on" : ""), onclick: () => zoomTo(c, c.date) },
    el("div", { className: "trp-num", textContent: n }),
    el("div", { className: "trp-time", textContent: c.time }),
    el("div", { className: "trp-place no-i18n", textContent: p?.name || "?" }));
  node.dataset.item = c.id;
  node.style.setProperty("--day", colorOf(c.date));
  if (c.comment) node.append(el("div", { className: "trp-comment no-i18n", textContent: c.comment }));
  if (doc.owner && on) node.append(actions([["Изменить", () => cardForm(c)], ["Удалить", () => confirm("Удалить карточку?") && change("/api/trip/card/delete", { id: c.id })]]));
  return node;
}

function staysNode(d) {
  const list = dayStays(d), open = openStays.has(d);
  const body = el("div", { className: "trp-stays-body" });
  const box = el("div", { className: "trp-stays" },
    el("button", { className: "trp-stays-head", onclick: () => { open ? openStays.delete(d) : openStays.add(d); renderList(); } },
      el("span", { textContent: `🛏 Ночлег (${list.length})` }), el("i", { textContent: open ? "▾" : "▸" })));
  if (!open) return box;
  for (const s of list) body.append(editing?.key === s.id ? editing.node : stayNode(s, d));
  if (editing?.key === "stay:" + d) body.append(editing.node);
  else if (doc.owner) body.append(el("button", { className: "trp-btn", textContent: "+ Вариант", onclick: () => stayForm(null, d) }));
  box.append(body);
  return box;
}

function stayNode(s, d) {
  const on = selected === s.id;
  const node = el("div", { className: "trp-stay" + (on ? " on" : ""), onclick: () => zoomTo(s, d) },
    el("div", { className: "trp-place no-i18n", textContent: s.name }));
  node.dataset.item = s.id;
  if (s.price) node.append(el("div", { className: "trp-price no-i18n", textContent: s.price }));
  if (s.comment) node.append(el("div", { className: "trp-comment no-i18n", textContent: s.comment }));
  if (s.url) node.append(el("a", { className: "trp-link", href: s.url, target: "_blank", rel: "noopener", textContent: "Открыть страницу ↗", onclick: e => e.stopPropagation() }));
  if (doc.owner && on) node.append(actions([["Изменить", () => stayForm(s, d)], ["Удалить", () => confirm("Удалить вариант?") && change("/api/trip/stay/delete", { id: s.id })]]));
  return node;
}

async function renameDay(d) {
  const title = prompt("Подпись дня", doc.days[d] || "");
  if (title !== null) change("/api/trip/day", { date: d, title });
}

const fmtCoords = p => p ? `${p.lat}, ${p.lng}` : "";
const parseCoords = s => {
  const m = String(s).match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  return m ? [+m[1], +m[2]] : null;
};

function coordsRow(input) {
  return el("div", { className: "trp-row" }, input, el("button", { className: "trp-btn", type: "button", textContent: "📍 На карте", onclick: async () => {
    await ensureMap();
    if (!map) return;
    raise("map");
    startPick((lat, lng) => { input.value = `${lat}, ${lng}`; raise("list"); });
  }}));
}

function formButtons() {
  return el("div", { className: "trp-row" },
    el("button", { className: "trp-btn on", type: "submit", textContent: "Сохранить" }),
    el("button", { className: "trp-btn", type: "button", textContent: "Отмена", onclick: () => { editing = null; stopPick(); renderList(); } }));
}

function cardForm(card) {
  const cur = card && placeOf(card.place);
  const today = view.date || dates().at(-1) || new Date().toISOString().slice(0, 10);
  const date = el("input", { type: "date", value: card?.date || today, required: true });
  const time = el("input", { type: "time", value: card?.time || "10:00", required: true });
  const place = el("input", { type: "text", placeholder: "Место", value: cur?.name || "", maxLength: 120 });
  place.setAttribute("list", "trp-places");
  const options = el("datalist", { id: "trp-places" }, ...doc.places.map(p => el("option", { value: p.name })));
  const coords = el("input", { type: "text", placeholder: "Широта, долгота", value: fmtCoords(cur) });
  const comment = el("textarea", { placeholder: "Комментарий", value: card?.comment || "", maxLength: 2000 });
  const leg = el("select", { className: "trp-select" }, el("option", { value: "walk", textContent: "🚶 Сюда пешком" }), el("option", { value: "transit", textContent: "🚆 Сюда на транспорте" }));
  leg.value = card?.leg || "walk";
  const found = () => doc.places.find(p => p.name.toLowerCase() === place.value.trim().toLowerCase());
  place.addEventListener("input", () => { const p = found(); if (p) coords.value = fmtCoords(p); });
  const save = async () => {
    const p = found() || cur;
    const sent = { name: place.value.trim() };
    // новое имя + новая точка = новое место; новое имя без точки = переименование этого места
    const moved = coords.value.trim() !== fmtCoords(p);
    if (p && (found() || !moved)) sent.id = p.id;
    if (moved) {
      const ll = parseCoords(coords.value);
      if (!ll) return notify("⚠ Координаты: нужно «широта, долгота»");
      [sent.lat, sent.lng] = ll;
    }
    if (await change("/api/trip/card", { id: card?.id, date: date.value, time: time.value, comment: comment.value, leg: leg.value, place: sent })) stopPick();
  };
  const node = el("form", { className: "trp-form", onsubmit: e => { e.preventDefault(); save(); } },
    el("div", { className: "trp-row" }, date, time), place, options, coordsRow(coords), leg, comment,
    el("div", { className: "trp-hint", textContent: "Имя или точка места меняются во всех его карточках." }), formButtons());
  editing = { key: card?.id || "new", node };
  renderList();
  node.scrollIntoView({ block: "nearest" });
}

function stayForm(stay, day) {
  const name = el("input", { type: "text", placeholder: "Название", value: stay?.name || "", maxLength: 120, required: true });
  const coords = el("input", { type: "text", placeholder: "Широта, долгота", value: fmtCoords(stay) });
  const price = el("input", { type: "text", placeholder: "Цена", value: stay?.price || "", maxLength: 80 });
  const url = el("input", { type: "url", placeholder: "https://…", value: stay?.url || "", maxLength: 500 });
  const comment = el("textarea", { placeholder: "Комментарий", value: stay?.comment || "", maxLength: 2000 });
  const checks = dates().map(d => {
    const c = el("input", { type: "checkbox", value: d, checked: stay ? stay.dates.includes(d) : d === day });
    return [c, el("label", { className: "trp-check no-i18n" }, c, dayName(d))];
  });
  const save = async () => {
    const ll = parseCoords(coords.value);
    if (!ll) return notify("⚠ Координаты: нужно «широта, долгота»");
    const days = checks.filter(([c]) => c.checked).map(([c]) => c.value);
    if (await change("/api/trip/stay", { id: stay?.id, name: name.value, lat: ll[0], lng: ll[1], price: price.value, url: url.value, comment: comment.value, dates: days })) stopPick();
  };
  const node = el("form", { className: "trp-form", onsubmit: e => { e.preventDefault(); save(); } },
    name, coordsRow(coords), price, url, comment, el("div", { className: "trp-checks" }, ...checks.map(x => x[1])), formButtons());
  editing = { key: stay?.id || "stay:" + day, node };
  renderList();
  node.scrollIntoView({ block: "nearest" });
}

/* ----- карта ----- */
function startPick(done) {
  picking = done;
  map.getCanvasContainer().classList.add("pick");
  notify(PICK_HINT, 2500);
}
function stopPick() {
  picking = null;
  map?.getCanvasContainer().classList.remove("pick");
}

function routeFeatures() {
  const line = (coordinates, color, kind) => ({ type: "Feature", properties: { color, kind }, geometry: { type: "LineString", coordinates } });
  const out = [];
  const days = view.all ? dates() : [view.date];
  days.forEach((d, n) => {
    const list = dayCards(d), color = colorOf(d);
    list.slice(1).forEach((c, i) => {
      const a = placeOf(list[i].place), b = placeOf(c.place);
      if (!a || !b || a === b) return;
      const leg = c.leg !== "transit" && legOf(list[i], c);
      out.push(line(leg ? leg.geo : [lngLat(a), lngLat(b)], color, c.leg === "transit" ? "transit" : "walk"));
    });
    const next = days[n + 1] && dayCards(days[n + 1])[0], last = placeOf(list.at(-1)?.place), first = next && placeOf(next.place);
    if (last && first && last !== first) out.push(line([lngLat(last), lngLat(first)], "#ffffff", "between"));
  });
  return { type: "FeatureCollection", features: out };
}

function addPin(ll, html, cls, title, color, onClick, born, top) {
  const node = el("div", { className: "trp-pin" + cls, title, textContent: html });
  node.style.setProperty("--day", color);
  if (top) node.style.zIndex = 2;
  node.addEventListener("click", e => {
    e.stopPropagation();
    if (picking) { const done = picking; stopPick(); return done(ll[1], ll[0]); }
    onClick(e);
  });
  pins.push(new maplibregl.Marker({ element: node }).setLngLat(ll).addTo(map));
  if (born) Juice.spawn(node, { sound: false });
}

function drawMap() {
  if (!map || !styleReady) return;
  map.getSource("trp-route").setData(routeFeatures());
  pins.forEach(m => m.remove());
  pins = [];
  const shown = view.all ? orderedCards() : dayCards(view.date);
  // одна точка — один маркер, номера всех её карточек дня через запятую
  const groups = new Map();
  const numbers = new Map(dates().flatMap(d => dayCards(d).map((c, i) => [c.id, i + 1])));
  for (const c of shown) (groups.get(c.place) || groups.set(c.place, []).get(c.place)).push(c);
  const active = doc.cards.find(c => c.id === selected)?.place;
  for (const [pid, cards] of groups) {
    const p = placeOf(pid); if (!p) continue;
    const label = view.all ? cards.length > 1 ? "×" + cards.length : "" : cards.map(c => numbers.get(c.id)).join(",");
    addPin(lngLat(p), label, pid === active ? " on" : "", p.name, colorOf(cards[0].date), e => pointClicked(pid, e), cards.some(c => fresh.has(c.id)), pid === active);
  }
  for (const s of shownStays()) {
    addPin(lngLat(s), "🛏", " stay" + (selected === s.id ? " on" : ""), s.name, "#e8e8f0", () => goTo(s, view.date || s.dates[0]), fresh.has(s.id), selected === s.id);
  }
  if (!fitted && shown.length) { fitted = true; fit(); }
}

function fitLine(line) {
  if (!map) return;
  const b = line.reduce((box, p) => box.extend(p), new maplibregl.LngLatBounds(line[0], line[0]));
  map.fitBounds(b, { padding: 46, maxZoom: 16, duration: 600 });
  raise("map");
}

function fit() {
  if (!map) return;
  const ll = (view.all ? orderedCards() : dayCards(view.date)).map(c => placeOf(c.place)).filter(Boolean).map(lngLat);
  if (ll.length) { map.resize(); fitLine(ll); }
}

// все карточки точки, со всех дней: и тех, что на карте сейчас не показаны
function pointClicked(pid, ev) {
  const cards = orderedCards().filter(c => c.place === pid);
  if (cards.length === 1) return goTo(cards[0], cards[0].date);
  showMenu(ev.clientX, ev.clientY, cards);
}

function showMenu(x, y, cards) {
  document.querySelector(".trp-menu")?.remove();
  const m = el("div", { className: "shr-menu trp-menu glass no-i18n" }, ...cards.map(c =>
    el("button", { onclick: () => { close(); goTo(c, c.date); } },
      `${dayName(c.date)} · ${c.time}`, el("span", { textContent: c.comment || "—" }))));
  document.body.append(m);
  m.style.left = Math.max(6, Math.min(x, innerWidth - m.offsetWidth - 6)) + "px";
  m.style.top = Math.max(6, Math.min(y, innerHeight - m.offsetHeight - 6)) + "px";
  const off = e => { if (!m.contains(e.target)) close(); };
  function close() { m.remove(); document.removeEventListener("pointerdown", off, true); }
  setTimeout(() => document.addEventListener("pointerdown", off, true));
}
