import { el } from "../core/util.js";
import "../i18n/trip.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= поездка: менеджер + карта =================
 * Два окна на одно состояние. Менеджер — карточки по дням, карта (Leaflet) — маршрут.
 * День → маршрут дня; карточка → зум на её точку; точка → её карточка, а если карточек несколько —
 * меню с ними; «Весь маршрут» → все дни разными цветами. Линии прямые: между точками, не по улицам.
 * Читать могут все. Кнопки правки — только для удобства: право проверяет СЕРВЕР (trip.py).
 * Закрыли одно окно — второе работает, а нужное окно откроется снова при следующем переходе.
 * Тайлы: страница живёт под COEP, поэтому чужие картинки — только с crossOrigin (CORS).
 */
const DAY_COLORS = ["#8ab4ff", "#ff9ecf", "#8fe8cf", "#ffc59e", "#c3a6ff", "#fff09e", "#9fd3ff"];
const TILES = [
  ["https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'],
  ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'],
];
const ZOOM_CARD = 16;
const NARROW = "(max-width: 640px)";   // как в style.css: окна на весь экран, видно только верхнее

let doc = { days: {}, places: [], cards: [], owner: false };
let view = { all: true, date: null };  // что показывает карта
let selected = null;                   // id выбранной карточки
let editing = null;                    // {card, node} — открытая форма
let picking = null;                    // (lat, lng) => void — ждём клик по карте
let listWin = null, mapWin = null, listBox = null, addBtn = null, allBtn = null;
let L = null, map = null, layer = null, tiles = null, fitted = false;
const pins = new Map();                // id места → маркер

const placeOf = id => doc.places.find(p => p.id === id);
const dates = () => [...new Set(doc.cards.map(c => c.date))].sort();
const dayCards = d => doc.cards.filter(c => c.date === d).sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
const colorOf = d => DAY_COLORS[dates().indexOf(d) % DAY_COLORS.length];
const dayName = d => new Date(d + "T12:00:00").toLocaleDateString(globalThis.NOS_LOCALE, { weekday: "short", day: "numeric", month: "long" });
const orderedCards = () => dates().flatMap(dayCards);

async function api(path, body) {
  const r = await fetch(path, { cache: "no-store", ...(body && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
async function change(path, body) {
  try { doc = await api(path, body); editing = null; refresh(); return true; }
  catch (e) { notify("⚠ " + e.message, 3000); return false; }
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
    addBtn = el("button", { className: "trp-btn", textContent: "+ Карточка", onclick: () => openForm(null) });
    allBtn = el("button", { className: "trp-btn", textContent: "🧭 Весь маршрут", onclick: showAll });
    listBox = el("div", { className: "trp-list" });
    c.append(el("div", { className: "trp" }, el("div", { className: "trp-head" }, el("div", { className: "trp-title", textContent: "Поездка" }), allBtn, addBtn), listBox));
    w.onClose = () => { listWin = listBox = addBtn = allBtn = editing = null; picking = null; map?.getContainer().classList.remove("pick"); };
  }});
  beside(listWin, "left");
}

async function ensureMap() {
  if (mapWin) return WM.restore(mapWin);
  try {
    L ||= await import("/vendor/leaflet/leaflet-src.esm.js");
    if (!document.querySelector('link[href="/vendor/leaflet/leaflet.css"]')) {
      await new Promise(res => {
        const l = el("link", { rel: "stylesheet", href: "/vendor/leaflet/leaflet.css" });
        l.onload = l.onerror = res;
        document.head.append(l);
      });
    }
  } catch (e) { return notify("⚠ Не загрузилось: " + e.message); }
  mapWin = WM.open({ title: "Карта поездки", icon: "🗺️", width: 760, height: 560, key: "trip:map", render(c, w) {
    const box = el("div", { className: "trp-map no-i18n" });
    c.append(box);
    map = L.map(box, { zoomControl: true, attributionControl: true }).setView([34.85, 135.55], 9);
    map.attributionControl.setPrefix(false);
    setTiles(0);
    layer = L.layerGroup().addTo(map);
    map.on("click", e => {
      if (!picking) return;
      const done = picking; stopPick();
      done(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    });
    const ro = new ResizeObserver(() => map?.invalidateSize());
    ro.observe(box);
    w.onClose = () => { ro.disconnect(); map.remove(); map = layer = tiles = mapWin = null; fitted = false; pins.clear(); stopPick(); };
    w.onRestore = () => setTimeout(() => map?.invalidateSize(), 400);
  }});
  beside(mapWin, "right");
  map.invalidateSize();
}

// основной источник тайлов не отвечает или не даёт CORS — переходим на запасной
function setTiles(i) {
  tiles?.remove();
  let fails = 0;
  tiles = L.tileLayer(TILES[i][0], { maxZoom: 19, crossOrigin: "anonymous", attribution: TILES[i][1], subdomains: "abcd" }).addTo(map);
  if (i + 1 < TILES.length) tiles.on("tileerror", () => { if (++fails === 8) setTiles(i + 1); });
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
  map?.invalidateSize();
}

/* ----- состояние и переходы ----- */
function refresh() {
  if (selected && !doc.cards.some(c => c.id === selected)) selected = null;
  if (view.date && !dates().includes(view.date)) view = { all: true, date: null };
  renderList();
  drawMap();
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

async function zoomToCard(card) {
  selected = card.id;
  if (!view.all && view.date !== card.date) view = { all: false, date: card.date };
  await ensureMap();
  refresh();
  const p = placeOf(card.place);
  if (p) map.flyTo([p.lat, p.lng], Math.max(ZOOM_CARD, map.getZoom()), { duration: 0.6 });
  raise("map");
}

// переход с карты: показать карточку в менеджере
function goToCard(card) {
  selected = card.id;
  if (!view.all && view.date !== card.date) view = { all: false, date: card.date };
  ensureList();
  refresh();
  raise("list");
  const node = listBox?.querySelector(`[data-card="${card.id}"]`);
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

/* ----- менеджер ----- */
function renderList() {
  if (!listBox) return;
  addBtn.hidden = !doc.owner;
  allBtn.classList.toggle("on", view.all);
  const scroll = listBox.scrollTop, kids = [];
  if (editing && !editing.card?.id) kids.push(editing.node);
  for (const d of dates()) {
    const head = el("button", { className: "trp-day" + (view.date === d ? " on" : ""), title: "Показать маршрут дня", onclick: () => showDay(d) },
      el("b", { textContent: dayName(d) }));
    head.style.setProperty("--day", colorOf(d));
    if (doc.days[d]) head.append(el("span", { className: "no-i18n", textContent: doc.days[d] }));
    if (doc.owner) head.append(el("span", { className: "trp-edit", textContent: "✎", title: "Подпись дня", onclick: e => { e.stopPropagation(); renameDay(d); } }));
    kids.push(head);
    dayCards(d).forEach((c, i) => kids.push(editing?.card?.id === c.id ? editing.node : cardNode(c, i + 1)));
  }
  if (!kids.length) kids.push(el("div", { className: "trp-empty", textContent: "Пока нет карточек." }));
  listBox.replaceChildren(...kids);
  listBox.scrollTop = scroll;
}

function cardNode(c, n) {
  const p = placeOf(c.place), on = selected === c.id;
  const node = el("div", { className: "trp-card" + (on ? " on" : ""), onclick: () => zoomToCard(c) },
    el("div", { className: "trp-num", textContent: n }),
    el("div", { className: "trp-time", textContent: c.time }),
    el("div", { className: "trp-place no-i18n", textContent: p?.name || "?" }));
  node.dataset.card = c.id;
  node.style.setProperty("--day", colorOf(c.date));
  if (c.comment) node.append(el("div", { className: "trp-comment no-i18n", textContent: c.comment }));
  if (doc.owner && on) {
    const act = (text, run) => el("button", { className: "trp-btn", textContent: text, onclick: e => { e.stopPropagation(); run(); } });
    node.append(el("div", { className: "trp-actions" }, act("Изменить", () => openForm(c)), act("Удалить", () => removeCard(c))));
  }
  return node;
}

async function renameDay(d) {
  const title = prompt("Подпись дня", doc.days[d] || "");
  if (title !== null) change("/api/trip/day", { date: d, title });
}

function removeCard(c) {
  if (confirm("Удалить карточку?")) change("/api/trip/card/delete", { id: c.id });
}

const fmtCoords = p => p ? `${p.lat}, ${p.lng}` : "";
const parseCoords = s => {
  const m = String(s).match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
  return m ? [+m[1], +m[2]] : null;
};

function openForm(card) {
  const cur = card && placeOf(card.place);
  const today = view.date || dates().at(-1) || new Date().toISOString().slice(0, 10);
  const date = el("input", { type: "date", value: card?.date || today, required: true });
  const time = el("input", { type: "time", value: card?.time || "10:00", required: true });
  const listId = "trp-places";
  const place = el("input", { type: "text", placeholder: "Место", value: cur?.name || "", maxLength: 120 });
  place.setAttribute("list", listId);
  const options = el("datalist", { id: listId }, ...doc.places.map(p => el("option", { value: p.name })));
  const coords = el("input", { type: "text", placeholder: "Широта, долгота", value: fmtCoords(cur), inputMode: "text" });
  const comment = el("textarea", { placeholder: "Комментарий", value: card?.comment || "", maxLength: 2000 });
  const found = () => doc.places.find(p => p.name.toLowerCase() === place.value.trim().toLowerCase());
  place.addEventListener("input", () => { const p = found(); if (p) coords.value = fmtCoords(p); });
  const pick = el("button", { className: "trp-btn", type: "button", textContent: "📍 На карте", onclick: async () => {
    await ensureMap();
    raise("map");
    startPick((lat, lng) => { coords.value = `${lat}, ${lng}`; raise("list"); });
  }});
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
    if (await change("/api/trip/card", { id: card?.id, date: date.value, time: time.value, comment: comment.value, place: sent })) stopPick();
  };
  const node = el("form", { className: "trp-form", onsubmit: e => { e.preventDefault(); save(); } },
    el("div", { className: "trp-row" }, date, time), place, options,
    el("div", { className: "trp-row" }, coords, pick), comment,
    el("div", { className: "trp-hint", textContent: "Имя или точка места меняются во всех его карточках." }),
    el("div", { className: "trp-row" },
      el("button", { className: "trp-btn on", type: "submit", textContent: "Сохранить" }),
      el("button", { className: "trp-btn", type: "button", textContent: "Отмена", onclick: () => { editing = null; stopPick(); renderList(); } })));
  editing = { card, node };
  renderList();
  node.scrollIntoView({ block: "nearest" });
}

/* ----- карта ----- */
function startPick(done) {
  picking = done;
  map.getContainer().classList.add("pick");
  notify("Кликни по карте, чтобы поставить точку", 2500);
}
function stopPick() {
  picking = null;
  map?.getContainer().classList.remove("pick");
}

function drawMap() {
  if (!map) return;
  layer.clearLayers();
  pins.clear();
  const shown = view.all ? orderedCards() : dayCards(view.date);
  if (view.all) {
    const all = shown.map(c => placeOf(c.place)).filter(Boolean).map(p => [p.lat, p.lng]);
    if (all.length > 1) L.polyline(all, { color: "#fff", weight: 1.5, opacity: 0.35, dashArray: "4 7", interactive: false }).addTo(layer);
  }
  for (const d of view.all ? dates() : [view.date]) {
    const line = dayCards(d).map(c => placeOf(c.place)).filter(Boolean).map(p => [p.lat, p.lng]);
    if (line.length > 1) L.polyline(line, { color: colorOf(d), weight: 3.5, opacity: 0.9, interactive: false }).addTo(layer);
  }
  // одна точка — один маркер, номера всех её карточек дня через запятую
  const groups = new Map();
  const numbers = new Map(dates().flatMap(d => dayCards(d).map((c, i) => [c.id, i + 1])));
  for (const c of shown) (groups.get(c.place) || groups.set(c.place, []).get(c.place)).push(c);
  const active = doc.cards.find(c => c.id === selected)?.place;
  for (const [pid, cards] of groups) {
    const p = placeOf(pid); if (!p) continue;
    const label = view.all ? cards.length > 1 ? "×" + cards.length : "" : cards.map(c => numbers.get(c.id)).join(",");
    const icon = L.divIcon({ className: "", iconSize: null,
      html: `<div class="trp-pin${pid === active ? " on" : ""}" style="--day:${colorOf(cards[0].date)};transform:translate(-50%,-50%)">${label}</div>` });
    const m = L.marker([p.lat, p.lng], { icon, title: p.name, zIndexOffset: pid === active ? 1000 : 0 }).addTo(layer);
    m.on("click", e => { if (picking) return map.fire("click", { latlng: e.latlng }); pointClicked(pid, e.originalEvent); });
    pins.set(pid, m);
  }
  if (!fitted && shown.length) { fitted = true; fit(); }
}

function fit() {
  if (!map) return;
  const ll = (view.all ? orderedCards() : dayCards(view.date)).map(c => placeOf(c.place)).filter(Boolean).map(p => [p.lat, p.lng]);
  if (!ll.length) return;
  map.invalidateSize();
  map.flyToBounds(L.latLngBounds(ll), { padding: [46, 46], maxZoom: 16, duration: 0.6 });
}

// все карточки точки, со всех дней: и тех, что на карте сейчас не показаны
function pointClicked(pid, ev) {
  const cards = orderedCards().filter(c => c.place === pid);
  if (cards.length === 1) return goToCard(cards[0]);
  showMenu(ev.clientX, ev.clientY, cards);
}

function showMenu(x, y, cards) {
  document.querySelector(".trp-menu")?.remove();
  const m = el("div", { className: "shr-menu trp-menu glass no-i18n" }, ...cards.map(c =>
    el("button", { onclick: () => { close(); goToCard(c); } },
      `${dayName(c.date)} · ${c.time}`, el("span", { textContent: c.comment || "—" }))));
  document.body.append(m);
  m.style.left = Math.max(6, Math.min(x, innerWidth - m.offsetWidth - 6)) + "px";
  m.style.top = Math.max(6, Math.min(y, innerHeight - m.offsetHeight - 6)) + "px";
  const off = e => { if (!m.contains(e.target)) close(); };
  function close() { m.remove(); document.removeEventListener("pointerdown", off, true); }
  setTimeout(() => document.addEventListener("pointerdown", off, true));
}
