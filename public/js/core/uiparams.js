import { Params } from "./params.js";
import { WM } from "../wm.js";

/* ================= любые крутилки и ползунки ОС — цели для проводков =================
 * ui.<ключ окна>#<номер> — n-й регулятор в окне: <input type=range|number> или крутилка DAWN без своего адреса
 * (у таких есть node._ctl). Регулятор ищется заново при каждом обращении, поэтому провод переживает перерисовку
 * окна, а если окно закрыто — просто молчит. apply двигает регулятор так, будто его крутит человек (событие input),
 * restore возвращает значение, которое было до первой модуляции.
 *
 * win.<ключ окна | *>.<эффект> — само окно: тряска, наклон, масштаб, прозрачность, «прыжок».
 * Так «громкость бочки → окна трясутся» — это провод от источника «Уровень» на win.*.shake.
 */
const CTL = 'input[type="range"], input[type="number"], .dk:not([data-path])';
const winOf = key => [...document.querySelectorAll(".window[data-wkey]")].find(w => w.dataset.wkey === key);
const controls = win => [...win.querySelectorAll(CTL)].filter(e => e.tagName === "INPUT" || e._ctl);

export const UIParams = {
  /* элемент → адрес (или null, если это не регулятор в окне) */
  addrOf(elm) {
    const c = elm?.closest?.(CTL), win = c?.closest(".window[data-wkey]");
    if (!c || !win || (c.tagName !== "INPUT" && !c._ctl)) return null;
    const i = controls(win).indexOf(c);
    return i < 0 ? null : `ui.${win.dataset.wkey}#${i}`;
  },
  elOf(addr) {
    const m = addr.match(/^ui\.(.+)#(\d+)$/);
    if (!m) return null;
    const win = winOf(m[1]);
    return win ? controls(win)[+m[2]] || null : null;
  },
  /* показать окно цели: свёрнутое — развернуть, закрытое — открыть, если знаем как */
  async reveal(addr) {
    const key = addr.startsWith("ui.") ? addr.slice(3).split("#")[0] : addr.startsWith("win.") ? addr.split(".")[1] : null;
    if (!key || key === "*") return false;
    for (const w of WM.wins.values()) if (w.key === key) { WM.restore(w); WM.focus(w); return true; }
    if (key === "settings") { (await import("../apps/settings.js")).openSettings(); return true; }
    if (key.startsWith("dawn:")) { const [, n, a] = key.split(":"); (await import("../apps/dawn/index.js")).Dawn.open(n, a); return true; }
    return false;
  },
};

const base = new Map();   // адрес → значение до модуляции
const labelOf = c => {
  if (c._ctl) return c._ctl.label;
  const l = c.closest("label")?.textContent || c.title || c.getAttribute("aria-label") || c.previousElementSibling?.textContent || c.name || "ползунок";
  return l.trim().replace(/\s+/g, " ").slice(0, 40);
};
const specOf = c => c._ctl ? c._ctl.spec : { min: +c.min || 0, max: c.max !== "" ? +c.max : 100, def: +c.value, step: c.step && c.step !== "any" ? +c.step : undefined };
const getV = c => c._ctl ? c._ctl.get() : +c.value;
function setV(c, v) {
  if (c._ctl) return c._ctl.set(v);
  c.value = v;
  c.dispatchEvent(new Event("input", { bubbles: true }));
}
const titleOf = key => winOf(key)?.querySelector(".titlebar .title")?.textContent || key;

Params.addProvider({
  prefix: "ui.",
  label: "Окна",
  list() {
    const out = [];
    for (const win of document.querySelectorAll(".window[data-wkey]")) {
      const key = win.dataset.wkey, g = "Окно: " + titleOf(key);
      controls(win).forEach((c, i) => out.push({ addr: `ui.${key}#${i}`, label: labelOf(c), group: g }));
    }
    return out;
  },
  resolve(addr) {
    const c = UIParams.elOf(addr);
    if (!c) {   // окно закрыто — цель есть, но молчит
      const m = addr.match(/^ui\.(.+)#\d+$/);
      return m ? { label: titleOf(m[1]) + " · регулятор", spec: null, base: () => NaN, apply() {}, restore() { base.delete(addr); } } : null;
    }
    if (!base.has(addr)) base.set(addr, getV(c));
    return { label: titleOf(addr.slice(3).split("#")[0]) + " · " + labelOf(c), spec: specOf(c),
      base: () => base.get(addr) ?? getV(c),
      apply: v => setV(c, v),
      restore: () => { if (base.has(addr)) setV(c, base.get(addr)); base.delete(addr); } };
  },
});

/* ---------- эффекты окон ---------- */
const FX = {
  shake: { label: "тряска", min: 0, max: 40, def: 0 },
  tilt: { label: "наклон", min: -30, max: 30, def: 0 },
  zoom: { label: "масштаб", min: 0.5, max: 1.6, def: 1 },
  fade: { label: "прозрачность", min: 0, max: 1, def: 1 },
  jump: { label: "прыжок", min: 0, max: 120, def: 0 },
};
const state = new Map();   // "ключ.эффект" → значение
const nodes = key => key === "*" ? [...document.querySelectorAll(".window")] : [winOf(key)].filter(Boolean);
function paintWin(key) {
  for (const n of nodes(key)) {
    const k = n.dataset.wkey, g = e => state.get(`${k}.${e}`) ?? state.get(`*.${e}`) ?? FX[e].def;
    const calm = document.documentElement.classList.contains("fx-calm");   // минимальное качество: окна не трясём
    const s = calm ? 0 : g("shake"), j = calm ? 0 : g("jump");
    const dx = s ? (Math.random() * 2 - 1) * s : 0, dy = (s ? (Math.random() * 2 - 1) * s : 0) - j;
    n.style.translate = dx || dy ? `${dx.toFixed(1)}px ${dy.toFixed(1)}px` : "";
    n.style.rotate = g("tilt") ? g("tilt").toFixed(2) + "deg" : "";
    n.style.scale = g("zoom") !== 1 ? g("zoom").toFixed(3) : "";
    n.style.opacity = g("fade") !== 1 ? g("fade").toFixed(3) : "";
  }
}
Params.addProvider({
  prefix: "win.",
  label: "Окна",
  list() {
    const out = Object.entries(FX).map(([e, f]) => ({ addr: `win.*.${e}`, label: "Все окна · " + f.label, group: "Эффекты окон" }));
    for (const w of document.querySelectorAll(".window[data-wkey]"))
      for (const [e, f] of Object.entries(FX)) out.push({ addr: `win.${w.dataset.wkey}.${e}`, label: titleOf(w.dataset.wkey) + " · " + f.label, group: "Эффекты окон" });
    return out;
  },
  resolve(addr) {
    const i = addr.lastIndexOf("."), key = addr.slice(4, i), e = addr.slice(i + 1), f = FX[e];
    if (!f || !key) return null;
    return { label: (key === "*" ? "Все окна" : titleOf(key)) + " · " + f.label, spec: { min: f.min, max: f.max, def: f.def },
      base: () => f.def,
      apply: v => { state.set(`${key}.${e}`, v); paintWin(key); },
      restore: () => { state.delete(`${key}.${e}`); paintWin(key); } };
  },
});
