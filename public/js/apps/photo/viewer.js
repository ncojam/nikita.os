import { baseName, el, fsUrl, store } from "../../core/util.js";
import { VFS } from "../../core/vfs.js";
import { notify } from "../../ui/notify.js";
import { WM } from "../../wm.js";
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
  const name = baseName(path);
  return WM.open({ title: name, icon: "🖼️", key: "file:" + path, width: 820, height: 600, render(c, w) {
    const st = { mode: "flat", strength: 0.04, focus: 0.5, x: 0, y: 0, cursor: true, eye: 1, ...store.get(SET, {}), ...(opts.set || {}) };
    const stage = el("div", { className: "ph-stage" });
    const img = el("img", { className: "ph-img", alt: name, src: fsUrl(path) });
    const canvas = el("canvas", { className: "ph-canvas", hidden: true });
    const box3d = el("div", { className: "ph-3d", hidden: true });
    const info = el("div", { className: "ph-info" });
    stage.append(img, canvas, box3d, info);
    const bFlat = el("button", { className: "ph-mode", textContent: "🖼 Фото" });
    const bPar = el("button", { className: "ph-mode", textContent: "🌊 Параллакс" });
    const b3d = el("button", { className: "ph-mode", textContent: "🧊 3D", disabled: true, title: "Сцену 3D делает тулчейн на компьютере (tools/photo3d) — файл <картинка>.scene.nvx" });
    const tools = el("div", { className: "ph-tools" });
    c.append(el("div", { className: "photo" }, stage, el("div", { className: "ph-bar" }, el("div", { className: "ph-modes" }, bFlat, bPar, b3d), tools)));

    let depthImg = null, depthFrom = "", par = null, s3d = null, raf = 0, dead = false;
    const say = (t, ms = 0) => { info.textContent = t; info.hidden = !t; if (ms) setTimeout(() => info.textContent === t && (info.hidden = true), ms); };
    const save = () => store.set(SET, { strength: st.strength, focus: st.focus, cursor: st.cursor, eye: st.eye });

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
      if (m !== "3d" && s3d) { s3d.dispose(); s3d = null; }
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
        el("span", { className: "ph-dim", textContent: "глубина: " + depthFrom }));
      say("");
      const m = { x: 0, y: 0 }, sm = { x: 0, y: 0 };
      const onMove = e => { const r = stage.getBoundingClientRect(); m.x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2))); m.y = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2))); };
      addEventListener("pointermove", onMove);
      const tick = () => {
        if (dead || st.mode !== "parallax") { removeEventListener("pointermove", onMove); return; }
        sm.x += ((st.cursor ? m.x : 0) - sm.x) * 0.12; sm.y += ((st.cursor ? m.y : 0) - sm.y) * 0.12;
        par.set({ x: Math.max(-1.5, Math.min(1.5, st.x + sm.x)), y: Math.max(-1.5, Math.min(1.5, st.y + sm.y)), strength: st.strength, focus: st.focus });
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
          s3d = await createScene3D(box3d, await r.arrayBuffer(), { key: path, onInfo: t => say(t, 5000) });
          s3d.setEye(st.eye);
        } catch (e) { say("⚠ " + e.message); return; }
        say((s3d.head.kind === "minecraft" ? "⛏ Сцена Minecraft" : "🧊 Сцена из фото") + ` · ${s3d.head.count.toLocaleString(globalThis.NOS_LOCALE)} вокселей`, 4000);
      }
      const walk = el("button", { className: "btn small", textContent: "🚶 Ходить", onclick: () => { const on = s3d.mode !== "walk"; s3d.setMode(on ? "walk" : "orbit"); walk.classList.toggle("on", on); } });
      tools.replaceChildren(walk,
        el("button", { className: "btn small", textContent: "📐 Пол по 3 точкам", title: "Кликни три точки на полу — сцена встанет на него", onclick: () => { if (s3d.mode === "walk") { s3d.setMode("orbit"); walk.classList.remove("on"); } s3d.pickFloor(); } }),
        el("button", { className: "btn small", textContent: "↺ Пол", title: "Сбросить свой пол", onclick: () => s3d.resetFloor() }),
        el("button", { className: "btn small", textContent: "▦", title: "Сетка пола", onclick: () => s3d.toggleGrid() }),
        el("button", { className: "btn small", textContent: "📷", title: "Вернуться в точку съёмки", onclick: () => s3d.home() }),
        range("Рост", "eye", 0.25, 4, 0.05, () => s3d?.setEye(st.eye), "Масштаб: высота глаз над полом (и скорость шага)"));
    }

    bFlat.onclick = () => setMode("flat");
    bPar.onclick = () => setMode("parallax");
    b3d.onclick = () => setMode("3d");
    stage.ondblclick = () => WM.setMax(w, !w.maximized);
    fetch(fsUrl(path + ".scene.nvx"), { method: "HEAD", cache: "no-store" }).then(r => { if (r.ok) { b3d.disabled = false; b3d.title = "Воксельная сцена: облёт, ходьба, пол"; } }).catch(() => {});

    w.cmd = () => `photo ${JSON.stringify(path)} ${st.mode} ${JSON.stringify({ strength: st.strength, focus: st.focus, x: st.x, y: st.y, cursor: st.cursor, eye: st.eye })}`;
    w.onClose = () => { dead = true; cancelAnimationFrame(raf); par?.dispose(); s3d?.dispose(); };
    const want = opts.mode || "flat";
    if (want !== "flat") setMode(want);
    else {
      setMode("flat");
      // глубина уже есть рядом — сразу оживляем (параллакс — главная фишка просмотрщика)
      fetch(fsUrl(path + ".depth.png"), { method: "HEAD", cache: "no-store" }).then(r => r.ok && !dead && st.mode === "flat" && setMode("parallax")).catch(() => {});
    }
  } });
}
