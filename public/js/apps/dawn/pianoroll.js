import { el } from "../../core/util.js";
import { Engine, TYPES } from "./engine.js";
import { EDOS, EDO_NAME, degreeNames, inScale, isBlack, noteNameE, scaleSet, scalesOf, snapToScale } from "./tuning.js";
import { dwBtn, pal, select, shell } from "./ui.js";

/* ================= DAWN — пиано ролл =================
 * Ноты выбранного канала в текущем паттерне (те же, что шаги в стойке). Строки — ступени строя канала
 * (12-EDO, 24, 19, 31…). Лад и тоника подсвечивают строки; «🧲» — ноты прилипают к ладу.
 * ЛКМ: по пустому — нота (и тянуть длину), по ноте — двигать, за правый край — длина.
 * ПКМ: удалить (можно вести). Колесо — вверх/вниз, Shift — вбок, Ctrl — масштаб. Снизу — громкость нот.
 */
const KEYS_W = 58, VEL_H = 64;
const SNAPS = [["0.0625", "1/64"], ["0.125", "1/32"], ["0.1667", "1/16T"], ["0.25", "1/16"], ["0.3333", "1/8T"],
  ["0.5", "1/8"], ["1", "1/4 (доля)"], ["bar", "такт"]];

export const PIANO = {
  title: () => "Пиано ролл",
  icon: "🎹",
  color: "var(--dw-sky)",
  size: () => [Math.min(860, innerWidth - 40), 520, Math.max(12, Math.min(780, innerWidth - 880)), 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-piano", "var(--dw-sky)");
    const tb = el("div", { className: "dw-pr-tools" });
    const cv = el("canvas", { className: "dw-pr-cv" });
    const wrap = el("div", { className: "dw-pr-wrap" }, cv);
    root.append(tb, wrap);
    const g = cv.getContext("2d");

    let snapV = "0.25";
    const view = { px: 88, x: 0, y: -1 };   // px на долю, сдвиг по X (доли), по Y (px от верхней строки)
    let lastLen = 0.25, W = 0, H = 0, dpr = 1, lastKey = "";
    const ch = () => Engine.chan(Dawn.pianoCh) || Engine.project.channels[0];
    const edo = () => ch()?.edo || 12;
    const rowH = () => Math.max(6, Math.min(15, Math.round(14 * 12 / edo())));
    const HI = () => edo() * 11 - 1;
    const notes = () => ch() ? Engine.notesOf(ch().id) : [];
    const snap = () => snapV === "bar" ? Engine.barLen() : +snapV;
    const gridH = () => H - VEL_H;
    const scale = () => { const s = ch()?.scale || { root: 0, mode: "chromatic" }; return { ...s, set: scaleSet(edo(), s.mode, s.root) }; };

    /* ---------- панель: канал, привязка, строй, лад, тоника, магнит ---------- */
    function tools() {
      const c2 = ch();
      if (!Engine.chan(Dawn.pianoCh)) Dawn.pianoCh = Engine.project.channels[0]?.id || null;
      const sc = c2?.scale || { root: 0, mode: "chromatic", snap: false };
      const roots = degreeNames(edo());
      const key = (c2?.id || "") + ":" + edo();
      if (key !== lastKey) { lastKey = key; if (W) centerOnNotes(); }   // другой канал или строй — показать его ноты
      tb.replaceChildren(...[
        select(Engine.project.channels.map(x => [x.id, TYPES[x.type].icon + " " + x.name]), Dawn.pianoCh,
          v => { Dawn.pianoCh = v; tools(); centerOnNotes(); draw(); Engine.emit("change", { param: true, piano: true }); }, "Канал"),
        select(SNAPS.map(([v, t]) => [v, "⧉ " + t]), snapV, v => { snapV = v; }, "Привязка по времени"),
        c2 && select(EDOS.map(e => [e, EDO_NAME[e]]), edo(), v => { Engine.setEdo(c2, +v); centerOnNotes(); tools(); draw(); }, "Строй: деление октавы"),
        c2 && select(Object.entries(scalesOf(edo())).map(([k, [name]]) => [k, "🎼 " + name]), sc.mode,
          v => { c2.scale = { ...sc, mode: v }; Engine.touch({ param: true }); tools(); draw(); }, "Лад"),
        c2 && sc.mode !== "chromatic" && select(roots.map((r, i) => [i, "Тоника " + r]), sc.root,
          v => { c2.scale = { ...sc, root: +v }; Engine.touch({ param: true }); draw(); }, "Тоника"),
        c2 && sc.mode !== "chromatic" && dwBtn("🧲", () => { c2.scale = { ...sc, snap: !sc.snap }; Engine.touch({ param: true }); tools(); },
          { title: "Ноты прилипают к ладу", className: "dw-btn dw-tog" + (sc.snap ? " on" : "") }),
        dwBtn("−", () => zoom(0.8), { title: "Мельче (Ctrl+колесо)" }), dwBtn("＋", () => zoom(1.25), { title: "Крупнее" }),
        dwBtn("🎛", () => Dawn.open("inst", Dawn.pianoCh), { title: "Открыть инструмент" }),
        el("span", { className: "dw-dim", textContent: `${notes().length} нот` })].filter(Boolean));
      win.setTitle("Пиано ролл — " + (c2?.name || "") + " · " + Engine.pat().name);
    }

    function fit() {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = Math.max(50, r.width); H = Math.max(80, r.height);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      clampView();
    }
    function clampView() {
      view.y = Math.max(0, Math.min((HI() + 1) * rowH() - gridH(), view.y));
      view.x = Math.max(0, view.x);
    }
    function centerOnNotes() {
      const L = notes();
      const mid = L.length ? L.reduce((a, n) => a + n.n, 0) / L.length : Engine.defaultPitch(ch() || { edo: 12 });
      view.y = (HI() - mid) * rowH() - gridH() / 2;
      clampView();
    }
    function zoom(k, atX = KEYS_W + (W - KEYS_W) / 2) {
      const s = view.x + (atX - KEYS_W) / view.px;
      view.px = Math.max(20, Math.min(400, view.px * k));
      view.x = Math.max(0, s - (atX - KEYS_W) / view.px);
      draw();
    }

    const sx = s => KEYS_W + (s - view.x) * view.px;
    const ny = n => (HI() - n) * rowH() - view.y;
    const xs = x => view.x + (x - KEYS_W) / view.px;
    const yn = y => HI() - Math.floor((y + view.y) / rowH());

    function draw() {
      if (!W) return;
      const C = pal(), E = edo(), R = rowH(), pat = Engine.pat(), len = Engine.patLength(), bar = Engine.barLen(pat);
      const col = ch()?.color || "#c3a6ff", gh = gridH(), sc = scale(), useScale = sc.mode !== "chromatic";
      const names = degreeNames(E);
      g.clearRect(0, 0, W, H);
      // строки: в ладу / вне лада / тоника; без лада — «чёрные» и «белые»
      for (let n = Math.max(0, yn(gh)); n <= Math.min(HI(), yn(0)); n++) {
        const y = ny(n), d = ((n % E) + E) % E;
        g.fillStyle = useScale ? (d === sc.root ? C.rowRoot : inScale(n, sc.set, E) ? C.rowIn : C.rowOut)
                               : (isBlack(n, E) ? C.rowB : C.rowW);
        g.fillRect(KEYS_W, y, W - KEYS_W, R);
        if (d === 0) { g.fillStyle = C.oct; g.fillRect(KEYS_W, y + R - 1, W - KEYS_W, 1); }
      }
      // вертикали: 1/16, доли размера (4/d), такты; за концом паттерна — темнее
      const beatU = 4 / pat.sig[1];
      for (let s = Math.floor(view.x * 4) / 4; s <= xs(W); s += 0.25) {
        const x = Math.round(sx(s)), isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6, isBeat = Math.abs(s / beatU - Math.round(s / beatU)) < 1e-6;
        if (!isBar && !isBeat && view.px < 40) continue;
        g.fillStyle = isBar ? C.g3 : isBeat ? C.g2 : C.g1;
        g.fillRect(x, 0, 1, gh);
      }
      if (sx(len) < W) { g.fillStyle = C.shade; g.fillRect(Math.max(KEYS_W, sx(len)), 0, W, gh); }
      // ноты (вне лада — с пунктирной рамкой)
      for (const nt of notes()) {
        const x = sx(nt.s), y = ny(nt.n), w = Math.max(3, nt.l * view.px - 1);
        if (x + w < KEYS_W || x > W || y + R < 0 || y > gh) continue;
        g.globalAlpha = 0.55 + 0.45 * nt.v;
        g.fillStyle = col; roundRect(x + 0.5, y + 1, w, R - 2, Math.min(4, R / 3)); g.fill();
        g.globalAlpha = 1;
        if (useScale && !inScale(nt.n, sc.set, E)) { g.setLineDash([3, 2]); g.strokeStyle = C.text; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
        g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x + w - 3, y + 3, 1.5, Math.max(1, R - 6));
        if (w > 26 && R >= 11) { g.fillStyle = C.noteText; g.font = "9px system-ui"; g.fillText(noteNameE(nt.n, E), x + 4, y + R - 3.5); }
      }
      // клавиши
      for (let n = Math.max(0, yn(gh)); n <= Math.min(HI(), yn(0)); n++) {
        const y = ny(n), d = ((n % E) + E) % E, bl = isBlack(n, E);
        g.fillStyle = useScale && inScale(n, sc.set, E) ? (bl ? C.keyB : C.keyIn) : bl ? C.keyB : C.keyW;
        g.fillRect(0, y, bl ? KEYS_W * 0.62 : KEYS_W, R - (bl ? 0 : 1));
        if (useScale && d === sc.root) { g.fillStyle = C.g3; g.fillRect(KEYS_W - 4, y, 4, R - 1); }
        if (d === 0 || (R >= 12 && E !== 12)) {
          g.fillStyle = bl ? C.keyW : C.keyLbl; g.font = (d === 0 ? "600 " : "") + "9px system-ui";
          g.fillText(d === 0 ? noteNameE(n, E) : names[d], 24, y + R - 3);
        }
      }
      // громкость
      g.fillStyle = C.panel; g.fillRect(0, gh, W, VEL_H);
      g.fillStyle = C.dim; g.font = "9px system-ui"; g.fillText("VEL", 8, gh + 14);
      for (const nt of notes()) {
        const x = sx(nt.s);
        if (x < KEYS_W - 2 || x > W) continue;
        const hgt = (VEL_H - 10) * nt.v;
        g.fillStyle = col; g.fillRect(x, H - 4 - hgt, 3, hgt);
        g.beginPath(); g.arc(x + 1.5, H - 4 - hgt, 3, 0, 7); g.fill();
      }
      const st = Engine.positionPattern();
      if (st >= 0) { const x = sx(st); if (x >= KEYS_W) { g.fillStyle = C.head; g.fillRect(x, 0, 2, H); } }
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
    const fixPitch = n => {
      const sc = scale(), c2 = ch();
      n = Math.max(0, Math.min(HI(), n));
      return c2?.scale?.snap && sc.mode !== "chromatic" ? snapToScale(n, sc.set, edo()) : n;
    };

    let drag = null;
    cv.addEventListener("pointerdown", e => {
      if (!ch()) return;
      Engine.init();
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      cv.setPointerCapture(e.pointerId);
      if (y > gridH()) { drag = { vel: true }; velAt(x, y); return; }
      if (x < KEYS_W) { Engine.preview(ch(), yn(y), 0.85, 0.4); return; }
      const h = hit(x, y);
      if (e.button === 2) { drag = { erase: true }; if (h) del(h.nt); return; }
      if (h) {
        drag = h.edge ? { nt: h.nt, resize: true } : { nt: h.nt, move: true, ds: xs(x) - h.nt.s };
        if (!h.edge) Engine.preview(ch(), h.nt.n, h.nt.v, 0.2);
      } else {
        const q = snap(), s = Math.max(0, Math.floor(xs(x) / q + 1e-6) * q), n = fixPitch(yn(y));
        const nt = { s: +s.toFixed(4), l: lastLen, n, v: 0.85 };
        notes().push(nt);
        Engine.preview(ch(), n, 0.85, lastLen * Engine.beatDur());
        drag = { nt, resize: true };
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
        const s = Math.max(0, Math.round((xs(x) - drag.ds) / q) * q), n = fixPitch(yn(y));
        if (n !== drag.nt.n) Engine.preview(ch(), n, drag.nt.v, 0.15);
        drag.nt.s = +s.toFixed(4); drag.nt.n = n;
      } else if (drag.resize) {
        drag.nt.l = +Math.max(q, Math.round((xs(x) - drag.nt.s) / q) * q).toFixed(4);
      }
      Engine.touch({ notes: true, param: true });
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
      if (best) { best.v = +v.toFixed(3); Engine.touch({ param: true }); draw(); }
    }
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - cv.getBoundingClientRect().left);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x = Math.max(0, view.x + (e.deltaX || e.deltaY) / view.px);
      else view.y += e.deltaY;
      clampView(); draw();
    }, { passive: false });

    const ro = new ResizeObserver(() => {
      const mid = W && view.y >= 0 ? yn(gridH() / 2) : null;   // при ресайзе держим в центре ту же ноту
      fit();
      if (mid == null) centerOnNotes(); else { view.y = (HI() - mid) * rowH() - gridH() / 2; clampView(); }
      draw();
    });
    ro.observe(wrap);
    tools();
    let raf = 0, wasPlaying = false;
    const frame = () => { if (Engine.playing || wasPlaying) draw(); wasPlaying = Engine.playing; raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    const offs = [
      Engine.on("change", w => { if (w?.channels || w?.all || w?.piano || (w?.notes && !drag)) tools(); if (!drag) draw(); }),
      Engine.on("pattern", () => { tools(); centerOnNotes(); draw(); }),
      Engine.on("theme", draw)];
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offs.forEach(f => f()); };
  },
};
