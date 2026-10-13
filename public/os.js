"use strict";

/* ================= утилиты ================= */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const joinPath = (a, b) => (a.replace(/\/+$/, "") + "/" + b).replace(/\/+/g, "/");
const parentOf = p => p.replace(/\/[^/]+\/?$/, "") || "/";
const baseName = p => p.split("/").filter(Boolean).pop() || "/";
const fsUrl = p => "/fs" + p.split("/").map(encodeURIComponent).join("/");
const fmtSize = n => n < 1024 ? n + " Б" : n < 1048576 ? (n / 1024).toFixed(1) + " КБ"
  : n < 1073741824 ? (n / 1048576).toFixed(1) + " МБ" : (n / 1073741824).toFixed(2) + " ГБ";
const fmtTime = s => {
  if (!isFinite(s)) return "0:00";
  s = Math.floor(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
const px = r => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const EXT = {
  audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  video: ["mp4", "webm", "mkv", "mov"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
  text: ["txt", "md", "py", "js", "json", "css", "sh", "toml", "yaml", "yml", "ini", "cfg", "log", "c", "h", "cpp", "rs", "lua", ""],
  web: ["html", "htm"],
  rom: ["gba", "gb", "gbc"],
  link: ["lnk"],
};
const kindOf = name => {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  for (const [k, list] of Object.entries(EXT)) if (list.includes(ext)) return k;
  return "other";
};
const GLYPH = { dir: "📁", audio: "🎵", video: "🎬", image: "🖼️", text: "📄", web: "🎮", rom: "🕹️", link: "🔗", other: "📦" };
const KIND_NAME = { dir: "Папка", audio: "Аудио", video: "Видео", image: "Изображение", text: "Текст",
  web: "Веб-страница / игра", rom: "ROM (GBA / GB)", link: "Ярлык", other: "Файл" };

/* ================= анимации ================= */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const D = ms => (REDUCED ? 0 : ms);

/* ================= оконный менеджер ================= */
const WM = {
  z: 10,
  wins: new Map(),
  seq: 0,
  origin: null, // откуда «вылетает» следующее окно (иконка, по которой кликнули)

  maxRect() {
    return { left: 8, top: 8, width: innerWidth - 16, height: innerHeight - 8 - 64 - 10 };
  },

  /* ---------- прилипание и раскладка ---------- */
  cfg: {
    snap: store.get("wm.snap", true),     // прилипать к краям и соседним окнам
    gap: store.get("wm.gap", 0),          // расстояние, которое держат окна друг от друга и от краёв
    margin: store.get("wm.margin", 24),   // поля экрана при раскладке «по сетке»
  },
  SNAP: 7, // на каком расстоянии начинает «притягивать», px
  setCfg(k, v) {
    const old = this.cfg[k];
    this.cfg[k] = v; store.set("wm." + k, v);
    // меняем расстояние/поля — окна перестраиваются сразу
    if (k === "gap" && old !== v) this.respace(+old || 0);
    if (k === "margin" && old !== v && this.arrangedValid()) this.arrange();
  },

  // окна всё ещё стоят так, как их разложила кнопка «Разложить»?
  arranged: null,
  arrangedValid() {
    const vis = [...this.wins.values()].filter(w => !w.minimized && !w.closing);
    return !!this.arranged && vis.length === this.arranged.size && vis.every(w => this.arranged.has(w));
  },
  breakArrange() { this.arranged = null; },

  // пересчитать зазоры: всё, что было «приклеено» на старом расстоянии, переклеиваем на новое
  respace(oldG) {
    if (this.arrangedValid()) return this.arrange();
    const g = +this.cfg.gap || 0, A = this.area(), T = 1.5;
    const list = [...this.wins.values()].filter(w => !w.minimized && !w.closing && !w.maximized);
    const old = new Map(list.map(w => [w, this.rectOf(w)]));
    const nr = new Map(list.map(w => [w, { ...old.get(w) }]));
    const near = (a, b) => Math.abs(a - b) <= T;
    const axis = (lo, hi, crossLo, crossHi, aLo, aHi) => {
      // по одной оси: идём от начала экрана к концу, чтобы цепочки окон сдвигались по очереди
      for (const w of [...list].sort((a, b) => old.get(a)[lo] - old.get(b)[lo])) {
        const r = old.get(w), n = nr.get(w), size = r[hi] - r[lo];
        let start = null;
        if (near(r[lo], aLo + oldG)) start = aLo + g;
        else for (const o of list) {
          const ro = old.get(o);
          if (o !== w && near(r[lo], ro[hi] + oldG) && r[crossLo] < ro[crossHi] && r[crossHi] > ro[crossLo]) {
            start = nr.get(o)[hi] + g; break;
          }
        }
        const endGlued = near(r[hi], aHi - oldG);
        if (start !== null) {
          n[lo] = start;
          n[hi] = endGlued ? aHi - g : start + size; // прижато к обоим краям — меняем размер
        } else if (endGlued) {
          n[hi] = aHi - g; n[lo] = n[hi] - size;
        }
      }
    };
    axis("left", "right", "top", "bottom", A.left, A.right);
    axis("top", "bottom", "left", "right", A.top, A.bottom);
    for (const w of list) {
      const a = old.get(w), b = nr.get(w);
      if (a.left !== b.left || a.top !== b.top || a.right !== b.right || a.bottom !== b.bottom) {
        this.moveTo(w, { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top });
      }
    }
  },

  // рабочая область: весь экран над панелью задач
  area() {
    const tb = $("#taskbar").getBoundingClientRect();
    return { left: 0, top: 0, right: innerWidth, bottom: Math.min(innerHeight, tb.top) };
  },
  rectOf(w) {
    const n = w.node;
    return { left: n.offsetLeft, top: n.offsetTop, right: n.offsetLeft + n.offsetWidth, bottom: n.offsetTop + n.offsetHeight };
  },
  others(w) {
    return [...this.wins.values()].filter(o => o !== w && !o.minimized && !o.closing).map(o => this.rectOf(o));
  },

  // перетаскивание: x, y — куда хочет встать окно размером W×H
  snapMove(w, x, y, W, H) {
    if (!this.cfg.snap) return { x, y };
    const g = +this.cfg.gap || 0, T = this.SNAP, A = this.area();
    let bx = x, dx = T + 0.5, by = y, dy = T + 0.5;
    const tx = c => { const d = Math.abs(c - x); if (d < dx) { dx = d; bx = c; } };
    const ty = c => { const d = Math.abs(c - y); if (d < dy) { dy = d; by = c; } };
    tx(A.left + g); tx(A.right - g - W);
    ty(A.top + g); ty(A.bottom - g - H);
    for (const o of this.others(w)) {
      // соседи по горизонтали: перекрываются по вертикали (с запасом)
      const vNear = y < o.bottom + g + T && y + H > o.top - g - T;
      const hNear = x < o.right + g + T && x + W > o.left - g - T;
      if (vNear) { tx(o.right + g); tx(o.left - g - W); }
      if (hNear) { ty(o.bottom + g); ty(o.top - g - H); }
      // выравнивание краёв, когда окна стоят друг под другом / рядом
      const vGap = Math.max(o.top - (y + H), y - o.bottom);
      const hGap = Math.max(o.left - (x + W), x - o.right);
      if (hNear && vGap <= g + T * 3) { tx(o.left); tx(o.right - W); }
      if (vNear && hGap <= g + T * 3) { ty(o.top); ty(o.bottom - H); }
    }
    return { x: bx, y: by };
  },

  // растягивание за правый нижний угол: R, B — куда хотят встать правый и нижний края
  snapResize(w, x, y, R, B) {
    if (!this.cfg.snap) return { R, B };
    const g = +this.cfg.gap || 0, T = this.SNAP, A = this.area();
    let br = R, dr = T + 0.5, bb = B, db = T + 0.5;
    const tr = c => { const d = Math.abs(c - R); if (d < dr) { dr = d; br = c; } };
    const tb = c => { const d = Math.abs(c - B); if (d < db) { db = d; bb = c; } };
    tr(A.right - g); tb(A.bottom - g);
    for (const o of this.others(w)) {
      const vNear = y < o.bottom + g + T && B > o.top - g - T;
      const hNear = x < o.right + g + T && R > o.left - g - T;
      if (vNear && o.left >= x) tr(o.left - g);
      if (hNear && o.top >= y) tb(o.top - g);
      if (hNear) tr(o.right);   // выровнять правые края
      if (vNear) tb(o.bottom);  // выровнять нижние края
    }
    return { R: br, B: bb };
  },

  // плавно переставить окно в прямоугольник
  moveTo(w, r) {
    const n = w.node;
    w.anim?.cancel();
    w.maximized = false;
    n.classList.remove("maximized");
    if (!REDUCED) {
      n.classList.add("tween");
      clearTimeout(w.tweenT);
      w.tweenT = setTimeout(() => n.classList.remove("tween"), 360);
    }
    Object.assign(n.style, px(r));
  },

  // разложить открытые окна по сетке
  arrange() {
    const list = [...this.wins.values()].filter(w => !w.minimized && !w.closing);
    if (!list.length) return notify("Нет открытых окон");
    const g = +this.cfg.gap || 0, m = +this.cfg.margin || 0, A = this.area();
    const L = A.left + m, T = A.top + m, aw = A.right - m - L, ah = A.bottom - m - T;
    const n = list.length;
    // подбираем число колонок: ячейки поближе к пропорции ~3:2 и покрупнее
    let best = { score: -1, c: 1, r: n };
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      if (c * (r - 1) >= n) continue; // пустой последний ряд
      const cw = (aw - (c - 1) * g) / c, ch = (ah - (r - 1) * g) / r;
      const score = Math.min(cw / 1.5, ch);
      if (score > best.score) best = { score, c, r };
    }
    const { c, r } = best;
    // порядок: как окна стоят сейчас — сверху вниз, слева направо (меньше «прыжков»)
    list.sort((a, b) => {
      const ra = this.rectOf(a), rb = this.rectOf(b);
      return Math.round(ra.top / 120) - Math.round(rb.top / 120) || ra.left - rb.left;
    });
    const ch = (ah - (r - 1) * g) / r;
    list.forEach((w, i) => {
      const row = Math.floor(i / c), inRow = row === r - 1 ? n - c * (r - 1) : c;
      const col = i - row * c;
      const cw = (aw - (inRow - 1) * g) / inRow; // последний ряд растягиваем на всю ширину
      this.moveTo(w, {
        left: Math.round(L + col * (cw + g)), top: Math.round(T + row * (ch + g)),
        width: Math.round(cw), height: Math.round(ch),
      });
    });
    this.arranged = new Set(list); // запоминаем раскладку — изменения зазора/полей перестроят её
    const t = this.topmost(); if (t) this.focus(t);
  },

  // transform, который визуально кладёт окно поверх прямоугольника rect
  zoomTo(node, rect) {
    const r = node.getBoundingClientRect();
    const s = Math.max(0.04, Math.min(rect.width / r.width, rect.height / r.height));
    const dx = rect.left + rect.width / 2 - (r.left + r.width / 2);
    const dy = rect.top + rect.height / 2 - (r.top + r.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  },

  anim(w, frames, dur) {
    w.anim?.cancel();
    w.anim = null;
    if (!dur) return Promise.resolve(true);
    const a = w.anim = w.node.animate(frames, { duration: dur, easing: EASE });
    return a.finished.then(() => { if (w.anim === a) w.anim = null; return true; }, () => false);
  },

  open({ title, icon = "🪟", width = 720, height = 460, render, key }) {
    if (key) {
      for (const w of this.wins.values()) if (w.key === key) { this.restore(w); return w; }
    }
    const id = ++this.seq;
    const vw = innerWidth, vh = innerHeight - 70;
    width = Math.min(width, vw - 20);
    height = Math.min(height, vh - 20);
    const off = (this.wins.size % 8) * 28;
    const left = Math.max(10, (vw - width) / 2 - 100 + off);
    const top = Math.max(10, (vh - height) / 2 - 60 + off);

    const titleEl = el("div", { className: "title", textContent: title });
    const btn = (cls, svg, tip) => {
      const b = el("button", { className: cls, title: tip });
      b.innerHTML = `<svg viewBox="0 0 24 24">${svg}</svg>`;
      return b;
    };
    const bMin = btn("min", '<path d="M5 12h14"/>', "Свернуть");
    const bMax = btn("max", '<rect x="5" y="5" width="14" height="14" rx="3"/>', "Развернуть");
    const bClose = btn("close", '<path d="M6 6l12 12M18 6L6 18"/>', "Закрыть");
    const iconEl = el("span", { textContent: icon });
    const titlebar = el("div", { className: "titlebar" },
      iconEl, titleEl, el("div", { className: "controls" }, bMin, bMax, bClose));
    const content = el("div", { className: "content" });
    const resize = el("div", { className: "resize" });
    const node = el("div", { className: "window glass" }, titlebar, content, resize);
    Object.assign(node.style, px({ left, top, width, height }));

    const task = el("button", { className: "task", title },
      el("span", { textContent: icon }), el("span", { textContent: title }));

    const w = {
      id, key, node, content, task, minimized: false, maximized: false,
      // хуки для приложений: onClose (может вернуть Promise), onFocus, onMinimize, onRestore, onKey
      onClose: null, onFocus: null, onMinimize: null, onRestore: null, onKey: null,
      setTitle(t) { titleEl.textContent = t; task.title = t; task.lastChild.textContent = t; },
    };
    this.wins.set(id, w);
    $("#windows").append(node);
    $("#task-list").append(task);

    node.addEventListener("pointerdown", () => this.focus(w));
    bClose.onclick = e => { e.stopPropagation(); this.close(w); };
    bMin.onclick = e => { e.stopPropagation(); this.minimize(w); };
    bMax.onclick = e => { e.stopPropagation(); this.setMax(w, !w.maximized); };
    titlebar.ondblclick = e => { if (!e.target.closest("button")) this.setMax(w, !w.maximized); };
    task.onclick = () => {
      if (w.minimized) this.restore(w);
      else if (node.classList.contains("inactive")) this.focus(w);
      else this.minimize(w);
    };

    this.makeDraggable(w, titlebar);
    this.makeResizable(w, resize);
    render?.(content, w);
    this.focus(w);

    // появление: из иконки, если окно открыли кликом по ней, иначе — лёгкий zoom
    const o = this.origin;
    this.origin = null;
    const from = o && performance.now() - o.t < 600 ? this.zoomTo(node, o.rect) : "translateY(14px) scale(.94)";
    this.anim(w, [{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }], D(300));
    return w;
  },

  focus(w) {
    const was = this.focused;
    this.focused = w;
    if (was !== w) w.onFocus?.();
    w.node.style.zIndex = ++this.z;
    for (const o of this.wins.values()) {
      const active = o === w;
      o.node.classList.toggle("inactive", !active);
      o.task.classList.toggle("active", active && !o.minimized);
    }
  },
  topmost() {
    let best = null;
    for (const w of this.wins.values())
      if (!w.minimized && (!best || +w.node.style.zIndex > +best.node.style.zIndex)) best = w;
    return best;
  },

  async minimize(w) {
    if (w.minimized) return;
    w.anim?.cancel();
    w.minimized = true;
    w.task.classList.add("min");
    w.task.classList.remove("active");
    w.node.style.pointerEvents = "none";
    w.onMinimize?.();
    if (this.focused === w) this.focused = null;
    const to = this.zoomTo(w.node, w.task.getBoundingClientRect());
    const t = this.topmost(); if (t) this.focus(t);
    await this.anim(w, [
      { transform: "none", opacity: 1 },
      { transform: to, opacity: 0 },
    ], D(320));
    if (w.minimized) w.node.classList.add("minimized");
    w.node.style.pointerEvents = "";
  },

  restore(w) {
    this.origin = null;
    if (!w.minimized) return this.focus(w);
    w.anim?.cancel();
    w.minimized = false;
    w.node.classList.remove("minimized");
    w.task.classList.remove("min");
    w.onRestore?.();
    this.focus(w);
    const from = this.zoomTo(w.node, w.task.getBoundingClientRect());
    this.anim(w, [
      { transform: from, opacity: 0 },
      { transform: "none", opacity: 1 },
    ], D(340));
  },

  async close(w) {
    if (w.closing) return;
    w.closing = true;
    // приложение может попросить время на завершение (например, эмулятор сохраняется)
    const cleanup = Promise.race([
      Promise.resolve().then(() => w.onClose?.()).catch(e => console.warn("onClose:", e)),
      new Promise(r => setTimeout(r, 2000)),
    ]);
    w.task.remove();
    this.wins.delete(w.id);
    if (this.focused === w) this.focused = null;
    const t = this.topmost(); if (t) this.focus(t);
    w.node.style.pointerEvents = "none";
    await Promise.all([cleanup, this.anim(w, [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "translateY(10px) scale(.94)" },
    ], D(200))]);
    w.node.remove();
  },

  // плавный разворот: анимируем left/top/width/height через CSS-transition
  setMax(w, on, savedRect) {
    if (on === w.maximized) return;
    const n = w.node;
    this.breakArrange();
    w.anim?.cancel();
    if (on) w.restoreRect = savedRect || { left: n.offsetLeft, top: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight };
    w.maximized = on;
    if (!REDUCED) {
      n.classList.add("tween");
      clearTimeout(w.tweenT);
      w.tweenT = setTimeout(() => n.classList.remove("tween"), 360);
    }
    n.classList.toggle("maximized", on);
    Object.assign(n.style, px(on ? this.maxRect() : w.restoreRect));
  },

  makeDraggable(w, handle) {
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const n = w.node;
      let start = { left: n.offsetLeft, top: n.offsetTop, width: n.offsetWidth, height: n.offsetHeight };
      if (w.maximized) {
        // «отрываем» развёрнутое окно, как в настоящих ОС
        const ratio = e.clientX / innerWidth;
        const r = w.restoreRect;
        w.maximized = false;
        n.classList.remove("maximized", "tween");
        start = { ...r, left: e.clientX - r.width * ratio, top: Math.max(0, e.clientY - 20) };
        Object.assign(n.style, px(start));
      }
      const sx = e.clientX - n.offsetLeft, sy = e.clientY - n.offsetTop;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        this.breakArrange(); // окно сдвинули руками — раскладка больше не «сетка»
        const x = Math.min(Math.max(ev.clientX - sx, -n.offsetWidth + 80), innerWidth - 80);
        const y = Math.min(Math.max(ev.clientY - sy, 0), innerHeight - 60);
        // прилипание (Alt — двигать свободно)
        const s = ev.altKey ? { x, y } : this.snapMove(w, x, y, n.offsetWidth, n.offsetHeight);
        n.style.left = s.x + "px"; n.style.top = s.y + "px";
      };
      const up = ev => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        if (ev.clientY <= 2) this.setMax(w, true, start); // утащил к верху — развернуть
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  },

  makeResizable(w, handle) {
    handle.addEventListener("pointerdown", e => {
      e.stopPropagation();
      const n = w.node;
      this.breakArrange();
      w.maximized = false;
      n.classList.remove("maximized", "tween");
      const sx = e.clientX, sy = e.clientY, sw = n.offsetWidth, sh = n.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      const x0 = n.offsetLeft, y0 = n.offsetTop;
      const move = ev => {
        let R = x0 + Math.max(300, sw + ev.clientX - sx);
        let B = y0 + Math.max(180, sh + ev.clientY - sy);
        if (!ev.altKey) ({ R, B } = this.snapResize(w, x0, y0, R, B));
        n.style.width = Math.max(300, R - x0) + "px";
        n.style.height = Math.max(180, B - y0) + "px";
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  },
};

// клавиатура отдаётся активному окну
document.addEventListener("keydown", e => {
  const w = WM.topmost();
  if (w && w === WM.focused && !e.target.closest("input[type=text], textarea")) w.onKey?.(e);
});

addEventListener("resize", () => {
  for (const w of WM.wins.values()) if (w.maximized) Object.assign(w.node.style, px(WM.maxRect()));
});

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
            ic.title = it.type === "dir" ? it.name : `${it.name}\n${fmtSize(it.size)}`;
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
const GitHub = {
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

// иконка: эмодзи или путь к картинке в fs ("/home/nikita/icons/x.png")
function setGlyph(box, icon) {
  if (typeof icon === "string" && icon.startsWith("/")) {
    const img = el("img", { src: fsUrl(icon), alt: "", draggable: false });
    img.onerror = () => { box.textContent = "❔"; };
    box.replaceChildren(img);
  } else box.textContent = icon || "📦";
}

function makeIcon(glyph, label, onOpen, meta = null) {
  const g = el("div", { className: "glyph" });
  setGlyph(g, glyph);
  const ic = el("div", { className: "icon" }, g, el("div", { className: "label", textContent: label }));
  ic.meta = meta;
  ic.open = () => {
    WM.origin = { rect: ic.getBoundingClientRect(), t: performance.now() };
    onOpen();
  };
  ic.addEventListener("dblclick", ic.open);
  // на тач-устройствах одного тапа достаточно
  ic.addEventListener("pointerup", e => { if (e.pointerType === "touch") ic.open(); });
  return ic;
}

/*
 * Выделение иконок: клик, Ctrl+клик (добавить/убрать), Shift+клик (диапазон)
 * и рамка мышью по пустому месту (с Ctrl — добавляет к выделению).
 * surface — где начинается рамка, box — контейнер с иконками (может прокручиваться).
 */
function makeSelectable(surface, box, onChange = () => {}) {
  const items = () => [...box.querySelectorAll(":scope > .icon")];
  const selected = () => items().filter(i => i.classList.contains("selected"));
  const set = list => { for (const i of items()) i.classList.toggle("selected", list.includes(i)); onChange(); };
  let anchor = null;

  box.addEventListener("click", e => {
    const ic = e.target.closest(".icon");
    if (!ic || ic.parentElement !== box) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) { ic.classList.toggle("selected"); anchor = ic; onChange(); }
    else if (e.shiftKey && anchor) {
      const all = items(), a = all.indexOf(anchor), b = all.indexOf(ic);
      set(all.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else { set([ic]); anchor = ic; }
  });

  surface.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.pointerType === "touch" || e.target.closest(".icon, button, input")) return;
    const win = e.target.closest(".window");
    if (win && !win.contains(surface)) return; // клик в чужом окне поверх рабочего стола
    const additive = e.ctrlKey || e.metaKey;
    const base = additive ? new Set(selected()) : new Set();
    if (!additive) set([]);
    const r = box.getBoundingClientRect();
    const toContent = (cx, cy) => ({ x: cx - r.left + box.scrollLeft, y: cy - r.top + box.scrollTop });
    const start = toContent(e.clientX, e.clientY);
    let last = { x: e.clientX, y: e.clientY }, mq = null, raf = 0;

    const update = () => {
      const cur = toContent(last.x, last.y);
      const L = Math.min(start.x, cur.x), T = Math.min(start.y, cur.y);
      const R = Math.max(start.x, cur.x), B = Math.max(start.y, cur.y);
      if (!mq) {
        if (R - L < 4 && B - T < 4) return;
        mq = el("div", { className: "marquee" });
        document.body.append(mq);
      }
      // рисуем в экранных координатах, обрезая по видимой области контейнера
      const sl = Math.max(r.left, L - box.scrollLeft + r.left), st = Math.max(r.top, T - box.scrollTop + r.top);
      const sr = Math.min(r.right, R - box.scrollLeft + r.left), sb = Math.min(r.bottom, B - box.scrollTop + r.top);
      Object.assign(mq.style, px({ left: sl, top: st, width: Math.max(0, sr - sl), height: Math.max(0, sb - st) }));
      for (const it of items()) {
        const ir = it.getBoundingClientRect();
        const il = ir.left - r.left + box.scrollLeft, itp = ir.top - r.top + box.scrollTop;
        const hit = il < R && il + ir.width > L && itp < B && itp + ir.height > T;
        it.classList.toggle("selected", hit || base.has(it));
      }
      onChange();
    };
    // автопрокрутка, когда тянешь за край
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const edge = 28;
      let dy = 0;
      if (last.y > r.bottom - edge) dy = Math.min(24, (last.y - (r.bottom - edge)) / 2);
      else if (last.y < r.top + edge) dy = -Math.min(24, ((r.top + edge) - last.y) / 2);
      if (dy && box.scrollHeight > box.clientHeight) { box.scrollTop += dy; update(); }
    };
    const move = ev => { last = { x: ev.clientX, y: ev.clientY }; update(); };
    const up = () => {
      cancelAnimationFrame(raf);
      mq?.remove();
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    loop();
    e.preventDefault();
  });

  const api = { items, selected, select: list => { set(list); anchor = list[0] || null; }, selectAll: () => set(items()), clear: () => set([]) };
  box.sel = api; // нужно контекстному меню
  return api;
}

/* ================= ID3-теги (название, исполнитель, обложка) ================= */
const ID3 = (() => {
  const cache = new Map();
  const syncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];
  const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

  async function range(url, a, b) {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
    if (!r.ok) return new Uint8Array();
    return new Uint8Array(await r.arrayBuffer());
  }
  // кодировка 0 по стандарту latin1, но русские теги там почти всегда в cp1251
  function decode(enc, bytes) {
    let label = ["windows-1251", "utf-16le", "utf-16be", "utf-8"][enc] || "utf-8";
    if (enc === 1 && bytes.length >= 2) {
      if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
      if (bytes[0] <= 0xff && (bytes[0] === 0xfe || bytes[0] === 0xff)) bytes = bytes.subarray(2);
    }
    return new TextDecoder(label).decode(bytes).split("\0")[0].trim();
  }
  function term(b, start, wide) {
    if (!wide) { const k = b.indexOf(0, start); return k < 0 ? b.length : k + 1; }
    for (let k = start; k + 1 < b.length; k += 2) if (b[k] === 0 && b[k + 1] === 0) return k + 2;
    return b.length;
  }
  function picture(b) {
    const enc = b[0];
    const mEnd = term(b, 1, false);
    let mime = new TextDecoder("latin1").decode(b.subarray(1, mEnd - 1)).toLowerCase();
    if (!mime || mime === "image/jpg" || !mime.includes("/")) mime = mime.includes("png") ? "image/png" : "image/jpeg";
    const dataStart = term(b, mEnd + 1, enc === 1 || enc === 2); // +1 — пропускаем тип картинки
    return URL.createObjectURL(new Blob([b.subarray(dataStart)], { type: mime }));
  }

  async function read(url) {
    const out = {};
    try {
      const h = await range(url, 0, 9);
      if (h.length < 10 || h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return out; // "ID3"
      const ver = h[3], flags = h[5], size = syncsafe(h, 6);
      if (ver < 3 || ver > 4 || !size || size > 12 * 1024 * 1024) return out;
      let tag = await range(url, 10, 10 + size - 1);
      if (ver === 3 && flags & 0x80) { // unsynchronisation: FF 00 -> FF
        const r = []; for (let i = 0; i < tag.length; i++) { r.push(tag[i]); if (tag[i] === 0xff && tag[i + 1] === 0) i++; }
        tag = Uint8Array.from(r);
      }
      let pos = 0;
      if (flags & 0x40) pos = ver === 4 ? syncsafe(tag, 0) : u32(tag, 0) + 4;
      while (pos + 10 <= tag.length) {
        const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fsize = ver === 4 ? syncsafe(tag, pos + 4) : u32(tag, pos + 4);
        const body = tag.subarray(pos + 10, pos + 10 + fsize);
        pos += 10 + fsize;
        if (!body.length) continue;
        if (id === "TIT2") out.title = decode(body[0], body.subarray(1));
        else if (id === "TPE1") out.artist = decode(body[0], body.subarray(1));
        else if (id === "TALB") out.album = decode(body[0], body.subarray(1));
        else if (id === "APIC" && !out.cover) out.cover = picture(body);
      }
    } catch (e) { console.warn("ID3:", e); }
    return out;
  }

  function fromName(path) {
    const n = baseName(path).replace(/\.[^.]+$/, "").replace(/_/g, " ");
    const m = n.match(/^(.+?)\s+[-–—]\s+(.+)$/); // "Artist - Title"
    return m ? { artist: m[1], title: m[2] } : { title: n };
  }

  return {
    get(path) {
      if (!cache.has(path)) {
        cache.set(path, (kindOf(path) === "audio" && /\.mp3$/i.test(path) ? read(fsUrl(path)) : Promise.resolve({}))
          .then(t => ({ ...fromName(path), ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)) })));
      }
      return cache.get(path);
    },
  };
})();

/* ================= mp3-плеер ================= */
const ICONS = {
  play: '<svg class="ic-fill" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  prev: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="5" y="5" width="2.5" height="14" rx="1"/><path d="M19 6v12a1 1 0 0 1-1.5.86L9 13.2a1.4 1.4 0 0 1 0-2.4l8.5-5.66A1 1 0 0 1 19 6z"/></svg>',
  next: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="16.5" y="5" width="2.5" height="14" rx="1"/><path d="M5 6v12a1 1 0 0 0 1.5.86L15 13.2a1.4 1.4 0 0 0 0-2.4L6.5 5.14A1 1 0 0 0 5 6z"/></svg>',
  shuffle: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.6 0 2.8-1.6 3.9-3.5M14.1 9.5C15.2 7.6 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  repeat: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/></svg>',
  vol: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
};

const Player = {
  audio: new Audio(),
  list: [], idx: -1,
  win: null, ui: null,
  shuffle: store.get("pl.shuffle", false),
  repeat: store.get("pl.repeat", "all"), // off | all | one
  ctx: null, analyser: null, raf: 0,
  seeking: false,

  init() {
    const a = this.audio;
    a.preload = "metadata";
    a.volume = store.get("pl.volume", 0.8);
    a.addEventListener("play", () => this.syncPlay());
    a.addEventListener("pause", () => this.syncPlay());
    a.addEventListener("timeupdate", () => this.syncTime());
    a.addEventListener("loadedmetadata", () => this.syncTime());
    a.addEventListener("ended", () => this.next(true));
    a.addEventListener("volumechange", () => { this.syncVol(); store.set("pl.volume", a.volume); });

    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => a.play());
      ms.setActionHandler("pause", () => a.pause());
      ms.setActionHandler("previoustrack", () => this.prev());
      ms.setActionHandler("nexttrack", () => this.next());
      try { ms.setActionHandler("seekto", d => { a.currentTime = d.seekTime; }); } catch {}
    }

    document.addEventListener("keydown", e => {
      if (!this.win || WM.topmost() !== this.win || e.target.closest("textarea, input[type=text]")) return;
      if (e.code === "Space") { e.preventDefault(); this.toggle(); }
      else if (e.code === "ArrowRight" && !e.target.closest("input")) a.currentTime = Math.min(a.duration || 0, a.currentTime + 5);
      else if (e.code === "ArrowLeft" && !e.target.closest("input")) a.currentTime = Math.max(0, a.currentTime - 5);
    });
  },

  // открыть плеер на треке: плейлист = все аудиофайлы той же папки
  async open(path) {
    const dir = parentOf(path);
    let list = [path];
    try {
      const r = await fetch("/api/ls?path=" + encodeURIComponent(dir));
      const d = await r.json();
      const found = d.entries.filter(e => e.type === "file" && kindOf(e.name) === "audio").map(e => joinPath(dir, e.name));
      if (found.length) list = found;
    } catch {}
    this.list = list;
    if (this.win) WM.restore(this.win);
    else this.win = WM.open({ title: "Плеер", icon: "🎧", width: 420, height: 640, key: "player", render: (c, w) => this.build(c, w) });
    this.renderList();
    this.play(Math.max(0, list.indexOf(path)));
  },

  build(c, w) {
    c.innerHTML = `
      <div class="player paused">
        <div class="pl-art"><div class="pl-bg"></div><canvas class="pl-viz"></canvas><div class="pl-cover">💿</div></div>
        <div class="pl-meta"><div class="pl-title">—</div><div class="pl-artist"></div></div>
        <div class="pl-seek"><span class="pl-cur">0:00</span><input type="range" class="pl-bar" min="0" max="1000" value="0" aria-label="Позиция"><span class="pl-dur">0:00</span></div>
        <div class="pl-ctrl">
          <button class="toggle pl-shuffle" title="Перемешать">${ICONS.shuffle}</button>
          <button class="pl-prev" title="Предыдущий">${ICONS.prev}</button>
          <button class="big pl-play" title="Играть / пауза (пробел)">${ICONS.play}</button>
          <button class="pl-next" title="Следующий">${ICONS.next}</button>
          <button class="toggle pl-repeat" title="Повтор">${ICONS.repeat}</button>
        </div>
        <div class="pl-vol"><button class="pl-mute" title="Звук">${ICONS.vol}</button><input type="range" class="pl-volbar" min="0" max="1" step="0.01" aria-label="Громкость"></div>
        <div class="pl-list"></div>
      </div>`;
    const q = s => c.querySelector(s);
    const ui = this.ui = {
      root: q(".player"), bg: q(".pl-bg"), viz: q(".pl-viz"), cover: q(".pl-cover"),
      title: q(".pl-title"), artist: q(".pl-artist"),
      cur: q(".pl-cur"), dur: q(".pl-dur"), bar: q(".pl-bar"),
      play: q(".pl-play"), shuffle: q(".pl-shuffle"), repeat: q(".pl-repeat"),
      mute: q(".pl-mute"), vol: q(".pl-volbar"), list: q(".pl-list"),
    };
    const a = this.audio;
    ui.play.onclick = () => this.toggle();
    q(".pl-prev").onclick = () => this.prev();
    q(".pl-next").onclick = () => this.next();
    ui.shuffle.onclick = () => { this.shuffle = !this.shuffle; store.set("pl.shuffle", this.shuffle); this.syncModes(); };
    ui.repeat.onclick = () => {
      this.repeat = { off: "all", all: "one", one: "off" }[this.repeat];
      store.set("pl.repeat", this.repeat); this.syncModes();
    };
    ui.bar.addEventListener("input", () => {
      this.seeking = true;
      ui.cur.textContent = fmtTime(ui.bar.value / 1000 * (a.duration || 0));
      ui.bar.style.setProperty("--p", ui.bar.value / 10 + "%");
    });
    ui.bar.addEventListener("change", () => {
      if (a.duration) a.currentTime = ui.bar.value / 1000 * a.duration;
      this.seeking = false;
    });
    ui.vol.addEventListener("input", () => { a.volume = +ui.vol.value; a.muted = false; });
    ui.mute.onclick = () => { a.muted = !a.muted; };

    new ResizeObserver(() => {
      const dpr = devicePixelRatio || 1;
      ui.viz.width = ui.viz.clientWidth * dpr;
      ui.viz.height = ui.viz.clientHeight * dpr;
    }).observe(ui.viz);

    w.onClose = () => { a.pause(); this.stopViz(); this.win = null; this.ui = null; };
    this.syncModes(); this.syncVol(); this.syncPlay();
  },

  async renderList() {
    const ui = this.ui; if (!ui) return;
    const list = this.list;
    ui.list.replaceChildren(...list.map((p, i) => {
      const item = el("div", { className: "pl-item" });
      item.innerHTML = `<span class="n"><span class="num">${i + 1}</span><span class="eq"><i></i><i></i><i></i></span></span>
        <span class="t"><b></b><small></small></span>`;
      item.querySelector("b").textContent = baseName(p).replace(/\.[^.]+$/, "");
      item.onclick = () => this.play(i);
      return item;
    }));
    this.highlight();
    // подтягиваем теги по очереди, чтобы не долбить сервер
    for (let i = 0; i < list.length; i++) {
      const m = await ID3.get(list[i]);
      if (this.list !== list || !this.ui) return;
      const it = ui.list.children[i];
      it.querySelector("b").textContent = m.title;
      it.querySelector("small").textContent = m.artist || "";
    }
  },

  highlight() {
    if (!this.ui) return;
    [...this.ui.list.children].forEach((it, i) => it.classList.toggle("active", i === this.idx));
    this.ui.list.children[this.idx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },

  initGraph() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
      src.connect(this.analyser).connect(this.ctx.destination);
    } catch (e) { console.warn("WebAudio:", e); }
  },

  async play(i) {
    if (i < 0 || i >= this.list.length) return;
    this.idx = i;
    const path = this.list[i];
    this.audio.src = fsUrl(path);
    this.initGraph();
    this.audio.play().catch(() => {});
    this.highlight();

    const m = await ID3.get(path);
    if (this.list[this.idx] !== path) return; // уже переключили
    if (this.ui) {
      this.ui.title.textContent = m.title;
      this.ui.artist.textContent = [m.artist, m.album].filter(Boolean).join(" · ");
      this.ui.cover.replaceChildren(m.cover ? el("img", { src: m.cover, alt: "" }) : "💿");
      this.ui.bg.style.backgroundImage = m.cover ? `url("${m.cover}")` : "";
    }
    this.win?.setTitle(m.title);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: m.title, artist: m.artist || "", album: m.album || "",
        artwork: m.cover ? [{ src: m.cover }] : [],
      });
    }
  },

  toggle() {
    if (this.idx < 0) return this.list.length && this.play(0);
    this.initGraph();
    this.audio.paused ? this.audio.play() : this.audio.pause();
  },

  next(auto = false) {
    const n = this.list.length; if (!n) return;
    if (auto && this.repeat === "one") { this.audio.currentTime = 0; this.audio.play(); return; }
    let i;
    if (this.shuffle && n > 1) { do i = Math.floor(Math.random() * n); while (i === this.idx); }
    else i = this.idx + 1;
    if (i >= n) {
      if (auto && this.repeat === "off") return;
      i = 0;
    }
    this.play(i);
  },

  prev() {
    const n = this.list.length; if (!n) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.play((this.idx - 1 + n) % n);
  },

  syncPlay() {
    const playing = !this.audio.paused;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (!this.ui) return;
    this.ui.root.classList.toggle("paused", !playing);
    this.ui.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    playing ? this.startViz() : this.stopViz();
  },
  syncTime() {
    const ui = this.ui; if (!ui || this.seeking) return;
    const a = this.audio, p = a.duration ? a.currentTime / a.duration : 0;
    ui.bar.value = p * 1000;
    ui.bar.style.setProperty("--p", p * 100 + "%");
    ui.cur.textContent = fmtTime(a.currentTime);
    ui.dur.textContent = fmtTime(a.duration);
  },
  syncVol() {
    const ui = this.ui; if (!ui) return;
    const v = this.audio.muted ? 0 : this.audio.volume;
    ui.vol.value = v;
    ui.vol.style.setProperty("--p", v * 100 + "%");
    ui.mute.innerHTML = v === 0 ? ICONS.mute : ICONS.vol;
  },
  syncModes() {
    const ui = this.ui; if (!ui) return;
    ui.shuffle.classList.toggle("on", this.shuffle);
    ui.repeat.classList.toggle("on", this.repeat !== "off");
    ui.repeat.classList.toggle("one", this.repeat === "one");
    ui.repeat.title = { off: "Повтор: выкл", all: "Повтор: весь плейлист", one: "Повтор: один трек" }[this.repeat];
  },

  /* визуализатор спектра */
  startViz() {
    if (this.raf || !this.analyser || !this.ui) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      if (!this.ui || this.win?.minimized) return;
      const cv = this.ui.viz, g = cv.getContext("2d"), W = cv.width, H = cv.height;
      this.analyser.getByteFrequencyData(data);
      g.clearRect(0, 0, W, H);
      const bars = 36, gap = W * 0.006, bw = (W - gap * (bars - 1)) / bars;
      const grad = g.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0, "rgba(138,180,255,0.9)");
      grad.addColorStop(1, "rgba(190,140,255,0.35)");
      g.fillStyle = grad;
      const usable = Math.floor(data.length * 0.72);
      for (let i = 0; i < bars; i++) {
        // логарифмическая шкала — басы не занимают пол-экрана
        const a = Math.floor(Math.pow(i / bars, 1.6) * usable), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * usable));
        let v = 0; for (let k = a; k < b; k++) v = Math.max(v, data[k]);
        const h = Math.max(H * 0.015, (v / 255) ** 1.4 * H * 0.85);
        const x = i * (bw + gap);
        g.beginPath();
        g.roundRect ? g.roundRect(x, H - h, bw, h, Math.min(bw / 2, 6)) : g.rect(x, H - h, bw, h);
        g.fill();
      }
    };
    draw();
  },
  stopViz() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const cv = this.ui?.viz;
    if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },
};
Player.init();

/* клики внутри iframe не всплывают в наш документ — подписываемся сами, чтобы окно получало фокус */
function wireIframe(frame, w) {
  frame.addEventListener("load", () => {
    try { frame.contentWindow.addEventListener("pointerdown", () => WM.focus(w), true); } catch {}
  });
  const prev = w.onFocus;
  w.onFocus = () => { prev?.(); setTimeout(() => { try { frame.contentWindow.focus(); } catch {} }, 0); };
}

/* ================= открытие файлов ================= */
function openFile(path) {
  const name = baseName(path), kind = kindOf(name), url = fsUrl(path);
  const opts = { title: name, icon: GLYPH[kind], key: "file:" + path };

  if (kind === "link") return Links.open(path);
  if (kind === "audio") return Player.open(path);
  if (kind === "video") return WM.open({ ...opts, width: 800, height: 500, render(c, w) {
    const v = el("video", { src: url, controls: true, autoplay: true });
    c.append(el("div", { className: "viewer-media" }, v));
    w.onClose = () => v.pause();
  }});
  if (kind === "image") return WM.open({ ...opts, width: 760, height: 520, render(c) {
    c.append(el("div", { className: "viewer-img" }, el("img", { src: url, alt: name })));
  }});
  if (kind === "web") return WM.open({ ...opts, width: 960, height: 640, render(c, w) {
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
  WM.open({ title: "О системе", icon: "ℹ️", width: 440, height: 340, key: "about", render(c) {
    c.innerHTML = `<div class="about"><h2>nikita.os</h2>
      <p>Музыка, игры и прочие проекты.</p>
      <p style="color:var(--muted)">Двойной клик — открыть, правый клик — меню действий. Окна можно таскать, сворачивать, разворачивать (двойной клик по заголовку) и растягивать за правый нижний угол.</p>
      <p style="color:var(--muted)">Рабочий стол — это папка <code>/home/nikita/Desktop</code>: что положишь туда, то и будет на рабочем столе.</p></div>`;
  }});
}

/* ================= рабочий стол ================= */
/*
 * Ярлык .lnk — JSON-файл:
 *   { "name": "Graveblood", "icon": "🕹️" | "/путь/к/картинке.png",
 *     "open": "/путь/в/fs" | "app": "settings|about|explorer" (+ "path") | "url": "https://..." }
 */
const APPS = {
  settings: () => openSettings(),
  about: () => openAbout(),
  explorer: l => openExplorer(l.path || "/home/nikita"),
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
    if (l.open) return openPath(l.open);
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
async function openPath(p) {
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
  isDir ? openExplorer(p) : openFile(p);
}

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
Desktop.load();
// вернулся на вкладку — подтягиваем изменения в папке рабочего стола
addEventListener("focus", () => Desktop.load());
document.addEventListener("visibilitychange", () => { if (!document.hidden) Desktop.load(); });
const deskSel = makeSelectable($("#desktop"), $("#icons"));
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

/* ================= пуск (с анимацией) ================= */
const startBtn = $("#start-btn"), startMenu = $("#start-menu");
let startAnim = null;
function toggleStart(show) {
  if (show === startBtn.classList.contains("on")) return;
  startAnim?.cancel();
  startBtn.classList.toggle("on", show);
  const b = startBtn.getBoundingClientRect();
  // меню выезжает из кнопки: прижато к её левому краю
  startMenu.style.left = Math.max(10, Math.min(b.left - 8, innerWidth - 310)) + "px";
  startMenu.style.transformOrigin = `${b.left + b.width / 2 - parseFloat(startMenu.style.left)}px 100%`;
  const hidden = { opacity: 0, transform: "translateY(16px) scale(.92)" };
  const shown = { opacity: 1, transform: "none" };
  if (show) startMenu.hidden = false;
  if (!D(1)) { startMenu.hidden = !show; return; }
  const a = startAnim = startMenu.animate(show ? [hidden, shown] : [shown, hidden],
    { duration: show ? 240 : 170, easing: EASE, fill: "forwards" });
  a.finished.then(() => {
    if (!show) startMenu.hidden = true;
    a.cancel();
    if (startAnim === a) startAnim = null;
  }, () => {});
}
startBtn.onclick = e => { e.stopPropagation(); toggleStart(!startBtn.classList.contains("on")); };
document.addEventListener("pointerdown", e => {
  if (startBtn.classList.contains("on") && !startMenu.contains(e.target) && !startBtn.contains(e.target)) toggleStart(false);
});
startMenu.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  WM.origin = { rect: b.getBoundingClientRect(), t: performance.now() };
  if (b.dataset.open) openExplorer(b.dataset.open);
  if (b.dataset.app === "about") openAbout();
  if (b.dataset.app === "settings") openSettings();
  toggleStart(false);
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && startBtn.classList.contains("on")) toggleStart(false);
});

/* ================= обои ================= */
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
const Wallpaper = {
  cfg: { wallpaper: "/home/nikita/Wallpapers/wallpaper.jpg", dim: 0.25, wallpaperDir: "/home/nikita/Wallpapers" }, // из fs/etc/os.json
  current: null,
  // папка, из которой берутся обои (выбор посетителя важнее значения из os.json)
  get dir() { return store.get("wp.dir", this.cfg.wallpaperDir || "/home/nikita/Wallpapers"); },
  set dir(p) { store.set("wp.dir", p); },

  async init() {
    try {
      const r = await fetch("/fs/etc/os.json", { cache: "no-store" });
      if (r.ok) Object.assign(this.cfg, await r.json());
    } catch {}
    this.apply(store.get("wp.src", this.cfg.wallpaper), store.get("wp.dim", this.cfg.dim), false);
  },
  get src() { return this.current?.src ?? "glow"; },
  get dim() { return this.current?.dim ?? 0.25; },

  // src: "glow" или путь к картинке в fs
  apply(src, dim = this.dim, save = true) {
    dim = Math.min(0.8, Math.max(0, +dim || 0));
    const same = this.current && this.current.src === src;
    this.current = { src, dim };
    if (save) { store.set("wp.src", src); store.set("wp.dim", dim); }
    const box = $("#wallpaper");
    if (same) { // поменялось только затемнение — без перерисовки
      const top = box.lastElementChild;
      if (top && src !== "glow") top.style.backgroundImage = this.css(src, dim);
      return;
    }
    const layer = el("div", { className: "wp-layer" + (src === "glow" ? " wp-glow" : "") });
    if (src !== "glow") layer.style.backgroundImage = this.css(src, dim);
    const show = () => {
      box.append(layer);
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("shown")));
      // старые слои убираем после проявления нового
      setTimeout(() => { while (box.firstElementChild !== layer) box.firstElementChild.remove(); }, 700);
    };
    if (src === "glow") return show();
    const img = new Image();
    img.onload = show;
    img.onerror = () => { console.warn("Обои не загрузились:", src); if (!box.children.length) this.apply("glow", dim, false); };
    img.src = fsUrl(src);
  },
  css: (src, dim) => `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${fsUrl(src)}")`,
};
Wallpaper.init();

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

/* ================= настройки ================= */
function openSettings() {
  WM.open({ title: "Настройки", icon: "⚙️", width: 660, height: 640, key: "settings", async render(c, w) {
    const tiles = el("div", { className: "wp-grid" });
    const dim = el("input", { type: "range", min: 0, max: 0.8, step: 0.05, value: Wallpaper.dim });
    const dimVal = el("span", { textContent: Math.round(Wallpaper.dim * 100) + "%" });
    const refresh = el("button", { className: "btn", textContent: "⟳ Обновить" });
    const dirBox = el("input", { type: "text", value: Wallpaper.dir, className: "path", spellcheck: false });
    const pick = el("button", { className: "btn", textContent: "📂 Выбрать…" });
    const hint = el("div", { className: "hint" });
    hint.innerHTML = "Показываются картинки (png, jpg, webp…) из выбранной папки. " +
      "Выбор сохраняется в этом браузере. Папку и фон по умолчанию для всех посетителей можно задать в <code>fs/etc/os.json</code> " +
      "(<code>wallpaperDir</code>, <code>wallpaper</code>).";
    // окна: прилипание, зазор, поля раскладки
    const snap = el("input", { type: "checkbox", checked: WM.cfg.snap });
    const num = (key, max) => {
      const range = el("input", { type: "range", min: 0, max, step: 1, value: WM.cfg[key] });
      const box = el("input", { type: "number", min: 0, max, value: WM.cfg[key], className: "num" });
      const set = v => {
        v = Math.max(0, Math.min(max, Math.round(+v || 0)));
        range.value = box.value = v; WM.setCfg(key, v);
      };
      range.oninput = () => set(range.value);
      box.onchange = () => set(box.value);
      return [range, box, el("span", { textContent: "px" })];
    };
    snap.onchange = () => WM.setCfg("snap", snap.checked);
    const tryArrange = el("button", { className: "btn", textContent: "▦ Разложить окна сейчас", onclick: () => WM.arrange() });

    c.append(el("div", { className: "settings" },
      el("section", {}, el("h3", { textContent: "Фон рабочего стола" }),
        el("div", { className: "row dirrow" }, el("span", { className: "lbl", textContent: "Папка с обоями" }), dirBox, pick, refresh),
        tiles, hint),
      el("section", {}, el("h3", { textContent: "Затемнение картинки" }),
        el("div", { className: "row" }, dim, dimVal)),
      el("section", {}, el("h3", { textContent: "Окна" }),
        el("label", { className: "row check" }, snap,
          el("span", { textContent: "Прилипать к краям экрана и друг к другу (на расстоянии 7 px; Alt — двигать свободно)" })),
        el("div", { className: "row" }, el("span", { className: "lbl", textContent: "Расстояние между окнами" }), ...num("gap", 64)),
        el("div", { className: "row" }, el("span", { className: "lbl", textContent: "Поля при раскладке" }), ...num("margin", 120)),
        el("div", { className: "row" }, tryArrange)),
    ));

    const mark = () => [...tiles.children].forEach(t => t.classList.toggle("active", t.dataset.src === Wallpaper.src));
    const tile = (src, label, thumbClass, bg) => {
      const th = el("div", { className: "thumb " + (thumbClass || "") });
      if (bg) th.style.backgroundImage = `url("${bg}")`;
      const t = el("button", { className: "wp-tile", title: src === "glow" ? label : src },
        th, el("span", { className: "cap", textContent: label }));
      t.dataset.src = src;
      t.onclick = () => { Wallpaper.apply(src, +dim.value); mark(); };
      return t;
    };
    async function load() {
      const dir = Wallpaper.dir;
      dirBox.value = dir;
      tiles.replaceChildren(tile("glow", "Чёрный с подсветкой", "thumb-glow"));
      try {
        const r = await fetch("/api/ls?path=" + encodeURIComponent(dir), { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "такой папки нет — создай её или выбери другую" : d.error || r.statusText);
        const imgs = d.entries.filter(e => e.type === "file" && IMAGE_EXT.includes(e.name.split(".").pop().toLowerCase()));
        for (const e of imgs) { const p = joinPath(dir, e.name); tiles.append(tile(p, e.name, "", fsUrl(p))); }
        if (!imgs.length) tiles.append(el("div", { className: "hint empty-wp", textContent: "В этой папке пока нет картинок" }));
      } catch (e) {
        tiles.append(el("div", { className: "hint empty-wp", textContent: `${dir}: ${e.message}` }));
      }
      mark();
    }
    const setDir = p => { if (!p) return; p = "/" + p.trim().replace(/^\/+|\/+$/g, ""); Wallpaper.dir = p; load(); };
    dirBox.onchange = () => setDir(dirBox.value);
    dirBox.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); setDir(dirBox.value); } };
    pick.onclick = async () => setDir(await pickFolder(Wallpaper.dir, "Папка с обоями"));
    dim.oninput = () => { dimVal.textContent = Math.round(dim.value * 100) + "%"; Wallpaper.apply(Wallpaper.src, +dim.value); };
    refresh.onclick = load;
    load();
  }});
}

/* ================= часы ================= */
function tick() {
  const d = new Date();
  $("#clock").innerHTML =
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + "<br>" +
    `<span style="color:var(--muted)">${d.toLocaleDateString("ru-RU")}</span>`;
}
tick(); setInterval(tick, 10_000);

/* ================= полный экран ================= */
const fsBtn = $("#fs-btn");
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
fsBtn.onclick = async () => {
  try {
    if (isFs()) await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
    else {
      const de = document.documentElement;
      await (de.requestFullscreen?.() ?? de.webkitRequestFullscreen?.());
    }
  } catch (e) { console.warn("Fullscreen:", e); }
};
const syncFs = () => {
  $("#fs-enter").toggleAttribute("hidden", isFs());
  $("#fs-exit").toggleAttribute("hidden", !isFs());
  fsBtn.title = isFs() ? "Выйти из полного экрана" : "Полный экран";
};
document.addEventListener("fullscreenchange", syncFs);
document.addEventListener("webkitfullscreenchange", syncFs);

$("#arrange-btn").onclick = () => WM.arrange();

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
  if (meta.type === "file" && meta.size !== undefined) rows.push(["Размер", `${fmtSize(meta.size)} (${meta.size.toLocaleString("ru-RU")} байт)`]);
  if (meta.mtime) rows.push(["Изменён", new Date(meta.mtime * 1000).toLocaleString("ru-RU")]);
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
  return [
    { label: icons.length > 1 ? `Открыть (${icons.length})` : "Открыть", icon: "↗", bold: true, hint: "Enter",
      run: () => icons.slice(0, 12).forEach(i => i.open()) },
    one?.openNew && { label: "Открыть в новом окне", icon: "⧉", run: one.openNew },
    target && { label: "Открыть расположение", icon: "📂", run: () => openExplorer(parentOf(target), { select: baseName(target) }) },
    one?.kind === "rom" && { label: "Играть", icon: "🕹️", run: () => icons[0].open() },
    "-",
    files.length && { label: files.length > 1 ? `Скачать (${files.length})` : "Скачать", icon: "⬇",
      run: () => files.forEach((m, k) => setTimeout(() => download(m.path), k * 300)) },
    target && /\.[^/.]+$/.test(target) && { label: "Скачать файл ярлыка", icon: "⬇", run: () => download(target) },
    paths.length && { label: paths.length > 1 ? "Копировать пути" : "Копировать путь", icon: "⎘",
      run: () => copyText(paths.join("\n"), paths.length > 1 ? "Пути скопированы" : "Путь скопирован") },
    files.length && { label: files.length > 1 ? "Копировать ссылки" : "Копировать ссылку", icon: "🔗",
      run: () => copyText(files.map(m => location.origin + fsUrl(m.path)).join("\n"), "Ссылка скопирована") },
    "-",
    one && { label: "Свойства", icon: "ℹ", run: () => openProperties(one) },
  ];
};

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

document.addEventListener("contextmenu", e => {
  const t = e.target;
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
    { label: "Открыть папку рабочего стола", icon: "📂", run: () => openPath(DESKTOP) },
    { label: "Сменить фон…", icon: "🖼", run: () => openSettings() },
    "-",
    { label: fsLabel(), icon: "⛶", run: () => fsBtn.click() },
    { label: "О системе", icon: "ℹ", run: () => openAbout() },
  ]);
});

/* стартовое окно */
openExplorer("/home/nikita/Projects");
