import { el } from "../core/util.js";

/* ================= Грид — шаблон выбора из многих вариантов =================
 * Как «список», только в двух измерениях: слева направо — категории (колонки), вниз от каждой — элементы-квадратики.
 * Используется везде, где выбирать приходится из длинного перечня: цели автоматизации, пресеты синтов…
 *
 *   grid({ columns, onPick, value, search, empty }) → узел
 *     columns: [{ title, color?, items: [{ value, label, sub?, icon?, color?, title? }] }]
 *     onPick(item, column) — клик по квадратику
 *     value — выбранное значение (подсвечивается)
 *     search — показать поиск сверху (по умолчанию да, если элементов больше 12)
 *
 *   pickGrid({ anchor, title, columns, value }) → Promise<item | null>
 *     то же самое во всплывающем окошке рядом с anchor; Esc или клик мимо — null.
 *
 * Колонки без элементов не рисуются. Поиск фильтрует по подписи, подзаголовку и названию колонки.
 */
export function grid({ columns, onPick, value = null, search, empty = "Пусто" }) {
  const total = columns.reduce((n, c) => n + c.items.length, 0);
  const box = el("div", { className: "ngrid" });
  const cols = el("div", { className: "ngrid-cols" });
  const q = el("input", { className: "ngrid-q", type: "search", placeholder: "Поиск…", spellcheck: false });
  if (search ?? total > 12) box.append(q);
  box.append(cols);

  function draw() {
    const needle = q.value.trim().toLowerCase();
    const hit = (it, c) => !needle || [it.label, it.sub, c.title].some(s => String(s || "").toLowerCase().includes(needle));
    const list = columns.map(c => ({ c, items: c.items.filter(it => hit(it, c)) })).filter(x => x.items.length);
    if (!list.length) { cols.replaceChildren(el("div", { className: "ngrid-empty", textContent: needle ? "Ничего не нашлось" : empty })); return; }
    cols.replaceChildren(...list.map(({ c, items }) => {
      const col = el("div", { className: "ngrid-col" },
        el("div", { className: "ngrid-head", textContent: c.title, title: c.title }),
        ...items.map(it => {
          const cell = el("button", { className: "ngrid-cell" + (value != null && String(it.value) === String(value) ? " on" : ""),
            title: it.title || [it.label, it.sub].filter(Boolean).join("\n"), onclick: () => onPick?.(it, c) },
            it.icon ? el("span", { className: "ngrid-ic", textContent: it.icon }) : "",
            el("span", { className: "ngrid-label", textContent: it.label }),
            it.sub ? el("span", { className: "ngrid-sub", textContent: it.sub }) : "");
          const col2 = it.color || c.color;
          if (col2) cell.style.setProperty("--gc", col2);
          return cell;
        }));
      if (c.color) col.style.setProperty("--gc", c.color);
      return col;
    }));
  }
  q.oninput = draw;
  q.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter") cols.querySelector(".ngrid-cell")?.click(); };
  draw();
  box.focusSearch = () => q.isConnected && q.focus();
  return box;
}

/* грид во всплывающем окошке */
let open = null;
export function pickGrid({ anchor, title = "", columns, value, empty }) {
  open?.(null);
  return new Promise(resolve => {
    const pop = el("div", { className: "ngrid-pop glass" });
    const done = v => {
      if (open !== done) return;
      open = null;
      removeEventListener("pointerdown", away, true); removeEventListener("keydown", esc, true);
      pop.remove();
      resolve(v);
    };
    open = done;
    const g = grid({ columns, value, empty, onPick: it => done(it) });
    pop.append(el("div", { className: "ngrid-pop-head" }, el("b", { textContent: title }),
      el("button", { className: "ngrid-x", textContent: "✕", title: "Закрыть", onclick: () => done(null) })), g);
    document.body.append(pop);
    // рядом с кнопкой, но в пределах экрана
    const r = anchor?.getBoundingClientRect?.() || { left: innerWidth / 2 - 300, bottom: 120, top: 120 };
    const W = Math.min(innerWidth - 20, Math.max(320, columns.filter(c => c.items.length).length * 172 + 24)), H = Math.min(innerHeight - 20, 460);
    pop.style.width = W + "px"; pop.style.maxHeight = H + "px";
    pop.style.left = Math.max(10, Math.min(r.left, innerWidth - W - 10)) + "px";
    const below = r.bottom + 6 + H < innerHeight;
    pop.style.top = (below ? r.bottom + 6 : Math.max(10, r.top - 6 - Math.min(H, pop.offsetHeight))) + "px";
    const away = e => { if (!pop.contains(e.target)) done(null); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } };
    setTimeout(() => { addEventListener("pointerdown", away, true); addEventListener("keydown", esc, true); });
    g.focusSearch();
  });
}

/* кнопка, которая открывает грид: как <select>, но с квадратиками */
export function gridButton({ label, title = "", columns, value, onPick, className = "dw-btn" }) {
  const b = el("button", { className, textContent: label, title });
  b.onclick = async e => {
    e.stopPropagation();
    const it = await pickGrid({ anchor: b, title: title || label, columns: typeof columns === "function" ? columns() : columns, value });
    if (it) onPick(it);
  };
  return b;
}
