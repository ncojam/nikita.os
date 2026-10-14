import { GLYPH } from "../core/types.js";
import { el, fsUrl, joinPath, parentOf } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { WM, wireIframe } from "../wm.js";

/*
 * Папка-зеркало GitHub. Если в папке лежит файл github.mount, проводник показывает
 * вместо её содержимого файлы репозитория. Всё делает браузер: дерево берётся
 * из GitHub API, файлы открываются и скачиваются прямо с GitHub. Сервер не участвует.
 *
 * github.mount — либо одна строка со ссылкой:
 *     https://github.com/ncojam/cfa-engine
 *   (можно и https://github.com/owner/repo/tree/ветка/подпапка или просто owner/repo),
 * либо JSON:
 *     { "repo": "ncojam/cfa-engine", "branch": "main", "path": "editors" }
 *   branch и path — необязательны (по умолчанию основная ветка и корень репозитория).
 */
let GitHub;

/* запуск — вызывается из main.js */
export function init_remote_github() {
  GitHub = {
    MARKER: "github.mount",
    TTL: 10 * 60 * 1000,             // кеш дерева: у анонимного API лимит 60 запросов в час
    mounts: new Map(),               // локальная папка -> настройки репозитория

    parse(text) {
      text = text.trim();
      let o = {};
      if (text.startsWith("{")) {
        try { o = JSON.parse(text); } catch { throw new Error(`${this.MARKER}: это не JSON`); }
      } else o = { repo: text.split(/\s+/)[0] };
      const repo = String(o.repo || o.url || "");
      const m = repo.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+?))?)?\/?$/i)
        || repo.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (!m) throw new Error(`${this.MARKER}: не понял, какой это репозиторий («${repo || "пусто"}»)`);
      const sub = String(o.path || m[4] || "").replace(/^\/+|\/+$/g, "");
      const branch = o.branch || o.ref || m[3] || null;
      return { owner: m[1], repo: m[2], branch, ref: branch || "HEAD", sub };
    },

    async mountAt(root) {
      const r = await fetch(fsUrl(joinPath(root, this.MARKER)), { cache: "no-store" });
      if (!r.ok) throw new Error(`не прочитать ${this.MARKER}`);
      const m = { ...this.parse(await r.text()), root };
      this.mounts.set(root, m);
      return m;
    },

    // путь внутри смонтированной папки (локально его нет): ищем github.mount у родителей
    async find(path) {
      for (const [root, m] of this.mounts) {
        if (path.startsWith(root + "/")) return { m, rel: path.slice(root.length + 1) };
      }
      for (let p = parentOf(path); ; p = parentOf(p)) {
        try {
          const r = await fetch("/api/entry?path=" + encodeURIComponent(joinPath(p, this.MARKER)));
          if (r.ok && (await r.json()).exists) {
            const m = await this.mountAt(p);
            return { m, rel: path.slice(p === "/" ? 1 : p.length + 1) };
          }
        } catch {}
        if (p === "/") return null;
      }
    },

    async tree(m, force = false) {
      const key = `gh.tree:${m.owner}/${m.repo}@${m.ref}`;
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem(key)); } catch {}
      if (!force && cached && Date.now() - cached.t < this.TTL) return cached;
      try {
        const r = await fetch(`https://api.github.com/repos/${m.owner}/${m.repo}/git/trees/${encodeURIComponent(m.ref)}?recursive=1`,
          { headers: { Accept: "application/vnd.github+json" } });
        if (r.status === 403 || r.status === 429) {
          const reset = +r.headers.get("x-ratelimit-reset");
          throw new Error("лимит запросов к GitHub исчерпан (60 в час)" +
            (reset ? `, сброс в ${new Date(reset * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""));
        }
        if (r.status === 404 || r.status === 409) throw new Error("репозиторий или ветка не найдены (или репозиторий приватный)");
        if (!r.ok) throw new Error("GitHub ответил " + r.status);
        const d = await r.json();
        const data = {
          t: Date.now(), truncated: !!d.truncated,
          items: d.tree.filter(x => x.type === "blob" || x.type === "tree").map(x => [x.path, x.type === "tree" ? 1 : 0, x.size || 0]),
        };
        try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
        return data;
      } catch (e) {
        if (cached) return { ...cached, stale: e.message || "нет связи с GitHub" }; // показываем последнее известное
        throw new Error(e.message === "Failed to fetch" || e.name === "TypeError" ? "нет связи с GitHub" : e.message);
      }
    },

    async list(m, rel, force) {
      const data = await this.tree(m, force);
      const base = [m.sub, rel].filter(Boolean).join("/");
      if (base && !data.items.some(([p, d]) => d && p === base)) throw new Error(`в репозитории нет папки «${base}»`);
      const pre = base ? base + "/" : "";
      const entries = [];
      for (const [p, isDir, size] of data.items) {
        if (!p.startsWith(pre)) continue;
        const name = p.slice(pre.length);
        if (!name || name.includes("/")) continue;
        entries.push({ name, type: isDir ? "dir" : "file", size, rpath: p });
      }
      entries.sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1)
        || a.name.localeCompare(b.name, "ru", { numeric: true, sensitivity: "base" }));
      return { entries, info: data };
    },

    // один путь внутри репозитория: { type, size } или null
    async stat(m, rel) {
      const data = await this.tree(m);
      const want = [m.sub, rel].filter(Boolean).join("/");
      if (!want) return { type: "dir", size: 0 };
      const it = data.items.find(([p]) => p === want);
      return it ? { type: it[1] ? "dir" : "file", size: it[2], rpath: want } : null;
    },

    enc: p => p.split("/").map(encodeURIComponent).join("/"),
    raw(m, rpath) { return `https://raw.githubusercontent.com/${m.owner}/${m.repo}/${encodeURIComponent(m.ref)}/${this.enc(rpath)}`; },
    html(m, rpath = "", dir = false) {
      const base = `https://github.com/${m.owner}/${m.repo}`;
      return rpath ? `${base}/${dir ? "tree" : "blob"}/${encodeURIComponent(m.ref)}/${this.enc(rpath)}` : base;
    },
    label: m => `${m.owner}/${m.repo}` + (m.branch ? ` @ ${m.branch}` : "") + (m.sub ? ` / ${m.sub}` : ""),

    // открыть файл репозитория: код и текст — у нас, картинки — у нас, ROM — в эмуляторе, остальное — на GitHub
    open(meta) {
      const { m, rpath } = meta.remote, name = meta.name, raw = this.raw(m, rpath);
      const big = meta.size > 4 * 1024 * 1024;
      const textLike = /^(md|txt|c|h|cc|cpp|hpp|hh|py|js|ts|json|css|html?|sh|bat|cmake|mk|s|inc|asm|ld|toml|ya?ml|ini|cfg|xml|csv|lua|rs|go|java|kt|gitignore|gitattributes|editorconfig|tmx|tsx)$/i;
      const ext = name.includes(".") ? name.split(".").pop() : "";
      const opts = { title: name, icon: GLYPH[meta.kind] || "📄", key: "gh:" + raw };
      if (meta.kind === "rom") {
        return WM.open({ ...opts, width: 760, height: 580, render(c, w) {
          const f = el("iframe", { className: "viewer-frame", src: "/apps/gba.html?url=" + encodeURIComponent(raw), allow: "fullscreen; autoplay; gamepad" });
          c.append(f); wireIframe(f, w);
          const send = cmd => f.contentWindow?.postMessage({ type: "gba", cmd }, location.origin);
          w.onMinimize = () => send("pause"); w.onRestore = () => send("resume");
          w.onClose = () => f.contentWindow?.gbaShutdown?.();
        } });
      }
      if (meta.kind === "image" && !big) {
        return WM.open({ ...opts, width: 760, height: 520, render(c) {
          c.append(el("div", { className: "viewer-img" }, el("img", { src: raw, alt: name, crossOrigin: "anonymous" })));
        } });
      }
      if (!big && (textLike.test(ext) || !ext || ["text", "web"].includes(meta.kind))) {
        return WM.open({ ...opts, width: 720, height: 500, render: async c => {
          const pre = el("pre", { className: "viewer-text", textContent: "Загрузка с GitHub…" });
          const bar = el("div", { className: "gh-filebar" },
            el("span", { textContent: `${m.owner}/${m.repo} · ${rpath}` }),
            el("a", { href: this.html(m, rpath), target: "_blank", rel: "noopener", textContent: "Открыть на GitHub ↗" }));
          c.append(el("div", { className: "gh-file" }, bar, pre));
          try {
            const r = await fetch(raw);
            if (!r.ok) throw new Error("GitHub ответил " + r.status);
            const t = await r.text();
            pre.textContent = t.length ? t : "(пустой файл)";
          } catch (e) { pre.textContent = "Не удалось загрузить: " + e.message; }
        } });
      }
      window.open(this.html(m, rpath), "_blank", "noopener");
    },

    async download(meta) {
      const { m, rpath } = meta.remote;
      try {
        const r = await fetch(this.raw(m, rpath));
        if (!r.ok) throw new Error("GitHub ответил " + r.status);
        const url = URL.createObjectURL(await r.blob());
        const a = el("a", { href: url, download: meta.name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { notify("Не скачать: " + e.message); }
    },
  };
}

export { GitHub };
