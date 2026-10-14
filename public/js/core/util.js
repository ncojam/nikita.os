/* ================= утилиты ================= */
const $ = (s, r = document) => r.querySelector(s);

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

const joinPath = (a, b) => (a.replace(/\/+$/, "") + "/" + b).replace(/\/+/g, "/");

const parentOf = p => p.replace(/\/[^/]+\/?$/, "") || "/";

const baseName = p => p.split("/").filter(Boolean).pop() || "/";

const fsUrl = p => "/fs" + p.split("/").map(encodeURIComponent).join("/");

const fmtSize = n => n < 1024 ? n + " Б" : n < 1048576 ? (n / 1024).toFixed(1) + " КБ"
  : n < 1073741824 ? (n / 1048576).toFixed(1) + " МБ" : (n / 1073741824).toFixed(2) + " ГБ";

const fmtTime = s => {
  if (!isFinite(s)) return "0:00";
  s = Math.floor(s);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

const fmtCount = n => n < 10000 ? n.toLocaleString("ru-RU")
  : new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const px = r => ({ left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

export { $, el, joinPath, parentOf, baseName, fsUrl, fmtSize, fmtTime, plural, fmtCount, px, store };
