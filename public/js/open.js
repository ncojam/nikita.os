import { openExplorer } from "./apps/explorer.js";
import { Player } from "./apps/player.js";
import { openSettings } from "./apps/settings.js";
import { openChat } from "./apps/chat.js";
import { openFakeDL } from "./apps/fakedl.js";
import { openPost } from "./apps/post.js";
import { openAirHockey } from "./apps/airhockey.js";
import { openBrowser } from "./apps/browser.js";
import { GLYPH, kindOf } from "./core/types.js";
import { baseName, el, fsUrl } from "./core/util.js";
import { GitHub } from "./remote/github.js";
import { setGlyph } from "./ui/icons.js";
import { notify } from "./ui/notify.js";
import { WM, wireIframe } from "./wm.js";

/* ================= открытие файлов ================= */
function openFile(path, link = null) {
  const name = baseName(path), kind = kindOf(name), url = fsUrl(path);
  // ярлык может задать заголовок, иконку и размер окна
  const opts = { title: link?.name || name, icon: link?.icon || GLYPH[kind], key: "file:" + path };

  if (kind === "link") return Links.open(path);
  if (kind === "post") return openPost(path);
  if (kind === "audio") return Player.open(path);
  if (kind === "video") return WM.open({ ...opts, width: 800, height: 500, render(c, w) {
    const v = el("video", { src: url, controls: true, autoplay: true });
    c.append(el("div", { className: "viewer-media" }, v));
    w.onClose = () => v.pause();
  }});
  if (kind === "image") return WM.open({ ...opts, width: 760, height: 520, render(c) {
    c.append(el("div", { className: "viewer-img" }, el("img", { src: url, alt: name })));
  }});
  if (kind === "web") return WM.open({ ...opts, width: link?.width || 960, height: link?.height || 640, render(c, w) {
    // index.html игры открывается в iframe — соседние файлы (js, assets) подтянутся по относительным путям
    const f = el("iframe", { className: "viewer-frame", src: url, allow: "fullscreen; autoplay; gamepad" });
    c.append(f);
    wireIframe(f, w);
  }});
  if (kind === "rom") return WM.open({ ...opts, width: 760, height: 580, render(c, w) {
    const f = el("iframe", { className: "viewer-frame", src: "/apps/gba.html?rom=" + encodeURIComponent(path),
      allow: "fullscreen; autoplay; gamepad" });
    c.append(f);
    wireIframe(f, w);
    const send = cmd => f.contentWindow?.postMessage({ type: "gba", cmd }, location.origin);
    w.onMinimize = () => send("pause");
    w.onRestore = () => send("resume");
    w.onClose = () => f.contentWindow?.gbaShutdown?.(); // успеть сохраниться до закрытия
  }});
  if (kind === "flash") return WM.open({ ...opts, width: link?.width || 820, height: link?.height || 640, render(c, w) {
    const f = el("iframe", { className: "viewer-frame",
      src: "/apps/flash.html?swf=" + encodeURIComponent(url),
      allow: "fullscreen; autoplay; gamepad" });
    c.append(f);
    wireIframe(f, w);   // фокус клавиатуры уходит в игру
    const send = cmd => f.contentWindow?.postMessage({ type: "flash", cmd }, location.origin);
    w.onMinimize = () => send("pause");
    w.onRestore  = () => send("resume");
    // при закрытии iframe удаляется вместе с окном, Ruffle умрёт сам
  }});
  if (kind === "text") return WM.open({ ...opts, width: 680, height: 460, async render(c) {
    const pre = el("pre", { className: "viewer-text", textContent: "Загрузка…" });
    c.append(pre);
    try {
      const r = await fetch(url);
      const t = await r.text();
      pre.textContent = t.length ? t : "(пустой файл)";
    } catch (e) { pre.textContent = "Ошибка: " + e.message; }
  }});
  return WM.open({ ...opts, width: 420, height: 240, render(c) {
    const a = el("a", { href: url, download: name, textContent: "Скачать " + name });
    c.append(el("div", { className: "viewer-other" }, el("p", { textContent: "Нет приложения для этого файла." }), a));
  }});
}

function openAbout() {
  WM.open({ title: "О системе", icon: "ℹ️", width: 440, height: 400, key: "about", render(c) {
    c.innerHTML = `<div class="about"><h2>nikita.os</h2>
      <p>Музыка, игры и прочие проекты.</p>
      <p style="color:var(--muted)">Двойной клик — открыть, правый клик — меню действий. Окна можно таскать, сворачивать, разворачивать (двойной клик по заголовку) и растягивать за правый нижний угол.</p>
      <p style="color:var(--muted)">Рабочий стол — это папка <code>/home/nikita/Desktop</code>: что положишь туда, то и будет на рабочем столе.</p>
      <p style="color:var(--muted)">Сайт написан на чистом JS без фреймворков, бэкенд — Python.
        GBA — mGBA (WASM), Flash — <a href="https://ruffle.rs" target="_blank" rel="noopener">Ruffle</a>.</p>
      <p>Built with Claude Opus 5.5 ·
        <a href="https://github.com/ncojam/nikita.os" target="_blank" rel="noopener">исходники на GitHub ↗</a></p>
    </div>`;
  }});
}

/* ================= рабочий стол ================= */
/*
 * Ярлык .lnk — JSON-файл:
 *   { "name": "Graveblood", "icon": "🕹️" | "/путь/к/картинке.png",
 *     "open": "/путь/в/fs" | "app": "settings|about|explorer|chat" (+ "path") | "url": "https://..." }
 */
const APPS = {
  settings: () => openSettings(),
  about: () => openAbout(),
  chat: () => openChat(),
  explorer: l => openExplorer(l.path || "/home/nikita"),
  fakedl: l => openFakeDL(l),
  airhockey: () => openAirHockey(),
  browser: l => openBrowser(l.path),
};

const Links = {
  async read(path) {
    const r = await fetch(fsUrl(path), { cache: "no-store" });
    if (!r.ok) throw new Error("ярлык не найден");
    return r.json();
  },
  // что ярлык делает — для «Свойств»
  describe(l) {
    if (l.open) return l.open;
    if (l.app) return "приложение: " + l.app;
    if (l.url) return l.url;
    return "—";
  },
  async run(l) {
    if (l.open) return openPath(l.open, l);
    if (l.app) {
      if (APPS[l.app]) return APPS[l.app](l);
      return notify(`Нет приложения «${l.app}»`);
    }
    if (l.url) return void window.open(l.url, "_blank", "noopener");
    notify("Ярлык пустой: нужно поле open, app или url");
  },
  async open(path) {
    try { await this.run(await this.read(path)); }
    catch (e) { notify("Не открыть ярлык: " + e.message); }
  },
  // в проводнике показываем иконку и имя из ярлыка
  async decorate(ic, path) {
    try {
      const l = await this.read(path);
      ic.meta.link = l;
      if (l.icon) setGlyph(ic.querySelector(".glyph"), l.icon);
      if (l.name) ic.querySelector(".label").textContent = l.name;
      ic.classList.add("is-link");
      ic.title = `${l.name || baseName(path)}\n→ ${this.describe(l)}`;
    } catch {}
  },
};

// открыть путь из fs: папку — в проводнике, файл — своим приложением
async function openPath(p, link = null) {
  // (эндпоинт специально не называется /api/stat — такие адреса режут блокировщики рекламы)
  let st = null;
  try {
    const r = await fetch("/api/entry?path=" + encodeURIComponent(p));
    if (r.ok) st = await r.json();
  } catch (e) { console.warn("api/entry:", e); }
  if (st && !st.exists) {
    // может, это путь внутри папки-зеркала GitHub
    const f = await GitHub.find(p).catch(() => null);
    const rs = f && await GitHub.stat(f.m, f.rel).catch(() => null);
    if (!rs) return notify("Не найдено: " + p);
    if (rs.type === "dir") return openExplorer(p);
    const name = baseName(p);
    return GitHub.open({ name, path: p, type: "file", size: rs.size, kind: kindOf(name),
      remote: { m: f.m, rpath: rs.rpath, isDir: false } });
  }
  // сервер не ответил — угадываем по расширению: есть расширение — файл, нет — папка
  const isDir = st ? st.type === "dir" : !/\.[^/.]+$/.test(baseName(p));
  isDir ? openExplorer(p) : openFile(p, link);
}

export { openFile, openAbout, Links, openPath };
