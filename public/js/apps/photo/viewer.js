import { baseName, el, fsUrl, store } from "../../core/util.js";
import { isSidecar, kindOf } from "../../core/types.js";
import { VFS } from "../../core/vfs.js";
import { notify } from "../../ui/notify.js";
import { WM } from "../../wm.js";
import { Ambient } from "./ambient.js";
import { computeDepth } from "./depth.js";
import { Parallax } from "./parallax.js";

/* ================= Просмотрщик фото: 🖼 фото · 🌊 параллакс · 🧊 3D =================
 * Данные лежат рядом с картинкой (общее правило сайта для «производных» файлов):
 *   <картинка>.depth.png — карта глубины (белое — близко);  <картинка>.scene.nvx — воксельная сцена (apps/photo/nvx.js).
 * Проводник показывает их отдельной группой внизу папки, рабочий стол — прячет (core/types.js: isSidecar).
 *
 * Где берётся глубина, по порядку:
 *   1) файл рядом (его готовит тулчейн tools/photo3d на компьютере автора — так серверу не надо напрягаться);
 *   2) картинка из личного слоя посетителя (загружена в браузер) — считаем в браузере и кладём рядом туда же;
 *   3) сервер: /api/depth — посчитанная им раньше или поставленная в очередь (сервер считает в тихие часы);
 *      пока в очереди — можно посчитать в браузере (скачается модель ~27 МБ), результат ляжет в личный слой.
 * Сцена 3D — только из тулчейна (это тяжёлая работа).
 *
 * Ползунки «Угол X/Y», «Сила», «Фокус», «Рост» — обычные регуляторы окна, поэтому они цели проводков:
 * LFO из «Генераторов» на «Угол X» — и фото само покачивается. ⌘ даёт команду photo с текущими настройками.
 */
const SET = "photo.set";
const enc = encodeURIComponent;

export function openPhoto(path, opts = {}) {
  return WM.open({ title: baseName(path), icon: "🖼️", key: "file:" + path, width: 820, height: 600, render(c, w) {
    /* листать: соседние картинки той же папки (‹ ›, ←/→, PageUp/PageDown, Home/End); режим сохраняется */
    let view = null, cur = path, list = null;
    const amb = new Ambient();   // эмбиент и шаги живут у окна, а не у картинки: листание музыку не обрывает
    const siblings = async () => {
      if (list) return list;
      const dir = cur.slice(0, cur.lastIndexOf("/")) || "/";
      try {
        const d = await (await fetch("/api/ls?path=" + enc(dir))).json();
        list = (d.entries || []).filter(e => e.type === "file" && kindOf(e.name) === "image" && !isSidecar(e.name)).map(e => (dir === "/" ? "" : dir) + "/" + e.name);
      } catch { list = []; }
      return list;
    };
    const show = (p, o) => {
      const mode = view?.mode();
      view?.stop();
      c.replaceChildren();
      cur = p; w.key = "file:" + p; w.node.dataset.wkey = w.key; w.setTitle(baseName(p));
      view = mount(c, w, p, o || { mode }, nav);
    };
    const nav = { amb,
      async step(d) {
        const L = await siblings(), i = L.indexOf(cur);
        if (L.length < 2) return;
        show(L[i < 0 ? 0 : (i + d + L.length) % L.length]);
      },
      async jump(end) { const L = await siblings(); if (L.length) show(end ? L.at(-1) : L[0]); },
      async where() { const L = await siblings(); return L.length > 1 ? `${L.indexOf(cur) + 1} / ${L.length}` : ""; },
    };
    w.onKey = e => {
      if (e.target.closest?.("input, select")) return;
      const k = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key];
      if (k) { e.preventDefault(); nav.step(k); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); nav.jump(e.key === "End"); }
    };
    w.onClose = () => { view?.stop(); amb.close(); };
    show(path, opts);
  } });
}

/* одна картинка в окне просмотрщика; возвращает { stop(), mode() } */
function mount(c, w, path, opts, nav) {
  const name = baseName(path);
  {
    const st = { mode: "flat", strength: 0.04, focus: 0.5, x: 0, y: 0, cursor: true, eye: 1, vol: 0.6, win: 0.5, pt: 1.2, collide: false, ...store.get(SET, {}), ...(opts.set || {}) };
    const stage = el("div", { className: "ph-stage" });
    const img = el("img", { className: "ph-img", alt: name, src: fsUrl(path) });
    const canvas = el("canvas", { className: "ph-canvas", hidden: true });
    const box3d = el("div", { className: "ph-3d", hidden: true });
    const info = el("div", { className: "ph-info" });
    const bPrev = el("button", { className: "ph-nav prev", textContent: "‹", title: "Предыдущая (←)", onclick: () => nav.step(-1) });
    const bNext = el("button", { className: "ph-nav next", textContent: "›", title: "Следующая (→)", onclick: () => nav.step(1) });
    const count = el("span", { className: "ph-count no-i18n" });
    nav.where().then(t => { count.textContent = t; bPrev.hidden = bNext.hidden = !t; });
    stage.append(img, canvas, box3d, bPrev, bNext, info);
    const bFlat = el("button", { className: "ph-mode", textContent: "🖼 Фото" });
    const bPar = el("button", { className: "ph-mode", textContent: "🌊 Параллакс" });
    const b3d = el("button", { className: "ph-mode", textContent: "🧊 3D", disabled: true, title: "Сцену 3D делает тулчейн на компьютере (tools/photo3d) — файл <картинка>.scene.nvx" });
    const tools = el("div", { className: "ph-tools" });
    c.append(el("div", { className: "photo" }, stage, el("div", { className: "ph-bar" }, el("div", { className: "ph-modes" }, bFlat, bPar, b3d), tools, count)));

    let depthImg = null, depthFrom = "", par = null, s3d = null, raf = 0, dead = false;
    const say = (t, ms = 0) => { info.textContent = t; info.hidden = !t; if (ms) setTimeout(() => info.textContent === t && (info.hidden = true), ms); };
    const save = () => store.set(SET, { vol: st.vol, win: st.win, strength: st.strength, focus: st.focus, cursor: st.cursor, eye: st.eye, pt: st.pt, collide: st.collide });

    /* ---------- ползунки (они же цели проводков) ---------- */
    const range = (label, key, min, max, step, onSet, title = "") => {
      const inp = el("input", { type: "range", min, max, step, value: st[key], title: title || label,
        oninput: () => { st[key] = +inp.value; onSet?.(); save(); } });
      return el("label", { className: "ph-rng" }, el("span", { textContent: label }), inp);
    };

    /* ---------- глубина ---------- */
    const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("картинка не открылась")); i.src = src; });
    async function findDepth() {
      const side = await fetch(fsUrl(path + ".depth.png"), { cache: "no-store" }).catch(() => null);
      if (side?.ok) return { blob: await side.blob(), from: "файл рядом" };
      let local = false;
      try { local = !!(await (await fetch("/api/entry?path=" + enc(path))).json()).local; } catch {}
      if (local) return { compute: true, from: "посчитана в браузере" };
      try {
        const r = await fetch("/api/depth?path=" + enc(path), { cache: "no-store" });
        if (r.status === 200) return { blob: await r.blob(), from: "сервер" };
        if (r.status === 202) return { queued: (await r.json().catch(() => ({}))).position };
      } catch {}
      return { none: true };
    }
    async function compute() {
      try {
        const src = await loadImg(fsUrl(path));
        const blob = await computeDepth(src, { onStage: t => say("🧠 " + t) });
        try { await VFS.writeFile(path + ".depth.png", blob, "image/png"); } catch { /* не сохранилось — покажем и так */ }
        return blob;
      } catch (e) { say("⚠ " + e.message); throw e; }
    }
    async function ensureDepth() {
      if (depthImg) return true;
      say("Ищу карту глубины…");
      const d = await findDepth();
      let blob = d.blob;
      if (d.compute) blob = await compute().catch(() => null);
      if (d.queued != null || d.none) {
        say("");
        const msg = d.queued != null ? `Сервер посчитает глубину в тихие часы (в очереди: ${d.queued}).` : "Карты глубины пока нет.";
        tools.replaceChildren(el("span", { className: "ph-dim", textContent: msg }),
          el("button", { className: "btn small", textContent: "🧠 Посчитать в браузере", title: "Скачается модель ~27 МБ, результат сохранится у вас в браузере",
            onclick: async () => { const b = await compute().catch(() => null); if (b) { depthImg = await loadImg(URL.createObjectURL(b)); depthFrom = "посчитана в браузере"; setMode("parallax"); } } }));
        return false;
      }
      if (!blob) return false;
      depthImg = await loadImg(URL.createObjectURL(blob));
      depthFrom = d.from;
      return true;
    }

    /* ---------- режимы ---------- */
    async function setMode(m) {
      if (m === "parallax" && !(await ensureDepth())) { if (st.mode !== "parallax") m = "flat"; else return; }
      if (dead) return;
      st.mode = m;
      [bFlat, bPar, b3d].forEach((b, i) => b.classList.toggle("on", ["flat", "parallax", "3d"][i] === m));
      img.hidden = m !== "flat"; canvas.hidden = m !== "parallax"; box3d.hidden = m !== "3d";
      cancelAnimationFrame(raf);
      w.node.style.transform = "";
      if (m !== "3d" && s3d) { s3d.dispose(); s3d = null; }
      if (m !== "3d") nav.amb.leave();   // ушли из 3D — эмбиент затихает
      if (m === "flat") { tools.replaceChildren(el("span", { className: "ph-dim", textContent: "Двойной клик — во весь экран окна" })); say(""); return; }
      if (m === "parallax") return startParallax();
      if (m === "3d") return start3d();
    }

    async function startParallax() {
      if (!par) {
        await img.decode().catch(() => {});
        try { par = new Parallax(canvas, img, depthImg); }
        catch (e) { say("⚠ " + e.message); return; }
      }
      const cur = el("button", { className: "btn small" + (st.cursor ? " on" : ""), textContent: "🖱 Курсор", title: "Угол обзора — от положения курсора относительно центра",
        onclick: () => { st.cursor = !st.cursor; cur.classList.toggle("on", st.cursor); save(); } });
      tools.replaceChildren(cur,
        range("Угол X", "x", -1, 1, 0.01, null, "Угол обзора по горизонтали (прибавляется к курсору) — цель для проводков"),
        range("Угол Y", "y", -1, 1, 0.01, null, "Угол обзора по вертикали — цель для проводков"),
        range("Сила", "strength", 0, 0.12, 0.002),
        range("Фокус", "focus", 0, 1, 0.01, null, "Какая глубина стоит на месте: 0 — дальнее, 1 — ближнее"),
        range("Окно", "win", 0, 1, 0.01, null, "Окно поворачивается вместе с картинкой (0 — не поворачивать) — цель для проводков"),
        el("span", { className: "ph-dim", textContent: "глубина: " + depthFrom }));
      say("");
      const m = { x: 0, y: 0 }, sm = { x: 0, y: 0 };
      const onMove = e => { const r = stage.getBoundingClientRect(); m.x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2))); m.y = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2))); };
      addEventListener("pointermove", onMove);
      const tick = () => {
        if (dead || st.mode !== "parallax") { removeEventListener("pointermove", onMove); return; }
        sm.x += ((st.cursor ? m.x : 0) - sm.x) * 0.12; sm.y += ((st.cursor ? m.y : 0) - sm.y) * 0.12;
        const x = Math.max(-1.5, Math.min(1.5, st.x + sm.x)), y = Math.max(-1.5, Math.min(1.5, st.y + sm.y));
        par.set({ x, y, strength: st.strength, focus: st.focus });
        // окно поворачивается вслед за ракурсом: смотришь справа — правый край ближе (как настоящая рамка)
        const deg = st.win * 16;
        w.node.style.transform = deg && !w.maximized ? `perspective(1600px) rotateY(${(-x * deg).toFixed(2)}deg) rotateX(${(y * deg).toFixed(2)}deg)` : "";
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    async function start3d() {
      if (!s3d) {
        say("Строю сцену…");
        try {
          const r = await fetch(fsUrl(path + ".scene.nvx"), { cache: "no-store" });
          if (!r.ok) throw new Error("нет файла сцены");
          const { createScene3D } = await import("./scene3d.js");
          s3d = await createScene3D(box3d, await r.arrayBuffer(), { key: path, onInfo: t => say(t, 5000), onStep: (p, mc) => nav.amb.step(p, mc) });
          nav.amb.setVolume(st.vol); nav.amb.enter();
          s3d.setEye(st.eye); s3d.setPointSize(st.pt); s3d.setCollide(!!st.collide);
        } catch (e) { say("⚠ " + e.message + " — показываю фото", 4000); return setMode("flat"); }
        say((s3d.head.kind === "minecraft" ? "⛏ Сцена Minecraft" : "🧊 Сцена из фото") + ` · ${s3d.head.count.toLocaleString(globalThis.NOS_LOCALE)} вокселей`, 4000);
      }
      const pts = range("Точки", "pt", 0.3, 4, 0.05, () => s3d?.setPointSize(st.pt), "Размер точек");
      const walk = el("button", { className: "btn small", textContent: "🚶 Ходить", onclick: () => { const on = s3d.mode !== "walk"; s3d.setMode(on ? "walk" : "orbit"); walk.classList.toggle("on", on); } });
      tools.replaceChildren(walk,
        el("button", { className: "btn small", textContent: "📐 Пол по 3 точкам", title: "Кликни три точки на полу — сцена встанет на него", onclick: () => { if (s3d.mode === "walk") { s3d.setMode("orbit"); walk.classList.remove("on"); } s3d.pickFloor(); } }),
        el("button", { className: "btn small", textContent: "↺ Пол", title: "Сбросить свой пол", onclick: () => s3d.resetFloor() }),
        el("button", { className: "btn small", textContent: "▦", title: "Сетка пола", onclick: () => s3d.toggleGrid() }),
        el("button", { className: "btn small", textContent: "📷", title: "Вернуться в точку съёмки", onclick: () => s3d.home() }),
        (() => { const b = el("button", { className: "btn small" + (s3d.collide ? " on" : ""), textContent: "🧱", title: "Столкновения с вокселями (выкл — ходишь сквозь, только по полу)",
          onclick: () => { s3d.setCollide(!s3d.collide); b.classList.toggle("on", s3d.collide); st.collide = s3d.collide; save(); } }); return b; })(),
        pts,
        range("Звук", "vol", 0, 1, 0.01, () => nav.amb.setVolume(st.vol), "Громкость эмбиента и шагов — цель для проводков"),
        range("Рост", "eye", 0.25, 4, 0.05, () => s3d?.setEye(st.eye), "Масштаб: высота глаз над полом (и скорость шага)"));
    }

    bFlat.onclick = () => setMode("flat");
    bPar.onclick = () => setMode("parallax");
    b3d.onclick = () => setMode("3d");
    stage.ondblclick = () => WM.setMax(w, !w.maximized);
    fetch(fsUrl(path + ".scene.nvx"), { method: "HEAD", cache: "no-store" }).then(r => { if (r.ok) { b3d.disabled = false; b3d.title = "Воксельная сцена: облёт, ходьба, пол"; } }).catch(() => {});

    w.cmd = () => `photo ${JSON.stringify(path)} ${st.mode} ${JSON.stringify({ strength: st.strength, focus: st.focus, x: st.x, y: st.y, win: st.win, cursor: st.cursor, eye: st.eye })}`;
    const stop = () => { dead = true; cancelAnimationFrame(raf); w.node.style.transform = ""; par?.dispose(); s3d?.dispose(); };
    const want = opts.mode || "flat";
    if (want !== "flat") setMode(want);
    else {
      setMode("flat");
      // глубина уже есть рядом — сразу оживляем (параллакс — главная фишка просмотрщика)
      fetch(fsUrl(path + ".depth.png"), { method: "HEAD", cache: "no-store" }).then(r => r.ok && !dead && st.mode === "flat" && setMode("parallax")).catch(() => {});
    }
    return { stop, mode: () => st.mode };
  }
}
