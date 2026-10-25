import { D, EASE, REDUCED } from "../core/anim.js";
import { baseName, el, fsUrl, parentOf } from "../core/util.js";
import { DESKTOP, Desktop } from "../desktop.js";
import { openAbout, openPath } from "../open.js";
import { createPost, openExplorer, openSettings, reportPostByPath } from "../apps/lazy.js";
import { createServerFolder, deleteServerFolder, deleteServerProject } from "../remote/userfolders.js";
import { GitHub } from "../remote/github.js";
import { VFS } from "../core/vfs.js";
import { canTouch, deleteIcons, newFolder, pickAndUpload, renameIcon } from "./fs-dnd.js";
import { copyText, download, notify, openProperties } from "./notify.js";
import { fsBtn } from "./taskbar.js";
import { WM } from "../wm.js";

/* ================= контекстное меню ================= */
const Ctx = {
  node: null,
  show(x, y, items) {
    this.hide(true);
    const m = el("div", { className: "ctx glass", role: "menu" });
    for (const it of items) {
      if (!it) continue;
      if (it === "-") { if (m.lastChild && !m.lastChild.classList.contains("sep")) m.append(el("div", { className: "sep" })); continue; }
      const b = el("button", { className: "ctx-item" + (it.bold ? " bold" : ""), disabled: !!it.disabled, role: "menuitem" },
        el("span", { className: "ci", textContent: it.icon || "" }),
        el("span", { className: "cl", textContent: it.label }),
        el("span", { className: "ck", textContent: it.hint || "" }));
      b.onclick = () => { this.hide(); it.run?.(); };
      m.append(b);
    }
    if (m.lastChild?.classList.contains("sep")) m.lastChild.remove();
    if (!m.children.length) return;
    document.body.append(m);
    // не вылезаем за экран
    const w = m.offsetWidth, h = m.offsetHeight;
    const left = x + w > innerWidth - 6 ? Math.max(6, x - w) : x;
    const top = y + h > innerHeight - 6 ? Math.max(6, y - h) : y;
    Object.assign(m.style, { left: left + "px", top: top + "px",
      transformOrigin: `${left < x ? "right" : "left"} ${top < y ? "bottom" : "top"}` });
    m.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: D(140), easing: EASE });
    this.node = m;
    m.querySelector(".ctx-item:not(:disabled)")?.focus({ preventScroll: true });
  },
  hide(instant = false) {
    const m = this.node;
    if (!m) return;
    this.node = null;
    if (instant || REDUCED) return m.remove();
    m.style.pointerEvents = "none";
    m.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(.97)" }], { duration: 100, easing: EASE, fill: "forwards" })
      .finished.then(() => m.remove(), () => m.remove());
  },
};

// меню для файлов из папки-зеркала GitHub
const remoteMenu = (icons, metas) => {
  const one = metas.length === 1 ? metas[0] : null;
  const files = metas.filter(m => m.type === "file");
  const ghLinks = metas.map(x => GitHub.html(x.remote.m, x.remote.rpath, x.remote.isDir));
  return [
    { label: icons.length > 1 ? `Открыть (${icons.length})` : "Открыть", icon: "↗", bold: true, hint: "Enter",
      run: () => icons.slice(0, 12).forEach(i => i.open()) },
    one?.openNew && { label: "Открыть в новом окне", icon: "⧉", run: one.openNew },
    { label: "Открыть на GitHub", icon: "🐙", run: () => ghLinks.slice(0, 8).forEach(u => window.open(u, "_blank", "noopener")) },
    "-",
    files.length && { label: files.length > 1 ? `Скачать (${files.length})` : "Скачать", icon: "⬇",
      run: () => files.forEach((x, k) => setTimeout(() => GitHub.download(x), k * 400)) },
    { label: "Копировать ссылку на GitHub", icon: "🔗", run: () => copyText(ghLinks.join("\n"), "Ссылка скопирована") },
    files.length && { label: "Копировать прямую ссылку (raw)", icon: "⎘",
      run: () => copyText(files.map(x => GitHub.raw(x.remote.m, x.remote.rpath)).join("\n"), "Ссылка скопирована") },
    { label: "Копировать путь", icon: "⎘", run: () => copyText(metas.map(x => x.path).join("\n"), "Путь скопирован") },
    "-",
    one && { label: "Свойства", icon: "ℹ", run: () => openProperties(one) },
  ];
};

const fileMenu = icons => {
  const metas = icons.map(i => i.meta).filter(Boolean);
  if (metas.length && metas.every(m => m.remote)) return remoteMenu(icons, metas);
  const one = metas.length === 1 ? metas[0] : null;
  const files = metas.filter(m => m.type === "file" && m.path);
  const paths = metas.filter(m => m.path).map(m => m.path);
  const target = one?.link?.open; // куда ведёт ярлык
  const editable = VFS.ready && metas.length && metas.every(canTouch);
  return [
    { label: icons.length > 1 ? `Открыть (${icons.length})` : "Открыть", icon: "↗", bold: true, hint: "Enter",
      run: () => icons.slice(0, 12).forEach(i => i.open()) },
    one?.openNew && { label: "Открыть в новом окне", icon: "⧉", run: one.openNew },
    target && { label: "Открыть расположение", icon: "📂", run: () => openExplorer(parentOf(target), { select: baseName(target) }) },
    one?.kind === "rom" && { label: "Играть", icon: "🕹️", run: () => icons[0].open() },
    one?.kind === "flash" && { label: "Играть", icon: "⚡", run: () => icons[0].open() },
    one?.kind === "post" && one.path && { label: "Пожаловаться (NSFW)", icon: "🚩", run: () => reportPostByPath(one.path) },
    one?.ufs && one.type === "dir" && { label: "Удалить папку (общая)", icon: "🗑", run: () => deleteServerFolder(one.path, one.name) },
    one?.ufs && one.type === "file" && /\.dawn$/i.test(one.name || "") && { label: "Удалить мой проект (с сервера)", icon: "🗑", run: () => deleteServerProject(one.path, one.name) },
    "-",
    files.length && { label: files.length > 1 ? `Скачать (${files.length})` : "Скачать", icon: "⬇",
      run: () => files.forEach((m, k) => setTimeout(() => download(m.path), k * 300)) },
    target && /\.[^/.]+$/.test(target) && { label: "Скачать файл ярлыка", icon: "⬇", run: () => download(target) },
    paths.length && { label: paths.length > 1 ? "Копировать пути" : "Копировать путь", icon: "⎘",
      run: () => copyText(paths.join("\n"), paths.length > 1 ? "Пути скопированы" : "Путь скопирован") },
    files.length && { label: files.length > 1 ? "Копировать ссылки" : "Копировать ссылку", icon: "🔗",
      run: () => copyText(files.map(m => location.origin + fsUrl(m.path)).join("\n"), "Ссылка скопирована") },
    "-",
    editable && one && { label: "Переименовать", icon: "✎", hint: "F2", run: () => renameIcon(icons[0]) },
    editable && { label: "Удалить", icon: "🗑", hint: "Del", run: () => deleteIcons(icons) },
    "-",
    one && { label: "Свойства", icon: "ℹ", run: () => openProperties(one) },
  ];
};

async function resetUserFs() {
  const u = await VFS.usage();
  if (!u.changes) return notify("Изменений нет — всё как на сервере");
  if (!confirm(`Сбросить все ваши изменения файлов (${u.changes}), включая загруженные файлы (${u.files})?\nПапки и файлы вернутся как на сервере.`)) return;
  await VFS.reset();
  notify("Файловая система сброшена");
}

const windowMenu = w => [
  w.minimized
    ? { label: "Восстановить", icon: "▢", run: () => WM.restore(w) }
    : { label: "Свернуть", icon: "—", run: () => WM.minimize(w) },
  { label: w.maximized ? "Обычный размер" : "Развернуть", icon: "⛶",
    run: () => { if (w.minimized) WM.restore(w); WM.setMax(w, !w.maximized); } },
  "-",
  { label: "Закрыть", icon: "✕", run: () => WM.close(w) },
];

const fsLabel = () => document.fullscreenElement ? "Выйти из полного экрана" : "Полный экран";

/* запуск — вызывается из main.js */
export function init_ui_context_menu() {
  document.addEventListener("pointerdown", e => { if (Ctx.node && !Ctx.node.contains(e.target)) Ctx.hide(); }, true);

  addEventListener("blur", () => Ctx.hide());

  addEventListener("resize", () => Ctx.hide(true));

  document.addEventListener("wheel", e => { if (Ctx.node && !Ctx.node.contains(e.target)) Ctx.hide(); }, { passive: true });

  document.addEventListener("keydown", e => {
    if (!Ctx.node) return;
    const btns = [...Ctx.node.querySelectorAll(".ctx-item:not(:disabled)")];
    const i = btns.indexOf(document.activeElement);
    if (e.key === "Escape") { Ctx.hide(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === "ArrowDown") { btns[(i + 1) % btns.length]?.focus(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { btns[(i - 1 + btns.length) % btns.length]?.focus(); e.preventDefault(); }
    e.stopPropagation(); // пока меню открыто, клавиши не уходят окнам (Enter нажмёт пункт меню)
  }, true);

  document.addEventListener("contextmenu", e => {
    const t = e.target;
    if (e.defaultPrevented) return;   // приложение само обрабатывает правую кнопку (DAWN, игры)
    // родное меню браузера там, где оно полезно: поля ввода, ссылки, выделенный текст
    if (t.closest("input, textarea, a[href]")) return;
    const s = getSelection();
    if (s && !s.isCollapsed && s.containsNode(t, true)) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;

    const ic = t.closest(".icon");
    if (ic) {
      const box = ic.parentElement;
      if (!ic.classList.contains("selected")) box.sel?.select([ic]);
      const icons = box.sel ? box.sel.selected() : [ic];
      return Ctx.show(x, y, fileMenu(icons.length ? icons : [ic]));
    }
    const task = t.closest(".task");
    if (task) {
      const w = [...WM.wins.values()].find(w => w.task === task);
      return w && Ctx.show(x, y, windowMenu(w));
    }
    const winNode = t.closest(".window");
    if (winNode) {
      const w = [...WM.wins.values()].find(w => w.node === winNode);
      const grid = t.closest(".grid");
      if (grid?.ctx) {
        const g = grid.ctx, rm = g.remote();
        return Ctx.show(x, y, [
          { label: rm ? "Обновить из GitHub" : "Обновить", icon: "⟳", run: g.refresh },
          rm && { label: "Открыть эту папку на GitHub", icon: "🐙",
            run: () => window.open(GitHub.html(rm.m, [rm.m.sub, rm.rel].filter(Boolean).join("/"), true), "_blank", "noopener") },
          { label: "Выделить всё", icon: "▦", hint: "Ctrl+A", run: g.selectAll },
          { label: "Вверх", icon: "↑", hint: "Backspace", disabled: !g.canUp(), run: g.up },
          "-",
          g.canEdit?.() && { label: "Новая папка (у меня)", icon: "📁", run: g.mkdir },
          !rm && { label: "Новая папка (общая)", icon: "🌐", run: () => createServerFolder(g.path()) },
          g.canEdit?.() && { label: "Загрузить файлы…", icon: "⤒", run: g.upload },
          !rm && { label: "Создать запись", icon: "📝", run: () => createPost(g.path(), g.refresh) },
          "-",
          { label: "Копировать путь папки", icon: "⎘", run: () => copyText(g.path(), "Путь скопирован") },
          { label: "Открыть в новом окне", icon: "⧉", run: () => openExplorer(g.path()) },
        ]);
      }
      return w && Ctx.show(x, y, windowMenu(w));
    }
    if (t.closest("#taskbar")) {
      return Ctx.show(x, y, [
        { label: "Разложить окна", icon: "▦", run: () => WM.arrange() },
        { label: "Показать рабочий стол", icon: "▭", run: () => [...WM.wins.values()].forEach(w => WM.minimize(w)) },
        { label: fsLabel(), icon: "⛶", run: () => fsBtn.click() },
      ]);
    }
    if (t.closest("#start-menu")) return;
    // рабочий стол
    Ctx.show(x, y, [
      { label: "Обновить", icon: "⟳", run: () => Desktop.load(true) },
      VFS.ready && { label: "Новая папка (у меня)", icon: "📁", run: async () => {
        const p = await newFolder(DESKTOP);
        if (p) Desktop.putAt([baseName(p)], ...Desktop.cellAt(x, y));
      } },
      { label: "Новая папка (общая)", icon: "🌐", run: () => createServerFolder(DESKTOP) },
      VFS.ready && { label: "Загрузить файлы…", icon: "⤒", run: () => pickAndUpload(DESKTOP) },
      { label: "Создать запись", icon: "📝", run: () => createPost(DESKTOP, () => Desktop.load(true)) },
      { label: "Упорядочить значки", icon: "▦", run: () => { Desktop.pos = {}; Desktop.savePos(); Desktop.layout(); } },
      "-",
      { label: "Открыть папку рабочего стола", icon: "📂", run: () => openPath(DESKTOP) },
      { label: "Сменить фон…", icon: "🖼", run: () => openSettings() },
      VFS.ready && { label: "Сбросить мои изменения файлов…", icon: "↺", run: resetUserFs },
      "-",
      { label: fsLabel(), icon: "⛶", run: () => fsBtn.click() },
      { label: "О системе", icon: "ℹ", run: () => openAbout() },
    ]);
  });
}
