import { el, store } from "../core/util.js";
import "../i18n/palette.js";
import { copyText, notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { DITHERS, METHODS, METRICS, collect, isDiffusion, isOrdered, makePalette, prepare, render } from "./palette-algo.js";

/* ================= Палитра: сжатие картинки до N цветов =================
 * Вставил картинку (Ctrl+V / «Вставить» / перетащил файл) → выбрал число цветов, способ подбора палитры,
 * дизеринг и способ сравнения цветов → результат пересчитывается сразу, а «Скопировать» кладёт PNG в буфер.
 * Алгоритмы — palette-algo.js (без DOM). Здесь — только окно, чтение картинки и кэши:
 *   • картинка уменьшается до выбранного размера один раз (src), а не на каждое движение ползунка;
 *   • палитра пересчитывается, только если сменились картинка / размер / число цветов / метод;
 *   • дизеринг — каждый раз, но обновления склеиваются через requestAnimationFrame.
 * Всё считается в браузере, на сервер ничего не уходит. Настройки — store("palette.opts").
 */
const MAX_SIDE = 2048;
const SIZES = [[0, "Оригинал"], [1024, "1024 px"], [512, "512 px"], [256, "256 px"], [128, "128 px"], [64, "64 px"], [32, "32 px"], [16, "16 px"]];
const SCALES = [1, 2, 4, 8, 16];
const DEF = { n: 16, method: "median", dither: "fs", strength: 100, serp: true, metric: "redmean", size: 0, scale: 1 };

export function openPalette() {
  WM.open({ title: "Палитра", icon: "🎨", width: 900, height: 620, key: "palette", render(c, w) {
    c.classList.add("pl");
    const o = { ...DEF, ...store.get("palette.opts", {}) };
    const save = () => store.set("palette.opts", o);

    let bitmap = null;       // исходная картинка
    let src = null;          // ImageData после уменьшения
    let srcKey = "";
    let samples = null;      // пиксели для палитры
    let palKey = "", pal = null, P = null, pKey = "";
    let outData = null;      // последний результат (ImageData)
    let raf = 0;

    /* ---------- элементы ---------- */
    const mkSelect = (opts, cur, on) => {
      const s = el("select", { className: "pl-in" });
      for (const [v, t] of opts) s.append(el("option", { value: v, textContent: t }));
      s.value = String(cur);
      s.addEventListener("change", () => on(s.value));
      return s;
    };
    const row = (label, ...kids) => el("div", { className: "pl-row" }, el("label", { className: "pl-label", textContent: label }), ...kids);

    const fileIn = el("input", { type: "file", accept: "image/*", hidden: true });
    fileIn.addEventListener("change", () => { if (fileIn.files[0]) loadBlob(fileIn.files[0]); fileIn.value = ""; });

    const nRange = el("input", { type: "range", min: 2, max: 256, value: o.n, className: "pl-range" });
    const nNum = el("input", { type: "number", min: 2, max: 256, value: o.n, className: "pl-in pl-num" });
    const setN = v => {
      v = Math.max(2, Math.min(256, Math.round(+v) || 2));
      o.n = v; nRange.value = v; nNum.value = v; save(); schedule();
    };
    nRange.addEventListener("input", () => setN(nRange.value));
    nNum.addEventListener("change", () => setN(nNum.value));

    const methodSel = mkSelect(Object.entries(METHODS).map(([k, v]) => [k, v[0]]), o.method, v => { o.method = v; save(); methodHint(); schedule(); });
    const methodHintEl = el("div", { className: "pl-hint" });
    const methodHint = () => { methodHintEl.textContent = METHODS[o.method][1]; };
    methodHint();

    const ditherSel = mkSelect(Object.entries(DITHERS), o.dither, v => { o.dither = v; save(); syncEnabled(); schedule(); });
    const strRange = el("input", { type: "range", min: 0, max: 100, value: o.strength, className: "pl-range" });
    const strVal = el("span", { className: "pl-val", textContent: o.strength + "%" });
    strRange.addEventListener("input", () => { o.strength = +strRange.value; strVal.textContent = o.strength + "%"; save(); schedule(); });
    const serp = el("input", { type: "checkbox", checked: o.serp });
    serp.addEventListener("change", () => { o.serp = serp.checked; save(); schedule(); });
    const serpLabel = el("label", { className: "pl-check", title: "Строки обходятся то слева направо, то справа налево — меньше «червячков»" }, serp, " змейка");

    const metricSel = mkSelect(Object.entries(METRICS).map(([k, v]) => [k, v[0]]), o.metric, v => { o.metric = v; save(); schedule(); });
    const sizeSel = mkSelect(SIZES, o.size, v => { o.size = +v; save(); schedule(); });
    const scaleSel = mkSelect(SCALES.map(s => [s, "×" + s]), o.scale, v => { o.scale = +v; save(); updateInfo(); });

    function syncEnabled() {
      const none = o.dither === "none";
      strRange.disabled = none;
      serp.disabled = !isDiffusion(o.dither);
      serpLabel.classList.toggle("off", serp.disabled);
    }
    syncEnabled();

    const swatches = el("div", { className: "pl-swatches" });
    const info = el("div", { className: "pl-info" });

    const copyBtn = el("button", { className: "pl-btn pl-primary", textContent: "📋 Скопировать результат", disabled: true, onclick: () => copyResult() });
    const saveBtn = el("button", { className: "pl-btn", textContent: "💾 PNG", title: "Сохранить результат файлом", disabled: true, onclick: () => saveResult() });
    const cmpBtn = el("button", { className: "pl-btn", textContent: "👁 Оригинал", title: "Удерживай, чтобы увидеть исходную картинку", disabled: true });

    const side = el("div", { className: "pl-side" },
      el("div", { className: "pl-row" },
        el("button", { className: "pl-btn", textContent: "📋 Вставить", title: "Взять картинку из буфера обмена (или нажми Ctrl+V)", onclick: () => pasteFromClipboard() }),
        el("button", { className: "pl-btn", textContent: "📂 Открыть…", onclick: () => fileIn.click() }), fileIn),
      row("Размер", sizeSel),
      row("Цветов", nRange, nNum),
      row("Палитра", methodSel), methodHintEl,
      row("Дизеринг", ditherSel),
      row("Сила", strRange, strVal),
      el("div", { className: "pl-row" }, el("span", { className: "pl-label" }), serpLabel),
      row("Сравнение", metricSel),
      row("Копия", scaleSel),
      el("div", { className: "pl-sub", textContent: "Палитра" }), swatches,
      el("div", { className: "pl-spacer" }),
      el("div", { className: "pl-actions" }, copyBtn, el("div", { className: "pl-row" }, saveBtn, cmpBtn)));

    const cv = el("canvas", { className: "pl-cv" });
    const cvOrig = el("canvas", { className: "pl-cv", hidden: true });
    const empty = el("div", { className: "pl-empty" },
      el("div", { className: "pl-empty-i", textContent: "🖼️" }),
      el("div", { textContent: "Вставь картинку — Ctrl+V, кнопка «Вставить» или перетащи файл сюда" }));
    const stage = el("div", { className: "pl-stage" }, cv, cvOrig, empty);
    cv.hidden = true;
    c.append(side, el("div", { className: "pl-main" }, stage, info));
    c.tabIndex = 0;

    /* ---------- загрузка картинки ---------- */
    async function loadBlob(blob) {
      try {
        const bm = await createImageBitmap(blob);
        bitmap?.close?.();
        bitmap = bm; srcKey = ""; palKey = "";
        empty.hidden = true; cv.hidden = false; cmpBtn.disabled = false;
        schedule();
      } catch { notify("Не получилось открыть картинку — формат не поддерживается"); }
    }
    async function pasteFromClipboard() {
      try {
        for (const it of await navigator.clipboard.read()) for (const t of it.types) if (t.startsWith("image/")) return loadBlob(await it.getType(t));
        notify("В буфере нет картинки");
      } catch { c.focus(); notify("Браузер не дал прочитать буфер — нажми Ctrl+V"); }
    }
    const onPaste = e => {
      if (WM.focused !== w) return;
      const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); loadBlob(f); }
    };
    document.addEventListener("paste", onPaste);
    w.onClose = () => { document.removeEventListener("paste", onPaste); cancelAnimationFrame(raf); bitmap?.close?.(); };

    c.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
    c.addEventListener("drop", e => {
      const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); loadBlob(f); }
    });

    /* ---------- пересчёт ---------- */
    function schedule() {
      if (!bitmap || raf) return;
      raf = requestAnimationFrame(() => { raf = 0; update(); });
    }

    function update() {
      const t0 = performance.now();
      // 1. уменьшенная картинка
      const key = o.size + "|" + MAX_SIDE;
      if (srcKey !== key || !src) {
        const lim = o.size || MAX_SIDE;
        const k = Math.min(1, lim / Math.max(bitmap.width, bitmap.height));
        const tw = Math.max(1, Math.round(bitmap.width * k)), th = Math.max(1, Math.round(bitmap.height * k));
        const tmp = document.createElement("canvas"); tmp.width = tw; tmp.height = th;
        const g = tmp.getContext("2d", { willReadFrequently: true });
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
        g.drawImage(bitmap, 0, 0, tw, th);
        src = g.getImageData(0, 0, tw, th);
        srcKey = key; palKey = "";
        cvOrig.width = tw; cvOrig.height = th;
        cvOrig.getContext("2d").putImageData(src, 0, 0);
      }
      // 2. палитра
      const pk = o.method + "|" + o.n;
      if (palKey !== pk || !pal) {
        samples = collect(src.data, o.method === "kmeans" ? 30000 : 60000);
        pal = makePalette(samples, o.method, o.n);
        palKey = pk; pKey = "";
        drawSwatches();
      }
      // 3. поиск ближайшего (кэш привязан к палитре и метрике)
      if (pKey !== o.metric || !P) { P = prepare(pal, o.metric); pKey = o.metric; }
      // 4. дизеринг
      const out = render(src, P, { dither: o.dither, strength: o.strength / 100, serpentine: o.serp });
      outData = new ImageData(out, src.width, src.height);
      cv.width = src.width; cv.height = src.height;
      cv.getContext("2d").putImageData(outData, 0, 0);
      copyBtn.disabled = saveBtn.disabled = false;
      info.dataset.ms = Math.round(performance.now() - t0);
      updateInfo();
    }

    function updateInfo() {
      if (!outData) { info.textContent = ""; return; }
      const s = o.scale;
      info.textContent = `${outData.width}×${outData.height}` + (s > 1 ? ` → ${outData.width * s}×${outData.height * s}` : "")
        + ` · цветов: ${pal.length} · ${info.dataset.ms} мс`;
    }

    function drawSwatches() {
      swatches.textContent = "";
      for (const [r, g, b] of pal) {
        const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
        swatches.append(el("button", { className: "pl-sw", title: hex + " — клик скопирует", style: `background:${hex}`, onclick: () => copyText(hex, "Скопировано " + hex) }));
      }
    }

    /* ---------- вывод ---------- */
    function resultCanvas() {
      const s = o.scale;
      if (s === 1) return cv;
      const big = document.createElement("canvas");
      big.width = cv.width * s; big.height = cv.height * s;
      const g = big.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(cv, 0, 0, big.width, big.height);
      return big;
    }
    const toBlob = canvas => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/png"));

    async function copyResult() {
      if (!outData) return;
      const canvas = resultCanvas();
      try {
        // Promise внутри ClipboardItem — чтобы Safari не терял «жест пользователя» на время кодирования PNG
        await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(canvas) })]);
        notify("Скопировано — можно вставлять");
      } catch { notify("Браузер не дал скопировать (нужен HTTPS) — сохрани через «💾 PNG»", 3200); }
    }
    async function saveResult() {
      if (!outData) return;
      const url = URL.createObjectURL(await toBlob(resultCanvas()));
      const a = el("a", { href: url, download: `palette-${pal.length}c.png` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // сравнение с оригиналом: пока кнопка зажата
    const showOrig = on => { if (!outData) return; cvOrig.hidden = !on; cv.hidden = on; };
    cmpBtn.addEventListener("pointerdown", e => { cmpBtn.setPointerCapture?.(e.pointerId); showOrig(true); });
    cmpBtn.addEventListener("pointerup", () => showOrig(false));
    cmpBtn.addEventListener("pointercancel", () => showOrig(false));
    cmpBtn.addEventListener("lostpointercapture", () => showOrig(false));

    // Ctrl+C в окне — тоже копирует результат (если не выделен текст в поле)
    c.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyC" && outData && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); copyResult(); }
    });
    setTimeout(() => c.focus(), 0);
  } });
}
