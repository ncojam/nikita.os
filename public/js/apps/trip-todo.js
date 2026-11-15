import { el } from "../core/util.js";
import { KINDS, fmtMoney, todoStats } from "./trip-calc.js";

/* ================= поездки: чек-лист «что куплено» =================
 * Вкладка «Чек-лист»: карточки-пункты по группам (билеты, ночлег, документы, другое) с галочкой.
 * Пункт может быть привязан к перегону варианта пути или к варианту ночлега: тогда в карточке видно, куда он ведёт,
 * а в карточке пути у перегона горит «куплен / не куплен» — это одна и та же галочка.
 * «Билеты по выбранному пути» создаёт пункт на каждый перегон выбранного (✔) варианта, кому ещё не хватает.
 * Галочку и правку делает только владелец (проверяет сервер). ctx — от trip.js.
 */
let sel = null;
let editing = null;      // {key, node}

const linkLabel = (t, link) => {
  if (link?.stay) { const s = t.stays.find(x => x.id === link.stay); return s ? "🛏 " + s.name : null; }
  const r = link && t.routes.find(x => x.id === link.route), s = r?.steps.find(x => x.id === link.step);
  return s ? `🧭 ${r.name} ▸ ${s.frm} → ${s.to}` : null;
};
const linkPrice = (t, link) => t.routes.find(x => x.id === link?.route)?.steps.find(x => x.id === link.step)?.price ?? null;

function linkSelect(t, value) {
  const s = el("select", { className: "trp-select" }, el("option", { value: "", textContent: "— без привязки —" }));
  for (const r of t.routes) {
    const g = el("optgroup", { label: r.name });
    r.steps.forEach(x => g.append(el("option", { value: `r:${r.id}:${x.id}`, textContent: `${x.frm} → ${x.to}` })));
    s.append(g);
  }
  if (t.stays.length) s.append(el("optgroup", { label: "Ночлег" }, ...t.stays.map(x => el("option", { value: "s:" + x.id, textContent: x.name }))));
  s.value = value?.stay ? "s:" + value.stay : value?.step ? `r:${value.route}:${value.step}` : "";
  return s;
}
const linkOf = v => v.startsWith("s:") ? { stay: v.slice(2) } : v.startsWith("r:") ? { route: v.split(":")[1], step: v.split(":")[2] } : null;
const kindSelect = value => {
  const s = el("select", { className: "trp-select" }, ...Object.entries(KINDS).map(([k, [i, n]]) => el("option", { value: k, textContent: i + " " + n })));
  s.value = value || "ticket";
  return s;
};

export function todoTab(ctx) {
  const t = ctx.trip(), kids = [], st = todoStats(t);
  const bar = el("div", { className: "trp-bar" });
  if (t.owner) {
    bar.append(el("button", { className: "trp-btn on", textContent: "+ Пункт", onclick: () => todoForm(ctx, null) }));
    if (t.chosen) bar.append(el("button", { className: "trp-btn", textContent: "🎫 Билеты по выбранному пути", onclick: () => ctx.change("/api/trip/todo/fill", {}) }));
  }
  kids.push(bar);
  if (st.total) {
    const pct = Math.round(st.done / st.total * 100);
    kids.push(el("div", { className: "trp-progress no-i18n" },
      el("div", { className: "trp-progress-bar" }, el("i", { style: `width:${pct}%` })),
      el("div", { textContent: `Готово ${st.done} из ${st.total}` + (st.price ? ` · куплено на ${fmtMoney(st.bought, t.cur)} из ${fmtMoney(st.price, t.cur)}` : "") })));
  }
  if (editing?.key === "new") kids.push(editing.node);
  if (!t.todos.length && !editing) kids.push(el("div", { className: "trp-empty", textContent: "Пока пусто. Добавь пункты или выбери вариант пути ✔ и создай билеты кнопкой." }));
  for (const [kind, [icon, name]] of Object.entries(KINDS)) {
    const list = t.todos.filter(x => x.kind === kind);
    if (!list.length) continue;
    kids.push(el("div", { className: "trp-group no-i18n", textContent: `${icon} ${name} · ${list.filter(x => x.done).length}/${list.length}` }));
    for (const x of list) kids.push(editing?.key === x.id ? editing.node : todoNode(ctx, x));
  }
  return kids;
}

function todoNode(ctx, x) {
  const t = ctx.trip(), on = sel === x.id, label = linkLabel(t, x.link), price = linkPrice(t, x.link);
  const check = el("input", { type: "checkbox", checked: x.done, disabled: !t.owner, title: "Куплено / сделано",
    onclick: e => e.stopPropagation(), onchange: () => ctx.change("/api/trip/todo", { id: x.id, done: check.checked }) });
  const node = el("div", { className: "trp-todo" + (x.done ? " done" : "") + (on ? " on" : ""), onclick: () => { sel = on ? null : x.id; ctx.rerender(); } },
    check, el("div", { className: "trp-todo-main no-i18n" }, el("div", { className: "trp-todo-text", textContent: x.text }),
      ...(label ? [el("div", { className: "trp-todo-link", textContent: label + (price != null ? " · " + fmtMoney(price, t.cur) : "") })] : [])));
  node.dataset.item = x.id;
  if (t.owner && on) node.append(el("div", { className: "trp-actions row" },
    ...[["Изменить", () => todoForm(ctx, x)], ["Удалить", () => confirm("Удалить пункт?") && ctx.change("/api/trip/todo/delete", { id: x.id })]].map(([text, run]) =>
      el("button", { className: "trp-btn", textContent: text, onclick: e => { e.stopPropagation(); run(); } }))));
  return node;
}

function todoForm(ctx, todo) {
  const t = ctx.trip();
  const text = el("input", { type: "text", placeholder: "Что нужно сделать или купить", value: todo?.text || "", maxLength: 200, required: true });
  const kind = kindSelect(todo?.kind), link = linkSelect(t, todo?.link);
  const save = async () => {
    await ctx.change("/api/trip/todo", { id: todo?.id, text: text.value, kind: kind.value, link: linkOf(link.value) }, () => { editing = null; });
  };
  const node = el("form", { className: "trp-form", onsubmit: e => { e.preventDefault(); save(); } }, text,
    el("div", { className: "trp-row" }, kind, link),
    el("div", { className: "trp-hint", textContent: "Привязка к перегону или ночлегу связывает пункт с карточкой пути: галочка общая." }),
    el("div", { className: "trp-row" }, el("button", { className: "trp-btn on", type: "submit", textContent: "Сохранить" }),
      el("button", { className: "trp-btn", type: "button", textContent: "Отмена", onclick: () => { editing = null; ctx.rerender(); } })));
  editing = { key: todo?.id || "new", node };
  ctx.rerender();
  node.scrollIntoView({ block: "nearest" });
  text.focus();
}

export function closeTodoForm() { editing = null; sel = null; }
