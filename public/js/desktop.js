import { openExplorer } from "./apps/explorer.js";
import { GLYPH, kindOf } from "./core/types.js";
import { $, joinPath, store } from "./core/util.js";
import { VFS } from "./core/vfs.js";
import { deleteIcons, makeDropTarget, makeIconsDraggable, renameIcon } from "./ui/fs-dnd.js";
import { Links, openFile } from "./open.js";
import { makeIcon, makeSelectable } from "./ui/icons.js";
import { WM } from "./wm.js";

/* Рабочий стол = содержимое папки DESKTOP (ярлыки, файлы, папки) */
const DESKTOP = "/home/nikita/Desktop";

const FALLBACK_DESKTOP = [
  { name: "nikita", icon: "🏠", open: "/home/nikita" },
  { name: "Projects", icon: "📁", open: "/home/nikita/Projects" },
  { name: "Настройки", icon: "⚙️", app: "settings" },
  { name: "Чат", icon: "💬", app: "chat" },
];

/* Раскладка: иконки стоят в ячейках сетки, позиции хранятся у пользователя в браузере (по имени) */
const CELL_W = 98, CELL_H = 108, POS_KEY = "desk.pos";

const Desktop = {
  sig: "",
  pos: store.get(POS_KEY, {}),
  savePos() { store.set(POS_KEY, this.pos); },
  rows() { return Math.max(1, Math.floor($("#icons").clientHeight / CELL_H)); },
  // ячейка под точкой экрана
  cellAt(x, y) {
    const r = $("#icons").getBoundingClientRect();
    return [Math.max(0, Math.floor((x - r.left) / CELL_W)), Math.min(this.rows() - 1, Math.max(0, Math.floor((y - r.top) / CELL_H)))];
  },
  layout() {
    const box = $("#icons"), rows = this.rows();
    const icons = [...box.children].filter(i => i.classList.contains("icon"));
    const busy = new Set(), key = (c, r) => c + ":" + r;
    const place = (ic, c, r) => { busy.add(key(c, r)); ic.style.left = c * CELL_W + "px"; ic.style.top = r * CELL_H + "px"; };
    const rest = [];
    for (const ic of icons) {
      const p = this.pos[ic.meta?.name];
      if (p && p[1] < rows && !busy.has(key(p[0], p[1]))) place(ic, p[0], p[1]); else rest.push(ic);
    }
    // забываем позиции иконок, которых больше нет на столе, и те, что заняли чужую ячейку
    const names = new Set(icons.map(i => i.meta?.name));
    let dirty = false;
    for (const n of Object.keys(this.pos)) if (!names.has(n)) { delete this.pos[n]; dirty = true; }
    for (const ic of rest) if (this.pos[ic.meta?.name]) { delete this.pos[ic.meta.name]; dirty = true; }
    if (dirty && icons.length) this.savePos();
    let i = 0;
    for (const ic of rest) {
      while (busy.has(key(Math.floor(i / rows), i % rows))) i++;
      place(ic, Math.floor(i / rows), i % rows);
    }
  },
  // поставить иконки с именами names в ячейку (c, r) и следующие свободные за ней
  putAt(names, c, r) {
    const rows = this.rows();
    const taken = new Set([...$("#icons").children]
      .filter(i => i.classList.contains("icon") && !names.includes(i.meta?.name))
      .map(i => Math.round(parseFloat(i.style.left) / CELL_W) + ":" + Math.round(parseFloat(i.style.top) / CELL_H)));
    let i = c * rows + r;
    for (const n of names) {
      while (taken.has(Math.floor(i / rows) + ":" + (i % rows))) i++;
      this.pos[n] = [Math.floor(i / rows), i % rows];
      taken.add(this.pos[n].join(":"));
      i++;
    }
    this.savePos();
    this.layout();
  },
  async load(force = false) {
    const box = $("#icons");
    let entries = null;
    try {
      const r = await fetch("/api/ls?path=" + encodeURIComponent(DESKTOP), { cache: "no-store" });
      if (r.ok) entries = (await r.json()).entries;
    } catch {}
    // перерисовываем, только если в папке что-то поменялось
    const sig = JSON.stringify(entries);
    if (!force && sig === this.sig) return;
    this.sig = sig;

    if (!entries) { // папки нет — встроенный набор
      box.replaceChildren(...FALLBACK_DESKTOP.map(l =>
        makeIcon(l.icon, l.name, () => Links.run(l), { name: l.name, kind: "link", type: "file", link: l, builtin: true })));
      this.layout();
      return;
    }
    const icons = await Promise.all(entries.map(async it => {
      const full = joinPath(DESKTOP, it.name);
      const kind = it.type === "dir" ? "dir" : kindOf(it.name);
      const meta = { ...it, path: full, kind };
      if (kind === "link") {
        let l = {};
        try { l = await Links.read(full); } catch {}
        meta.link = l;
        const ic = makeIcon(l.icon || GLYPH.link, l.name || it.name.replace(/\.lnk$/i, ""), () => Links.run(l), meta);
        ic.title = `${l.name || it.name}\n→ ${Links.describe(l)}`;
        return ic;
      }
      return makeIcon(GLYPH[kind], it.name, () => it.type === "dir" ? openExplorer(full) : openFile(full), meta);
    }));
    box.replaceChildren(...icons);
    this.layout();
  },
};

let deskSel;

/* запуск — вызывается из main.js */
export function init_desktop() {
  Desktop.load();

  // вернулся на вкладку — подтягиваем изменения в папке рабочего стола
  addEventListener("focus", () => Desktop.load());

  document.addEventListener("visibilitychange", () => { if (!document.hidden) Desktop.load(); });

  deskSel = makeSelectable($("#desktop"), $("#icons"));

  // перестановка иконок и перенос файлов на рабочий стол (из проводника и с компьютера)
  const outsideWindows = e => !e.target.closest?.(".window, #taskbar, #start-menu");
  makeIconsDraggable($("#icons"), () => DESKTOP);
  makeDropTarget($("#desktop"), {
    dir: () => DESKTOP,
    accept: outsideWindows,
    onSame: (e, drag) => Desktop.putAt(drag.icons.map(i => i.meta.name), ...Desktop.cellAt(e.clientX, e.clientY)),
    onDone: (e, res, drag) => {
      if (!res) return;
      const dst = drag ? res.moved : res.created;
      const here = (dst || []).filter(p => p.startsWith(DESKTOP + "/") && !p.slice(DESKTOP.length + 1).includes("/"));
      if (here.length) Desktop.putAt(here.map(p => p.slice(DESKTOP.length + 1)), ...Desktop.cellAt(e.clientX, e.clientY));
    },
  });
  VFS.onChange(info => { if (info?.reset) Desktop.pos = {}; Desktop.load(true); });
  addEventListener("resize", () => Desktop.layout());

  // клик по пустому рабочему столу снимает фокус с окон — горячие клавиши идут рабочему столу
  $("#desktop").addEventListener("pointerdown", e => {
    if (e.target.closest(".window")) return;
    WM.focused = null;
    for (const w of WM.wins.values()) { w.node.classList.add("inactive"); w.task.classList.remove("active"); }
  });

  document.addEventListener("keydown", e => {
    if (WM.focused || e.target.closest("input, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") { e.preventDefault(); deskSel.selectAll(); }
    else if (e.key === "Escape") deskSel.clear();
    else if (e.key === "Enter") deskSel.selected().forEach(i => i.open());
    else if (e.key === "Delete") deleteIcons(deskSel.selected());
    else if (e.key === "F2") { e.preventDefault(); const s = deskSel.selected(); if (s.length === 1) renameIcon(s[0]); }
  });
}

export { DESKTOP, Desktop };
