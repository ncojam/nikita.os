import { el, fmtSize } from "../core/util.js";
import { WM } from "../wm.js";
import { notify } from "../ui/notify.js";

/* ================= файлообменник (только для cojam) =================
 * Папка на сервере: перетащил файлы в окно или нажал «+» (на телефоне откроется выбор файлов) —
 * они лежат на сервере и доступны с любого устройства, где ты вошёл как cojam.
 * Право проверяет СЕРВЕР (share.py); эта проверка в openShare — лишь чтобы не показывать пустое окно.
 * Файл: клик — скачать, ⋯ или долгое нажатие (≈0,5 с) / ПКМ — меню (скачать, открыть, удалить).
 */
const OWNER = "cojam";
const LONG_MS = 500;

export async function whoami() {
  try { const r = await fetch("/api/chat/me", { cache: "no-store" }); if (r.ok) return (await r.json()).nick; } catch {}
  return null;
}
export const isOwner = nick => String(nick || "").toLowerCase() === OWNER;

export async function openShare() {
  const nick = await whoami();
  if (!isOwner(nick)) {
    notify(nick ? "Файлообменник — только для " + OWNER : "Войди в чат под ником " + OWNER, 2600);
    return;
  }
  WM.open({ title: "Файлы", icon: "📤", width: 560, height: 520, key: "share", render(c) {
    const info = el("div", { className: "shr-info" });
    const list = el("div", { className: "shr-list" });
    const drop = el("div", { className: "shr-drop", textContent: "Отпусти, чтобы загрузить" });
    const input = el("input", { type: "file", multiple: true, hidden: true });
    const add = el("button", { className: "shr-add", title: "Добавить файлы", textContent: "+" });
    const root = el("div", { className: "shr" },
      el("div", { className: "shr-head" }, el("div", { className: "shr-title", textContent: "📤 Мои файлы" }), info, add),
      list, drop, input);
    c.append(root);

    const url = n => "/api/share/file/" + encodeURIComponent(n);
    const api = async (path, opt) => {
      const r = await fetch(path, { cache: "no-store", ...opt });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.status);
      return j;
    };

    async function refresh() {
      try {
        const j = await api("/api/share/list");
        info.textContent = `${j.files.length} · ${fmtSize(j.used)} из ${fmtSize(j.quota)}`;
        list.replaceChildren(...(j.files.length ? j.files.map(row) : [el("div", { className: "shr-empty", textContent: "Пока пусто. Перетащи сюда файлы или нажми «+»." })]));
      } catch (e) { list.replaceChildren(el("div", { className: "shr-empty", textContent: "⚠ " + e.message })); }
    }

    function row(f) {
      const more = el("button", { className: "shr-more", title: "Меню", textContent: "⋯" });
      const r = el("div", { className: "shr-row", tabIndex: 0 },
        el("span", { className: "shr-name", textContent: f.name, title: f.name }),
        el("span", { className: "shr-size", textContent: fmtSize(f.size) }), more);
      const download = () => { const a = el("a", { href: url(f.name), download: f.name }); document.body.append(a); a.click(); a.remove(); };
      const menu = (x, y) => showMenu(x, y, [
        ["⬇ Скачать", download],
        ["↗ Открыть в новой вкладке", () => window.open(url(f.name) + "?inline=1", "_blank", "noopener")],
        ["🗑 Удалить", async () => {
          if (!confirm(`Удалить «${f.name}»?`)) return;
          try { await api("/api/share/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name }) }); refresh(); }
          catch (e) { notify("⚠ " + e.message); }
        }],
      ]);
      r.onclick = e => { if (!more.contains(e.target) && !r._long) download(); };
      more.onclick = e => { e.stopPropagation(); const b = more.getBoundingClientRect(); menu(b.left, b.bottom); };
      r.addEventListener("contextmenu", e => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY); });
      // долгое нажатие для сенсорных экранов (iOS не шлёт contextmenu)
      let timer = null, sx = 0, sy = 0;
      r.addEventListener("touchstart", e => {
        const t = e.touches[0]; sx = t.clientX; sy = t.clientY; r._long = false;
        timer = setTimeout(() => { r._long = true; menu(sx, sy); navigator.vibrate?.(15); }, LONG_MS);
      }, { passive: true });
      r.addEventListener("touchmove", e => {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) clearTimeout(timer);
      }, { passive: true });
      for (const ev of ["touchend", "touchcancel"]) r.addEventListener(ev, () => { clearTimeout(timer); setTimeout(() => r._long = false, 50); });
      return r;
    }

    function showMenu(x, y, items) {
      document.querySelector(".shr-menu")?.remove();
      const m = el("div", { className: "shr-menu glass" }, ...items.map(([label, run]) =>
        el("button", { textContent: label, onclick: () => { m.remove(); run(); } })));
      document.body.append(m);
      m.style.left = Math.max(6, Math.min(x, innerWidth - m.offsetWidth - 6)) + "px";
      m.style.top = Math.max(6, Math.min(y, innerHeight - m.offsetHeight - 6)) + "px";
      const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("pointerdown", off, true); } };
      setTimeout(() => document.addEventListener("pointerdown", off, true));
    }

    async function upload(files) {
      files = [...files]; if (!files.length) return;
      for (const [i, f] of files.entries()) {
        await new Promise(res => {
          const x = new XMLHttpRequest(), fd = new FormData();
          fd.append("file", f, f.name);
          x.open("POST", "/api/share/upload");
          x.upload.onprogress = e => { if (e.lengthComputable) info.textContent = `⬆ ${i + 1}/${files.length} ${f.name} — ${Math.round(e.loaded / e.total * 100)} %`; };
          x.onload = () => { if (x.status >= 400) { let m = x.status; try { m = JSON.parse(x.responseText).error || m; } catch {} notify(`⚠ ${f.name}: ${m}`, 3500); } res(); };
          x.onerror = () => { notify(`⚠ ${f.name}: сеть`, 3000); res(); };
          x.send(fd);
        });
      }
      refresh();
    }

    add.onclick = () => input.click();
    input.onchange = () => { upload(input.files); input.value = ""; };
    let depth = 0;
    const hasFiles = e => e.dataTransfer?.types?.includes("Files");
    root.addEventListener("dragenter", e => { if (hasFiles(e)) { e.preventDefault(); depth++; root.classList.add("drag"); } });
    root.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
    root.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; root.classList.remove("drag"); } });
    root.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; root.classList.remove("drag"); upload(e.dataTransfer.files); });

    refresh();
  }});
}
