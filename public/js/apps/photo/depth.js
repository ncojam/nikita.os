/* ================= Глубина в браузере =================
 * Карта глубины по одной картинке — нейросеть Depth Anything V2 Small (ONNX, ~27 МБ) через onnxruntime-web.
 * И модель, и рантайм лежат в своей fs: /fs/usr/share/depth/ (их кладёт туда тулчейн: tools/photo3d → «📦 Подготовить сайт»).
 * Чужого кода и CDN нет; без файлов — понятная ошибка.
 *
 * Результат — PNG в оттенках серого того же формата, что делает тулчейн: белое — близко, чёрное — далеко
 * (это «обратная глубина», disparity, растянутая на 0..255). Сохраняется рядом с картинкой: <имя>.depth.png.
 */
export const DEPTH_DIR = "/fs/usr/share/depth/";
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
let sessionP = null, ort = null;

export async function depthAvailable() {
  try { const r = await fetch(DEPTH_DIR + "model.onnx", { method: "HEAD" }); return r.ok; } catch { return false; }
}

async function session() {
  if (!sessionP) sessionP = (async () => {
    ort = await import(DEPTH_DIR + "ort.wasm.min.mjs");
    ort.env.wasm.wasmPaths = DEPTH_DIR;
    ort.env.wasm.proxy = true;   // считать в воркере — окно не подвисает
    return ort.InferenceSession.create(DEPTH_DIR + "model.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  })().catch(e => { sessionP = null; throw new Error("модель глубины не загрузилась (нет файлов в " + DEPTH_DIR + "?): " + (e.message || e)); });
  return sessionP;
}

/* img — ImageBitmap или <img>; maxSide — до какого размера считать (кратно 14, как любит модель) */
export async function computeDepth(img, { maxSide = 518, onStage = () => {} } = {}) {
  onStage("Загружаю модель…");
  const s = await session();
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(W0, H0));
  const w = Math.max(14, Math.round(W0 * k / 14) * 14), h = Math.max(14, Math.round(H0 * k / 14) * 14);
  const cv = new OffscreenCanvas(w, h), g = cv.getContext("2d");
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, N = w * h, data = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) data[c * N + i] = (px[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  onStage("Считаю глубину…");
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", data, [1, 3, h, w]) });
  const t = out[s.outputNames[0]], d = t.data, oh = t.dims.at(-2), ow = t.dims.at(-1);
  let mn = Infinity, mx = -Infinity;
  for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const small = new OffscreenCanvas(ow, oh), sg = small.getContext("2d"), im = sg.createImageData(ow, oh);
  for (let i = 0; i < ow * oh; i++) { const v = Math.round((d[i] - mn) / (mx - mn || 1) * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  sg.putImageData(im, 0, 0);
  // до размера картинки (но не больше 1024 по большей стороне) — мягко, без лесенки
  const k2 = Math.min(1, 1024 / Math.max(W0, H0)), fw = Math.round(W0 * k2), fh = Math.round(H0 * k2);
  const big = new OffscreenCanvas(fw, fh), bg = big.getContext("2d");
  bg.imageSmoothingQuality = "high";
  bg.drawImage(small, 0, 0, fw, fh);
  return big.convertToBlob({ type: "image/png" });
}
