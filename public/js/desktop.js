import { openExplorer } from "./apps/explorer.js";
import { GLYPH, kindOf } from "./core/types.js";
import { $, joinPath } from "./core/util.js";
import { Links, openFile } from "./open.js";
import { makeIcon, makeSelectable } from "./ui/icons.js";
import { WM } from "./wm.js";

/* Рабочий стол = содержимое папки DESKTOP (ярлыки, файлы, папки) */
const DESKTOP = "/home/nikita/Desktop";

const FALLBACK_DESKTOP = [
  { name: "nikita", icon: "🏠", open: "/home/nikita" },
  { name: "Projects", icon: "📁", open: "/home/nikita/Projects" },
  { name: "Настройки", icon: "⚙️", app: "settings" },
];

const Desktop = {
  sig: "",
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
  });
}

export { DESKTOP, Desktop };
