import { GLYPH, kindOf } from "../core/types.js";
import { baseName, el, fmtSize, joinPath, parentOf, plural } from "../core/util.js";
import { Links, openFile } from "../open.js";
import { GitHub } from "../remote/github.js";
import { makeIcon, makeSelectable } from "../ui/icons.js";
import { WM } from "../wm.js";

/* ================= проводник ================= */
// opts.select — имя файла, который выделить после загрузки (для «Открыть расположение»)
function openExplorer(path = "/home/nikita/Projects", opts = {}) {
  WM.open({
    title: baseName(path), icon: "📁", width: 760, height: 480,
    render(root, win) {
      let pendingSelect = opts.select || null;
      let cur = path, history = [], future = [];
      const bBack = el("button", { textContent: "←", title: "Назад" });
      const bFwd = el("button", { textContent: "→", title: "Вперёд" });
      const bUp = el("button", { textContent: "↑", title: "Вверх" });
      const bRefresh = el("button", { textContent: "⟳", title: "Обновить" });
      const crumbs = el("div", { className: "crumbs" });
      const grid = el("div", { className: "grid" });
      const status = el("div", { className: "statusbar" });
      const banner = el("div", { className: "gh-banner", hidden: true }); // «эта папка — зеркало GitHub»
      root.append(el("div", { className: "explorer" },
        el("div", { className: "toolbar" }, bBack, bFwd, bUp, bRefresh, crumbs), banner, grid, status));
      let remote = null, loadSeq = 0; // remote = { m, rel } когда показываем репозиторий
      let summary = "";
      const sel = makeSelectable(grid, grid, () => {
        const n = sel.selected().length;
        status.textContent = summary + (n ? ` · выбрано: ${n}` : "");
      });
      win.onKey = e => {
        if ((e.ctrlKey || e.metaKey) && e.code === "KeyA") { e.preventDefault(); sel.selectAll(); }
        else if (e.key === "Escape") sel.clear();
        else if (e.key === "Enter") { const s = sel.selected(); if (s.length === 1) s[0].open(); }
        else if (e.key === "Backspace" && cur !== "/") go(parentOf(cur));
      };

      const go = (p, push = true) => {
        if (push && p !== cur) { history.push(cur); future = []; }
        cur = p; load();
      };
      bBack.onclick = () => history.length && (future.push(cur), go(history.pop(), false));
      bFwd.onclick = () => future.length && (history.push(cur), go(future.pop(), false));
      bUp.onclick = () => cur !== "/" && go(parentOf(cur));
      bRefresh.onclick = () => load(true);
      // для контекстного меню по пустому месту
      grid.ctx = {
        path: () => cur, refresh: () => load(true), selectAll: () => sel.selectAll(),
        canUp: () => cur !== "/",
        up: () => cur !== "/" && go(parentOf(cur)),
        remote: () => remote,
      };

      function showBanner(info) {
        if (!remote) { banner.hidden = true; return; }
        const { m, rel } = remote;
        const age = info ? Math.round((Date.now() - info.t) / 60000) : 0;
        banner.hidden = false;
        banner.replaceChildren(
          el("span", { className: "gh-logo", textContent: "🐙" }),
          el("span", { className: "gh-text" },
            el("b", { textContent: "GitHub · " + GitHub.label(m) }),
            el("small", { textContent: !info ? "не удалось получить содержимое репозитория" : info.stale
              ? `⚠ ${info.stale} — показана копия от ${new Date(info.t).toLocaleString("ru-RU")}`
              : `содержимое из репозитория · обновлено ${age < 1 ? "только что" : age + " мин назад"}` +
                (info.truncated ? " · репозиторий слишком большой, показана часть" : "") })),
          el("a", { href: GitHub.html(m, [m.sub, rel].filter(Boolean).join("/"), true), target: "_blank", rel: "noopener",
            className: "gh-btn", textContent: "Открыть на GitHub ↗" }),
          el("button", { className: "gh-btn", textContent: "⟳", title: "Обновить из GitHub", onclick: () => load(true) }),
        );
      }

      async function load(force = false) {
        const seq = ++loadSeq;
        win.setTitle(baseName(cur));
        bBack.disabled = !history.length; bFwd.disabled = !future.length; bUp.disabled = cur === "/";
        crumbs.replaceChildren(el("span", { textContent: "/", onclick: () => go("/") }));
        const parts = cur.split("/").filter(Boolean);
        parts.forEach((part, i) => {
          const p = "/" + parts.slice(0, i + 1).join("/");
          if (i) crumbs.append(el("i", { textContent: "/" }));
          crumbs.append(el("span", { textContent: part, className: i === parts.length - 1 ? "cur" : "", onclick: () => go(p) }));
        });
        grid.replaceChildren(el("div", { className: "empty", textContent: "Загрузка…" }));
        try {
          // 1) локальная папка; 2) если в ней github.mount или её нет, но она внутри зеркала — репозиторий
          let entries = null, info = null;
          remote = null;
          const r = await fetch("/api/ls?path=" + encodeURIComponent(cur));
          const data = await r.json().catch(() => ({}));
          if (r.ok && data.entries.some(e => e.type === "file" && e.name === GitHub.MARKER)) {
            remote = { m: await GitHub.mountAt(cur), rel: "" };
          } else if (r.ok) {
            entries = data.entries;
          } else if (r.status === 404) {
            remote = await GitHub.find(cur);
            if (!remote) throw new Error(data.error || "Нет такой папки");
          } else throw new Error(data.error || r.statusText);
          if (remote) {
            if (seq === loadSeq) grid.replaceChildren(el("div", { className: "empty", textContent: "Загрузка с GitHub…" }));
            ({ entries, info } = await GitHub.list(remote.m, remote.rel, force));
          }
          if (seq !== loadSeq) return; // пока грузили, ушли в другую папку
          showBanner(info);
          grid.replaceChildren();
          if (!entries.length) grid.append(el("div", { className: "empty", textContent: "Папка пуста" }));
          for (const it of entries) {
            const full = joinPath(cur, it.name);
            const kind = it.type === "dir" ? "dir" : kindOf(it.name);
            const meta = { ...it, path: full, kind };
            if (remote) meta.remote = { m: remote.m, rpath: it.rpath, isDir: it.type === "dir" };
            const open = () => it.type === "dir" ? go(full) : remote ? GitHub.open(meta) : openFile(full);
            const ic = makeIcon(GLYPH[kind], it.name, open, meta);
            ic.title = it.type === "dir" ? it.name : `${it.name}\n${fmtSize(it.size)}` +
              (it.plays !== undefined ? `\n▶ ${it.plays.toLocaleString("ru-RU")} ${plural(it.plays, "прослушивание", "прослушивания", "прослушиваний")}` : "");
            if (remote) ic.classList.add("is-remote");
            meta.openNew = it.type === "dir" ? () => openExplorer(full) : null;
            grid.append(ic);
            if (kind === "link" && !remote) Links.decorate(ic, full);
          }
          const files = entries.filter(e => e.type === "file");
          summary = `${entries.length} элем. · ${fmtSize(files.reduce((s, f) => s + f.size, 0))}` + (remote ? " · GitHub" : "");
          status.textContent = summary;
          if (pendingSelect) {
            const target = sel.items().find(i => i.meta?.name === pendingSelect);
            pendingSelect = null;
            if (target) { sel.select([target]); target.scrollIntoView({ block: "nearest" }); }
          }
        } catch (err) {
          if (seq !== loadSeq) return;
          showBanner(null);
          grid.replaceChildren(el("div", { className: "error", textContent: "⚠ " + (remote ? "GitHub: " : "") + err.message }));
          summary = status.textContent = "";
        }
      }
      load();
    },
  });
}

/* ================= выбор папки ================= */
// окно с деревом папок; резолвится выбранным путём или null
function pickFolder(start = "/home/nikita", title = "Выбор папки") {
  return new Promise(resolve => {
    let done = false;
    const finish = (v, w) => { if (done) return; done = true; resolve(v); if (w) WM.close(w); };
    WM.open({ title, icon: "📂", width: 460, height: 440, render(c, w) {
      let cur = start;
      const crumbs = el("div", { className: "crumbs" });
      const list = el("div", { className: "folder-list" });
      const ok = el("button", { className: "btn primary", textContent: "Выбрать эту папку" });
      const cancel = el("button", { className: "btn", textContent: "Отмена" });
      c.append(el("div", { className: "picker" }, crumbs, list, el("div", { className: "picker-foot" }, cancel, ok)));
      ok.onclick = () => finish(cur, w);
      cancel.onclick = () => finish(null, w);
      w.onClose = () => finish(null);
      async function go(p) {
        cur = p;
        crumbs.replaceChildren(el("span", { textContent: "/", onclick: () => go("/") }));
        const parts = p.split("/").filter(Boolean);
        parts.forEach((part, i) => {
          if (i) crumbs.append(el("i", { textContent: "/" }));
          crumbs.append(el("span", { textContent: part, className: i === parts.length - 1 ? "cur" : "",
            onclick: () => go("/" + parts.slice(0, i + 1).join("/")) }));
        });
        list.replaceChildren(el("div", { className: "hint", textContent: "Загрузка…" }));
        try {
          const r = await fetch("/api/ls?path=" + encodeURIComponent(p));
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || r.statusText);
          const dirs = d.entries.filter(e => e.type === "dir");
          list.replaceChildren();
          if (p !== "/") list.append(el("button", { className: "folder-item", textContent: "⬑  ..", onclick: () => go(parentOf(p)) }));
          for (const e of dirs) list.append(el("button", { className: "folder-item", textContent: "📁  " + e.name, onclick: () => go(joinPath(p, e.name)) }));
          if (!dirs.length) list.append(el("div", { className: "hint", textContent: "Вложенных папок нет" }));
        } catch (e) {
          list.replaceChildren(el("div", { className: "hint", textContent: "⚠ " + e.message }),
            el("button", { className: "folder-item", textContent: "⬑  ..", onclick: () => go(parentOf(p)) }));
        }
      }
      go(start);
    } });
  });
}

export { openExplorer, pickFolder };
