import { notify } from "../ui/notify.js";

/* ================= общие (серверные) папки =================
 * Папки в /ufs: видят все, живут на сервере. Правила (лимиты, кто удаляет) — на сервере,
 * клиент только зовёт эндпоинты и обновляет вид. Локальные папки — отдельно, через VFS.
 */
const changed = dir => window.dispatchEvent(new CustomEvent("nos-posts-changed", { detail: { dir } }));
const parentOf = p => p.replace(/\/[^/]+$/, "") || "/";

async function createServerFolder(parent) {
  const name = prompt("Название общей папки (её увидят все):");
  if (name === null) return;
  if (!name.trim()) return notify("Пустое имя");
  const r = await fetch("/api/folders", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent, name: name.trim() }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return notify(d.error || "Не вышло создать папку");
  notify("Общая папка создана");
  changed(parent);
}

async function deleteServerFolder(path, name) {
  if (!confirm(`Удалить общую папку «${name || path}»?\n\nНавсегда и для всех — вместе со всем, что внутри (включая чужие записи).`)) return;
  const r = await fetch("/api/folders/delete", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return notify(d.error || "Не вышло удалить");
  notify("Папка удалена");
  changed(parentOf(path));
}

/* свой проект DAWN, сохранённый на сервер (удалить может только автор — проверяет сервер) */
async function deleteServerProject(path, name) {
  if (!confirm(`Удалить проект «${name || path}» с сервера?\n\nОн пропадёт у всех.`)) return false;
  const r = await fetch("/api/dawn/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { notify(d.error || "Не вышло удалить"); return false; }
  notify("Проект удалён");
  changed(parentOf(path));
  return true;
}

export { createServerFolder, deleteServerFolder, deleteServerProject };
