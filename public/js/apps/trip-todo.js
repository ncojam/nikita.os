import { el } from "../core/util.js";
import { KINDS, MODES, fmtLocal, fmtMoney, pathSteps, todoStats } from "./trip-calc.js";

/* ================= поездки: чек-лист «что куплено» =================
 * Вкладка «Чек-лист»: карточки-пункты по группам (билеты, ночлег, документы, другое) с галочкой.
 * Билеты — не пункты, а сами перегоны собранной поездки (вкладка «Путь»): у каждого своя галочка `bought`,
 * та же, что в карточке пути. Купил самолёт, а поезд ещё нет — так и видно.
 * Свой пункт можно привязать к варианту ночлега.
 * Галочку и правку делает только владелец (проверяет сервер). ctx — от trip.js.
 */
let sel = null;
let editing = null;      // {key, node}

const linkLabel = (t, link) => {
  const s = link?.stay && t.stays.find(x => x.id === link.stay);
  return s ? "🛏 " + s.name : null;
};

function linkSelect(t, value) {
  const s = el("select", { className: "trp-select" }, el("option", { value: "", textContent: "— без привязки —" }));
  if (t.stays.length) s.append(el("optgroup", { label: "Ночлег" }, ...t.stays.map(x => el("option", { value: "s:" + x.id, textContent: x.name }))));
  s.value = value?.stay ? "s:" + value.stay : "";
  return s;
}
const linkOf = v => v.startsWith("s:") ? { stay: v.slice(2) } : null;
const kindSelect = value => {
  const s = el("select", { className: "trp-select" }, ...Object.entries(KINDS).map(([k, [i, n]]) => el("option", { value: k, textContent: i + " " + n })));
  s.value = value || "ticket";
  return s;
};

export function todoTab(ctx) {
  const t = ctx.trip(), kids = [], st = todoStats(t);
  const bar = el("div", { className: "trp-bar" });
  if (t.owner) bar.append(el("button", { className: "trp-btn on", textContent: "+ Пункт", onclick: () => todoForm(ctx, null) }));
  kids.push(bar);
  if (st.total) {
    const pct = Math.round(st.done / st.total * 100);
    kids.push(el("div", { className: "trp-progress no-i18n" },
      el("div", { className: "trp-progress-bar" }, el("i", { style: `width:${pct}%` })),
      el("div", { textContent: `Готово ${st.done} из ${st.total}` + (st.price ? ` · куплено на ${fmtMoney(st.bought, t.cur)} из ${fmtMoney(st.price, t.cur)}` : "") })));
  }
  if (editing?.key === "new") kids.push(editing.node);
  kids.push(...ticketsNodes(ctx));
  if (!t.todos.length && !editing && !pathSteps(t).length) kids.push(el("div", { className: "trp-empty", textContent: "Пока пусто. Собери поездку на вкладке «Путь» — билеты появятся здесь сами." }));
  for (const [kind, [icon, name]] of Object.entries(KINDS)) {
    const list = t.todos.filter(x => x.kind === kind);
    if (!list.length) continue;
    kids.push(el("div", { className: "trp-group no-i18n", textContent: `${icon} ${name} · ${list.filter(x => x.done).length}/${list.length}` }));
    for (const x of list) kids.push(editing?.key === x.id ? editing.node : todoNode(ctx, x));
  }
  return kids;
}

// билет = перегон собранной поездки; галочка — флаг перегона
function ticketsNodes(ctx) {
  const t = ctx.trip(), list = pathSteps(t);
  if (!list.length) return [];
  const out = [el("div", { className: "trp-group no-i18n", textContent: `🎫 Билеты по поездке · ${list.filter(x => x.step.bought).length}/${list.length}` })];
  for (const { route, step: s } of list) {
    const check = el("input", { type: "checkbox", checked: !!s.bought, disabled: !t.owner, title: "Билет куплен",
      onchange: () => ctx.change("/api/trip/step/bought", { route: route.id, step: s.id, done: check.checked }) });
    const [icon] = MODES[s.mode] || MODES.other;
    out.push(el("label", { className: "trp-todo" + (s.bought ? " done" : "") }, check,
      el("div", { className: "trp-todo-main no-i18n" },
        el("div", { className: "trp-todo-text", textContent: `${icon} ${s.frm} → ${s.to}` + (s.num ? " · " + s.num : "") }),
        el("div", { className: "trp-todo-link", textContent: `${fmtLocal(s.dep)}` + (s.price != null ? " · " + fmtMoney(s.price, t.cur) : "") + ` · ${route.name}` }))));
  }
  return out;
}

function todoNode(ctx, x) {
  const t = ctx.trip(), on = sel === x.id, label = linkLabel(t, x.link);
  const check = el("input", { type: "checkbox", checked: x.done, disabled: !t.owner, title: "Куплено / сделано",
    onclick: e => e.stopPropagation(), onchange: () => ctx.change("/api/trip/todo", { id: x.id, done: check.checked }) });
  const node = el("div", { className: "trp-todo" + (x.done ? " done" : "") + (on ? " on" : ""), onclick: () => { sel = on ? null : x.id; ctx.rerender(); } },
    check, el("div", { className: "trp-todo-main no-i18n" }, el("div", { className: "trp-todo-text", textContent: x.text }),
      ...(label ? [el("div", { className: "trp-todo-link", textContent: label })] : [])));
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
    el("div", { className: "trp-hint", textContent: "Билеты на перегоны поездки отмечаются сами — здесь всё остальное: документы, страховка, ночлег." }),
    el("div", { className: "trp-row" }, el("button", { className: "trp-btn on", type: "submit", textContent: "Сохранить" }),
      el("button", { className: "trp-btn", type: "button", textContent: "Отмена", onclick: () => { editing = null; ctx.rerender(); } })));
  editing = { key: todo?.id || "new", node };
  ctx.rerender();
  node.scrollIntoView({ block: "nearest" });
  text.focus();
}

export function closeTodoForm() { editing = null; sel = null; }
