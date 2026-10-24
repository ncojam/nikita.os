import { el } from "../../core/util.js";
import { Engine, TYPES } from "./engine.js";
import { EDOS, EDO_NAME, degreeNames, inScale, isBlack, noteNameE, scaleSet, scalesOf, snapToScale } from "./tuning.js";
import { dwBtn, pal, select, shell } from "./ui.js";

/* ================= DAWN — пиано ролл =================
 * Ноты выбранного канала в текущем паттерне (те же, что шаги в стойке). Строки — ступени строя канала.
 * Инструменты:
 *   🖌 кисть — ЛКМ по пустому: нота (тянуть — длина); по ноте — двигать; за правый край — длина. ПКМ — удалить.
 *   ⬚ выделение — рамкой (Shift — добавить), тянуть выделенное; Ctrl+C / X / V, Delete, Ctrl+A, стрелки.
 *   〰 изгиб — тянуть ноту вверх/вниз: к концу ноты высота уедет на столько ступеней (slide).
 * Колесо — вверх/вниз, Shift — вбок, Ctrl — масштаб по времени, Alt — высота строк (↕). Снизу — громкость.
 */
const KEYS_W = 58, VEL_H = 64;
const SNAPS = [["0.0625", "1/64"], ["0.125", "1/32"], ["0.1667", "1/16T"], ["0.25", "1/16"], ["0.3333", "1/8T"],
  ["0.5", "1/8"], ["1", "1/4 (доля)"], ["bar", "такт"]];
let clipboard = null;   // общий на все окна: [{s, l, n, v, b}] со сдвигом от первой ноты

export const PIANO = {
  title: () => "Пиано ролл",
  icon: "🎹",
  color: "var(--dw-sky)",
  size: () => [Math.min(900, innerWidth - 40), 540, Math.max(12, Math.min(780, innerWidth - 920)), 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-piano", "var(--dw-sky)");
    const tb = el("div", { className: "dw-pr-tools" });
    const cv = el("canvas", { className: "dw-pr-cv", tabIndex: 0 });
    const wrap = el("div", { className: "dw-pr-wrap" }, cv);
    root.append(tb, wrap);
    const g = cv.getContext("2d");

    let snapV = "0.25", tool = "brush", vzoom = 1, sel = new Set(), marquee = null, pasteAt = 0;
    const view = { px: 88, x: 0, y: -1 };
    let lastLen = 0.25, W = 0, H = 0, dpr = 1, lastKey = "";
    const ch = () => Engine.chan(Dawn.pianoCh) || Engine.project.channels[0];
    const edo = () => ch()?.edo || 12;
    const rowH = () => Math.max(3, Math.min(40, Math.round(14 * 12 / edo() * vzoom)));
    const HI = () => edo() * 11 - 1;
    const notes = () => ch() ? Engine.notesOf(ch().id) : [];
    const snap = () => snapV === "bar" ? Engine.barLen() : +snapV;
    const gridH = () => H - VEL_H;
    const scale = () => { const s = ch()?.scale || { root: 0, mode: "chromatic" }; return { ...s, set: scaleSet(edo(), s.mode, s.root) }; };
    const changed = (live = false) => Engine.touch(live ? { notes: true, param: true } : { notes: true });

    /* ---------- панель ---------- */
    function tools() {
      const c2 = ch();
      if (!Engine.chan(Dawn.pianoCh)) Dawn.pianoCh = Engine.project.channels[0]?.id || null;
      const sc = c2?.scale || { root: 0, mode: "chromatic", snap: false };
      const key = (c2?.id || "") + ":" + edo();
      if (key !== lastKey) { lastKey = key; sel.clear(); if (W) centerOnNotes(); }
      const tbtn = (id, txt, title) => dwBtn(txt, () => { tool = id; tools(); cursor(); }, { title, className: "dw-btn dw-tool" + (tool === id ? " on" : "") });
      tb.replaceChildren(...[
        el("div", { className: "dw-seg" }, tbtn("brush", "🖌", "Кисть: рисовать ноты (B)"), tbtn("select", "⬚", "Выделение: рамкой, Shift — добавить (S)"), tbtn("bend", "〰", "Изгиб ноты (slide): тянуть ноту вверх/вниз (G)")),
        dwBtn("✂", () => cut(), { title: "Вырезать (Ctrl+X)" }), dwBtn("⧉", () => copy(), { title: "Копировать (Ctrl+C)" }),
        dwBtn("📋", () => paste(), { title: "Вставить (Ctrl+V) — после выделенного или у курсора" }),
        dwBtn("🗑", () => delSel(), { title: "Удалить выделенное (Delete)" }),
        select(Engine.project.channels.map(x => [x.id, TYPES[x.type].icon + " " + x.name]), Dawn.pianoCh,
          v => { Dawn.pianoCh = v; tools(); draw(); Engine.emit("change", { param: true, piano: true }); }, "Канал"),
        select(SNAPS.map(([v, t]) => [v, "⧉ " + t]), snapV, v => { snapV = v; }, "Привязка по времени"),
        c2 && select(EDOS.map(e => [e, EDO_NAME[e]]), edo(), v => { Engine.setEdo(c2, +v); tools(); draw(); }, "Строй: деление октавы"),
        c2 && select(Object.entries(scalesOf(edo())).map(([k, [name]]) => [k, "🎼 " + name]), sc.mode,
          v => { c2.scale = { ...sc, mode: v }; Engine.touch({ param: true }); tools(); draw(); }, "Лад"),
        c2 && sc.mode !== "chromatic" && select(degreeNames(edo()).map((r, i) => [i, "Тоника " + r]), sc.root,
          v => { c2.scale = { ...sc, root: +v }; Engine.touch({ param: true }); draw(); }, "Тоника"),
        c2 && sc.mode !== "chromatic" && dwBtn("🧲", () => { c2.scale = { ...sc, snap: !sc.snap }; Engine.touch({ param: true }); tools(); },
          { title: "Ноты прилипают к ладу", className: "dw-btn dw-tog" + (sc.snap ? " on" : "") }),
        el("div", { className: "dw-seg" },
          dwBtn("↔−", () => zoom(0.8), { title: "Мельче по времени (Ctrl+колесо)" }), dwBtn("↔＋", () => zoom(1.25), { title: "Крупнее по времени" })),
        el("div", { className: "dw-seg" },
          dwBtn("↕−", () => vz(0.8), { title: "Ниже строки — больше нот на экране (Alt+колесо)" }), dwBtn("↕＋", () => vz(1.25), { title: "Выше строки" })),
        dwBtn("🎛", () => Dawn.open("inst", Dawn.pianoCh), { title: "Открыть инструмент" }),
        el("span", { className: "dw-dim", textContent: `${notes().length} нот${sel.size ? ` · выделено ${sel.size}` : ""}` })].filter(Boolean));
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
    /* вертикальный зум: держим ту же ноту под курсором (или в центре) */
    function vz(k, atY = gridH() / 2) {
      const n = (atY + view.y) / rowH();
      vzoom = Math.max(0.25, Math.min(3, vzoom * k));
      view.y = n * rowH() - atY;
      clampView(); draw();
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
      for (let n = Math.max(0, yn(gh)); n <= Math.min(HI(), yn(0)); n++) {
        const y = ny(n), d = ((n % E) + E) % E;
        g.fillStyle = useScale ? (d === sc.root ? C.rowRoot : inScale(n, sc.set, E) ? C.rowIn : C.rowOut)
                               : (isBlack(n, E) ? C.rowB : C.rowW);
        g.fillRect(KEYS_W, y, W - KEYS_W, R);
        if (d === 0) { g.fillStyle = C.oct; g.fillRect(KEYS_W, y + R - 1, W - KEYS_W, 1); }
      }
      const beatU = 4 / pat.sig[1];
      for (let s = Math.floor(view.x * 4) / 4; s <= xs(W); s += 0.25) {
        const x = Math.round(sx(s)), isBar = Math.abs(s / bar - Math.round(s / bar)) < 1e-6, isBeat = Math.abs(s / beatU - Math.round(s / beatU)) < 1e-6;
        if (!isBar && !isBeat && view.px < 40) continue;
        g.fillStyle = isBar ? C.g3 : isBeat ? C.g2 : C.g1;
        g.fillRect(x, 0, 1, gh);
      }
      if (sx(len) < W) { g.fillStyle = C.shade; g.fillRect(Math.max(KEYS_W, sx(len)), 0, W, gh); }
      // ноты: выделенные — с рамкой, вне лада — пунктир, изгиб — диагональ к конечной высоте
      for (const nt of notes()) {
        const x = sx(nt.s), y = ny(nt.n), w = Math.max(3, nt.l * view.px - 1);
        if (x + w < KEYS_W || x > W || (y + R < 0 && !nt.b) || (y > gh && !nt.b)) continue;
        g.globalAlpha = 0.55 + 0.45 * nt.v;
        g.fillStyle = col; roundRect(x + 0.5, y + 1, w, Math.max(2, R - 2), Math.min(4, R / 3)); g.fill();
        g.globalAlpha = 1;
        if (sel.has(nt)) { g.strokeStyle = C.head; g.lineWidth = 2; g.stroke(); }
        else if (useScale && !inScale(nt.n, sc.set, E)) { g.setLineDash([3, 2]); g.strokeStyle = C.text; g.lineWidth = 1; g.stroke(); g.setLineDash([]); }
        if (nt.b) {
          const y2 = ny(nt.n + nt.b);
          g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x + 2, y + R / 2); g.lineTo(x + w, y2 + R / 2); g.stroke();
          g.fillStyle = col; g.beginPath(); g.arc(x + w, y2 + R / 2, 3.5, 0, 7); g.fill();
        }
        g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(x + w - 3, y + 3, 1.5, Math.max(1, R - 6));
        if (w > 26 && R >= 11) { g.fillStyle = C.noteText; g.font = "9px system-ui"; g.fillText(noteNameE(nt.n, E) + (nt.b ? (nt.b > 0 ? " ↗" : " ↘") : ""), x + 4, y + R - 3.5); }
      }
      if (marquee) {
        g.fillStyle = "rgba(159,211,255,0.18)"; g.strokeStyle = C.head; g.lineWidth = 1;
        const [x0, y0, x1, y1] = [Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1), Math.max(marquee.x0, marquee.x1), Math.max(marquee.y0, marquee.y1)];
        g.fillRect(x0, y0, x1 - x0, y1 - y0); g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      }
      for (let n = Math.max(0, yn(gh)); n <= Math.min(HI(), yn(0)); n++) {
        const y = ny(n), d = ((n % E) + E) % E, bl = isBlack(n, E);
        g.fillStyle = useScale && inScale(n, sc.set, E) ? (bl ? C.keyB : C.keyIn) : bl ? C.keyB : C.keyW;
        g.fillRect(0, y, bl ? KEYS_W * 0.62 : KEYS_W, R - (bl ? 0 : 1));
        if (useScale && d === sc.root) { g.fillStyle = C.g3; g.fillRect(KEYS_W - 4, y, 4, R - 1); }
        if (R >= 8 && (d === 0 || (R >= 12 && E !== 12))) {
          g.fillStyle = bl ? C.keyW : C.keyLbl; g.font = (d === 0 ? "600 " : "") + "9px system-ui";
          g.fillText(d === 0 ? noteNameE(n, E) : names[d], 24, y + R - 3);
        }
      }
      g.fillStyle = C.panel; g.fillRect(0, gh, W, VEL_H);
      g.fillStyle = C.dim; g.font = "9px system-ui"; g.fillText("VEL", 8, gh + 14);
      for (const nt of notes()) {
        const x = sx(nt.s);
        if (x < KEYS_W - 2 || x > W) continue;
        const hgt = (VEL_H - 10) * nt.v;
        g.fillStyle = sel.has(nt) ? C.head : col; g.fillRect(x, H - 4 - hgt, 3, hgt);
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
    function cursor() { cv.style.cursor = tool === "select" ? "default" : tool === "bend" ? "ns-resize" : "crosshair"; }

    /* ---------- буфер обмена ---------- */
    const selected = () => notes().filter(n => sel.has(n));
    function copy() {
      const L = selected();
      if (!L.length) return;
      const s0 = Math.min(...L.map(n => n.s));
      clipboard = L.map(n => ({ s: n.s - s0, l: n.l, n: n.n, v: n.v, b: n.b, edo: edo() }));
      pasteAt = Math.max(...L.map(n => n.s + n.l));
    }
    function cut() { copy(); delSel(); }
    function delSel() {
      if (!sel.size) return;
      const L = notes();
      for (let i = L.length - 1; i >= 0; i--) if (sel.has(L[i])) L.splice(i, 1);
      sel.clear(); changed(); tools(); draw();
    }
    function paste() {
      if (!clipboard?.length) return;
      const k = edo() / (clipboard[0].edo || edo()), L = notes();
      sel.clear();
      const at = Math.round(pasteAt / snap()) * snap();
      for (const c2 of clipboard) {
        const nt = { s: +(at + c2.s).toFixed(4), l: c2.l, n: Math.round(c2.n * k), v: c2.v };
        if (c2.b) nt.b = c2.b * k;
        L.push(nt); sel.add(nt);
      }
      pasteAt = at + Math.max(...clipboard.map(c2 => c2.s + c2.l));
      changed(); tools(); draw();
    }

    /* ---------- мышь ---------- */
    let drag = null;
    cv.addEventListener("pointerdown", e => {
      if (!ch()) return;
      Engine.init();
      cv.focus({ preventScroll: true });
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      cv.setPointerCapture(e.pointerId);
      if (y > gridH()) { drag = { vel: true }; velAt(x, y); return; }
      if (x < KEYS_W) { Engine.preview(ch(), yn(y), 0.85, 0.4); return; }
      const h = hit(x, y);
      pasteAt = Math.max(0, Math.floor(xs(x) / snap()) * snap());
      if (e.button === 2) { drag = { erase: true }; if (h) del(h.nt); return; }
      if (tool === "bend") {
        if (h) { drag = { bend: h.nt, y0: y, b0: h.nt.b || 0 }; Engine.preview(ch(), h.nt.n, h.nt.v, h.nt.l * Engine.beatDur()); }
        return;
      }
      if (tool === "select") {
        if (h && sel.has(h.nt) && !e.shiftKey) drag = moveGroup(selected(), x, y);
        else if (h) { if (!e.shiftKey) sel.clear(); sel.add(h.nt); drag = moveGroup(selected(), x, y); tools(); }
        else { if (!e.shiftKey) sel.clear(); marquee = { x0: x, y0: y, x1: x, y1: y, add: e.shiftKey, base: new Set(sel) }; drag = { marquee: true }; tools(); }
        draw(); return;
      }
      // кисть
      if (h) {
        if (h.edge) drag = { nt: h.nt, resize: true };
        else { drag = sel.has(h.nt) && sel.size > 1 ? moveGroup(selected(), x, y) : moveGroup([h.nt], x, y); Engine.preview(ch(), h.nt.n, h.nt.v, 0.2); }
      } else {
        const q = snap(), s = Math.max(0, Math.floor(xs(x) / q + 1e-6) * q), n = fixPitch(yn(y));
        const nt = { s: +s.toFixed(4), l: lastLen, n, v: 0.85 };
        notes().push(nt);
        sel.clear();
        Engine.preview(ch(), n, 0.85, lastLen * Engine.beatDur());
        drag = { nt, resize: true };
        changed();
      }
    });
    function moveGroup(list, x, y) {
      return { group: list.map(nt => ({ nt, s0: nt.s, n0: nt.n })), sx0: xs(x), n0: yn(y), lastN: yn(y) };
    }
    cv.addEventListener("pointermove", e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!drag) {
        const h = y < gridH() && x > KEYS_W ? hit(x, y) : null;
        if (tool === "brush") cv.style.cursor = h ? (h.edge ? "ew-resize" : "grab") : x > KEYS_W && y < gridH() ? "crosshair" : "default";
        else cursor();
        return;
      }
      const q = snap();
      if (drag.vel) return velAt(x, y);
      if (drag.erase) { const h = hit(x, y); if (h) del(h.nt); return; }
      if (drag.marquee) {
        marquee.x1 = x; marquee.y1 = y;
        const s0 = xs(Math.min(marquee.x0, x)), s1 = xs(Math.max(marquee.x0, x)), n0 = yn(Math.max(marquee.y0, y)), n1 = yn(Math.min(marquee.y0, y));
        sel = new Set(marquee.add ? marquee.base : []);
        for (const nt of notes()) if (nt.s < s1 && nt.s + nt.l > s0 && nt.n >= n0 && nt.n <= n1) sel.add(nt);
        draw(); return;
      }
      if (drag.bend) {   // изгиб: вверх/вниз на сколько ступеней
        const b = Math.round(drag.b0 + (drag.y0 - y) / rowH());
        if (b) drag.bend.b = b; else delete drag.bend.b;
        changed(true); draw(); return;
      }
      if (drag.group) {
        const ds = Math.round((xs(x) - drag.sx0) / q) * q, dn = yn(y) - drag.n0;
        const minS = Math.min(...drag.group.map(g2 => g2.s0)), dsC = Math.max(-minS, ds);
        for (const g2 of drag.group) { g2.nt.s = +(g2.s0 + dsC).toFixed(4); g2.nt.n = drag.group.length === 1 ? fixPitch(g2.n0 + dn) : Math.max(0, Math.min(HI(), g2.n0 + dn)); }
        if (yn(y) !== drag.lastN) { drag.lastN = yn(y); Engine.preview(ch(), drag.group[0].nt.n, drag.group[0].nt.v, 0.15); }
      } else if (drag.resize) {
        drag.nt.l = +Math.max(q, Math.round((xs(x) - drag.nt.s) / q) * q).toFixed(4);
      }
      changed(true);
      draw();
    });
    const up = () => {
      if (drag?.nt) lastLen = drag.nt.l;
      if (drag && !drag.erase) changed();
      if (drag?.marquee) { marquee = null; tools(); }
      drag = null;
      draw();
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    function del(nt) { const L = notes(), i = L.indexOf(nt); if (i >= 0) { L.splice(i, 1); sel.delete(nt); changed(); draw(); } }
    function velAt(x, y) {
      const v = Math.max(0.05, Math.min(1, (H - 4 - y) / (VEL_H - 10)));
      let best = null, bd = 8;
      for (const nt of notes()) { const d = Math.abs(sx(nt.s) - x); if (d < bd) { bd = d; best = nt; } }
      if (!best) return;
      for (const nt of sel.has(best) ? selected() : [best]) nt.v = +v.toFixed(3);   // по выделенным — всем сразу
      Engine.touch({ param: true }); draw();
    }
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.altKey) return vz(e.deltaY < 0 ? 1.12 : 0.89, e.clientY - r.top);
      if (e.ctrlKey || e.metaKey) return zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - r.left);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x = Math.max(0, view.x + (e.deltaX || e.deltaY) / view.px);
      else view.y += e.deltaY;
      clampView(); draw();
    }, { passive: false });

    /* клавиши — когда фокус на ролле */
    cv.addEventListener("keydown", e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === "KeyC") copy();
      else if (mod && e.code === "KeyX") cut();
      else if (mod && e.code === "KeyV") paste();
      else if (mod && e.code === "KeyA") { sel = new Set(notes()); tools(); draw(); }
      else if (e.code === "Delete" || e.code === "Backspace") delSel();
      else if (!mod && e.code === "KeyB") { tool = "brush"; tools(); cursor(); }
      else if (!mod && e.code === "KeyS") { tool = "select"; tools(); cursor(); }
      else if (!mod && e.code === "KeyG") { tool = "bend"; tools(); cursor(); }
      else if (sel.size && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        const L = selected(), q = snap();
        const dn = e.code === "ArrowUp" ? (e.shiftKey ? edo() : 1) : e.code === "ArrowDown" ? -(e.shiftKey ? edo() : 1) : 0;
        const ds = e.code === "ArrowRight" ? q : e.code === "ArrowLeft" ? -q : 0;
        if (ds < 0 && L.some(n => n.s + ds < 0)) return e.preventDefault();
        for (const n of L) { n.n = Math.max(0, Math.min(HI(), n.n + dn)); n.s = +(n.s + ds).toFixed(4); }
        if (dn && L.length === 1) Engine.preview(ch(), L[0].n, L[0].v, 0.2);
        changed(); draw();
      } else if (e.code === "Escape") { sel.clear(); tools(); draw(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    const ro = new ResizeObserver(() => {
      const mid = W && view.y >= 0 ? yn(gridH() / 2) : null;
      fit();
      if (mid == null) centerOnNotes(); else { view.y = (HI() - mid) * rowH() - gridH() / 2; clampView(); }
      draw();
    });
    ro.observe(wrap);
    tools(); cursor();
    let raf = 0, wasPlaying = false;
    const frame = () => { if (Engine.playing || wasPlaying) draw(); wasPlaying = Engine.playing; raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    const offs = [
      Engine.on("change", w => {
        if (w?.all || w?.channels) sel = new Set([...sel].filter(n => notes().includes(n)));
        if (w?.channels || w?.all || w?.piano || (w?.notes && !drag)) tools();
        if (!drag) draw();
      }),
      Engine.on("pattern", () => { sel.clear(); tools(); centerOnNotes(); draw(); }),
      Engine.on("theme", draw)];
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offs.forEach(f => f()); };
  },
};
