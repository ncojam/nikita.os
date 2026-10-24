import { el } from "../../core/util.js";
import { Engine } from "./engine.js";
import { dwBtn, pal, select, shell } from "./ui.js";

/* ================= DAWN — плейлист (общий таймлайн) =================
 * Клипы паттернов на дорожках: { id, p: паттерн, t: дорожка, s: начало, l: длина } (доли).
 * Слева — список паттернов (кисть): клик выбирает, двойной клик — открыть стойку.
 * ЛКМ по пустому — поставить клип выбранного паттерна; по клипу — двигать (и между дорожками);
 * за правый край — длина (длиннее паттерна — паттерн повторяется). ПКМ — удалить (можно вести).
 * Двойной клик по клипу — выбрать его паттерн. Клик по линейке — откуда играть песню.
 * Сетка — 4/4 (такт = 4 доли); паттерны в 7/4 и т. п. просто занимают свою длину.
 */
const HEAD_W = 74, RULER = 24, TRACK_H = 42, SIDE_W = 132;

export const PLAYLIST = {
  title: () => "Плейлист",
  icon: "🎞",
  color: "var(--dw-lemon)",
  size: () => [Math.min(1000, innerWidth - 40), 420, 30, Math.max(12, innerHeight - 70 - 440)],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-playlist", "var(--dw-lemon)");
    let snapV = "4";
    const tb = el("div", { className: "dw-pr-tools" });
    const side = el("div", { className: "dw-pl-side" });
    const cv = el("canvas", { className: "dw-pr-cv" });
    const wrap = el("div", { className: "dw-pr-wrap" }, cv);
    root.append(tb, el("div", { className: "dw-pl-body" }, side, wrap));
    const g = cv.getContext("2d");
    const P = () => Engine.project;
    const view = { px: 22, x: 0, y: 0 };      // px на долю
    let W = 0, H = 0;

    function tools() {
      tb.replaceChildren(
        el("div", { className: "dw-seg" },
          el("button", { className: "dw-btn" + (P().mode === "pat" ? " on" : ""), textContent: "PAT", title: "Играть текущий паттерн по кругу", onclick: () => Engine.setMode("pat") }),
          el("button", { className: "dw-btn" + (P().mode === "song" ? " on" : ""), textContent: "SONG", title: "Играть плейлист", onclick: () => Engine.setMode("song") })),
        select([["4", "⧉ такт"], ["2", "⧉ ½ такта"], ["1", "⧉ доля"], ["0.25", "⧉ 1/16"]], snapV, v => { snapV = v; }, "Привязка"),
        dwBtn("−", () => zoom(0.8)), dwBtn("＋", () => zoom(1.25)),
        el("span", { className: "dw-dim", textContent: `${P().playlist.length} клипов · ${(Engine.songLength() / 4).toFixed(1)} тактов` }));
    }
    function sideList() {
      side.replaceChildren(el("div", { className: "dw-dim dw-pl-h", textContent: "Паттерны" }),
        ...P().patterns.map(p => {
          const b = el("button", { className: "dw-pl-pat" + (p.id === P().cur ? " on" : ""), textContent: p.name, title: `${p.sig[0]}/${p.sig[1]} · ${Engine.patLength(p.id)} долей` });
          b.style.setProperty("--chip", p.color);
          b.onclick = () => Engine.selectPattern(p.id);
          b.ondblclick = () => { Engine.selectPattern(p.id); Dawn.open("rack"); };
          return b;
        }),
        dwBtn("＋ паттерн", () => Engine.addPattern()));
    }
    function fit() {
      const r = wrap.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
      W = Math.max(50, r.width); H = Math.max(60, r.height);
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function zoom(k, atX = HEAD_W + (W - HEAD_W) / 2) {
      const s = view.x + (atX - HEAD_W) / view.px;
      view.px = Math.max(4, Math.min(120, view.px * k));
      view.x = Math.max(0, s - (atX - HEAD_W) / view.px);
      draw();
    }
    const sx = s => HEAD_W + (s - view.x) * view.px;
    const xs = x => view.x + (x - HEAD_W) / view.px;
    const ty = t => RULER + t * TRACK_H - view.y;
    const yt = y => Math.floor((y - RULER + view.y) / TRACK_H);
    const snap = () => +snapV;

    function draw() {
      if (!W) return;
      const C = pal(), tracks = P().tracks;
      g.clearRect(0, 0, W, H);
      for (let t = 0; t < tracks; t++) {
        const y = ty(t);
        if (y + TRACK_H < RULER || y > H) continue;
        g.fillStyle = t % 2 ? C.rowB : C.rowW; g.fillRect(HEAD_W, y, W - HEAD_W, TRACK_H);
      }
      for (let b = Math.floor(view.x); b <= xs(W); b++) {   // доли и такты 4/4
        const x = Math.round(sx(b));
        if (b % 4 && view.px < 10) continue;
        g.fillStyle = b % 16 === 0 ? C.g3 : b % 4 === 0 ? C.g2 : C.g1;
        g.fillRect(x, RULER, 1, H - RULER);
      }
      // клипы
      for (const cl of P().playlist) {
        const pat = Engine.pat(cl.p);
        if (!pat) continue;
        const x = sx(cl.s), y = ty(cl.t) + 2, w = cl.l * view.px, h = TRACK_H - 4;
        if (x + w < HEAD_W || x > W || y + h < RULER || y > H) continue;
        g.save(); g.beginPath(); g.rect(HEAD_W, RULER, W - HEAD_W, H - RULER); g.clip();
        g.globalAlpha = 0.9; g.fillStyle = pat.color; rr(x, y, w - 1, h, 6); g.fill(); g.globalAlpha = 1;
        // повторы паттерна внутри клипа
        const pl = Engine.patLength(pat.id);
        g.fillStyle = "rgba(0,0,0,0.25)";
        for (let k = pl; k < cl.l - 1e-6; k += pl) g.fillRect(x + k * view.px, y + 3, 1.5, h - 6);
        // мини-ноты всех каналов паттерна
        const all = Object.values(pat.notes).flat();
        if (all.length) {
          let lo = Infinity, hi = -Infinity;
          for (const n of all) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); }
          const span = Math.max(1, hi - lo);
          g.fillStyle = "rgba(30,15,50,0.55)";
          for (let k = 0; k < cl.l - 1e-6; k += pl) for (const n of all) {
            if (k + n.s >= cl.l) continue;
            const nx = x + (k + n.s) * view.px, ny = y + 14 + (1 - (n.n - lo) / span) * (h - 19);
            g.fillRect(nx, ny, Math.max(1.5, Math.min(n.l, cl.l - k - n.s) * view.px - 1), 2);
          }
        }
        g.fillStyle = C.clipText; g.font = "600 10px system-ui";
        g.fillText(pat.name, x + 5, y + 11, Math.max(10, w - 10));
        g.fillStyle = "rgba(255,255,255,0.7)"; g.fillRect(x + w - 4, y + 4, 2, h - 8);
        g.restore();
      }
      // линейка
      g.fillStyle = C.panel; g.fillRect(HEAD_W, 0, W - HEAD_W, RULER);
      g.fillStyle = C.dim; g.font = "10px system-ui";
      const every = view.px < 6 ? 8 : view.px < 12 ? 4 : view.px < 30 ? 2 : 1;
      for (let bar = Math.floor(view.x / 4); bar * 4 <= xs(W); bar++) if (bar % every === 0) g.fillText(String(bar + 1), sx(bar * 4) + 3, 15);
      const st = P().songStart || 0;   // откуда играть
      g.fillStyle = C.g3; g.beginPath(); g.moveTo(sx(st) - 6, 2); g.lineTo(sx(st) + 6, 2); g.lineTo(sx(st), 12); g.fill();
      // головы дорожек
      g.fillStyle = C.panel; g.fillRect(0, RULER, HEAD_W, H - RULER);
      g.fillStyle = C.dim; g.font = "10px system-ui";
      for (let t = 0; t < tracks; t++) { const y = ty(t); if (y + TRACK_H > RULER && y < H) g.fillText("Track " + (t + 1), 10, y + TRACK_H / 2 + 3); }
      const pos = Engine.positionSong();
      if (pos >= 0) { const x = sx(pos); if (x >= HEAD_W) { g.fillStyle = C.head; g.fillRect(x, 0, 2, H); } }
    }
    function rr(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    function hit(x, y) {
      const t = yt(y), s = xs(x);
      for (const cl of [...P().playlist].reverse()) if (cl.t === t && s >= cl.s && s < cl.s + cl.l)
        return { cl, edge: x > sx(cl.s + cl.l) - 8 };
      return null;
    }

    let drag = null;
    const changed = () => Engine.touch({ playlist: true, param: true });
    cv.addEventListener("pointerdown", e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      cv.setPointerCapture(e.pointerId);
      if (y < RULER && x > HEAD_W) {   // линейка — откуда играть
        P().songStart = Math.max(0, Math.floor(xs(x) / snap()) * snap());
        if (Engine.playing && P().mode === "song") { Engine.stop(); Engine.play(); }
        draw(); return;
      }
      if (x < HEAD_W || y < RULER) return;
      const h = hit(x, y);
      if (e.button === 2) { drag = { erase: true }; if (h) del(h.cl); return; }
      if (e.detail === 2 && h) { Engine.selectPattern(h.cl.p); Dawn.open("rack"); return; }
      if (h) drag = h.edge ? { cl: h.cl, resize: true } : { cl: h.cl, move: true, ds: xs(x) - h.cl.s };
      else {
        const t = yt(y);
        if (t < 0 || t >= P().tracks) return;
        const s = Math.max(0, Math.floor(xs(x) / snap()) * snap());
        const cl = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), p: P().cur, t, s, l: Engine.patLength() };
        P().playlist.push(cl);
        drag = { cl, move: true, ds: xs(x) - s };
        changed();
      }
      draw();
    });
    cv.addEventListener("pointermove", e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!drag) {
        const h = y > RULER && x > HEAD_W ? hit(x, y) : null;
        cv.style.cursor = h ? (h.edge ? "ew-resize" : "grab") : y < RULER ? "pointer" : "crosshair";
        return;
      }
      if (drag.erase) { const h = hit(x, y); if (h) del(h.cl); return; }
      const q = snap();
      if (drag.move) {
        drag.cl.s = Math.max(0, Math.round((xs(x) - drag.ds) / q) * q);
        drag.cl.t = Math.max(0, Math.min(P().tracks - 1, yt(y)));
      } else if (drag.resize) drag.cl.l = Math.max(Math.min(q, 0.25) || 0.25, Math.round((xs(x) - drag.cl.s) / q) * q || q);
      changed(); draw();
    });
    const up = () => { if (drag && !drag.erase) Engine.touch({ playlist: true }); drag = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    function del(cl) { const L = P().playlist, i = L.indexOf(cl); if (i >= 0) { L.splice(i, 1); changed(); tools(); draw(); } }
    cv.addEventListener("wheel", e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return zoom(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - cv.getBoundingClientRect().left);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) view.x = Math.max(0, view.x + (e.deltaX || e.deltaY) / view.px);
      else view.y = Math.max(0, Math.min(P().tracks * TRACK_H - (H - RULER), view.y + e.deltaY));
      draw();
    }, { passive: false });

    const ro = new ResizeObserver(() => { fit(); draw(); });
    ro.observe(wrap);
    tools(); sideList();
    let raf = 0, was = false;
    const frame = () => { if (Engine.playing || was) draw(); was = Engine.playing; raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    const offs = [
      Engine.on("change", w => { if (!w?.param || w?.playlist) { tools(); if (!w?.param) sideList(); } if (!drag) draw(); }),
      Engine.on("pattern", () => { sideList(); draw(); }), Engine.on("mode", tools), Engine.on("theme", draw)];
    return () => { cancelAnimationFrame(raf); ro.disconnect(); offs.forEach(f => f()); };
  },
};
