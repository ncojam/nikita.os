import { el, store } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { MODES, ZONES, compare, fmtAxis, fmtDelta, fmtDur, fmtLocal, fmtMoney, fmtZone, joinGap, pathRoutes, pathStats, routeStats } from "./trip-calc.js";
import { grip, sortable } from "./trip-drag.js";

/* ================= поездки: варианты пути и сравнение =================
 * Вкладка «Путь» в менеджере: карточка = вариант пути (цепочка перегонов: поезд, самолёт, автобус…).
 * У перегона — откуда, куда, отправление и прибытие по местному времени со своим поясом, цена, номер рейса.
 * Между перегонами видна стыковка: сколько ждать, «впритык» или «не стыкуется». Итог — время от двери до двери и цена.
 * Отдельное окно «Сравнение путей» — призрачное сравнение: у каждого варианта своя дорожка из перегонов,
 * а эталон (★) просвечивает на дорожках остальных пунктиром — сразу видно, кто быстрее и на сколько.
 * Ось — «от старта» (длительности) или «по календарю» (какого числа приедешь). Наведи на строку — остальные тускнеют.
 * Конструктор: вкладка — один список с чертой. Выше черты — собранная поездка (path, по порядку), ниже — варианты-детали.
 * Тянешь карточку за ⠿ через черту — вариант входит в поездку или выходит из неё; внутри раскрытой карточки
 * так же тянутся перегоны. У перегона в поездке своя галочка «билет куплен» — она же в чек-листе.
 * Право правки — только у владельца; проверяет сервер.
 * ctx = { trip(), change(path, body, before?), rerender() } — даёт trip.js; before(trip, новые id) вызывается до перерисовки.
 */
let sel = null;            // выбранный вариант в списке
let editing = null;        // {key: id | "new", node}
let cmpBox = null, cmpCtx = null;
const cmpState = { axis: "start", sort: "order" };

const baseKey = t => "trip.base." + t.id;
const baseId = t => store.get(baseKey(t), null);
const stepLine = s => `${s.frm} → ${s.to}`;
const inPath = (t, r) => (t.path || []).includes(r.id);

function chip(text, cls = "") { return el("span", { className: "trp-chip no-i18n " + cls, textContent: text }); }
function btn(text, run, cls = "") { return el("button", { className: "trp-btn " + cls, type: "button", textContent: text, onclick: e => { e.stopPropagation(); run(); } }); }

function gapNode(g, join) {
  const text = join ? (g.bad ? `⚠ следующая часть уезжает раньше, чем ты приедешь (${fmtDur(g.mins)})` : `🔗 стык частей: ${fmtDur(g.mins)}` + (g.tight ? " · впритык" : ""))
    : g.bad ? `⚠ не стыкуется: опоздание на ${fmtDur(g.mins)}` : g.tight ? `⚡ впритык: ${fmtDur(g.mins)} на пересадку` : `⏳ пересадка ${fmtDur(g.mins)}`;
  return el("div", { className: "trp-gap no-i18n" + (join ? " join" : "") + (g.bad ? " bad" : g.tight ? " tight" : ""), textContent: text });
}

/* ----- вкладка «Путь»: конструктор поездки ----- */
// новый порядок: что выше черты — поездка, ниже — варианты
function sendOrder(ctx, parts) {
  const cut = parts.findIndex(n => n.classList.contains("trp-divider"));
  const ids = n => n.dataset.item;
  ctx.change("/api/trip/route/order", { path: parts.slice(0, cut).map(ids), rest: parts.slice(cut + 1).map(ids) });
}
const setPath = (ctx, path) => ctx.change("/api/trip/route/order", { path, rest: ctx.trip().routes.map(r => r.id) });

function summaryNode(t) {
  const st = pathStats(t), list = pathRoutes(t);
  const box = el("div", { className: "trp-sum" }, el("div", { className: "trp-sum-title", textContent: "🧳 Поездка" }));
  if (!list.length) {
    box.append(el("div", { className: "trp-hint", textContent: "Собери поездку из вариантов: перетащи карточку за ⠿ выше черты или нажми «➕ В поездку»." }));
    return box;
  }
  const first = list[0].steps[0], last = list.at(-1).steps.at(-1);
  box.append(el("div", { className: "trp-sum-line no-i18n", textContent: `${first.frm} → ${last.to}` }),
    el("div", { className: "trp-chips" },
      chip("⏱ " + fmtDur(st.mins)), chip("💰 " + (st.price ? fmtMoney(st.price, t.cur) + (st.allPriced ? "" : "+?") : "—")),
      chip(`🎫 ${st.bought}/${st.count}`, st.bought === st.count ? "good" : ""), chip("🏁 " + fmtLocal(last.arr)),
      ...(st.bad ? [chip("⚠ не стыкуется", "bad")] : st.tight ? [chip("⚡ впритык", "warn")] : [])));
  return box;
}

export function routesTab(ctx) {
  const t = ctx.trip(), kids = [], path = pathRoutes(t), rest = t.routes.filter(r => !inPath(t, r));
  const bar = el("div", { className: "trp-bar" });
  if (t.owner) bar.append(btn("+ Вариант пути", () => routeForm(ctx, null), "on"));
  bar.append(btn("📊 Сравнить", () => openCompare(ctx)));
  kids.push(bar, summaryNode(t));
  if (editing?.key === "new") kids.push(editing.node);
  const box = el("div", { className: "trp-build" });
  path.forEach((r, i) => {
    if (i) { const g = joinGap(path[i - 1], r); if (g) box.append(gapNode(g, true)); }
    box.append(editing?.key === r.id ? editing.node : routeNode(ctx, r));
  });
  if (!path.length) box.append(el("div", { className: "trp-drop", textContent: "сюда — варианты, из которых собирается поездка" }));
  box.append(el("div", { className: "trp-divider", textContent: rest.length ? "📦 Варианты · тяни ⠿ вверх, чтобы взять в поездку" : "📦 Варианты" }));
  for (const r of rest) box.append(editing?.key === r.id ? editing.node : routeNode(ctx, r));
  if (!t.routes.length && !editing) box.append(el("div", { className: "trp-empty", textContent: "Пока нет вариантов. Добавь первый: поезд, самолёт, автобус." }));
  if (t.owner) sortable(box, ".trp-route", ".trp-grip.route", parts => sendOrder(ctx, parts));
  kids.push(box);
  return kids;
}

function routeNode(ctx, r) {
  const t = ctx.trip(), st = routeStats(r), on = sel === r.id, used = inPath(t, r);
  const { rows } = compare(t.routes, baseId(t)), me = rows.find(x => x.route === r);
  const node = el("div", { className: "trp-route" + (on ? " on" : "") + (used ? " chosen" : ""), onclick: () => { sel = on ? null : r.id; ctx.rerender(); } });
  node.dataset.item = r.id;
  const head = el("div", { className: "trp-route-head" });
  if (t.owner) head.append(grip("route", "Тяни: порядок в поездке, или через черту — в поездку / из неё"));
  head.append(el("b", { className: "no-i18n", textContent: r.name }));
  if (baseId(t) === r.id) head.append(chip("★ эталон"));
  if (me?.fastest) head.append(chip("⚡ быстрее всех", "good"));
  if (me?.cheapest) head.append(chip("💰 дешевле всех", "good"));
  if (st.bad) head.append(chip("⚠ не стыкуется", "bad"));
  node.append(head);
  if (st.steps.length) {
    node.append(el("div", { className: "trp-chips" },
      chip("⏱ " + fmtDur(st.mins)), chip("💰 " + (st.price ? fmtMoney(st.price, t.cur) + (st.allPriced ? "" : "+?") : "—")),
      chip("🔁 " + (st.transfers ? st.transfers + " перес." : "прямой")), chip("🏁 " + fmtLocal(r.steps.at(-1).arr))));
  }
  if (r.comment) node.append(el("div", { className: "trp-comment no-i18n", textContent: r.comment }));
  const steps = el("div", { className: "trp-steplist" });
  r.steps.forEach((s, i) => {
    if (i && st.gaps[i - 1]) steps.append(gapNode(st.gaps[i - 1]));
    steps.append(stepNode(ctx, r, s, on, used));
  });
  node.append(steps);
  if (on && t.owner && r.steps.length > 1) sortable(steps, ".trp-step", ".trp-grip.step", parts => {
    const order = parts.map(n => r.steps.find(x => x.id === n.dataset.step));
    ctx.change("/api/trip/route", { id: r.id, name: r.name, comment: r.comment, steps: order });
  });
  if (on) {
    const acts = el("div", { className: "trp-actions row" });
    if (t.owner) acts.append(btn(used ? "↩ Из поездки" : "➕ В поездку",
      () => setPath(ctx, used ? t.path.filter(x => x !== r.id) : [...t.path, r.id])));
    acts.append(btn(baseId(t) === r.id ? "★ Эталон" : "☆ Эталон", () => { store.set(baseKey(t), baseId(t) === r.id ? null : r.id); ctx.rerender(); refreshCompare(); }));
    if (t.owner) acts.append(btn("Изменить", () => routeForm(ctx, r)), btn("Копия", () => copyRoute(ctx, r)),
      btn("Удалить", () => confirm("Удалить вариант пути?") && ctx.change("/api/trip/route/delete", { id: r.id })));
    node.append(acts);
  }
  return node;
}

export function boughtTick(ctx, r, s) {
  const t = ctx.trip();
  return el("button", { className: "trp-tick no-i18n" + (s.bought ? " done" : ""), title: t.owner ? "Отметить: билет куплен / нет" : "Билет",
    textContent: s.bought ? "🎫 куплен ✓" : "🎫 не куплен", disabled: !t.owner,
    onclick: e => { e.stopPropagation(); ctx.change("/api/trip/step/bought", { route: r.id, step: s.id, done: !s.bought }); } });
}

function stepNode(ctx, r, s, open, used) {
  const t = ctx.trip(), [icon, name] = MODES[s.mode] || MODES.other;
  const zone = s.tza !== s.tzd ? ` (${fmtZone(s.tza)})` : "";
  const line = el("div", { className: "trp-step" + (open && t.owner ? " grab" : ""), title: name });
  line.dataset.step = s.id;
  line.append(open && t.owner && r.steps.length > 1 ? grip("step", "Тяни, чтобы поменять порядок перегонов") : el("span", { className: "trp-step-icon", textContent: icon }),
    el("div", { className: "trp-step-main no-i18n" },
      el("div", { className: "trp-step-route", textContent: (open && t.owner && r.steps.length > 1 ? icon + " " : "") + stepLine(s) + (s.num ? " · " + s.num : "") }),
      el("div", { className: "trp-step-time", textContent: `${fmtLocal(s.dep)} → ${fmtLocal(s.arr)}${zone}` + (s.price != null ? " · " + fmtMoney(s.price, t.cur) : "") })));
  if (used) line.append(boughtTick(ctx, r, s));
  if (s.comment) line.append(el("div", { className: "trp-comment no-i18n", textContent: s.comment }));
  return line;
}

const copyRoute = (ctx, r) => ctx.change("/api/trip/route", {
  name: r.name + " (копия)", comment: r.comment, steps: r.steps.map(({ id, ...s }) => s) }, (trip, made) => { sel = made[0] || null; });

/* ----- форма варианта ----- */
function zoneSelect(value) {
  const s = el("select", { className: "trp-select", title: "Часовой пояс" });
  for (let z = -12; z <= 14; z++) s.append(el("option", { value: z, textContent: fmtZone(z) + (ZONES.find(x => x[0] === z)?.[1] ? " · " + ZONES.find(x => x[0] === z)[1] : "") }));
  s.value = String(value);
  return s;
}

function stepRow(init, onRemove, onInput) {
  const input = (props) => el("input", { type: "text", ...props });
  const mode = el("select", { className: "trp-select" }, ...Object.entries(MODES).map(([k, [i, n]]) => el("option", { value: k, textContent: i + " " + n })));
  mode.value = init.mode || "train";
  const num = input({ placeholder: "Рейс / поезд №", value: init.num || "", maxLength: 40 });
  const frm = input({ placeholder: "Откуда", value: init.frm || "", maxLength: 120, required: true });
  const to = input({ placeholder: "Куда", value: init.to || "", maxLength: 120, required: true });
  const dep = el("input", { type: "datetime-local", value: init.dep || "", required: true, title: "Отправление (местное время)" });
  const arr = el("input", { type: "datetime-local", value: init.arr || "", required: true, title: "Прибытие (местное время)" });
  const tzd = zoneSelect(init.tzd ?? 3), tza = zoneSelect(init.tza ?? init.tzd ?? 3);
  const price = el("input", { type: "number", min: 0, step: "any", placeholder: "Цена", value: init.price ?? "" });
  const comment = input({ placeholder: "Заметка (багаж, вокзал, сайт…)", value: init.comment || "", maxLength: 500 });
  const get = () => ({ id: init.id, mode: mode.value, num: num.value, frm: frm.value, to: to.value, dep: dep.value, tzd: +tzd.value,
    arr: arr.value, tza: +tza.value, price: price.value === "" ? null : +price.value, comment: comment.value });
  const node = el("div", { className: "trp-stepform" },
    el("div", { className: "trp-row" }, mode, num, el("button", { className: "trp-btn", type: "button", textContent: "✕", title: "Убрать перегон", onclick: onRemove })),
    el("div", { className: "trp-row" }, frm, to),
    el("div", { className: "trp-row" }, el("label", { className: "trp-lbl", textContent: "Отпр." }, dep), tzd),
    el("div", { className: "trp-row" }, el("label", { className: "trp-lbl", textContent: "Приб." }, arr), tza),
    el("div", { className: "trp-row" }, price, comment));
  node.addEventListener("input", onInput);
  return { node, get };
}

function routeForm(ctx, route) {
  const t = ctx.trip();
  const name = el("input", { type: "text", placeholder: "Название: «Поезд + самолёт через Сургут»", value: route?.name || "", maxLength: 120, required: true });
  const comment = el("textarea", { placeholder: "Комментарий к варианту", value: route?.comment || "", maxLength: 2000 });
  const preview = el("div", { className: "trp-preview no-i18n" });
  const rows = [], list = el("div", { className: "trp-steps" });
  const update = () => {
    const r = { steps: rows.map(x => x.get()) }, st = routeStats(r);
    const bad = r.steps.length !== st.steps.length || st.steps.some(x => x.mins <= 0);
    const parts = st.steps.length && !bad ? ["⏱ " + fmtDur(st.mins), ...st.gaps.map(g => g.bad ? "⚠ не стыкуется" : g.tight ? "⚡ " + fmtDur(g.mins) : "⏳ " + fmtDur(g.mins)),
      st.price ? "💰 " + fmtMoney(st.price, t.cur) : ""].filter(Boolean) : [];
    preview.textContent = bad && r.steps.some(s => s.dep && s.arr) ? "⚠ прибытие должно быть позже отправления (проверь пояса)" : parts.join(" · ");
    preview.classList.toggle("bad", bad);
  };
  const add = init => {
    const row = stepRow(init, () => { if (rows.length > 1) { rows.splice(rows.indexOf(row), 1); row.node.remove(); update(); } }, update);
    rows.push(row);
    list.append(row.node);
    update();
  };
  (route ? route.steps : [{}]).forEach(add);
  const more = () => {
    const last = rows.at(-1)?.get() || {};
    add({ mode: last.mode, frm: last.to, dep: last.arr, tzd: last.tza, tza: last.tza });
  };
  const save = async () => {
    const steps = rows.map(x => x.get());
    if (await ctx.change("/api/trip/route", { id: route?.id, name: name.value, comment: comment.value, steps }, (trip, made) => { editing = null; sel = route?.id || made[0] || sel; })) editing = null;
  };
  const node = el("form", { className: "trp-form", onsubmit: e => { e.preventDefault(); save(); } }, name, comment, list,
    el("div", { className: "trp-row" }, el("button", { className: "trp-btn", type: "button", textContent: "+ Перегон", onclick: more })), preview,
    el("div", { className: "trp-hint", textContent: "Время — местное, пояс — у каждого конца свой: Москва → Сургут считается правильно." }),
    el("div", { className: "trp-row" }, el("button", { className: "trp-btn on", type: "submit", textContent: "Сохранить" }),
      el("button", { className: "trp-btn", type: "button", textContent: "Отмена", onclick: () => { editing = null; ctx.rerender(); } })));
  editing = { key: route?.id || "new", node };
  ctx.rerender();
  node.scrollIntoView({ block: "nearest" });
}

export function closeRouteForm() { editing = null; }
export function selectRoute(id) { sel = id; }

/* ----- сравнение: призрачные дорожки ----- */
export function openCompare(ctx) {
  cmpCtx = ctx;
  if (cmpBox) return refreshCompare();
  WM.open({ title: "Сравнение путей", icon: "📊", width: 880, height: 560, key: "trip:cmp", render(c, w) {
    cmpBox = el("div", { className: "cmp" });
    c.append(cmpBox);
    w.onClose = () => { cmpBox = null; };
    renderCompare();
  }});
}

export function refreshCompare() { if (cmpBox) renderCompare(); }

function segmented(options, value, onPick) {
  return el("div", { className: "cmp-seg" }, ...options.map(([k, text]) => el("button", { type: "button", className: k === value ? "on" : "", textContent: text, onclick: () => onPick(k) })));
}

function ticks(rowsData, axis, span, origin, tz) {
  const out = [];
  if (axis === "start") {
    const steps = [60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
    const step = steps.find(s => span / s <= 9) || steps.at(-1);
    for (let m = step; m < span; m += step) out.push([m, m % 1440 === 0 ? (m / 1440) + " д" : (m / 60) + " ч"]);
  } else {
    const first = Math.ceil((origin + tz * 60) / 1440) * 1440 - tz * 60;
    const days = [];
    for (let m = first; m < origin + span; m += 1440) days.push(m);
    const every = Math.ceil(days.length / 10);
    days.forEach((m, i) => { if (i % every === 0) out.push([m - origin, fmtAxis(m, tz)]); });
  }
  return out;
}

function renderCompare() {
  const ctx = cmpCtx, t = ctx.trip();
  const box = cmpBox;
  const { rows, base } = compare(t.routes, baseId(t));
  const head = el("div", { className: "cmp-head" },
    el("div", { className: "cmp-title no-i18n", textContent: `${t.icon} ${t.name}` }),
    segmented([["start", "⏱ От старта"], ["cal", "📅 По календарю"]], cmpState.axis, k => { cmpState.axis = k; renderCompare(); }),
    segmented([["order", "Как добавил"], ["price", "Дешевле"], ["time", "Быстрее"], ["arrive", "Раньше приедешь"]], cmpState.sort, k => { cmpState.sort = k; renderCompare(); }));
  const legend = el("div", { className: "cmp-legend" },
    ...Object.values(MODES).slice(0, 5).map(([i, n, col]) => el("span", {}, el("i", { style: `background:${col}` }), `${i} ${n}`)),
    el("span", {}, el("i", { className: "gap" }), "ожидание"), el("span", {}, el("i", { className: "ghost" }), "призрак эталона ★"));
  if (!rows.length) { box.replaceChildren(head, el("div", { className: "trp-empty", textContent: "Нечего сравнивать: добавь варианты пути на вкладке «Путь»." })); return; }
  const sorted = [...rows];
  const by = { price: x => x.st.allPriced ? x.st.price : Infinity, time: x => x.st.bad ? Infinity : x.st.mins, arrive: x => x.st.end || Infinity };
  if (by[cmpState.sort]) sorted.sort((a, b) => by[cmpState.sort](a) - by[cmpState.sort](b));
  const valid = rows.filter(x => x.st.steps.length);
  const calStart = Math.min(...valid.map(x => x.st.start)), calEnd = Math.max(...valid.map(x => x.st.end));
  const span = (cmpState.axis === "start" ? Math.max(...valid.map(x => x.st.mins)) : calEnd - calStart) * 1.04 || 60;
  const origin = x => cmpState.axis === "start" ? x.st.start : calStart;
  const tz = base?.route.steps[0]?.tzd ?? 3;
  const grid = ticks(valid, cmpState.axis, span, cmpState.axis === "start" ? 0 : calStart, tz);
  const pct = n => (n / span * 100).toFixed(3) + "%";
  const axis = el("div", { className: "cmp-row cmp-axis" }, el("div"), el("div", { className: "cmp-lane" }, ...grid.map(([m, label]) =>
    el("span", { className: "cmp-tick", style: `left:${pct(m)}`, textContent: label }))));
  const bars = (x, ghost) => {
    const out = [];
    x.st.steps.forEach((s, i) => {
      const [icon, name, col] = MODES[s.step.mode] || MODES.other;
      const bar = el("div", { className: "cmp-bar" + (ghost ? " ghost" : ""), style: `left:${pct(s.d - origin(x))};width:${pct(s.mins)};--c:${col}`,
        title: `${icon} ${name}: ${stepLine(s.step)} · ${fmtLocal(s.step.dep)} → ${fmtLocal(s.step.arr)} · ${fmtDur(s.mins)}` + (s.step.price != null ? " · " + fmtMoney(s.step.price, t.cur) : "") });
      if (!ghost) bar.append(el("span", { className: "no-i18n", textContent: icon }));
      out.push(bar);
      const g = x.st.gaps[i];
      if (g && g.mins !== 0) out.push(el("div", { className: "cmp-wait" + (ghost ? " ghost" : "") + (g.bad ? " bad" : g.tight ? " tight" : ""),
        style: `left:${pct((g.bad ? g.to.d : s.a) - origin(x))};width:${pct(Math.abs(g.mins))}`, title: g.bad ? "не стыкуется: " + fmtDur(g.mins) : "ожидание " + fmtDur(g.mins) }));
    });
    return out;
  };
  const rowNode = x => {
    const r = x.route, st = x.st;
    const info = el("div", { className: "cmp-info" },
      el("div", { className: "cmp-name no-i18n", textContent: r.name }),
      el("div", { className: "cmp-badges" }, ...[inPath(t, r) && chip("🧳 в поездке", "good"), x.isBase && chip("★ эталон"), x.fastest && chip("⚡", "good"), x.cheapest && chip("💰", "good"),
        st.bad && chip("⚠ не стыкуется", "bad"), !st.bad && st.tight && chip("⚡ впритык", "warn")].filter(Boolean)),
      el("div", { className: "cmp-nums no-i18n", textContent: `⏱ ${st.steps.length ? fmtDur(st.mins) : "—"} · 💰 ${st.price ? fmtMoney(st.price, t.cur) + (st.allPriced ? "" : "+?") : "—"} · 🔁 ${st.transfers}` }),
      el("div", { className: "cmp-nums no-i18n", textContent: st.steps.length ? `🏁 ${fmtAxis(st.end, r.steps.at(-1).tza, true)} (${fmtZone(r.steps.at(-1).tza)})` : "" }));
    if (!x.isBase && (x.dMins !== null || x.dPrice !== null)) {
      const d = el("div", { className: "cmp-delta no-i18n" });
      if (x.dMins !== null) d.append(el("span", { className: x.dMins <= 0 ? "good" : "bad", textContent: "⏱ " + fmtDelta(x.dMins, fmtDur) }));
      if (x.dPrice !== null) d.append(el("span", { className: x.dPrice <= 0 ? "good" : "bad", textContent: "💰 " + fmtDelta(x.dPrice, n => fmtMoney(n, t.cur)) }));
      info.append(d);
    }
    const acts = el("div", { className: "cmp-acts" }, btn(x.isBase ? "★" : "☆", () => { store.set(baseKey(t), r.id); ctx.rerender(); renderCompare(); }, x.isBase ? "on" : ""));
    acts.firstChild.title = "Сделать эталоном: он просвечивает призраком на остальных дорожках";
    if (t.owner) { const used = inPath(t, r), c = btn(used ? "🧳" : "➕", () => setPath(ctx, used ? t.path.filter(x => x !== r.id) : [...t.path, r.id]), used ? "on" : ""); c.title = used ? "Убрать из поездки" : "Взять в поездку"; acts.append(c); }
    info.append(acts);
    const lane = el("div", { className: "cmp-lane" }, ...grid.map(([m]) => el("i", { className: "cmp-line", style: `left:${pct(m)}` })));
    if (!x.isBase && base?.st.steps.length) lane.append(...bars(base, true));
    lane.append(...bars(x, false));
    return el("div", { className: "cmp-row" + (x.isBase ? " base" : "") }, info, lane);
  };
  box.replaceChildren(head, legend, el("div", { className: "cmp-scroll" }, axis, el("div", { className: "cmp-rows" }, ...sorted.map(rowNode))));
}
