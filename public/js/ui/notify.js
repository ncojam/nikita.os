import { D, EASE } from "../core/anim.js";
import { GLYPH, KIND_NAME } from "../core/types.js";
import { $, baseName, el, fmtSize, fsUrl, parentOf } from "../core/util.js";
import { Links } from "../open.js";
import { GitHub } from "../remote/github.js";
import { setGlyph } from "./icons.js";
import { WM } from "../wm.js";

/* ================= уведомления ================= */
function notify(text, ms = 1800) {
  let box = $("#notify");
  if (!box) { box = el("div", { id: "notify" }); document.body.append(box); }
  const n = el("div", { className: "note glass", textContent: text });
  box.append(n);
  n.animate([{ opacity: 0, transform: "translateY(10px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: D(200), easing: EASE });
  setTimeout(() => {
    const a = n.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(6px)" }], { duration: D(200), easing: EASE, fill: "forwards" });
    a.finished.then(() => n.remove(), () => n.remove());
  }, ms);
}

async function copyText(text, what = "Скопировано") {
  try { await navigator.clipboard.writeText(text); }
  catch { // http без TLS: clipboard API недоступен — старый способ
    const ta = el("textarea", { value: text });
    Object.assign(ta.style, { position: "fixed", opacity: 0, left: "-9999px" });
    document.body.append(ta); ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
  }
  notify(what);
}

function download(path) {
  const a = el("a", { href: fsUrl(path), download: baseName(path) });
  document.body.append(a); a.click(); a.remove();
}

/* ================= свойства файла ================= */
function openProperties(meta) {
  const kind = meta.kind || "other";
  const rows = [
    ["Имя", meta.link?.name || meta.name],
    ["Тип", KIND_NAME[kind] || "Файл"],
  ];
  if (meta.path) rows.push(["Расположение", parentOf(meta.path)], ["Путь", meta.path]);
  if (meta.link) rows.push(["Ведёт на", Links.describe(meta.link)]);
  if (meta.remote) {
    const { m, rpath } = meta.remote;
    rows.push(["Источник", `GitHub: ${m.owner}/${m.repo}`], ["Ветка", m.branch || "основная"], ["В репозитории", rpath]);
  }
  if (meta.type === "file" && meta.size !== undefined) rows.push(["Размер", `${fmtSize(meta.size)} (${meta.size.toLocaleString(globalThis.NOS_LOCALE)} байт)`]);
  if (meta.mtime) rows.push(["Изменён", new Date(meta.mtime * 1000).toLocaleString(globalThis.NOS_LOCALE)]);
  if (meta.plays !== undefined) rows.push(["Прослушивания", meta.plays.toLocaleString(globalThis.NOS_LOCALE)]);
  if (meta.remote) rows.push(["Ссылка", GitHub.html(meta.remote.m, meta.remote.rpath, meta.remote.isDir)]);
  WM.open({ title: "Свойства: " + (meta.link?.name || meta.name), icon: "ℹ️", width: 440, height: 320,
    key: "props:" + (meta.path || meta.name), render(c) {
      const dl = el("dl", { className: "props" });
      for (const [k, v] of rows) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v ?? "—" }));
      const head = el("div", { className: "props-head" });
      const g = el("div", { className: "glyph" });
      setGlyph(g, meta.link?.icon || GLYPH[kind]);
      head.append(g, el("div", { className: "props-name", textContent: meta.link?.name || meta.name }));
      c.append(el("div", { className: "props-wrap" }, head, dl));
    } });
}

export { notify, copyText, download, openProperties };
