import { D, EASE, REDUCED } from "./core/anim.js";
import { $, el, px, store } from "./core/util.js";
import { notify } from "./ui/notify.js";

/* ================= оконный менеджер ================= */
const WM = {
  z: 10,
  wins: new Map(),
  seq: 0,
  origin: null, // откуда «вылетает» следующее окно (иконка, по которой кликнули)

  maxRect() {
    const top = this.reservedTop() + 8;
    return { left: 8, top, width: innerWidth - 16, height: innerHeight - top - 64 - 10 };
  },
  /* панели приложений сверху (класс .wm-reserve-top, напр. док DAWN) — окна под них не заезжают */
  reservedTop() {
    let b = 0;
    // offsetParent у position: fixed всегда null — видимость проверяем по размерам
    for (const e of document.querySelectorAll(".wm-reserve-top")) { const r = e.getBoundingClientRect(); if (!e.hidden && r.height > 0) b = Math.max(b, r.bottom); }
    return b;
  },

  /* появилась/исчезла панель сверху (док DAWN) или сменился размер экрана — окна подстраиваются, как под панель задач:
   * развёрнутые — под новую рабочую область, остальные сдвигаются ниже панели (и ужимаются, если не влезают) */
  fitReserved() {
    const A = this.area(), top = A.top + (A.top ? 6 : 0);
    for (const w of this.wins.values()) {
      if (w.minimized || w.closing) continue;
      const n = w.node;
      if (w.maximized) { Object.assign(n.style, px(this.maxRect())); continue; }
      if (n.offsetTop >= top) continue;
      const h = Math.min(n.offsetHeight, Math.max(160, A.bottom - top - 6));
      n.style.top = top + "px"; if (h < n.offsetHeight) n.style.height = h + "px";
    }
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
    return { left: 0, top: this.reservedTop(), right: innerWidth, bottom: Math.min(innerHeight, tb.top) };
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

  /* taskList — свой список задач (у приложения может быть отдельная панель, как у DAWN) */
  open({ title, icon = "🪟", width = 720, height = 460, render, key, taskList }) {
    if (key) {
      for (const w of this.wins.values()) if (w.key === key) { this.restore(w); return w; }
    }
    const id = ++this.seq;
    const vw = innerWidth, vh = innerHeight - 70;
    width = Math.min(width, vw - 20);
    height = Math.min(height, vh - 20 - this.reservedTop());   // новое окно — ниже верхней панели (док DAWN)
    const off = (this.wins.size % 8) * 28;
    const left = Math.max(10, (vw - width) / 2 - 100 + off);
    const top = Math.max(10 + this.reservedTop(), (vh - height) / 2 - 60 + off);

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
    // размер тянется за любой край и угол
    const grips = ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(d => el("div", { className: "resize rz-" + d }));
    const node = el("div", { className: "window glass" }, titlebar, content, ...grips);
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
    if (key) node.dataset.wkey = key;
    $("#windows").append(node);
    (taskList || $("#task-list")).append(task);

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
    for (const g of grips) this.makeResizable(w, g, g.className.split("rz-")[1]);
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
        const y = Math.min(Math.max(ev.clientY - sy, 0), innerHeight - 60);   // руками можно и под верхнюю панель; прилипание — к её краю
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

  makeResizable(w, handle, dir = "se") {
    handle.addEventListener("pointerdown", e => {
      e.stopPropagation();
      const n = w.node;
      this.breakArrange();
      w.maximized = false;
      n.classList.remove("maximized", "tween");
      const sx = e.clientX, sy = e.clientY, sw = n.offsetWidth, sh = n.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      const x0 = n.offsetLeft, y0 = n.offsetTop;
      const right = x0 + sw, bottom = y0 + sh;
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy, A = this.area(), T = this.SNAP, g = +this.cfg.gap || 0;
        let L = x0, Tp = y0, R = right, B = bottom;
        if (dir.includes("e")) R = x0 + Math.max(300, sw + dx);
        if (dir.includes("s")) B = y0 + Math.max(180, sh + dy);
        if (dir.includes("w")) L = Math.min(right - 300, x0 + dx);
        if (dir.includes("n")) Tp = Math.max(0, Math.min(bottom - 180, y0 + dy));
        if (!ev.altKey) {
          if (dir.includes("e") || dir.includes("s")) ({ R, B } = this.snapResize(w, L, Tp, R, B));
          if (dir.includes("w") && Math.abs(L - A.left - g) < T) L = A.left + g;
          if (dir.includes("n") && Math.abs(Tp - A.top - g) < T) Tp = A.top + g;
        }
        n.style.left = L + "px"; n.style.top = Tp + "px";
        n.style.width = Math.max(300, R - L) + "px";
        n.style.height = Math.max(180, B - Tp) + "px";
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

/* клики внутри iframe не всплывают в наш документ — подписываемся сами, чтобы окно получало фокус */
function wireIframe(frame, w) {
  frame.addEventListener("load", () => {
    try { frame.contentWindow.addEventListener("pointerdown", () => WM.focus(w), true); } catch {}
  });
  const prev = w.onFocus;
  w.onFocus = () => { prev?.(); setTimeout(() => { try { frame.contentWindow.focus(); } catch {} }, 0); };
}

/* запуск — вызывается из main.js */
export function init_wm() {
  // клавиатура отдаётся активному окну
  document.addEventListener("keydown", e => {
    const w = WM.topmost();
    if (w && w === WM.focused && !e.target.closest("input[type=text], textarea")) w.onKey?.(e);
  });

  addEventListener("resize", () => {
    WM.fitReserved();
  });
  // верхние панели (.wm-reserve-top) появляются и прячутся — окна подстраиваются
  new MutationObserver(() => { const t = WM.reservedTop(); if (t !== WM._rt) { WM._rt = t; requestAnimationFrame(() => WM.fitReserved()); } })
    .observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ["hidden", "class"] });
}

export { WM, wireIframe };
