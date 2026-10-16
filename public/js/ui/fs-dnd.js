import { VFS, filesFromDrop } from "../core/vfs.js";
import { notify } from "./notify.js";

/*
 * Перетаскивание иконок между папками (проводник, рабочий стол) и файлов с компьютера.
 * Всё через VFS — сервер не меняется, изменения видит только этот пользователь.
 */
const MIME = "application/x-nikita-paths";
let dragging = null; // { paths, from, icons }

// ufs — общие серверные папки: их нельзя двигать/переименовывать/удалять локально (только автор, через сервер)
const canTouch = meta => !!meta?.path && !meta.remote && !meta.builtin && !meta.ufs;
const isFolder = ic => ic?.meta && ic.meta.type === "dir" && canTouch(ic.meta);

/* иконки в box можно тянуть; dir() — папка, которую показывает box */
function makeIconsDraggable(box, dir) {
  box.addEventListener("dragstart", e => {
    const ic = e.target.closest?.(".icon");
    if (!ic || ic.parentElement !== box || !canTouch(ic.meta)) { e.preventDefault(); return; }
    if (!ic.classList.contains("selected")) box.sel?.select([ic]);
    const icons = (box.sel?.selected() || [ic]).filter(i => canTouch(i.meta));
    dragging = { paths: icons.map(i => i.meta.path), from: dir(), icons };
    e.dataTransfer.setData(MIME, JSON.stringify(dragging.paths));
    e.dataTransfer.effectAllowed = "move";
    icons.forEach(i => i.classList.add("dragging"));
  });
  box.addEventListener("dragend", () => {
    dragging?.icons.forEach(i => i.classList.remove("dragging"));
    dragging = null;
  });
}

/*
 * surface принимает перетаскивание.
 * opts.dir()            — папка назначения (null — сюда нельзя)
 * opts.accept(e)        — дополнительная проверка цели (false — не наше событие, отдаём выше)
 * opts.onSame(e, drag)  — иконки отпустили в той же папке (рабочий стол: перестановка)
 * opts.onDone(e, res)   — после перемещения/загрузки
 */
function makeDropTarget(surface, opts) {
  let hl = null;
  const light = ic => { if (hl === ic) return; hl?.classList.remove("drop-target"); hl = ic; hl?.classList.add("drop-target"); };
  const external = e => !dragging && [...(e.dataTransfer?.types || [])].includes("Files");

  const target = e => {
    if (opts.accept && !opts.accept(e)) return null;
    if (!dragging && !external(e)) return null;
    const ic = e.target.closest?.(".icon");
    if (isFolder(ic) && surface.contains(ic) && !dragging?.paths.some(p => ic.meta.path === p || ic.meta.path.startsWith(p + "/")))
      return { dir: ic.meta.path, folder: ic };
    const dir = opts.dir();
    return dir ? { dir, folder: null } : null;
  };

  surface.addEventListener("dragover", e => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = dragging ? "move" : "copy";
    light(t.folder);
    surface.classList.toggle("drop-here", !t.folder);
  });
  surface.addEventListener("dragleave", e => {
    if (surface.contains(e.relatedTarget)) return;
    light(null); surface.classList.remove("drop-here");
  });
  surface.addEventListener("drop", async e => {
    const t = target(e);
    light(null); surface.classList.remove("drop-here");
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const drag = dragging;
    if (drag && !t.folder && t.dir === drag.from) return opts.onSame?.(e, drag);
    if (!VFS.ready) return notify("⚠ Браузер не поддерживает пользовательские файлы (нужен HTTPS)", 3000);
    try {
      if (drag) {
        const res = await VFS.move(drag.paths, t.dir);
        opts.onDone?.(e, res, drag);
      } else {
        const pending = filesFromDrop(e.dataTransfer); // читать dataTransfer нужно синхронно — до любого await
        notify("Загрузка…", 900);
        const items = await pending;
        if (!items.length) return;
        const res = await VFS.upload(t.dir, items);
        notify(`Загружено: ${items.length} · видно только вам`);
        opts.onDone?.(e, res, null);
      }
    } catch (err) {
      notify("⚠ " + err.message, 3000);
    }
  });
}

/* Delete / F2 для выделенных иконок */
async function deleteIcons(icons) {
  const metas = icons.map(i => i.meta).filter(canTouch);
  if (!metas.length) return;
  const what = metas.length === 1 ? `«${metas[0].name}»` : `${metas.length} элем.`;
  if (!confirm(`Удалить ${what}?\n\nСервер не меняется: файлы просто пропадут у вас. Вернуть всё можно через «Сбросить мои изменения».`)) return;
  try { await VFS.remove(metas.map(m => m.path)); } catch (e) { notify("⚠ " + e.message, 3000); }
}

async function renameIcon(ic) {
  const m = ic?.meta;
  if (!canTouch(m)) return;
  const name = prompt("Новое имя:", m.name);
  if (name === null || name.trim() === m.name) return;
  try { await VFS.rename(m.path, name.trim()); } catch (e) { notify("⚠ " + e.message, 3000); }
}

async function newFolder(dir) {
  const name = prompt("Имя папки:", "Новая папка");
  if (name === null) return null;
  try { return (await VFS.mkdir(dir, name.trim() || "Новая папка")).created; } catch (e) { notify("⚠ " + e.message, 3000); return null; }
}

function pickAndUpload(dir) {
  const inp = Object.assign(document.createElement("input"), { type: "file", multiple: true });
  inp.onchange = async () => {
    const files = [...inp.files];
    if (!files.length) return;
    try {
      await VFS.upload(dir, files.map(f => ({ file: f, path: f.name })));
      notify(`Загружено: ${files.length} · видно только вам`);
    } catch (e) { notify("⚠ " + e.message, 3000); }
  };
  inp.click();
}

export { makeIconsDraggable, makeDropTarget, deleteIcons, renameIcon, newFolder, pickAndUpload, canTouch };
