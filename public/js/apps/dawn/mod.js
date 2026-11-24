import { Bus } from "../../core/bus.js";
import { gridButton } from "../../ui/grid.js";
import { UIParams } from "../../core/uiparams.js";
import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { Engine, PASTEL } from "./engine.js";
import { LFO_SHAPES, LFO_SYNC, dawnParam, dawnTargets, srcValue, withSrc } from "./modcore.js";
import { ModView, dwBtn, knob, pal, select, shell } from "./ui.js";

/* ================= DAWN — модуляция: ручки, огибающие, LFO и проводки =================
 * Окно «Модуляция» — источники. У каждого — гнездо ●: тяни провод на любую крутилку DAWN (у крутилок есть
 * адрес data-path) или выбери цель списком — там же параметры самой ОС (os.*, из etc/params.json).
 * Один источник — сколько угодно проводов: одна ручка Macro может крутить фильтры трёх синтов и оттенок окон.
 *
 * Считает и применяет шина ОС (core/bus.js): DAWN — её клиент «dawn» (свои источники project.mods и свои цели
 * ch./mix./pedal. → G.applyOver: непрерывные сразу, остальные — на следующих нотах). Чужие цели (os.*, ui.*, win.*,
 * rig.*) шина применяет через Params. Сохранённые значения модуляция не трогает: снял провод — вернулось.
 *
 * Это же окно — «Автоматизация» и «Генераторы» самой ОС (без DAWN): render(c, win, { sys: true, kinds }) —
 * тогда источники живут в системной стойке Bus.rig, а не в проекте. Код карточек один, разница — в «области» (scope).
 */
const isDawn = a => a.startsWith("ch.") || a.startsWith("mix.") || a.startsWith("pedal.");

export const Mod = {
  showWires: false, focus: null, Dawn: null,
  start() {
    Bus.attach("dawn", {
      mods: () => Engine.project?.mods || [],
      value: src => this.value(src),
      owns: isDawn,
      param: a => Engine.project ? dawnParam(Engine.project, a) : null,
      apply: m => Engine.G?.applyOver(m),
      targets: () => Engine.project ? dawnTargets(Engine.project) : [],
      label: a => (Engine.project && dawnParam(Engine.project, a)?.label) || a + " (нет)",
    });
  },
  stop() {
    Bus.detach("dawn");
    Engine.G?.applyOver(new Map());
    if (!Bus.rig.mods.length) Wires.hide();
  },
  /* значение источника прямо сейчас: системный — по часам шины, проектный — по песне/паттерну
   * (LFO проекта — свои часы звука: качает и на остановленном транспорте) */
  value(src) {
    if (Bus.isSys(src)) return Bus.value(src);
    const P = Engine.project;
    if (!P) return 0;
    const lfoBeat = Engine.ctx ? Engine.ctx.currentTime / Engine.beatDur() : 0;
    const pos = Engine.playing ? Math.max(0, Engine.position()) : (P.mode === "song" ? P.songStart || 0 : 0);
    return srcValue(src, src.type === "lfo" ? lfoBeat : pos, withSrc(P, pos, lfoBeat, Engine.rt()));
  },
  targetLabel: addr => Bus.label(addr),
  allTargets: () => Bus.targets(),
  /* показать, куда ведёт провод: окно инструмента, микшер, настройки, педаль ОС, любое окно */
  async reveal(addr) {
    const D = this.Dawn, a = addr.split(".");
    if (a[0] === "ch" && D) return D.open("inst", a[1]);
    if (a[0] === "mix" && D) { D.mixSel = +a[1]; D.open("mixer"); Engine.emit("change", { mixsel: true, param: true }); return; }
    if (a[0] === "os" || a[0] === "bg") return (await import("../../apps/settings.js")).openSettings();
    if (a[0] === "rig") return (await import("../rig/index.js")).openRig("pedals");
    if (!(await UIParams.reveal(addr))) notify("Окно этой цели закрыто — открой его, и провод оживёт");
  },
  connect(src, addr) {
    if (src.wires.some(w => w.to === addr)) return notify("Этот провод уже есть");
    if (src.type === "knob" && addr.startsWith("ui.") && UIParams.elOf(addr)?.closest(`.dw-modcard`)) return notify("Ручку на саму себя не подключить");
    if (!Bus.known(addr)) return notify("Нет такого параметра: " + addr);
    src.wires.push({ to: addr, amt: 0.5 });
    touchSrc(src, { mods: true });
    notify(`🔌 ${src.name} → ${this.targetLabel(addr)}`);
  },
};
/* сохранить изменения источника там, где он живёт: в проекте DAWN или в системной стойке */
function touchSrc(src, what) {
  if (Bus.isSys(src)) Bus.changed(what.param ? { param: true } : {});
  else Engine.touch(what);
}
/* дуги модуляции на крутилках — по каждому тику шины (и для DAWN, и для педалей ОС) */
Bus.on(e => { if (e.tick) ModView.set(e.tick); });

/* ---------- провода поверх экрана: от гнезда источника к крутилке-цели ---------- */
const Wires = {
  svg: null, raf: 0, drag: null,
  ensure() {
    if (this.svg) return this.svg;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("dw-wires");
    document.body.append(this.svg);
    return this.svg;
  },
  show() { this.ensure(); cancelAnimationFrame(this.raf); const f = () => { this.draw(); this.raf = requestAnimationFrame(f); }; f(); },
  hide() { cancelAnimationFrame(this.raf); this.raf = 0; if (this.svg) this.svg.replaceChildren(); this.tags([]); },
  path(x1, y1, x2, y2, color, width = 2.5, dash = "") {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sag = Math.min(160, Math.hypot(x2 - x1, y2 - y1) * 0.35 + 30);   // провисает, как кабель
    p.setAttribute("d", `M${x1} ${y1} C${x1} ${y1 + sag} ${x2} ${y2 + sag} ${x2} ${y2}`);
    p.setAttribute("stroke", color); p.setAttribute("stroke-width", width); p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round");
    if (dash) p.setAttribute("stroke-dasharray", dash);
    return p;
  },
  center(elm) { const r = elm.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  visible(elm) {
    if (!elm?.isConnected || !elm.getClientRects().length) return false;   // скрыт (другая вкладка, display:none)
    const w = elm.closest(".window");
    return !w || !w.classList.contains("minimized");
  },
  /* элемент цели на экране (видимый) или null */
  target(addr) {
    if (addr.startsWith("ui.")) { const e = UIParams.elOf(addr); return this.visible(e) ? e : null; }
    if (addr.startsWith("win.")) {
      const k = addr.slice(4, addr.lastIndexOf("."));
      const n = k === "*" ? null : [...document.querySelectorAll(".window[data-wkey]")].find(w => w.dataset.wkey === k);
      return this.visible(n) ? n.querySelector(".titlebar") : null;
    }
    return [...document.querySelectorAll(`[data-path="${CSS.escape(addr)}"]`)].find(e => this.visible(e)) || null;
  },
  /* таблички для проводов, чья цель скрыта: название + клик — открыть окно */
  tagsBox: null, tagKey: "",
  tags(list) {
    const key = list.map(t => t.addr + t.color).join("|");
    if (!this.tagsBox) { this.tagsBox = document.createElement("div"); this.tagsBox.className = "dw-wiretags"; document.body.append(this.tagsBox); }
    if (key !== this.tagKey) {
      this.tagKey = key;
      this.tagsBox.replaceChildren(...list.map(t => {
        const b = document.createElement("button");
        b.className = "dw-wiretag"; b.textContent = "↗ " + Mod.targetLabel(t.addr); b.title = "Открыть окно цели";
        b.style.setProperty("--tc", t.color);
        b.onclick = () => Mod.reveal(t.addr);
        return b;
      }));
    }
    list.forEach((t, i) => { const b = this.tagsBox.children[i]; b.style.left = t.x + "px"; b.style.top = t.y + "px"; });
  },
  /* ---------- физика: провод — верёвка из точек (Verlet), концы прибиты к гнезду и цели ---------- */
  ropes: new Map(), ends: [], last: 0,
  rope(key, x1, y1, x2, y2) {
    const N = 16;
    let r = this.ropes.get(key);
    if (!r) {
      r = { pts: Array.from({ length: N }, (_, i) => { const k = i / (N - 1), x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k; return [x, y, x, y]; }), seen: 0 };
      this.ropes.set(key, r);
    }
    r.seen = this.frameNo;
    return r;
  },
  step(r, x1, y1, x2, y2, wind, dt) {
    const P = r.pts, N = P.length, len = Math.hypot(x2 - x1, y2 - y1), seg = (len * 1.08 + 40) / (N - 1);   // чуть длиннее — провисает
    const g = 1400 * dt * dt, t = performance.now() / 1000;
    for (let i = 1; i < N - 1; i++) {
      const p = P[i], vx = (p[0] - p[2]) * 0.985, vy = (p[1] - p[3]) * 0.985;
      // ветер: порывы вдоль экрана, у середины провода сильнее
      const k = Math.sin(Math.PI * i / (N - 1)), wx = wind * k * (900 + 500 * Math.sin(t * 2.1 + i * 0.4 + p[1] * 0.01)) * dt * dt;
      const wy = wind * k * 350 * Math.sin(t * 3.3 + i * 0.7) * dt * dt;
      p[2] = p[0]; p[3] = p[1]; p[0] += vx + wx; p[1] += vy + g + wy;
    }
    P[0][0] = P[0][2] = x1; P[0][1] = P[0][3] = y1; P[N - 1][0] = P[N - 1][2] = x2; P[N - 1][1] = P[N - 1][3] = y2;
    for (let it = 0; it < 10; it++) for (let i = 0; i < N - 1; i++) {
      const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6, diff = (d - seg) / d;
      const fa = i === 0 ? 0 : i + 1 === N - 1 ? 1 : 0.5, fb = 1 - fa;
      if (i !== 0) { a[0] += dx * diff * fa; a[1] += dy * diff * fa; }
      if (i + 1 !== N - 1) { b[0] -= dx * diff * fb; b[1] -= dy * diff * fb; }
    }
  },
  ropePath(r, color, width, dash = "") {
    const P = r.pts, p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
    for (let i = 1; i < P.length - 1; i++) { const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2; d += ` Q${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`; }
    d += ` L${P.at(-1)[0].toFixed(1)} ${P.at(-1)[1].toFixed(1)}`;
    p.setAttribute("d", d); p.setAttribute("stroke", color); p.setAttribute("stroke-width", width); p.setAttribute("fill", "none");
    p.setAttribute("stroke-linecap", "round"); if (dash) p.setAttribute("stroke-dasharray", dash);
    return p;
  },
  frameNo: 0,
  draw() {
    const svg = this.ensure(), parts = [], hidden = [];
    const now = performance.now(), dt = Math.min(1 / 30, Math.max(1 / 240, (now - (this.last || now - 16)) / 1000)); this.last = now;
    this.frameNo++; this.ends = [];
    const mods = [...(Engine.project?.mods || []), ...Bus.rig.mods];
    const wind = Math.min(2, mods.filter(m => m.type === "wind").reduce((s, m) => s + Mod.value(m), 0));
    const srcs = mods.filter(s => Mod.showWires || s.id === Mod.focus);
    for (const src of srcs) {
      const jack = document.querySelector(`.dw-jack[data-src="${src.id}"]`);
      if (!this.visible(jack)) continue;
      const [x1, y1] = this.center(jack);
      let k = 0;
      for (const w of src.wires) {
        if (w.to.startsWith("win.*.")) continue;   // «все окна» — табличка не нужна, видно и так
        const t = this.target(w.to);
        let x2, y2;
        if (t) [x2, y2] = this.center(t);
        else {   // цель скрыта — провод к табличке справа от гнезда
          x2 = Math.min(innerWidth - 240, x1 + 60); y2 = Math.min(innerHeight - 30, y1 + 26 + 28 * k++);
          hidden.push({ addr: w.to, color: src.color, x: x2 + 6, y: y2 - 11 });
        }
        const r = this.rope(src.id + "|" + w.to, x1, y1, x2, y2);
        this.step(r, x1, y1, x2, y2, wind, dt);
        parts.push(this.ropePath(r, "rgba(0,0,0,0.35)", 5), this.ropePath(r, src.color, 2.5, t ? "" : "4 4"));
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x2); dot.setAttribute("cy", y2); dot.setAttribute("r", 5); dot.setAttribute("fill", src.color);
        dot.setAttribute("stroke", "rgba(0,0,0,.4)");
        parts.push(dot);
        if (t) this.ends.push({ x: x2, y: y2, src, w, jack });
      }
    }
    for (const [key, r] of this.ropes) if (r.seen !== this.frameNo) this.ropes.delete(key);
    this.tags(hidden);
    if (this.drag) parts.push(this.path(this.drag.x1, this.drag.y1, this.drag.x2, this.drag.y2, this.drag.color, 3, "6 4"));
    svg.replaceChildren(...parts);
  },
  /* поднять провод с цели: нажал на его конец (кружок на крутилке) — провод снят и снова в руке */
  grab(e) {
    if (!this.raf || e.button !== 0) return;
    const hit = this.ends.find(p => Math.hypot(p.x - e.clientX, p.y - e.clientY) < 9);
    if (!hit) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    hit.src.wires = hit.src.wires.filter(x => x !== hit.w);
    touchSrc(hit.src, { param: true });
    this.start(e, hit.src, hit.jack, true);
  },
  /* тянем провод из гнезда: отпустили над крутилкой — подключили */
  start(e, src, jack, lifted = false) {
    e.preventDefault();
    const [x1, y1] = this.center(jack);
    this.drag = { x1, y1, x2: e.clientX, y2: e.clientY, color: src.color };
    document.documentElement.classList.add("dw-wiring");
    this.ensure();
    if (!this.raf) this.show();
    const move = ev => { this.drag.x2 = ev.clientX; this.drag.y2 = ev.clientY;
      document.querySelectorAll(".wire-hover").forEach(k => k.classList.remove("wire-hover"));
      const h = document.elementFromPoint(ev.clientX, ev.clientY);
      (h?.closest("[data-path]") || (UIParams.addrOf(h) && h.closest('input, .dk')))?.classList.add("wire-hover"); };
    const up = ev => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      document.documentElement.classList.remove("dw-wiring");
      document.querySelectorAll(".wire-hover").forEach(k => k.classList.remove("wire-hover"));
      this.drag = null;
      if (!Mod.showWires && !Mod.focus) this.hide();
      const h = document.elementFromPoint(ev.clientX, ev.clientY), t = h?.closest("[data-path]");
      const addr = t ? t.dataset.path : UIParams.addrOf(h) || (h?.closest(".window .titlebar") && h.closest(".window").dataset.wkey ? `win.${h.closest(".window").dataset.wkey}.shake` : null);
      if (addr) Mod.connect(src, addr);
      else if (lifted) { notify("🔌 Провод снят"); touchSrc(src, { mods: true }); }
      else notify("Отпусти провод над крутилкой или ползунком любого окна (на заголовке — тряска окна) — или выбери цель списком «＋ цель»");
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  },
};

/* ======================= окно «Модуляция» ======================= */
addEventListener("pointerdown", e => Wires.grab(e), true);   // раньше крутилки: схватить конец провода

/* области: где живут источники и что в них можно добавить */
const NAMES = { knob: "Ручка", env: "Огибающая", lfo: "LFO", meter: "Уровень", trig: "По ноте", wind: "Ветер", mouse: "Курсор", level: "Громкость плеера" };
const GLYPHS = { knob: "🎚", env: "📈", lfo: "∿", meter: "📶", trig: "⚡", wind: "🌬", mouse: "🖱", level: "🎵" };
const DAWN_SCOPE = {
  id: "dawn", kinds: ["knob", "env", "lfo", "trig", "wind", "meter"],
  mods: () => (Engine.project.mods ||= []),
  remove: src => { Engine.project.mods = Engine.project.mods.filter(m => m !== src); },
  touch: w => Engine.touch(w),
  envLen: () => Math.max(4, Engine.songLength() || Engine.patLength()),
  pos: () => Engine.playing ? Engine.position() : -1,
  watch: fn => { const a = Engine.on("change", w => { if (!w?.param) fn(); }), b = Engine.on("theme", fn); return () => { a(); b(); }; },
};
export const ALL_SYS_KINDS = ["knob", "env", "lfo", "wind", "mouse", "level"];
const sysScope = kinds => ({
  id: "sys", kinds: kinds || ALL_SYS_KINDS,
  mods: () => Bus.rig.mods,
  remove: src => { Bus.rig.mods = Bus.rig.mods.filter(m => m !== src); },
  touch: w => Bus.changed(w.param && !w.mods ? { param: true } : {}),
  envLen: () => 16,
  pos: () => Bus.beat(),
  watch: fn => Bus.on(e => { if (e.rig) fn(); }),
});
/* новый источник: ид, имя и настройки всех типов (тип можно будет поменять без потери полей) */
export function newSource(type, list, P = null, sys = false) {
  const n = list.length, kick = P?.channels.find(c => c.id === "kick") || P?.channels[0];
  const len = P ? Math.max(4, Engine.songLength() || Engine.patLength()) : 16;
  return { id: (sys ? "s" : "m") + Math.random().toString(36).slice(2, 7), type, name: NAMES[type] + " " + (n + 1),
    meter: { mix: kick?.mix || 1, gain: 1.5 }, trig: { ch: kick?.id || "", att: 5, hold: 40, rel: 250, vel: true },
    color: PASTEL[(n + 5) % PASTEL.length], value: 0.5,
    env: { len, loop: true, pts: [[0, 0], [len, 1]] },
    lfo: { sync: 3, shape: "sine", phase: 0 }, wind: { input: "", strength: 0.5, gust: 0.4 },
    mouse: { axis: "x" }, level: { gain: 1.5 }, wires: [] };
}

export const MODS = {
  title: () => "Модуляция",
  icon: "🔌", color: "#b8f59e",
  size: () => [560, 560, Math.max(12, innerWidth - 600), 260],
  /* arg: { sys: true, kinds } — системная стойка ОС (окна «Автоматизация» и «Генераторы» из Пуска) */
  render(c, win, arg, Dawn) {
    const S = arg?.sys ? sysScope(arg.kinds) : DAWN_SCOPE;
    if (Dawn) Mod.Dawn = Dawn;
    const root = shell(c, "dw-mods-win", "#b8f59e");
    const list = el("div", { className: "dw-modlist" });
    const top = el("div", { className: "dw-pr-tools" });
    root.append(top, list);
    let meters = [];

    function add(type) {
      const list = S.mods();
      list.push(newSource(type, list, S.id === "dawn" ? Engine.project : null, S.id === "sys"));
      S.touch({ mods: true });
    }

    function build() {
      const mods = S.mods().filter(m => S.kinds.includes(m.type));
      const TIPS = { knob: "Ручка, которой можно крутить много параметров сразу",
        env: S.id === "dawn" ? "Кривая во времени — едет вместе с песней/паттерном" : "Кривая во времени — едет по часам ОС (темп стойки)",
        lfo: "Качание в такт", trig: "Огибающая, которая стартует от каждой ноты канала. Провод с минусом на громкость — сайдчейн",
        wind: "Генератор ветра/вибрации: качает провода на экране; вход — любой источник (бочка, LFO…), выходов — сколько угодно",
        meter: "Громкость инсерта микшера как источник: бочка громче — окна трясутся",
        mouse: "Положение курсора на экране (по горизонтали или вертикали)", level: "Громкость музыки в плеере ОС: громче — больше" };
      top.replaceChildren(
        ...S.kinds.map(k => dwBtn("＋ " + NAMES[k], () => add(k), { title: TIPS[k] })),
        S.id === "sys" ? el("label", { className: "dw-dim dw-bpm", title: "Темп часов ОС: по нему идут LFO и огибающие системной стойки" }, "BPM ",
          el("input", { className: "dw-num", type: "number", min: 20, max: 300, value: Bus.rig.bpm, onchange: e => { Bus.rig.bpm = Math.max(20, Math.min(300, +e.target.value || 120)); Bus.changed({ param: true }); } })) : "",
        dwBtn(Mod.showWires ? "🔌 Провода: вкл" : "🔌 Провода: выкл", () => {
          Mod.showWires = !Mod.showWires; Mod.showWires || Mod.focus ? Wires.show() : Wires.hide(); build();
        }, { className: "dw-btn" + (Mod.showWires ? " on" : ""), title: "Рисовать провода поверх всех окон" }),
        el("span", { className: "dw-dim", textContent: "Тяни ● на любую крутилку или ползунок ОС · клик по карточке — её провода" }));
      meters = [];
      if (!mods.length) {
        list.replaceChildren(el("div", { className: "dw-dim dw-empty", textContent: S.id === "dawn"
          ? "Источников нет. Добавь ручку, огибающую или LFO — и тяни из ● провода к крутилкам синтов, микшера и даже к параметрам ОС."
          : "Источников нет. Добавь — и тяни из ● провод на любой ползунок, крутилку или заголовок окна ОС (тряска), на педали, на параметры ОС. Работает и без DAWN." }));
        return;
      }
      list.replaceChildren(...mods.map(src => card(src)));
    }

    function card(src) {
      const jack = el("button", { className: "dw-jack", title: "Тяни провод на крутилку", "data-src": src.id });
      jack.dataset.src = src.id;
      jack.style.setProperty("--jc", src.color);
      jack.onpointerdown = e => Wires.start(e, src, jack);
      const meter = el("div", { className: "dw-modmeter" }, el("i"));
      meters.push({ src, meter });
      const name = el("input", { className: "dw-name dw-modname", value: src.name, maxLength: 24,
        onchange: () => { src.name = name.value.trim() || src.name; S.touch({ mods: true, param: true }); } });
      const head = el("div", { className: "dw-modhead" }, el("span", { className: "dw-modtype", textContent: GLYPHS[src.type] }),
        name, meter, jack,
        dwBtn("✕", () => { S.remove(src); S.touch({ mods: true }); }, { className: "dw-btn dw-x", title: "Удалить источник" }));
      let body;
      if (src.type === "knob") {
        body = el("div", { className: "dw-modbody" },
          knob({ spec: { min: 0, max: 1, def: 0.5, label: "Value" }, size: 56, color: src.color, get: () => src.value, set: v => { src.value = v; }, done: () => S.touch({ param: true }) }).node,
          el("span", { className: "dw-dim", textContent: "Одна ручка → все провода сразу" }));
      } else if (src.type === "lfo") {
        body = el("div", { className: "dw-modbody" },
          select(LFO_SYNC.map((s, i) => [i, "⏱ " + s[0]]), src.lfo.sync, v => { src.lfo.sync = +v; S.touch({ param: true }); }, "Период"),
          select(LFO_SHAPES.map(s => [s, s]), src.lfo.shape, v => { src.lfo.shape = v; S.touch({ param: true }); }, "Форма"),
          knob({ spec: { min: 0, max: 1, def: 0, label: "Phase" }, color: src.color, get: () => src.lfo.phase, set: v => { src.lfo.phase = v; }, done: () => S.touch({ param: true }) }).node);
      } else if (src.type === "meter") {
        const P = Engine.project;
        body = el("div", { className: "dw-modbody" },
          select(P.mixer.map((m, i) => [i, (i ? `${i} · ${m.name}` : "Master")]), src.meter.mix, v => { src.meter.mix = +v; S.touch({ param: true }); }, "Какой инсерт слушать"),
          knob({ spec: { min: 0, max: 8, def: 1.5, label: "Gain", curve: 2 }, color: src.color, get: () => src.meter.gain, set: v => { src.meter.gain = v; }, done: () => S.touch({ param: true }) }).node,
          el("span", { className: "dw-dim", textContent: "Громкость инсерта → провода" }));
      } else if (src.type === "wind") {
        const wd = (src.wind ||= { input: "", strength: 0.5, gust: 0.4 });
        body = el("div", { className: "dw-modbody" },
          select([["", "вход: постоянный"], ...S.mods().filter(m => m !== src && m.type !== "wind").map(m => [m.id, "вход: " + m.name])], wd.input, v => { wd.input = v; S.touch({ param: true }); }, "Что раздувает ветер"),
          knob({ spec: { min: 0, max: 1, def: 0.5, label: "Сила" }, color: src.color, get: () => wd.strength, set: v => { wd.strength = v; }, done: () => S.touch({ param: true }) }).node,
          knob({ spec: { min: 0, max: 1, def: 0.4, label: "Порывы" }, color: src.color, get: () => wd.gust, set: v => { wd.gust = v; }, done: () => S.touch({ param: true }) }).node,
          el("span", { className: "dw-dim", textContent: "Качает провода; его провода — как у любого источника" }));
      } else if (src.type === "trig") {
        const P = Engine.project, tr = src.trig;
        const k = (key, label, min, max, def) => knob({ spec: { min, max, def, label, curve: 2 }, color: src.color, get: () => tr[key], set: v => { tr[key] = v; }, done: () => S.touch({ param: true }) }).node;
        body = el("div", { className: "dw-modbody" },
          select(P.channels.map(c => [c.id, c.name]), tr.ch, v => { tr.ch = v; S.touch({ param: true }); }, "От нот какого канала"),
          k("att", "Att мс", 0, 500, 5), k("hold", "Hold мс", 0, 1000, 40), k("rel", "Rel мс", 1, 3000, 250),
          dwBtn(tr.vel ? "vel" : "vel ✕", e => { tr.vel = !tr.vel; e.target.textContent = tr.vel ? "vel" : "vel ✕"; S.touch({ param: true }); }, { title: "Учитывать силу ноты" }),
          el("span", { className: "dw-dim", textContent: "Провод с минусом на громкость = сайдчейн" }));
      } else if (src.type === "mouse") {
        const ms = (src.mouse ||= { axis: "x" });
        body = el("div", { className: "dw-modbody" },
          select([["x", "↔ по горизонтали"], ["y", "↕ по вертикали"]], ms.axis, v => { ms.axis = v; S.touch({ param: true }); }, "Какая координата курсора"),
          el("span", { className: "dw-dim", textContent: "0 — левый/верхний край экрана, 1 — правый/нижний" }));
      } else if (src.type === "level") {
        const lv = (src.level ||= { gain: 1.5 });
        body = el("div", { className: "dw-modbody" },
          knob({ spec: { min: 0, max: 8, def: 1.5, label: "Gain", curve: 2 }, color: src.color, get: () => lv.gain, set: v => { lv.gain = v; }, done: () => S.touch({ param: true }) }).node,
          el("span", { className: "dw-dim", textContent: "Громкость плеера ОС → провода (включи музыку в 🎵)" }));
      } else body = envEditor(src);
      const wires = el("div", { className: "dw-wirelist" }, ...src.wires.map(w => el("div", { className: "dw-wire" },
        el("span", { className: "dw-wire-to", textContent: "→ " + Mod.targetLabel(w.to), title: w.to }),
        knob({ spec: { min: -1, max: 1, def: 0.5, label: "Amt", bipolar: true }, size: 26, color: src.color, get: () => w.amt, set: v => { w.amt = v; }, done: () => S.touch({ param: true }) }).node,
        dwBtn("✕", () => { src.wires = src.wires.filter(x => x !== w); S.touch({ mods: true }); }, { className: "dw-btn dw-x", title: "Снять провод" }))));
      const pick = gridButton({ label: "＋ цель…", title: "Подключить к параметру", className: "dw-btn dw-target-btn", onPick: it => Mod.connect(src, it.value),
        columns: () => targetColumns(Mod.allTargets(), src) });
      const cardEl = el("div", { className: "dw-modcard" + (Mod.focus === src.id ? " focus" : ""), style: `--mc:${src.color}` }, head, body, wires, pick);
      // клик по карточке — показать все её провода (и таблички к скрытым целям); ещё клик — спрятать
      cardEl.addEventListener("pointerdown", e => {
        if (e.target.closest(".dw-jack, select, input, .dk, button")) return;
        Mod.focus = Mod.focus === src.id ? null : src.id;
        list.querySelectorAll(".dw-modcard").forEach(x => x.classList.toggle("focus", x === cardEl && !!Mod.focus));
        Mod.focus || Mod.showWires ? Wires.show() : Wires.hide();
      });
      return cardEl;
    }

    /* огибающая: клик — точка, тянуть — двигать, ПКМ — удалить; длина в долях, повтор */
    function envEditor(src) {
      const e = src.env;
      const cv = el("canvas", { className: "dw-envcv" });
      const len = el("input", { className: "dw-num", type: "number", min: 0.25, step: 0.25, value: e.len, title: "Длина, долей",
        onchange: () => { e.len = Math.max(0.25, +len.value || 16); S.touch({ param: true }); draw(); } });
      const loop = dwBtn("🔁", () => { e.loop = !e.loop; loop.classList.toggle("on", e.loop); S.touch({ param: true }); }, { className: "dw-btn" + (e.loop ? " on" : ""), title: "Повторять" });
      const fitSong = S.id === "dawn" ? dwBtn("= песня", () => { e.len = Math.max(1, Engine.songLength() || Engine.patLength()); len.value = e.len; S.touch({ param: true }); draw(); }, { title: "Длина как у песни" }) : "";
      const g = cv.getContext("2d");
      let W = 0, H = 0, drag = null;
      const X = x => x / e.len * W, Y = y => H - 6 - y * (H - 12), xb = px => Math.max(0, Math.min(e.len, px / W * e.len)), yv = py => Math.max(0, Math.min(1, (H - 6 - py) / (H - 12)));
      function draw() {
        const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
        if (r.width && (W !== r.width || H !== r.height)) { W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); }
        if (!W) return;
        const C = pal();
        g.clearRect(0, 0, W, H);
        g.fillStyle = C.rowB; g.fillRect(0, 0, W, H);
        g.fillStyle = C.g2;
        for (let b = 0; b <= e.len; b += e.len > 32 ? 4 : 1) g.fillRect(Math.round(X(b)), 0, 1, H);
        const pts = e.pts.slice().sort((a, b) => a[0] - b[0]);
        g.strokeStyle = src.color; g.lineWidth = 2; g.beginPath();
        pts.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)));
        g.stroke();
        g.globalAlpha = 0.18; g.fillStyle = src.color; g.lineTo(X(pts.at(-1)?.[0] || 0), H); g.lineTo(X(pts[0]?.[0] || 0), H); g.fill(); g.globalAlpha = 1;
        for (const [x, y] of pts) { g.fillStyle = "#fff"; g.beginPath(); g.arc(X(x), Y(y), 4, 0, 7); g.fill(); g.strokeStyle = src.color; g.stroke(); }
        const pos = S.pos();
        if (pos >= 0) { const x = e.loop === false ? Math.min(pos, e.len) : pos % e.len; g.fillStyle = C.head; g.fillRect(X(x), 0, 2, H); }
      }
      const hitPt = (x, y) => e.pts.find(p => Math.hypot(X(p[0]) - x, Y(p[1]) - y) < 8);
      cv.onpointerdown = ev => {
        const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
        cv.setPointerCapture(ev.pointerId);
        let p = hitPt(x, y);
        if (ev.button === 2) { if (p && e.pts.length > 1) e.pts = e.pts.filter(q => q !== p); S.touch({ param: true }); draw(); return; }
        if (!p) { p = [Math.round(xb(x) * 4) / 4, +yv(y).toFixed(3)]; e.pts.push(p); }
        drag = p; draw();
      };
      cv.onpointermove = ev => {
        if (!drag) return;
        const r = cv.getBoundingClientRect();
        drag[0] = Math.round(xb(ev.clientX - r.left) * 4) / 4; drag[1] = +yv(ev.clientY - r.top).toFixed(3);
        draw();
      };
      cv.onpointerup = () => { if (drag) S.touch({ param: true }); drag = null; };
      const box = el("div", { className: "dw-modbody dw-envbox" }, el("div", { className: "dw-envtools" }, len, el("span", { className: "dw-dim", textContent: "долей" }), loop, fitSong), cv);
      box._draw = draw;
      requestAnimationFrame(draw);
      return box;
    }

    build();
    let raf = 0;
    const frame = () => {
      for (const m of meters) m.meter.firstChild.style.width = (Mod.value(m.src) * 100).toFixed(1) + "%";
      list.querySelectorAll(".dw-envbox").forEach(b => b._draw?.());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const offs = [S.watch(build)];
    if (Mod.focus) Wires.show();
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); if (Mod.focus) { Mod.focus = null; if (!Mod.showWires) Wires.hide(); } };
  },
};

/* колонки грида целей: группа → колонка, параметр → квадратик (имя без повтора группы) */
const GROUP_COLORS = [["Канал", "#c3a6ff"], ["Микшер", "#ffc89e"], ["Педали", "#d7b8ff"], ["ОС", "#9fd3ff"], ["Окна", "#b8f59e"], ["Педали ОС", "#ff9ecb"], ["Фон", "#ffe08a"]];
function targetColumns(targets, src) {
  const cols = new Map();
  for (const t of targets) {
    if (src.wires.some(w => w.to === t.addr)) continue;
    if (!cols.has(t.group)) cols.set(t.group, { title: t.group.replace(/^Окна: Окно: /, "🪟 "), color: GROUP_COLORS.find(([k]) => t.group.includes(k))?.[1], items: [] });
    const parts = String(t.label).split(" · ");
    cols.get(t.group).items.push({ value: t.addr, label: parts.length > 1 ? parts.slice(1).join(" · ") : t.label, sub: parts.length > 1 ? parts[0] : "", title: t.label + "\n" + t.addr });
  }
  return [...cols.values()];
}

export { Wires };
