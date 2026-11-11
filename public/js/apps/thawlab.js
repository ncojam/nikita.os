import { el, store } from "../core/util.js";
import "../i18n/thawlab.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import {
  DEFAULT_REPEAT, FPS, RATING_PRESETS, autoPick, comboFrames, comboScore, compileRating, ptsPerSec, setBaseStat, timing,
} from "./thawlab-model.js";

/* ================= THAW Lab: тайминги триков reTHAWed =================
 * Три окна на одно состояние:
 *   • главное — таблица (полоска времени у каждого трика, свой рейтинг-формула), сравнение, гайд;
 *   • «Анимация» — открывается кликом по трику рядом с главным; ↑/↓ листают трики в порядке таблицы.
 *     Пока это макет: манекен появится, когда расшифруем ключевые кадры .ska;
 *   • «Сет» — арсенал по вкладкам (флипы / грэбы / спешлы) + сборщик комбо и отчёт .md.
 *     Трик перетаскивается строкой из таблицы в окно сета (или кнопкой ＋).
 * Данные — /apps/thawlab/tricks.json: только числа (очки, кадры), без файлов игры.
 * Модель и пересчёт под стат — thawlab-model.js. Состояние посетителя — store("thawlab.*").
 */
const DATA_URL = "/apps/thawlab/tricks.json";
const CAT = { flip: "Флип", grab: "Грэб", manual: "Мэнюал", other: "Другое" };
const BAR_MAX = 120;   // шкала полосок в таблице, кадров (длиннее — обрезаем со стрелкой)
const DRAG_TYPE = "application/x-thawlab-trick";

// трики, которые ценны не очками, а тем, что дают в комбо
const UTILITY = {
  "Hot Rod": "Спешл-мэнюал, разгоняет скейтера — восстанавливает скорость посреди комбо",
  "Jango Jump Jet": "Спешл-грэб, подбрасывает вверх на ранце — больше воздуха, больше триков",
};

const TABS = [["tricks", "📋 Трики"], ["compare", "📊 Сравнение"], ["guide", "📖 Гайд"]];
const SET_TABS = [["flip", "🛹 Флипы"], ["grab", "✋ Грэбы"], ["special", "★ Спешлы"], ["combo", "🧮 Комбо"]];

let data = null;
const S = {
  tab: "tricks", stat: 1.3, sos: true,
  q: "", cat: "all", specials: true, timedOnly: true,
  sort: "rating", dir: -1,
  formula: RATING_PRESETS[0][1], showFormula: false,
  compare: [], combo: [], arsenal: { flip: [], grab: [], special: [] },
  repeat: DEFAULT_REPEAT.slice(), budget: 2.5, autoSpecials: false, autoGrabs: true, fromArsenal: true,
  similarOf: null, tol: 3,
  setTab: "flip", current: null,
};
let rating = compileRating(S.formula);
let order = [];   // id триков в текущем порядке таблицы — для ↑/↓

const load = (k, d) => store.get("thawlab." + k, d);
const save = (k, v) => store.set("thawlab." + k, v);

const byId = id => data.tricks.find(t => t.id === id);
const fr = x => x == null ? "—" : (Math.round(x * 10) / 10).toLocaleString(globalThis.NOS_LOCALE);
const sec = f => (f / FPS).toLocaleString(globalThis.NOS_LOCALE, { maximumFractionDigits: 2 }) + " с";
const int = x => x == null ? "—" : Math.round(x).toLocaleString(globalThis.NOS_LOCALE);
const tm = t => timing(t, S.stat, S.sos);
const label = t => t.n + (t.v ? ` (${t.v})` : "");
const slotOf = t => t.sp ? "special" : t.c === "flip" ? "flip" : t.c === "grab" ? "grab" : null;
const SLOT_NAME = { flip: "Флипы", grab: "Грэбы", special: "Спешлы" };

let mainWin = null, body = null, tabBtns = {};
let setWin = null, setBody = null;
let animWin = null, animRender = null;

async function ensureData() {
  if (data) return;
  const r = await fetch(DATA_URL, { cache: "no-cache" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  data = await r.json();
  setBaseStat(data.meta.stat);
  const ar = load("arsenal", null) || {};
  Object.assign(S, {
    tab: TABS.some(([k]) => k === load("tab")) ? load("tab") : "tricks",
    stat: load("stat", data.meta.stat), sos: load("sos", true),
    compare: load("compare", []).filter(byId),
    combo: (load("combo", null) ?? load("set", [])).filter(byId),
    arsenal: { flip: (ar.flip || []).filter(byId), grab: (ar.grab || []).filter(byId), special: (ar.special || []).filter(byId) },
    repeat: load("repeat", DEFAULT_REPEAT.slice()), formula: load("formula", S.formula),
    setTab: load("setTab", "flip"),
  });
  try { rating = compileRating(S.formula); } catch { S.formula = RATING_PRESETS[0][1]; rating = compileRating(S.formula); }
}

// одно изменение — перерисовать всё открытое
function refresh() {
  if (body?.isConnected) renderTab();
  if (setBody?.isConnected) renderSet();
  animRender?.();
}

// поставить окно рядом с главным (справа, если влезает, иначе слева)
// места мало — главное окно уезжает к левому краю, боковое встаёт к правому (может чуть перекрыть)
function placeBeside(w) {
  if (!mainWin?.node.isConnected || mainWin.maximized || matchMedia("(max-width: 640px)").matches) return;
  const n = { width: w.node.offsetWidth, height: w.node.offsetHeight };   // без учёта анимации появления
  let m = mainWin.node.getBoundingClientRect();
  if (m.right + 8 + n.width > innerWidth - 8 && m.left > 8) {
    mainWin.node.style.left = "8px";
    m = mainWin.node.getBoundingClientRect();
  }
  const left = Math.min(m.right + 8, innerWidth - n.width - 8);
  // второе боковое окно — чуть ниже первого, чтобы заголовки не слиплись
  const other = [animWin, setWin].find(o => o && o !== w && o.node.isConnected);
  const top = m.top + (other ? 44 : 0);
  w.node.style.left = Math.max(8, left) + "px";
  w.node.style.top = Math.max(8, Math.min(top, innerHeight - n.height - 70)) + "px";
}

/* ================= главное окно ================= */
export async function openThawLab() {
  mainWin = WM.open({ title: "THAW Lab", icon: "🛹", width: 1060, height: 680, key: "thawlab",
    async render(c, w) {
      c.classList.add("tl");
      c.append(el("div", { className: "tl-loading", textContent: "Загружаю данные триков…" }));
      try { await ensureData(); } catch (e) {
        c.replaceChildren(el("div", { className: "tl-loading", textContent: "⚠ Не удалось загрузить данные: " + e.message }));
        return;
      }
      build(c);
      w.onKey = e => { if (S.tab === "tricks") stepKey(e); };
    } });
}

function build(c) {
  const statVal = el("span", { className: "tl-statval" });
  const slider = el("input", { type: "range", min: 1, max: 1.3, step: 0.01, value: S.stat });
  const showStat = () => { statVal.textContent = "×" + Number(S.stat).toFixed(2); };
  slider.oninput = () => { S.stat = +slider.value; showStat(); save("stat", S.stat); refresh(); };
  showStat();
  const sos = el("input", { type: "checkbox", checked: S.sos });
  sos.onchange = () => { S.sos = sos.checked; save("sos", S.sos); refresh(); };

  tabBtns = {};
  const tabs = el("div", { className: "tl-tabs" }, ...TABS.map(([k, name]) => {
    const b = el("button", { className: "tl-tab", textContent: name });
    b.onclick = () => { S.tab = k; save("tab", k); renderTab(); };
    tabBtns[k] = b;
    return b;
  }));
  const setBtn = el("button", { className: "tl-btn primary", textContent: "🧩 Сет", title: "Арсенал и сборщик комбо — в отдельном окне" });
  setBtn.onclick = () => openSet();
  const head = el("div", { className: "tl-head" }, tabs,
    el("label", { className: "tl-stat", title: "Множитель скорости флипов от стата скейтера. Полные статы — 1,3 (упирается в потолок скорости)" },
      el("span", { textContent: "Стат флипов" }), slider, statVal),
    el("label", { className: "tl-check", title: "Влияет ли стат на скорость спешл-флипов. По скрипту — да, но замер The 900 (TH4) говорит, что нет" },
      sos, el("span", { textContent: "и на спешлы" })),
    setBtn);
  body = el("div", { className: "tl-body" });
  c.replaceChildren(head, body);
  renderTab();
}

function renderTab() {
  for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle("on", k === S.tab);
  const f = { tricks: renderTricks, compare: renderCompare, guide: renderGuide }[S.tab] || renderTricks;
  const keep = S.tab === "tricks" ? body.querySelector(".tl-tablewrap")?.scrollTop : 0;
  body.classList.toggle("fixed", S.tab === "tricks");   // у таблицы своя прокрутка, шапка стоит
  body.replaceChildren(f());
  const tw = body.querySelector(".tl-tablewrap");
  if (tw && keep) tw.scrollTop = keep;
}

/* ---------- 📋 таблица ---------- */
const COLS = [
  ["name", "Трик", t => label(t)],
  ["cat", "Тип", t => CAT[t.c]],
  ["s", "Очки", t => t.s],
  ["total", "Время", (t, m) => m?.total],
  ["cancel", "Неотм.", (t, m) => m?.cancel],
  ["tail", "Хвост", (t, m) => m ? m.total - m.cancel : null],
  ["pps", "Очки/с", (t, m) => m ? ptsPerSec(t, m) : null],
  ["rating", "Рейтинг", (t, m) => rating(t, m)],
];

function renderTricks() {
  const wrap = el("div", { className: "tl-pane fill" });
  const search = el("input", { type: "text", className: "tl-input", placeholder: "Поиск по названию…", value: S.q });
  const cat = el("select", { className: "tl-input" },
    ...[["all", "Все типы"], ["flip", "Флипы"], ["grab", "Грэбы"], ["manual", "Мэнюалы"], ["other", "Другое"]]
      .map(([v, n]) => el("option", { value: v, textContent: n, selected: S.cat === v })));
  const sp = el("input", { type: "checkbox", checked: S.specials });
  const timed = el("input", { type: "checkbox", checked: S.timedOnly });
  const fBtn = el("button", { className: "tl-btn" + (S.showFormula ? " on" : ""), textContent: "⚙ Рейтинг" });
  const table = el("div", { className: "tl-tablewrap" });
  const count = el("span", { className: "tl-muted" });

  const draw = () => {
    let rows = data.tricks.map(t => ({ t, m: tm(t) }));
    const q = S.q.trim().toLowerCase();
    rows = rows.filter(({ t, m }) =>
      (!q || label(t).toLowerCase().includes(q)) && (S.cat === "all" || t.c === S.cat) &&
      (S.specials || !t.sp) && (!S.timedOnly || m));
    const col = COLS.find(c => c[0] === S.sort) || COLS[7];
    rows.sort((a, b) => {
      const x = col[2](a.t, a.m), y = col[2](b.t, b.m);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * S.dir;
    });
    order = rows.map(r => r.t.id);
    count.textContent = rows.length + " шт.";
    const th = COLS.map(([k, name]) => {
      const h = el("th", { textContent: name + (S.sort === k ? (S.dir > 0 ? " ▲" : " ▼") : ""), className: k === "total" ? "bar" : "" });
      h.onclick = () => { if (S.sort === k) S.dir *= -1; else { S.sort = k; S.dir = k === "name" || k === "cat" ? 1 : -1; } draw(); };
      return h;
    });
    const tbody = el("tbody", {}, ...rows.map(({ t, m }) => trickRow(t, m)));
    table.replaceChildren(el("table", { className: "tl-table" }, el("thead", {}, el("tr", {}, ...th, el("th", {}))), tbody));
  };
  search.oninput = () => { S.q = search.value; draw(); };
  cat.onchange = () => { S.cat = cat.value; draw(); };
  sp.onchange = () => { S.specials = sp.checked; draw(); };
  timed.onchange = () => { S.timedOnly = timed.checked; draw(); };
  fBtn.onclick = () => { S.showFormula = !S.showFormula; renderTab(); };

  wrap.append(el("div", { className: "tl-bar" }, search, cat,
    el("label", { className: "tl-check" }, sp, el("span", { textContent: "спешлы" })),
    el("label", { className: "tl-check" }, timed, el("span", { textContent: "только с таймингом" })), count, fBtn));
  if (S.showFormula) wrap.append(formulaPanel(draw));
  wrap.append(el("div", { className: "tl-hint", textContent: "Полоска — вся анимация на общей шкале (120 кадров = 2 с): синее нельзя прервать, штриховка — хвост, который отменяет следующий трик. Клик по трику — окно анимации (↑/↓ листают), строку можно перетащить в окно «Сет»." }),
    table);
  draw();
  return wrap;
}

function formulaPanel(redraw) {
  const input = el("input", { type: "text", className: "tl-input mono", value: S.formula, spellcheck: false });
  const err = el("span", { className: "tl-err" });
  const apply = src => {
    try { rating = compileRating(src); S.formula = src; save("formula", src); err.textContent = ""; input.value = src; redraw(); }
    catch (e) { err.textContent = "⚠ " + e.message; }
  };
  input.onchange = () => apply(input.value);
  const presets = RATING_PRESETS.map(([name, f]) => {
    const b = el("button", { className: "tl-btn small" + (f === S.formula ? " on" : ""), textContent: name, title: f });
    b.onclick = () => { apply(f); for (const x of b.parentNode.children) x.classList.toggle("on", x === b); };
    return b;
  });
  return el("div", { className: "tl-formula" },
    el("div", { className: "tl-bar" }, el("b", { textContent: "Рейтинг =" }), input, err),
    el("div", { className: "tl-bar" }, el("span", { className: "tl-muted", textContent: "Готовые:" }), ...presets),
    el("div", { className: "tl-hint", textContent:
      "Переменные: s — очки, lock — неотменяемые кадры, tail — хвост, total — вся анимация, pps — очки/с, blend — вход, intro — вступление, sp — 1 у спешла. " +
      "Функции: min, max, pow, sqrt, log, abs, round. «Сбалансированный» = очки/с, но трик дольше 20 кадров штрафуется: длинная неотменяемая часть — это риск не успеть приземлиться и меньше свободы в маршруте." }));
}

function trickRow(t, m) {
  const name = el("td", { className: "tl-name" }, el("span", { textContent: t.n }));
  if (t.v) name.append(el("span", { className: "tl-var", textContent: t.v }));
  if (t.sp) name.append(el("span", { className: "tl-tag sp", textContent: "спешл", title: "Нужна полная шкала спешла" }));
  if (UTILITY[t.n]) name.append(el("span", { className: "tl-tag ut", textContent: "🔧 польза", title: UTILITY[t.n] }));
  const notes = [];
  if (t.hold) notes.push("держится, пока зажата кнопка");
  if (t.p2) notes.push("две анимации подряд");
  if (t.c === "grab") notes.push("минимум при мгновенном отпускании; удержание даёт очки");
  if (notes.length) name.title = notes.join("; ");

  const inCmp = S.compare.includes(t.id), slot = slotOf(t), inAr = slot && S.arsenal[slot].includes(t.id);
  const cmp = el("button", { className: "tl-mini" + (inCmp ? " on" : ""), textContent: "⇄", title: "В сравнение" });
  cmp.onclick = e => { e.stopPropagation(); toggle(S.compare, t.id); save("compare", S.compare); renderTab(); };
  const add = el("button", { className: "tl-mini" + (inAr ? " on" : ""), textContent: inAr ? "✓" : "＋",
    title: slot ? (inAr ? "Убрать из сета" : `В сет: ${SLOT_NAME[slot]}`) : "Этот тип в сет пока не входит" });
  add.disabled = !slot || !m;
  add.onclick = e => { e.stopPropagation(); if (inAr) dropFromArsenal(t.id); else addToArsenal(t); };

  const r = el("tr", { className: (m ? "" : "tl-dim") + (S.current === t.id ? " cur" : ""), draggable: !!slot && !!m },
    name, el("td", { textContent: CAT[t.c] }), el("td", { className: "num", textContent: int(t.s) }),
    el("td", { className: "bar" }, miniBar(m)),
    el("td", { className: "num", textContent: fr(m?.cancel) }),
    el("td", { className: "num", textContent: m ? fr(m.total - m.cancel) : "—" }),
    el("td", { className: "num", textContent: m ? int(ptsPerSec(t, m)) : "—" }),
    el("td", { className: "num strong", textContent: m ? fmtRating(rating(t, m)) : "—" }),
    el("td", { className: "tl-acts" }, cmp, add));
  r.dataset.id = t.id;
  r.onclick = () => openAnim(t.id);
  r.ondragstart = e => { e.dataTransfer.setData(DRAG_TYPE, t.id); e.dataTransfer.setData("text/plain", label(t)); e.dataTransfer.effectAllowed = "copy"; };
  return r;
}
const fmtRating = v => v == null ? "—" : Math.abs(v) >= 100 ? int(v) : fr(v);

function miniBar(m) {
  const b = el("div", { className: "tl-mbar" });
  if (!m) return b;
  const pc = f => Math.min(f, BAR_MAX) / BAR_MAX * 100 + "%";
  if (m.intro) b.append(el("i", { className: "intro", style: `left:0;width:${pc(m.intro)}` }));
  b.append(el("i", { className: "lock", style: `left:${pc(m.intro || 0)};width:calc(${pc(m.cancel)} - ${pc(m.intro || 0)})` }));
  b.append(el("i", { className: "tail", style: `left:${pc(m.cancel)};width:calc(${pc(m.total)} - ${pc(m.cancel)})` }));
  if (m.total > BAR_MAX) b.append(el("span", { className: "over", textContent: "▸" }));
  b.title = `Всего ${fr(m.total)} кадр: неотменяемо ${fr(m.cancel)}, хвост ${fr(m.total - m.cancel)}`;
  return b;
}

const toggle = (arr, id) => { const i = arr.indexOf(id); if (i < 0) arr.push(id); else arr.splice(i, 1); };

// ↑/↓ — соседний трик в порядке таблицы
function stepKey(e) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  step(e.key === "ArrowUp" ? -1 : 1);
}
function step(d) {
  if (!order.length) return;
  const i = order.indexOf(S.current);
  const j = i < 0 ? 0 : Math.max(0, Math.min(order.length - 1, i + d));
  openAnim(order[j]);
}

/* ---------- 📊 сравнение ---------- */
function timeline(items) {
  const max = Math.max(30, ...items.map(({ m }) => m ? m.total + m.blend : 0));
  const scale = el("div", { className: "tl-scale" });
  for (let f = 0; f <= max; f += max > 120 ? 30 : 10)
    scale.append(el("span", { textContent: f, style: `left:${f / max * 100}%` }));
  const rows = items.map(({ t, m, extra }) => {
    const track = el("div", { className: "tl-track" });
    if (m) {
      const seg = (from, len, cls, tip) => track.append(el("div", { className: "tl-seg " + cls, title: tip,
        style: `left:${from / max * 100}%;width:${Math.max(len, 0) / max * 100}%` }));
      if (m.intro) seg(0, m.intro, "intro", `Вступление: ${fr(m.intro)} кадр`);
      seg(m.intro || 0, m.cancel - (m.intro || 0), "lock", `Неотменяемо: ${fr(m.cancel)} кадр`);
      seg(m.cancel, m.total - m.cancel, "tail", `Хвост: ${fr(m.total - m.cancel)} кадр`);
      track.append(el("div", { className: "tl-blend", style: `left:${(m.cancel + m.blend) / max * 100}%`,
        title: `Так глаз увидит переход в следующий трик (+${fr(m.blend)} кадр смешивания)` }));
    }
    return el("div", { className: "tl-tlrow" },
      el("div", { className: "tl-tlname", title: label(t) }, el("b", { textContent: label(t) }),
        el("span", { className: "tl-muted", textContent: m ? ` ${int(t.s)} очк · ${fr(m.cancel)} кадр · ${int(ptsPerSec(t, m))} оч/с` : " тайминг не определён" })),
      track, extra || el("span"));
  });
  return el("div", { className: "tl-timeline" }, el("div", { className: "tl-tlrow head" }, el("span"), scale, el("span")), ...rows);
}

function renderCompare() {
  const wrap = el("div", { className: "tl-pane" });
  const legend = el("div", { className: "tl-legend" },
    el("span", { className: "tl-seg intro" }), "вступление ",
    el("span", { className: "tl-seg lock" }), "неотменяемо ",
    el("span", { className: "tl-seg tail" }), "хвост (отменяется следующим триком) ",
    el("span", { className: "tl-blend inline" }), "где глаз видит переход");

  const items = S.compare.map(byId).filter(Boolean).map(t => {
    const rm = el("button", { className: "tl-mini", textContent: "✕", title: "Убрать" });
    rm.onclick = () => { toggle(S.compare, t.id); save("compare", S.compare); renderTab(); };
    const sim = el("button", { className: "tl-mini" + (S.similarOf === t.id ? " on" : ""), textContent: "≈", title: "Похожие по времени" });
    sim.onclick = () => { S.similarOf = S.similarOf === t.id ? null : t.id; renderTab(); };
    return { t, m: tm(t), extra: el("span", { className: "tl-acts" }, sim, rm) };
  });

  wrap.append(el("div", { className: "tl-hint", textContent: "Добавляй трики кнопкой ⇄ в таблице. Кнопка ≈ ищет трики с почти таким же временем — и показывает, какой из них даёт больше очков." }), legend);
  if (!items.length) wrap.append(el("div", { className: "tl-empty", textContent: "Пока пусто — выбери трики во вкладке «Трики»." }));
  else wrap.append(timeline(items));

  const base = S.similarOf && byId(S.similarOf);
  const bm = base && tm(base);
  if (bm) {
    const tol = el("input", { type: "number", className: "tl-input small", min: 0, max: 30, step: 1, value: S.tol });
    tol.onchange = () => { S.tol = Math.max(0, +tol.value || 0); renderTab(); };
    const near = data.tricks.map(t => ({ t, m: tm(t) }))
      .filter(({ t, m }) => m && t.id !== base.id && Math.abs(m.cancel - bm.cancel) <= S.tol && (S.specials || !t.sp))
      .sort((a, b) => b.t.s - a.t.s).slice(0, 25)
      .map(({ t, m }) => {
        const add = el("button", { className: "tl-mini", textContent: "⇄", title: "В сравнение" });
        add.onclick = () => { if (!S.compare.includes(t.id)) S.compare.push(t.id); save("compare", S.compare); renderTab(); };
        return { t, m, extra: el("span", { className: "tl-acts" }, add) };
      });
    wrap.append(el("h3", { className: "tl-h" }, `Похожие на «${label(base)}» (${fr(bm.cancel)} кадр ± `, tol, ")"));
    wrap.append(near.length ? timeline(near) : el("div", { className: "tl-empty", textContent: "Ничего в этом окне." }));
  }
  return wrap;
}

/* ================= окно «Анимация» (макет) ================= */
function openAnim(id) {
  S.current = id;
  for (const r of body?.querySelectorAll("tr.cur") || []) r.classList.remove("cur");
  body?.querySelector(`tr[data-id="${CSS.escape(id)}"]`)?.classList.add("cur");
  if (animWin?.node.isConnected) { animRender(); WM.focus(animWin); return; }

  let raf = 0, t0 = performance.now(), playing = true, speed = 1;
  animWin = WM.open({ title: "Анимация", icon: "🎬", width: 440, height: 560, key: "thawlab-anim",
    render(c, w) {
      c.classList.add("tl", "tl-anim");
      const title = el("div", { className: "tl-an-title" });
      const up = el("button", { className: "tl-mini", textContent: "↑", title: "Предыдущий трик (↑)", onclick: () => step(-1) });
      const down = el("button", { className: "tl-mini", textContent: "↓", title: "Следующий трик (↓)", onclick: () => step(1) });
      const stage = el("div", { className: "tl-an-stage" });
      stage.innerHTML = MANNEQUIN;   // своя разметка
      const track = el("div", { className: "tl-track big" });
      const head = el("div", { className: "tl-an-head" });
      const time = el("div", { className: "tl-an-time" });
      const facts = el("div", { className: "tl-an-facts" });
      const play = el("button", { className: "tl-btn", textContent: "⏸" });
      play.onclick = () => { playing = !playing; play.textContent = playing ? "⏸" : "▶"; t0 = performance.now() - pos / speed / FPS * 1000; };
      const spd = el("select", { className: "tl-input" }, ...[1, 0.5, 0.25].map(v => el("option", { value: v, textContent: v + "×" })));
      spd.onchange = () => { t0 = performance.now() - pos / +spd.value / FPS * 1000; speed = +spd.value; };
      let pos = 0, m = null;

      c.append(el("div", { className: "tl-an-top" }, up, down, title), stage,
        el("div", { className: "tl-an-ctrl" }, play, spd, time), track, facts,
        el("div", { className: "tl-hint", textContent: "Пока макет: манекен оживёт, когда расшифруем ключевые кадры .ska. Анимации будут браться из файлов твоей копии игры (личная папка, на сервер не уходят)." }));

      animRender = () => {
        const t = byId(S.current);
        if (!t) return;
        m = tm(t);
        title.replaceChildren(el("b", { textContent: t.n }), t.v ? el("span", { className: "tl-var", textContent: t.v }) : "");
        w.setTitle("Анимация: " + t.n);
        track.replaceChildren();
        facts.replaceChildren();
        if (!m) { facts.append(el("div", { className: "tl-muted", textContent: "Тайминг не определён" })); return; }
        const seg = (from, len, cls) => track.append(el("div", { className: "tl-seg " + cls,
          style: `left:${from / m.total * 100}%;width:${Math.max(len, 0) / m.total * 100}%` }));
        if (m.intro) seg(0, m.intro, "intro");
        seg(m.intro || 0, m.cancel - (m.intro || 0), "lock");
        seg(m.cancel, m.total - m.cancel, "tail");
        track.append(head);
        const fact = (k, v) => facts.append(el("div", {}, el("span", { textContent: k }), el("b", { textContent: v })));
        fact("Очки", int(t.s));
        fact("Неотменяемо", `${fr(m.cancel)} кадр · ${sec(m.cancel)}`);
        fact("Хвост", `${fr(m.total - m.cancel)} кадр`);
        fact("Вся анимация", `${fr(m.total)} кадр · ${sec(m.total)}`);
        fact("Очки/с", int(ptsPerSec(t, m)));
        fact("Рейтинг", fmtRating(rating(t, m)));
        t0 = performance.now();
      };
      const loop = now => {
        raf = requestAnimationFrame(loop);
        if (!m) return;
        if (playing) pos = ((now - t0) / 1000 * FPS * speed) % (m.total + 20);   // 20 кадров паузы в конце
        const f = Math.min(pos, m.total);
        head.style.left = f / m.total * 100 + "%";
        const phase = f < (m.intro || 0) ? "вступление" : f < m.cancel ? "неотменяемо" : f < m.total ? "хвост — жми следующий трик" : "конец";
        time.textContent = `${fr(f)} / ${fr(m.total)} кадр · ${phase}`;
        stage.dataset.phase = f < m.cancel ? "lock" : f < m.total ? "tail" : "end";
        stage.style.setProperty("--p", (f / m.total).toFixed(3));
      };
      w.onKey = stepKey;
      w.onClose = () => { cancelAnimationFrame(raf); animWin = null; animRender = null; };
      animRender();
      raf = requestAnimationFrame(loop);
    } });
  placeBeside(animWin);
}

// условный манекен: доска крутится по прогрессу трика (--p), фигура статична
const MANNEQUIN = `
<svg viewBox="0 0 200 200" class="tl-dummy" aria-hidden="true">
  <g class="body" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round">
    <circle cx="100" cy="40" r="13" fill="currentColor" stroke="none"/>
    <path d="M100 56 L100 104 M100 66 L76 92 M100 66 L124 88 M100 104 L84 140 M100 104 L118 140"/>
  </g>
  <g class="board"><rect x="62" y="146" width="76" height="9" rx="4.5"/></g>
</svg>`;

/* ================= окно «Сет» ================= */
function openSet() {
  if (setWin?.node.isConnected) { WM.focus(setWin); return; }
  setWin = WM.open({ title: "Сет", icon: "🧩", width: 560, height: 620, key: "thawlab-set",
    render(c, w) {
      c.classList.add("tl", "tl-set");
      setBody = c;
      const accept = e => e.dataTransfer.types.includes(DRAG_TYPE);
      c.addEventListener("dragover", e => { if (accept(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; c.classList.add("drop"); } });
      c.addEventListener("dragleave", e => { if (!c.contains(e.relatedTarget)) c.classList.remove("drop"); });
      c.addEventListener("drop", e => {
        c.classList.remove("drop");
        if (!accept(e)) return;
        e.preventDefault();
        const t = byId(e.dataTransfer.getData(DRAG_TYPE));
        if (!t) return;
        const tab = e.target.closest?.("[data-settab]")?.dataset.settab || S.setTab;
        if (tab === "combo") { S.combo.push(t.id); save("combo", S.combo); refresh(); return; }
        addToArsenal(t, tab);
      });
      w.onClose = () => { setWin = null; setBody = null; };
      renderSet();
    } });
  placeBeside(setWin);
}

function addToArsenal(t, wanted) {
  const slot = slotOf(t);
  if (!slot) return notify("Мэнюалы и прочее в сет пока не входят");
  if (!tm(t)) return notify("У этого трика тайминг не определён");
  if (S.arsenal[slot].includes(t.id)) return notify(`«${t.n}» уже в «${SLOT_NAME[slot]}»`);
  S.arsenal[slot].push(t.id);
  save("arsenal", S.arsenal);
  if (wanted && wanted !== slot) notify(`«${t.n}» — это ${SLOT_NAME[slot].toLowerCase()}: положил туда`);
  else notify(`+ ${t.n} → ${SLOT_NAME[slot]}`, 900);
  if (setWin?.node.isConnected) S.setTab = slot;
  refresh();
}
function dropFromArsenal(id) {
  for (const k of Object.keys(S.arsenal)) S.arsenal[k] = S.arsenal[k].filter(x => x !== id);
  save("arsenal", S.arsenal);
  refresh();
}

function renderSet() {
  const c = setBody;
  const tabs = el("div", { className: "tl-tabs pad" }, ...SET_TABS.map(([k, name]) => {
    const n = k === "combo" ? S.combo.length : S.arsenal[k].length;
    const b = el("button", { className: "tl-tab" + (S.setTab === k ? " on" : ""), textContent: `${name} ${n || ""}`.trim() });
    b.dataset.settab = k;
    b.onclick = () => { S.setTab = k; save("setTab", k); renderSet(); };
    return b;
  }));
  const inner = el("div", { className: "tl-body" }, S.setTab === "combo" ? renderCombo() : renderSlot(S.setTab));
  c.replaceChildren(el("div", { className: "tl-head" }, tabs), inner);
}

function renderSlot(slot) {
  const wrap = el("div", { className: "tl-pane" });
  const list = S.arsenal[slot].map(byId).filter(Boolean)
    .map(t => ({ t, m: tm(t) })).sort((a, b) => (rating(b.t, b.m) ?? -1e9) - (rating(a.t, a.m) ?? -1e9));
  wrap.append(el("div", { className: "tl-hint", textContent: "Перетащи строку трика из таблицы сюда (или на вкладку) — он ляжет в свою категорию. ⤵ — добавить в комбо." }));
  if (!list.length) wrap.append(el("div", { className: "tl-empty", textContent: `${SLOT_NAME[slot]}: пусто` }));
  else wrap.append(el("div", { className: "tl-tablewrap" }, el("table", { className: "tl-table" },
    el("thead", {}, el("tr", {}, ...["Трик", "Очки", "Время", "Неотм.", "Рейтинг", ""].map(h => el("th", { textContent: h })))),
    el("tbody", {}, ...list.map(({ t, m }) => {
      const toCombo = el("button", { className: "tl-mini", textContent: "⤵", title: "В комбо" });
      toCombo.onclick = () => { S.combo.push(t.id); save("combo", S.combo); notify(`В комбо: ${S.combo.length}`, 800); refresh(); };
      const rm = el("button", { className: "tl-mini", textContent: "✕", title: "Убрать из сета" });
      rm.onclick = () => dropFromArsenal(t.id);
      const r = el("tr", { className: S.current === t.id ? "cur" : "" },
        el("td", { textContent: label(t) }), el("td", { className: "num", textContent: int(t.s) }),
        el("td", { className: "bar" }, miniBar(m)), el("td", { className: "num", textContent: fr(m?.cancel) }),
        el("td", { className: "num strong", textContent: fmtRating(rating(t, m)) }),
        el("td", { className: "tl-acts" }, toCombo, rm));
      r.onclick = e => { if (!e.target.closest("button")) openAnim(t.id); };
      return r;
    })))));
  return wrap;
}

function renderCombo() {
  const wrap = el("div", { className: "tl-pane" });
  const list = S.combo.map(byId).filter(Boolean);
  const sc = comboScore(list, S.repeat);
  const frames = comboFrames(list, S.stat, S.sos);
  const save2 = () => { save("combo", S.combo); refresh(); };

  const rows = sc.parts.map(({ t, pct, pts }, i) => {
    const m = tm(t), last = i === list.length - 1;
    const mv = d => () => { const j = i + d; if (j < 0 || j >= S.combo.length) return; [S.combo[i], S.combo[j]] = [S.combo[j], S.combo[i]]; save2(); };
    return el("tr", {},
      el("td", { className: "num tl-muted", textContent: i + 1 }), el("td", { textContent: label(t) }),
      el("td", { className: "num" + (pct < 100 ? " warn" : ""), textContent: pct + "%" }),
      el("td", { className: "num", textContent: int(pts) }),
      el("td", { className: "num", textContent: m ? fr(last ? m.total : m.cancel) : "—", title: last ? "Последний трик нужно докрутить целиком" : "" }),
      el("td", { className: "tl-acts" },
        el("button", { className: "tl-mini", textContent: "↑", onclick: mv(-1) }),
        el("button", { className: "tl-mini", textContent: "↓", onclick: mv(1) }),
        el("button", { className: "tl-mini", textContent: "✕", onclick: () => { S.combo.splice(i, 1); save2(); } })));
  });

  const budget = el("input", { type: "number", className: "tl-input small", min: 0.3, max: 10, step: 0.1, value: S.budget });
  budget.onchange = () => { S.budget = Math.max(0.3, +budget.value || 2.5); };
  const chk = (key, text) => {
    const i = el("input", { type: "checkbox", checked: S[key] });
    i.onchange = () => { S[key] = i.checked; };
    return el("label", { className: "tl-check" }, i, el("span", { textContent: text }));
  };
  const pick = el("button", { className: "tl-btn primary", textContent: "✨ Подобрать" });
  pick.onclick = () => {
    const ar = new Set([...S.arsenal.flip, ...S.arsenal.grab, ...S.arsenal.special]);
    const useAr = S.fromArsenal && ar.size > 0;
    const pool = data.tricks.filter(t => useAr ? ar.has(t.id)
      : (t.c === "flip" || (S.autoGrabs && t.c === "grab")) && (S.autoSpecials || !t.sp));
    const res = autoPick(pool, S.budget * FPS, S.stat, S.sos, S.repeat);
    if (!res.length) return notify("Ничего не влезает в это время");
    S.combo = res.map(t => t.id); save2();
  };
  const rep = el("input", { type: "text", className: "tl-input", value: S.repeat.join(", "), title: "Доля очков за 1-й, 2-й, 3-й… повтор одного трика в комбо" });
  rep.onchange = () => {
    const v = rep.value.split(/[,;\s]+/).map(Number).filter(x => x >= 0 && x <= 100);
    if (v.length) { S.repeat = v; save("repeat", v); refresh(); }
  };
  const clear = el("button", { className: "tl-btn", textContent: "Очистить" });
  clear.onclick = () => { S.combo = []; save2(); };
  const exp = el("button", { className: "tl-btn", textContent: "⬇ Отчёт .md" });
  exp.onclick = () => exportReport(list, sc, frames);
  exp.disabled = !list.length;

  const card = (k, v, big) => el("div", { className: "tl-stat-card" + (big ? " big" : "") }, el("span", { textContent: k }), el("b", { textContent: v }));
  wrap.append(
    el("div", { className: "tl-bar" }, el("span", { textContent: "Время в воздухе" }), budget, el("span", { textContent: "с" }), pick),
    el("div", { className: "tl-bar" }, chk("fromArsenal", "только из сета"), chk("autoGrabs", "грэбы"), chk("autoSpecials", "спешлы")),
    el("div", { className: "tl-bar" }, el("span", { textContent: "Повторы, %" }), rep,
      el("span", { className: "tl-muted", textContent: "предположение" })),
    el("div", { className: "tl-totals" },
      card("Множитель", "×" + sc.mult), card("Сумма", int(sc.base)), card("Итого", int(sc.total), true),
      card("Время", list.length ? sec(frames) : "—"), card("Очки/с", frames ? int(sc.total / (frames / FPS)) : "—")),
    list.length
      ? el("div", { className: "tl-tablewrap" }, el("table", { className: "tl-table" },
          el("thead", {}, el("tr", {}, ...["#", "Трик", "Повтор", "Даёт", "Кадров", ""].map(h => el("th", { textContent: h })))),
          el("tbody", {}, ...rows)))
      : el("div", { className: "tl-empty", textContent: "Комбо пусто: ⤵ из вкладок сета, перетаскивание сюда или «Подобрать»." }),
    el("div", { className: "tl-bar" }, clear, exp),
    el("div", { className: "tl-hint", textContent: "Подбор жадный: каждый раз берёт трик с наибольшим приростом итоговых очков на кадр. Множитель = число триков; вращения, гэпы и бонусы за баланс пока не учитываются." }));
  return wrap;
}

function exportReport(list, sc, frames) {
  const lines = [
    "# THAW Lab — комбо", "",
    `Стат флипов: ×${Number(S.stat).toFixed(2)}${S.sos ? "" : " (на спешлы не действует)"} · повторы: ${S.repeat.join("/")} % · рейтинг: \`${S.formula}\``, "",
    "| # | Трик | Очки | Повтор | Даёт | Кадров |", "|---|---|---|---|---|---|",
    ...sc.parts.map(({ t, pct, pts }, i) => {
      const m = tm(t);
      return `| ${i + 1} | ${label(t)} | ${t.s} | ${pct}% | ${Math.round(pts)} | ${m ? fr(i === list.length - 1 ? m.total : m.cancel) : "—"} |`;
    }), "",
    `**Итого:** ${int(sc.base)} × ${sc.mult} = **${int(sc.total)}** за ${fr(frames)} кадр (${sec(frames)}), ${frames ? int(sc.total / (frames / FPS)) : 0} очк/с`, "",
    "## Сет", "",
    ...Object.entries(SLOT_NAME).map(([k, n]) => `- **${n}:** ${S.arsenal[k].map(byId).filter(Boolean).map(label).join(", ") || "—"}`), "",
    `Данные: ${data.meta.source}, сборка ${data.meta.built}.`, "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "thaw-combo.md" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- 📖 гайд (своя разметка) ---------- */
const GUIDE = `
<h2>Что это</h2>
<p>База таймингов триков <b>Tony Hawk's American Wasteland</b> с модом <b>reTHAWed</b> — для тех, кто ставит длинные комбо.
Для каждого трика: сколько кадров его нельзя прервать, сколько анимации отменяется следующим триком и сколько очков он даёт.
Цифры вытащены из скриптов и анимаций самой игры, часть проверена замерами по видео.</p>

<h2>Как работают тайминги</h2>
<p>Скрипт флипа (<code>fliptrick</code>) делает по шагам:</p>
<pre>Skater_PlayAnim  от начала до endpos | конца,
                 speed = min(speed × стат флипов, MaxSpeed | 1.3)
wait 15 frames                       ← жёсткий минимум (или своё значение трика)
[HoldFrame: держим кадр, пока зажата кнопка]
Skater_WaitAnim framesfromend = Trickslack   (у трика нет своего — 10)
bailoff → canspin → DoNextTrick      ← здесь стартует забуферизованный следующий трик
WaitAnimWhilstChecking               ← хвост анимации, который этим и отменяется</pre>
<ul>
<li><b>Неотменяемая часть</b> = max(15 кадров, (длина анимации − Trickslack) / скорость).</li>
<li><b>Хвост</b> — последние Trickslack кадров анимации; реальное время ≈ Trickslack / скорость.</li>
<li><b>Буфер:</b> нажатия во время трика встают в очередь, <code>DoNextTrick</code> достаёт их в момент разрешения.
Окно двойного нажатия для extra-триков — 14 кадров у флипов, 15 у грэбов.</li>
<li><b>Скорость</b> умножается на стат флипов скейтера и упирается в потолок 1,3 (или в MaxSpeed трика).
При полных статах базовые флипы идут на потолке — поэтому ползунок «Стат флипов» в шапке.</li>
<li><b>Вступление.</b> У некоторых спешлов (например, C-Flip) сначала целиком играется отдельная анимация — всё это время тоже неотменяемо.</li>
<li><b>Две анимации.</b> Трики вида «X to Y» после ожидания запускают вторую анимацию; Trickslack считается от её конца.</li>
<li><b>Вход.</b> Новый трик 0,2 с (12 кадров) плавно смешивается со старым. Игра уже приняла трик, а глаз видит границу позже —
не путай это с таймингом при замерах.</li>
</ul>
<p><b>Грэбы</b> (<code>grabtrick</code>): анимацию нельзя бросить раньше 60% (WaitPercent; с ForceInit — до конца),
дальше грэб держится, пока зажата кнопка, и копит очки. Стат флипов на грэбы не влияет, вход — 0,3 с.</p>

<h2>Рейтинг</h2>
<p>«Очки в секунду» — хороший показатель, но не единственный: трик с огромной неотменяемой частью может дать много очков в секунду
и всё равно быть неудобным — его не прервать, если земля близко, и он отнимает свободу в маршруте. Поэтому в таблице есть
<b>рейтинг</b> со своей формулой (кнопка «⚙ Рейтинг»). По умолчанию — «Сбалансированный»: очки/с, но трик дольше 20 кадров
штрафуется тем сильнее, чем он длиннее.</p>

<h2>Проверено в игре</h2>
<table class="tl-table small">
<tr><th>Замер</th><th>Модель</th><th>Видео</th><th>Итог</th></tr>
<tr><td>Heelflip ×N, полные статы</td><td>18,5 кадра между триками</td><td>~18</td><td>✅ сходится</td></tr>
<tr><td>C-Flip → флип</td><td>43 неотм., 66 всего</td><td>~49, 66–68</td><td>✅ с учётом входа</td></tr>
<tr><td>The 900 (TH4) → флип</td><td>61 (стат на спешлы) / 66 (без)</td><td>66</td><td>❓ похоже, стат на спешлы не действует</td></tr>
</table>

<h2>Трики, которые ценны не очками</h2>
<ul>
<li><b>Hot Rod</b> — спешл-мэнюал, который разгоняет скейтера. Скорость — главный ресурс длинного комбо, держи его в арсенале обязательно.</li>
<li><b>Jango Jump Jet</b> — спешл-грэб: скейтер подлетает на ранце. Больше воздуха — больше триков, а acid drop с высоты даёт больше скорости.</li>
</ul>

<h2>Советы по уровню</h2>
<ul>
<li>В комбо нужно постоянно двигаться: быть в воздухе, держать скорость, связывать рейлы. Без рейлов игра рано или поздно сильно тормозит скейтера.</li>
<li><b>Wallride</b> даёт высоту и не имеет полоски баланса — пользуйся им как можно чаще.</li>
<li>Как можно больше времени проводи <b>в воздухе</b>.</li>
<li>Если берёшь рейл — выбирай такой, где можно <b>шаффлить</b>: почти не теряешь баланс.</li>
<li><b>Bert slide</b> вместо мэнюала: без полоски баланса, но сильно тормозит.</li>
<li><b>Бонки</b> по столбикам — набрать высоту.</li>
<li>Встань с доски в воздухе, чтобы <b>скорректировать траекторию</b>, если не дотягиваешь до рейла.</li>
<li>Строй маршрут без потери скорости и через <b>ускорялки</b> и всё, что подбрасывает вверх.</li>
</ul>

<h2>Открытые вопросы</h2>
<ul>
<li>Действует ли стат флипов на спешлы (The 900).</li>
<li>Сколько очков трик теряет при повторе в комбо — сейчас стоит предположение 100/75/50/25/10%.</li>
<li>Когда у грэба срабатывает Trickslack (условие в скрипте пока не расшифровано).</li>
<li>Мэнюалы, лип-трики, вращения и бонусы — ещё не разобраны.</li>
</ul>

<h2>Откуда данные</h2>
<p>reTHAWed 4.4: распакованы архивы, декодированы QB-скрипты, найдены длительности анимаций.
Здесь лежат только числа — никаких файлов игры. Инструменты для самостоятельной проверки будут опубликованы.</p>`;

function renderGuide() {
  const g = el("div", { className: "tl-pane tl-guide" });
  g.innerHTML = GUIDE;   // своя разметка, без пользовательского текста
  return g;
}
