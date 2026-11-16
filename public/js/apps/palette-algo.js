/* ================= Палитра: алгоритмы (без DOM) =================
 * Чистые функции для приложения «Палитра» (palette.js): подбор палитры, поиск ближайшего цвета, дизеринг.
 * Работают с «плоскими» массивами RGBA (как ImageData.data), поэтому их можно проверить в Node.
 * Правила: прозрачность < 128 → пиксель остаётся прозрачным и в расчёт палитры не входит;
 * всё детерминировано (свой генератор случайных), чтобы картинка не «мигала» при движении ползунков.
 */

export const METHODS = {
  median: ["Median cut", "делит цветовой куб пополам по самой длинной оси — быстрый и ровный"],
  kmeans: ["K-means", "кластеры по похожести — точнее для фото, чуть медленнее"],
  popular: ["Частые цвета", "самые частые цвета картинки — хорошо для пиксель-арта и логотипов"],
  uniform: ["Равномерная сетка RGB", "фиксированная сетка из уровней R, G, B (от 8 цветов; меньше — серый)"],
  gray: ["Оттенки серого", "N ровных серых от чёрного до белого"],
};

export const DITHERS = {
  none: "Нет",
  fs: "Флойд — Стейнберг",
  atkinson: "Аткинсон",
  jjn: "Джарвис — Джудис — Нинке",
  stucki: "Стаки",
  burkes: "Беркс",
  sierra: "Сьерра",
  sierraLite: "Сьерра Lite",
  bayer2: "Упорядоченный Байер 2×2",
  bayer4: "Упорядоченный Байер 4×4",
  bayer8: "Упорядоченный Байер 8×8",
  noise: "Белый шум",
};

export const METRICS = {
  rgb: ["RGB", "обычное расстояние в RGB"],
  redmean: ["Redmean", "приближение к восприятию глаза"],
  luma: ["Яркость важнее", "веса как в формуле яркости: зелёный > красный > синий"],
};

// kernels: [dx, dy, вес], общий делитель
const KERNELS = {
  fs: [16, [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]],
  atkinson: [8, [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]],
  jjn: [48, [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]]],
  stucki: [42, [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]]],
  burkes: [32, [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]]],
  sierra: [32, [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]]],
  sierraLite: [4, [[1, 0, 2], [-1, 1, 1], [0, 1, 1]]],
};

export const isDiffusion = d => d in KERNELS;
export const isOrdered = d => d.startsWith("bayer");

/* ---------- сбор пикселей ---------- */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// непрозрачные пиксели с шагом, не больше max штук → Uint8Array RGBRGB…
export function collect(data, max = 60000) {
  const total = data.length >> 2;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) opaque++;
  if (!opaque) return new Uint8Array(0);
  const step = Math.max(1, Math.floor(opaque / max));
  const out = new Uint8Array(Math.ceil(opaque / step) * 3);
  let n = 0, seen = 0;
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] < 128) continue;
    if (seen++ % step) continue;
    out[n++] = data[p * 4]; out[n++] = data[p * 4 + 1]; out[n++] = data[p * 4 + 2];
  }
  return out.subarray(0, n);
}

/* ---------- методы палитры ---------- */
function medianCut(s, n) {
  const m = s.length / 3;
  const idx = new Uint32Array(m);
  for (let i = 0; i < m; i++) idx[i] = i;
  const stat = (a, b) => {
    let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0;
    for (let k = a; k < b; k++) {
      const j = idx[k] * 3, r = s[j], g = s[j + 1], bl = s[j + 2];
      if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (g < g0) g0 = g; if (g > g1) g1 = g;
      if (bl < b0) b0 = bl; if (bl > b1) b1 = bl;
    }
    const dr = r1 - r0, dg = g1 - g0, db = b1 - b0;
    const axis = dg >= dr && dg >= db ? 1 : dr >= db ? 0 : 2;
    const range = Math.max(dr, dg, db);
    return { a, b, axis, range, score: range * Math.sqrt(b - a) };
  };
  const boxes = [stat(0, m)];
  while (boxes.length < n) {
    let bi = -1, best = 0;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].b - boxes[i].a > 1 && boxes[i].score > best) { best = boxes[i].score; bi = i; }
    if (bi < 0) break;
    const { a, b, axis } = boxes[bi];
    idx.subarray(a, b).sort((i, j) => s[i * 3 + axis] - s[j * 3 + axis]);
    const mid = (a + b) >> 1;
    boxes.splice(bi, 1, stat(a, mid), stat(mid, b));
  }
  return boxes.map(({ a, b }) => {
    let r = 0, g = 0, bl = 0;
    for (let k = a; k < b; k++) { const j = idx[k] * 3; r += s[j]; g += s[j + 1]; bl += s[j + 2]; }
    const c = b - a;
    return [Math.round(r / c), Math.round(g / c), Math.round(bl / c)];
  });
}

function kmeans(s, n) {
  let m = s.length / 3;
  const cap = Math.min(16000, Math.max(6000, n * 40));
  let pts = s;
  if (m > cap) {   // равномерная выборка
    const step = m / cap;
    pts = new Uint8Array(cap * 3);
    for (let i = 0; i < cap; i++) { const j = Math.floor(i * step) * 3; pts[i * 3] = s[j]; pts[i * 3 + 1] = s[j + 1]; pts[i * 3 + 2] = s[j + 2]; }
    m = cap;
  }
  const k = Math.min(n, m);
  const rnd = mulberry32(1234567);
  const C = new Float32Array(k * 3);
  const d2 = new Float32Array(m).fill(Infinity);
  for (let c = 0; c < k; c++) {   // k-means++
    let pick;
    if (c === 0) pick = Math.floor(rnd() * m);
    else {
      let sum = 0;
      for (let i = 0; i < m; i++) sum += d2[i];
      let t = rnd() * sum; pick = m - 1;
      if (sum > 0) for (let i = 0; i < m; i++) { t -= d2[i]; if (t <= 0) { pick = i; break; } }
      else pick = Math.floor(rnd() * m);
    }
    C[c * 3] = pts[pick * 3]; C[c * 3 + 1] = pts[pick * 3 + 1]; C[c * 3 + 2] = pts[pick * 3 + 2];
    for (let i = 0; i < m; i++) {
      const dr = pts[i * 3] - C[c * 3], dg = pts[i * 3 + 1] - C[c * 3 + 1], db = pts[i * 3 + 2] - C[c * 3 + 2];
      const d = dr * dr + dg * dg + db * db;
      if (d < d2[i]) d2[i] = d;
    }
  }
  const asg = new Int32Array(m).fill(-1);
  const sum = new Float64Array(k * 3), cnt = new Uint32Array(k);
  for (let it = 0; it < 10; it++) {
    let changed = 0;
    sum.fill(0); cnt.fill(0);
    for (let i = 0; i < m; i++) {
      const r = pts[i * 3], g = pts[i * 3 + 1], b = pts[i * 3 + 2];
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - C[c * 3], dg = g - C[c * 3 + 1], db = b - C[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; bi = c; }
      }
      if (asg[i] !== bi) { asg[i] = bi; changed++; }
      sum[bi * 3] += r; sum[bi * 3 + 1] += g; sum[bi * 3 + 2] += b; cnt[bi]++;
    }
    for (let c = 0; c < k; c++) if (cnt[c]) { C[c * 3] = sum[c * 3] / cnt[c]; C[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; C[c * 3 + 2] = sum[c * 3 + 2] / cnt[c]; }
    if (!changed) break;
  }
  const out = [];
  for (let c = 0; c < k; c++) if (cnt[c]) out.push([Math.round(C[c * 3]), Math.round(C[c * 3 + 1]), Math.round(C[c * 3 + 2])]);
  return out;
}

function popular(s, n) {
  const m = s.length / 3;
  const cnt = new Uint32Array(32768), R = new Float64Array(32768), G = new Float64Array(32768), B = new Float64Array(32768);
  for (let i = 0; i < m; i++) {
    const r = s[i * 3], g = s[i * 3 + 1], b = s[i * 3 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    cnt[key]++; R[key] += r; G[key] += g; B[key] += b;
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) keys.push(k);
  keys.sort((a, b) => cnt[b] - cnt[a]);
  return keys.slice(0, n).map(k => [Math.round(R[k] / cnt[k]), Math.round(G[k] / cnt[k]), Math.round(B[k] / cnt[k])]);
}

function gray(n) {
  if (n < 2) return [[128, 128, 128]];
  return Array.from({ length: n }, (_, i) => { const v = Math.round(i * 255 / (n - 1)); return [v, v, v]; });
}

function uniform(n) {
  if (n < 8) return gray(n);
  const lv = [2, 2, 2], w = [1, 1.3, 0.8];
  for (;;) {
    let grew = false;
    const order = [0, 1, 2].sort((a, b) => lv[a] / w[a] - lv[b] / w[b]);
    for (const c of order) {
      lv[c]++;
      if (lv[0] * lv[1] * lv[2] <= n) { grew = true; break; }
      lv[c]--;
    }
    if (!grew) break;
  }
  const out = [];
  for (let r = 0; r < lv[0]; r++) for (let g = 0; g < lv[1]; g++) for (let b = 0; b < lv[2]; b++)
    out.push([Math.round(r * 255 / (lv[0] - 1)), Math.round(g * 255 / (lv[1] - 1)), Math.round(b * 255 / (lv[2] - 1))]);
  return out;
}

const dedupe = pal => {
  const seen = new Set(), out = [];
  for (const c of pal) { const k = (c[0] << 16) | (c[1] << 8) | c[2]; if (!seen.has(k)) { seen.add(k); out.push(c); } }
  return out;
};

// samples — результат collect(); n — сколько цветов хотим. Возвращает [[r,g,b], …] (может быть меньше n)
export function makePalette(samples, method, n) {
  n = Math.max(1, Math.min(256, n | 0));
  if (method === "gray") return gray(n);
  if (method === "uniform") return uniform(n);
  if (!samples.length) return [[0, 0, 0]];
  let pal = method === "kmeans" ? kmeans(samples, n) : method === "popular" ? popular(samples, n) : medianCut(samples, n);
  pal = dedupe(pal);
  // для удобства чтения — от тёмных к светлым
  return pal.sort((a, b) => (a[0] * 299 + a[1] * 587 + a[2] * 114) - (b[0] * 299 + b[1] * 587 + b[2] * 114));
}

/* ---------- поиск ближайшего цвета ---------- */
// P — подготовленная палитра: P.find(r,g,b) → индекс. Ответы кэшируются по 6 битам на канал.
export function prepare(pal, metric = "redmean") {
  const n = pal.length;
  const pr = new Uint8Array(n), pg = new Uint8Array(n), pb = new Uint8Array(n);
  pal.forEach((c, i) => { pr[i] = c[0]; pg[i] = c[1]; pb[i] = c[2]; });
  const cache = new Int16Array(262144).fill(-1);
  const dist = metric === "rgb"
    ? (r, g, b, i) => { const dr = r - pr[i], dg = g - pg[i], db = b - pb[i]; return dr * dr + dg * dg + db * db; }
    : metric === "luma"
      ? (r, g, b, i) => { const dr = r - pr[i], dg = g - pg[i], db = b - pb[i]; return 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db; }
      : (r, g, b, i) => {
        const dr = r - pr[i], dg = g - pg[i], db = b - pb[i], rm = (r + pr[i]) >> 1;
        return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      };
  const find = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache[key];
    if (hit >= 0) return hit;
    const cr = (r & 252) | 2, cg = (g & 252) | 2, cb = (b & 252) | 2;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) { const d = dist(cr, cg, cb, i); if (d < bd) { bd = d; bi = i; } }
    cache[key] = bi;
    return bi;
  };
  // «шаг» палитры — на него опирается амплитуда упорядоченного дизеринга
  let nn = 0;
  if (n < 2) nn = 441;
  else {
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      for (let j = 0; j < n; j++) if (j !== i) {
        const dr = pr[i] - pr[j], dg = pg[i] - pg[j], db = pb[i] - pb[j];
        const d = dr * dr + dg * dg + db * db;
        if (d < best) best = d;
      }
      nn += Math.sqrt(best);
    }
    nn /= n;
  }
  return { n, r: pr, g: pg, b: pb, find, spread: Math.max(8, Math.min(255, nn / 1.15)) };
}

/* ---------- дизеринг ---------- */
function bayerMatrix(n) {
  let m = [[0]], size = 1;
  while (size < n) {
    const ns = size * 2, nm = Array.from({ length: ns }, () => new Array(ns));
    const add = [[0, 2], [3, 1]];
    for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++)
      nm[y][x] = 4 * m[y % size][x % size] + add[y >= size ? 1 : 0][x >= size ? 1 : 0];
    m = nm; size = ns;
  }
  const t = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) t[y * n + x] = (m[y][x] + 0.5) / (n * n) - 0.5;
  return t;
}
const BAYER = { bayer2: [2, bayerMatrix(2)], bayer4: [4, bayerMatrix(4)], bayer8: [8, bayerMatrix(8)] };

const clamp8 = v => v < 0 ? 0 : v > 255 ? 255 : v;

/* img — { data, width, height } (RGBA); P — результат prepare(); o — { dither, strength 0..1, serpentine }
 * Возвращает Uint8ClampedArray RGBA того же размера. */
export function render(img, P, o) {
  const { data, width: w, height: h } = img;
  const out = new Uint8ClampedArray(data.length);
  const s = o.strength, find = P.find;
  const put = (p, i) => { out[p * 4] = P.r[i]; out[p * 4 + 1] = P.g[i]; out[p * 4 + 2] = P.b[i]; out[p * 4 + 3] = 255; };

  if (o.dither === "none") {
    for (let p = 0; p < w * h; p++) {
      if (data[p * 4 + 3] < 128) continue;
      put(p, find(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]));
    }
  } else if (isOrdered(o.dither)) {
    const [bn, bt] = BAYER[o.dither], amp = P.spread * s;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3] < 128) continue;
      const off = bt[(y % bn) * bn + (x % bn)] * amp;
      put(p, find(clamp8(Math.round(data[p * 4] + off)), clamp8(Math.round(data[p * 4 + 1] + off)), clamp8(Math.round(data[p * 4 + 2] + off))));
    }
  } else if (o.dither === "noise") {
    const amp = P.spread * s;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3] < 128) continue;
      let q = Math.imul(x, 374761393) + Math.imul(y, 668265263);
      q = Math.imul(q ^ (q >>> 13), 1274126177); q ^= q >>> 16;
      const off = ((q >>> 0) / 4294967296 - 0.5) * amp;
      put(p, find(clamp8(Math.round(data[p * 4] + off)), clamp8(Math.round(data[p * 4 + 1] + off)), clamp8(Math.round(data[p * 4 + 2] + off))));
    }
  } else {
    const [div, taps] = KERNELS[o.dither];
    const T = taps.map(([dx, dy, k]) => [dx, dy, k / div]);
    const buf = new Float32Array(w * h * 3);
    for (let p = 0; p < w * h; p++) { buf[p * 3] = data[p * 4]; buf[p * 3 + 1] = data[p * 4 + 1]; buf[p * 3 + 2] = data[p * 4 + 2]; }
    for (let y = 0; y < h; y++) {
      const rev = o.serpentine && (y & 1);
      for (let k = 0; k < w; k++) {
        const x = rev ? w - 1 - k : k, p = y * w + x;
        if (data[p * 4 + 3] < 128) continue;
        const j = p * 3;
        const r = clamp8(buf[j]), g = clamp8(buf[j + 1]), b = clamp8(buf[j + 2]);
        const i = find(Math.round(r), Math.round(g), Math.round(b));
        put(p, i);
        const er = (r - P.r[i]) * s, eg = (g - P.g[i]) * s, eb = (b - P.b[i]) * s;
        for (let t = 0; t < T.length; t++) {
          const nx = x + (rev ? -T[t][0] : T[t][0]), ny = y + T[t][1];
          if (nx < 0 || nx >= w || ny >= h) continue;
          const q = (ny * w + nx) * 3, f = T[t][2];
          buf[q] += er * f; buf[q + 1] += eg * f; buf[q + 2] += eb * f;
        }
      }
    }
  }
  return out;
}
