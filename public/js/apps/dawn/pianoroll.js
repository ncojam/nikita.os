import { el } from "../../core/util.js";
import { Engine, STEPS_PER_BAR, TYPES } from "./engine.js";
import { dwBtn, noteName, shell } from "./ui.js";

/* ================= DAWN — пиано ролл =================
 * Ноты выбранного канала в текущем паттерне (те же, что шаги в стойке).
 * Левая кнопка: по пустому — поставить ноту (и тянуть длину), по ноте — двигать, за правый край — длина.
 * Правая кнопка: удалить (можно вести по нотам). Колесо — вверх/вниз, Shift+колесо — вбок,
 * Ctrl+колесо — масштаб. Снизу — громкость нот (тянуть столбики).
 */
const ROW = 14, KEYS_W = 54, VEL_H = 64, LO = 0, HI = 127;
const BLACK = [1, 3, 6, 8, 10];

export const PIANO = {
  title: () => "Пиано ролл",
  icon: "🎹",
  size: () => [Math.min(820, innerWidth - 40), 500, Math.max(12, Math.min(780, innerWidth - 840)), 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-piano", "var(--dw-sky)");
    const chSel = el("select", { className: "dw-sel", title: "Канал" });
    const snapSel = el("select", { className: "dw-sel", title: "Привязка" },
      ...[["0.25", "1/64"], ["0.5", "1/32"], ["1", "1/16 (шаг)"], ["2", "1/8"], ["4", "1/4 (доля)"], ["16", "такт"]]
        .map(([v, t]) => el("option", { value: v, textContent: "⧉ " + t, selected: v === "1" })));
    const info = el("span", { className: "dw-dim" });
    const tb = el("div", { className: "dw-pr-tools" }, chSel, snapSel,
      dwBtn("−", () => zoom(0.8), { title: "Мельче (Ctrl+колесо)" }), dwBtn("＋", () => zoom(1.25), { title: "Крупнее" }),
      dwBtn("🎛", () => Dawn.open("inst", Dawn.pianoCh), { title: "Открыть инструмент" }), info);
    const cv = el("canvas", { className: "dw-pr-cv" });
    const wrap = el("div", { className: "dw-pr-wrap" }, cv);
    root.append(tb, wrap);
    const g = cv.getContext("2d");

    const view = { px: 22, x: 0, y: (HI - 76) * ROW };   // px на шаг, сдвиг по X (шаги), по Y (px от верхней ноты)
    let lastLen = 1, W = 0, H = 0, dpr = 1;
    const ch = () => Engine.chan(Dawn.pianoCh) || Engine.project.channels[0];
    const notes = () => ch() ? Engine.notesOf(ch().id) : [];
    const snap = () => +snapSel.value;
    const gridH = () => H - VEL_H;

    function fillCh() {
      if (!Engine.chan(Dawn.pianoCh)) Dawn.pianoCh = Engine.project.channels[0]?.id || null;
      chSel.replaceChildren(...Engine.project.channels.map(c2 =>
        el("option", { value: c2.id, textContent: TYPES[c2.type].icon + " " + c2.name, selected: c2.id === Dawn.pianoCh })));
      win.setTitle("Пиано ролл — " + (ch()?.name || "") + " · " + Engine.pat().name);
    }
    chSel.onchange = () => { Dawn.pianoCh = chSel.value; fillCh(); Engine.emit("change", { param: true, piano: true }); draw(); };

    function fit() {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = Math.max(50, r.width); H = Math.max(80, r.height);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      clampView();
    }
    function clampView() {
      view.y = Math.max(0, Math.min((HI - LO + 1) * ROW - gridH(), view.y));
      view.x = Math.max(0, view.x);
    }
    function zoom(k, atX = KEYS_W + (W - KEYS_W) / 2) {
      const s = view.x + (atX - KEYS_W) / view.px;
      view.px = Math.max(5, Math.min(90, view.px * k));
      view.x = Math.max(0, s - (atX - KEYS_W) / view.px);
      draw();
    }

    const sx = s => KEYS_W + (s - view.x) * view.px;          // шаг -> x
    const ny = n => (HI - n) * ROW - view.y;                   // нота -> y (верх строки)
    const xs = x => view.x + (x - KEYS_W) / view.px;           // x -> шаг
    const yn = y => HI - Math.floor((y + view.y) / ROW);       // y -> нота

    function draw() {
      if (!W) return;
      const len = Engine.patLength(), col = ch()?.color || "#c3a6ff", gh = gridH();
      g.clearRect(0, 0, W, H);
      // фон строк
      for (let n = yn(gh); n <= yn(0); n++) {
        const y = ny(n);
        g.fillStyle = BLACK.includes(n % 12) ? "rgba(20,10,40,0.55)" : "rgba(255,255,255,0.025)";
        g.fillRect(KEYS_W, y, W - KEYS_W, ROW);
        if (n % 12 === 0) { g.fillStyle = "rgba(195,166,255,0.25)"; g.fillRect(KEYS_W, y + ROW - 1, W - KEYS_W, 1); }
      }
      // вертикали: шаги, доли, такты; за концом паттерна — темнее
      const s0 = Math.floor(view.x), s1 = Math.ceil(xs(W));
      for (let s = s0; s <= s1; s++) {
        const x = sx(s);
        g.fillStyle = s % STEPS_PER_BAR === 0 ? "rgba(255,158,207,0.45)" : s % 4 === 0 ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.04)";
        g.fillRect(Math.round(x), 0, 1, gh);
      }
      if (sx(len) < W) { g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(Math.max(KEYS_W, sx(len)), 0, W, gh); }
      // ноты
      for (const nt of notes()) {
        const x = sx(nt.s), y = ny(nt.n), w = Math.max(3, nt.l * view.px - 1);
        if (x + w < KEYS_W || x > W || y + ROW < 0 || y > gh) continue;
        g.globalAlpha = 0.55 + 0.45 * nt.v;
        g.fillStyle = col; roundRect(x + 0.5, y + 1, w, ROW - 2, 4); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(x + w - 3, y + 3, 1.5, ROW - 6);   // ручка длины
        if (w > 26) { g.fillStyle = "rgba(30,15,50,0.85)"; g.font = "9px system-ui"; g.fillText(noteName(nt.n), x + 4, y + ROW - 4); }
      }
      // клавиши
      for (let n = yn(gh); n <= yn(0); n++) {
        const y = ny(n), bl = BLACK.includes(n % 12);
        g.fillStyle = bl ? "#2a1f3d" : "#f6eefc"; g.fillRect(0, y, bl ? KEYS_W * 0.62 : KEYS_W, ROW - (bl ? 0 : 1));
        if (n % 12 === 0) { g.fillStyle = "#7a5fa8"; g.font = "9px system-ui"; g.fillText(noteName(n), 26, y + ROW - 3); }
      }
      // полоса громкости
      g.fillStyle = "rgba(10,5,20,0.6)"; g.fillRect(0, gh, W, VEL_H);
      g.fillStyle = "rgba(255,255,255,0.35)"; g.font = "9px system-ui"; g.fillText("VEL", 8, gh + 14);
      for (const nt of notes()) {
        const x = sx(nt.s);
        if (x < KEYS_W - 2 || x > W) continue;
        const hgt = (VEL_H - 10) * nt.v;
        g.fillStyle = col; g.fillRect(x, H - 4 - hgt, 3, hgt);
        g.beginPath(); g.arc(x + 1.5, H - 4 - hgt, 3, 0, 7); g.fill();
      }
      // плейхед
      const st = Engine.position();
      if (st >= 0) { const x = sx(st); if (x >= KEYS_W) { g.fillStyle = "#fff09e"; g.fillRect(x, 0, 2, H); } }
      info.textContent = `${notes().length} нот · ${len / STEPS_PER_BAR} т.`;
    }
    function roundRect(x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }

    function hit(x, y) {
      const n = yn(y), s = xs(x);
      for (const nt of [...notes()].reverse()) if (nt.n === n && s >= nt.s && s < nt.s + nt.l)
        return { nt, edge: x > sx(nt.s + nt.l) - 7 };
      return null;
    }

    let drag = null;
    cv.addEventListener("contextmenu", e => e.preventDefault());
    cv.addEventListener("pointerdown", e => {
      if (!ch()) return;
      Engine.init();
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      cv.setPointerCapture(e.pointerId);
      if (y > gridH()) { drag = { vel: true }; velAt(x, y); return; }
      if (x < KEYS_W) { const n = yn(y); Engine.preview(ch(), n, 0.85, 0.4); return; }
      const h = hit(x, y);
      if (e.button === 2) { drag = { erase: true }; if (h) { del(h.nt); } return; }
      if (h) {
        drag = h.edge ? { nt: h.nt, resize: true, l0: h.nt.l, x0: x } : { nt: h.nt, move: true, ds: xs(x) - h.nt.s, n0: h.nt.n };
        if (!h.edge) Engine.preview(ch(), h.nt.n, h.nt.v, 0.2);
      } else {
        const q = snap(), s = Math.max(0, Math.floor(xs(x) / q) * q), n = yn(y);
        const nt = { s, l: lastLen, n, v: 0.85 };
        notes().push(nt);
        Engine.preview(ch(), n, 0.85, lastLen * Engine.stepDur());
        drag = { nt, resize: true, l0: lastLen, x0: sx(s + lastLen), created: true };
        Engine.touch({ notes: true });
      }
    });
    cv.addEventListener("pointermove", e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!drag) {
        const h = y < gridH() && x > KEYS_W ? hit(x, y) : null;
        cv.style.cursor = h ? (h.edge ? "ew-resize" : "grab") : x > KEYS_W && y < gridH() ? "crosshair" : "default";
        return;
      }
      const q = snap();
      if (drag.vel) return velAt(x, y);
      if (drag.erase) { const h = hit(x, y); if (h) del(h.nt); return; }
      if (drag.move) {
        const s = Math.max(0, Math.round((xs(x) - drag.ds) / q) * q), n = Math.max(LO, Math.min(HI, yn(y)));
        if (n !== drag.nt.n) Engine.preview(ch(), n, drag.nt.v, 0.15);
        drag.nt.s = s; drag.nt.n = n;
      } else if (drag.resize) {
        drag.nt.l = Math.max(q, Math.round((xs(x) - drag.nt.s) / q) * q);
      }
      Engine.touch({ notes: true, param: true });   // param: стойка не перестраивается на каждом движении
      draw();
    });
    const up = () => {
      if (drag?.nt) lastLen = drag.nt.l;
      if (drag) Engine.touch({ notes: true });
      drag = null;
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    function del(nt) { const L = notes(), i = L.indexOf(nt); if (i >= 0) { L.splice(i, 1); Engine.touch({ notes: true }); draw(); } }
    function velAt(x, y) {
      const v = Math.max(0.05, Math.min(1, (H - 4 - y) / (VEL_H - 10)));
      let best = null, bd = 8;
      for (const nt of notes()) { const d = Math.abs(sx(nt.s) - x); if (d < bd) { bd = d; best = nt; } }
      if (best) { best.v = v; Engine.touch({ param: true }); draw(); }
    }
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - cv.getBoundingClientRect().left);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x = Math.max(0, view.x + (e.deltaX || e.deltaY) / view.px);
      else view.y += e.deltaY;
      clampView(); draw();
    }, { passive: false });

    const ro = new ResizeObserver(() => { fit(); draw(); });
    ro.observe(wrap);
    fillCh(); fit(); draw();
    let raf = 0, wasPlaying = false;
    const frame = () => { if (Engine.playing || wasPlaying) draw(); wasPlaying = Engine.playing; raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    const offs = [Engine.on("change", w => { if (w?.channels || w?.all || w?.piano) fillCh(); if (!drag) draw(); }),
      Engine.on("pattern", () => { fillCh(); draw(); })];
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offs.forEach(f => f()); };
  },
};
