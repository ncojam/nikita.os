import { el, store } from "../../core/util.js";
import { SPECS } from "./instruments.js";

/* ================= DAWN — общие элементы интерфейса =================
 * Крутилка (knob): тянуть вверх/вниз (Shift — точно), колесо, двойной клик — по умолчанию.
 * У крутилки есть адрес (path, напр. "ch.lead.cut") — на него цепляются проводки модуляции (mod.js).
 * Если параметр модулируется, поверх рисуется тонкая дуга текущего значения (ModView).
 */
/* что сейчас модулируется: адрес → значение; окно модуляции обновляет, крутилки подписаны */
export const ModView = { over: new Map(), subs: new Set(),
  set(over) { this.over = over; for (const f of [...this.subs]) f(); } };
const toNorm = (v, s) => ((v - s.min) / (s.max - s.min)) ** (1 / (s.curve || 1));
const fromNorm = (n, s) => {
  let v = s.min + (s.max - s.min) * Math.max(0, Math.min(1, n)) ** (s.curve || 1);
  if (s.step) v = Math.round(v / s.step) * s.step;
  return v;
};
export const fmt = (v, s) => {
  if (s.names) return s.names[Math.round(v)] ?? String(v);
  if (s.step) return String(Math.round(v));
  const a = Math.abs(v);
  if (s.max >= 1000) return v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "";
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(2) : v.toFixed(2);
};

const ARC = 270, R = 15;
const polar = (deg) => { const r = (deg - 90) * Math.PI / 180; return [18 + R * Math.cos(r), 18 + R * Math.sin(r)]; };
const arcPath = (a0, a1) => {
  if (Math.abs(a1 - a0) < 0.5) return "";
  const [x0, y0] = polar(a0), [x1, y1] = polar(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

/* knob({ spec | specKey, get(), set(v), color, label, path, size }) */
export function knob(o) {
  const spec = typeof o.spec === "string" ? SPECS[o.spec] : (o.spec || SPECS[o.specKey]);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.classList.add("dk-svg");
  const track = document.createElementNS(svgNS, "path"), val = document.createElementNS(svgNS, "path");
  const dot = document.createElementNS(svgNS, "circle"), modArc = document.createElementNS(svgNS, "path");
  track.setAttribute("class", "dk-track"); val.setAttribute("class", "dk-val"); dot.setAttribute("class", "dk-dot");
  modArc.setAttribute("class", "dk-mod");
  dot.setAttribute("r", "2.6");
  track.setAttribute("d", arcPath(-ARC / 2, ARC / 2));
  svg.append(track, val, modArc, dot);
  const readout = el("div", { className: "dk-label", textContent: o.label ?? spec.label });
  const node = el("div", { className: "dk", title: "" }, svg, readout);
  node.style.setProperty("--dk", o.color || "var(--dw-pink)");
  if (o.size) node.style.setProperty("--dk-size", o.size + "px");
  if (o.path) {
    node.dataset.path = o.path;
    const sub = () => {
      if (!node.isConnected) { if (node._seen) ModView.subs.delete(sub); return; }
      node._seen = true;
      const m = ModView.over.get(o.path);
      node.classList.toggle("modded", m != null);
      if (m == null) { modArc.setAttribute("d", ""); return; }
      const a0 = -ARC / 2 + ARC * toNorm(o.get(), spec), a1 = -ARC / 2 + ARC * toNorm(m, spec);
      modArc.setAttribute("d", arcPath(Math.min(a0, a1), Math.max(a0, a1)) || arcPath(a1 - 3, a1 + 3));
    };
    ModView.subs.add(sub);
  }

  // крутилка без адреса DAWN — всё равно цель для проводков (через core/uiparams.js)
  if (!o.path) node._ctl = { spec, get: o.get, set: v => { o.set(v); paint(); }, label: o.label ?? spec.label };

  function paint() {
    const v = o.get(), n = toNorm(v, spec), a = -ARC / 2 + ARC * n;
    const zero = spec.bipolar ? 0 : -ARC / 2;
    val.setAttribute("d", spec.bipolar ? arcPath(Math.min(zero, a), Math.max(zero, a)) : arcPath(-ARC / 2, a));
    const [x, y] = polar(a);
    dot.setAttribute("cx", x.toFixed(2)); dot.setAttribute("cy", y.toFixed(2));
    node.title = `${o.label ?? spec.label}: ${fmt(v, spec)}`;
  }
  function setN(n) { o.set(fromNorm(n, spec)); paint(); }

  let drag = null;
  node.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, n: toNorm(o.get(), spec) };
    node.classList.add("on");
    readout.textContent = fmt(o.get(), spec);
  });
  node.addEventListener("pointermove", e => {
    if (!drag) return;
    const k = e.shiftKey ? 0.0015 : 0.006;
    setN(drag.n + (drag.y - e.clientY) * k);
    readout.textContent = fmt(o.get(), spec);
  });
  const end = () => { if (!drag) return; drag = null; node.classList.remove("on"); readout.textContent = o.label ?? spec.label; o.done?.(); };
  node.addEventListener("pointerup", end); node.addEventListener("pointercancel", end);
  node.addEventListener("dblclick", () => { o.set(spec.def); paint(); o.done?.(); });
  node.addEventListener("wheel", e => {
    e.preventDefault();
    setN(toNorm(o.get(), spec) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03));
    o.done?.();
  }, { passive: false });
  paint();
  return { node, paint };
}

/* кнопка-переключатель (LED) */
export function led(on, onClick, title, color) {
  const b = el("button", { className: "dw-led" + (on ? " on" : ""), title, onclick: e => { e.stopPropagation(); onClick(e); } });
  if (color) b.style.setProperty("--led", color);
  return b;
}

export const dwBtn = (text, onClick, extra = {}) => el("button", { className: "dw-btn", textContent: text, onclick: onClick, ...extra });

/* общий «корпус» окна модуля: пастельная шапка-полоска цвета модуля.
 * Правую кнопку DAWN забирает себе (удаление нот/клипов) — меню ОС внутри не открывается. */
export function shell(c, cls, accent) {
  const root = el("div", { className: "dw " + cls });
  if (accent) root.style.setProperty("--acc", accent);
  root.addEventListener("contextmenu", e => { if (!e.target.closest("input, textarea")) e.preventDefault(); });
  c.append(root);
  return root;
}

/* ---------- темы: тёмная (неон на тёмном) и светлая (каждое окно — в своём пастельном цвете) ---------- */
export const theme = () => store.get("dawn.theme", "dark") === "light" ? "light" : "dark";
export function applyTheme(t = theme()) {
  store.set("dawn.theme", t);
  document.documentElement.dataset.dawnTheme = t;
}
/* цвета для canvas (пиано ролл, плейлист, микшер) — CSS туда не дотягивается */
export function pal() {
  return theme() === "light" ? {
    rowW: "rgba(255,255,255,0.55)", rowB: "rgba(110,80,170,0.12)", rowIn: "rgba(110,80,170,0.10)", rowOut: "rgba(60,40,100,0.10)",
    rowRoot: "rgba(255,95,168,0.20)", oct: "rgba(110,80,170,0.45)",
    g1: "rgba(80,50,130,0.08)", g2: "rgba(80,50,130,0.22)", g3: "rgba(255,95,168,0.65)",
    keyW: "#ffffff", keyB: "#6f5c96", keyIn: "#e9dcff", keyLbl: "#6f5c96", text: "#3b2a55", dim: "#7d6b99",
    shade: "rgba(80,60,120,0.12)", panel: "rgba(255,255,255,0.55)", head: "#ff3d97", noteText: "rgba(40,20,70,0.85)", clipText: "#3b2a55",
  } : {
    rowW: "rgba(255,255,255,0.025)", rowB: "rgba(20,10,40,0.55)", rowIn: "rgba(143,232,207,0.07)", rowOut: "rgba(0,0,0,0.25)",
    rowRoot: "rgba(255,158,207,0.16)", oct: "rgba(195,166,255,0.30)",
    g1: "rgba(255,255,255,0.04)", g2: "rgba(255,255,255,0.13)", g3: "rgba(255,158,207,0.45)",
    keyW: "#f6eefc", keyB: "#2a1f3d", keyIn: "#d9f7ec", keyLbl: "#7a5fa8", text: "#f4ecff", dim: "#a898c4",
    shade: "rgba(0,0,0,0.35)", panel: "rgba(10,5,20,0.6)", head: "#fff09e", noteText: "rgba(30,15,50,0.85)", clipText: "#1d1430",
  };
}

/* выпадающий список: [[значение, подпись], ...] */
export function select(items, value, onChange, title = "") {
  const s = el("select", { className: "dw-sel", title, onchange: () => onChange(s.value) },
    ...items.map(([v, t]) => el("option", { value: v, textContent: t, selected: String(v) === String(value) })));
  return s;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = n => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

/* число «по разрядам», как в FL: зажми цифру (целые, десятые… десятитысячные) и тяни вверх/вниз — меняется этот разряд;
 * колесо над цифрой — тоже; двойной клик — ввести. o: { get, set, min, max, decimals, label, title, done } */
export function digits(o) {
  const dec = o.decimals ?? 4, box = el("div", { className: "dw-digits", title: o.title || "" });
  const val = el("div", { className: "dw-digits-v" }), lab = el("div", { className: "dw-digits-l", textContent: o.label || "" });
  box.append(val, lab);
  const clampV = v => Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, +(+v).toFixed(dec)));
  function paint() {
    const v = o.get(), s = (v < 0 ? "−" : "") + Math.abs(v).toFixed(dec), dot = s.indexOf(".");
    val.replaceChildren(...[...s].map((c, i) => {
      if (c === "." || c === "−") return el("span", { textContent: c });
      const place = (dot < 0 ? s.length : dot) - i - (i < dot || dot < 0 ? 1 : 0);   // 0 — единицы, 1 — десятки, −1 — десятые…
      const d = el("span", { className: "dw-dig", textContent: c });
      d.dataset.p = String(place);   // el() атрибуты data-* не ставит
      return d;
    }));
  }
  const step = d => Math.pow(10, +d.dataset.p);
  let drag = null;
  val.addEventListener("pointerdown", e => {
    const d = e.target.closest(".dw-dig");
    if (!d || e.button !== 0) return;
    e.preventDefault(); val.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v: o.get(), st: step(d) }; d.classList.add("on");
  });
  val.addEventListener("pointermove", e => {
    if (!drag) return;
    const n = Math.round((drag.y - e.clientY) / 8);
    o.set(clampV(drag.v + n * drag.st), Math.sign(n)); paint();
  });
  const end = () => { if (!drag) return; drag = null; o.done?.(); };
  val.addEventListener("pointerup", end); val.addEventListener("pointercancel", end);
  val.addEventListener("wheel", e => {
    const d = e.target.closest(".dw-dig"); if (!d) return;
    e.preventDefault(); const dir = e.deltaY < 0 ? 1 : -1;
    o.set(clampV(o.get() + dir * step(d)), dir); paint(); o.done?.();
  }, { passive: false });
  val.addEventListener("dblclick", () => { const v = prompt(o.label || "", o.get()); if (v != null && isFinite(+v.replace(",", "."))) { o.set(clampV(+v.replace(",", ".")), 0); paint(); o.done?.(); } });
  paint();
  return { node: box, paint };
}
