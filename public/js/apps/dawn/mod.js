import { Params } from "../../core/params.js";
import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { Engine, PASTEL } from "./engine.js";
import { LFO_SHAPES, LFO_SYNC, computeOver, dawnParam, dawnTargets, srcValue } from "./modcore.js";
import { ModView, dwBtn, knob, pal, select, shell } from "./ui.js";

/* ================= DAWN — модуляция: ручки, огибающие, LFO и проводки =================
 * Окно «Модуляция» — источники. У каждого — гнездо ●: тяни провод на любую крутилку DAWN (у крутилок есть
 * адрес data-path) или выбери цель списком — там же параметры самой ОС (os.*, из etc/params.json).
 * Один источник — сколько угодно проводов: одна ручка Macro может крутить фильтры трёх синтов и оттенок окон.
 *
 * Mod.tick (30 раз в секунду, пока открыт проект): считает значения целей (modcore.computeOver),
 * отдаёт DAWN-цели движку (G.applyOver — непрерывные сразу, остальные — на следующих нотах),
 * а чужие (os.*) применяет через Params. Сохранённые значения модуляция не трогает: снял провод — вернулось.
 */
const isDawn = a => a.startsWith("ch.") || a.startsWith("mix.");
const uid = () => "m" + Math.random().toString(36).slice(2, 7);

export const Mod = {
  timer: null, applied: new Set(), showWires: false,
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 33);
  },
  stop() {
    clearInterval(this.timer); this.timer = null;
    for (const a of this.applied) Params.resolve(a)?.restore();
    this.applied.clear();
    Engine.G?.applyOver(new Map());
    ModView.set(new Map());
    Wires.hide();
  },
  /* позиция для огибающих: песня/паттерн; LFO — свои часы (качает и на остановленном транспорте) */
  tick() {
    const P = Engine.project;
    if (!P || !Engine.G) return;
    const beat = Engine.playing ? Math.max(0, Engine.position()) : (P.mode === "song" ? P.songStart || 0 : 0);
    const lfoBeat = Engine.ctx ? Engine.ctx.currentTime / Engine.beatDur() : 0;
    const over = computeOver(P, beat, a => Params.resolve(a), lfoBeat);
    const dawn = new Map(), seen = new Set();
    for (const [a, v] of over) {
      if (isDawn(a)) { dawn.set(a, v); continue; }
      const r = Params.resolve(a);
      if (!r || Math.abs(v - r.base()) < 1e-6) continue;   // на базе — не трогаем ОС (без лишних фильтров на окнах)
      r.apply(v);
      this.applied.add(a); seen.add(a);
    }
    for (const a of [...this.applied]) if (!seen.has(a)) { Params.resolve(a)?.restore(); this.applied.delete(a); }
    Engine.G.applyOver(dawn);
    ModView.set(over);
  },
  targetLabel(addr) {
    const P = Engine.project;
    if (isDawn(addr)) return dawnParam(P, addr)?.label || addr + " (нет)";
    return Params.resolve(addr)?.label ? "ОС · " + Params.resolve(addr).label : addr;
  },
  allTargets() {
    return [...dawnTargets(Engine.project), ...Params.list().map(x => ({ ...x, group: (x.provider || "ОС") + ": " + x.group }))];
  },
  connect(src, addr) {
    if (src.wires.some(w => w.to === addr)) return notify("Этот провод уже есть");
    if (!isDawn(addr) && !Params.resolve(addr)) return notify("Нет такого параметра: " + addr);
    src.wires.push({ to: addr, amt: 0.5 });
    Engine.touch({ mods: true });
    notify(`🔌 ${src.name} → ${this.targetLabel(addr)}`);
  },
};

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
  hide() { cancelAnimationFrame(this.raf); this.raf = 0; if (this.svg) this.svg.replaceChildren(); },
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
    if (!elm?.isConnected) return false;
    const w = elm.closest(".window");
    return !w || !w.classList.contains("minimized");
  },
  draw() {
    const svg = this.ensure(), parts = [];
    if (Mod.showWires && Engine.project) {
      for (const src of Engine.project.mods || []) {
        const jack = document.querySelector(`.dw-jack[data-src="${src.id}"]`);
        if (!this.visible(jack)) continue;
        const [x1, y1] = this.center(jack);
        for (const w of src.wires) {
          const t = [...document.querySelectorAll(`[data-path="${CSS.escape(w.to)}"]`)].find(e => this.visible(e));
          if (!t) continue;
          const [x2, y2] = this.center(t);
          parts.push(this.path(x1, y1, x2, y2, "rgba(0,0,0,0.35)", 5), this.path(x1, y1, x2, y2, src.color, 2.5));
          const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          dot.setAttribute("cx", x2); dot.setAttribute("cy", y2); dot.setAttribute("r", 4); dot.setAttribute("fill", src.color);
          parts.push(dot);
        }
      }
    }
    if (this.drag) parts.push(this.path(this.drag.x1, this.drag.y1, this.drag.x2, this.drag.y2, this.drag.color, 3, "6 4"));
    svg.replaceChildren(...parts);
  },
  /* тянем провод из гнезда: отпустили над крутилкой — подключили */
  start(e, src, jack) {
    e.preventDefault();
    const [x1, y1] = this.center(jack);
    this.drag = { x1, y1, x2: e.clientX, y2: e.clientY, color: src.color };
    document.documentElement.classList.add("dw-wiring");
    this.ensure();
    if (!this.raf) this.show();
    const move = ev => { this.drag.x2 = ev.clientX; this.drag.y2 = ev.clientY;
      document.querySelectorAll(".dk.wire-hover").forEach(k => k.classList.remove("wire-hover"));
      document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-path]")?.classList.add("wire-hover"); };
    const up = ev => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      document.documentElement.classList.remove("dw-wiring");
      document.querySelectorAll(".dk.wire-hover").forEach(k => k.classList.remove("wire-hover"));
      this.drag = null;
      if (!Mod.showWires) this.hide();
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-path]");
      if (t) Mod.connect(src, t.dataset.path);
      else notify("Отпусти провод над крутилкой — или выбери цель списком «＋ цель»");
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  },
};

/* ======================= окно «Модуляция» ======================= */
export const MODS = {
  title: () => "Модуляция",
  icon: "🔌", color: "#b8f59e",
  size: () => [560, 560, Math.max(12, innerWidth - 600), 260],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-mods-win", "#b8f59e");
    const list = el("div", { className: "dw-modlist" });
    const top = el("div", { className: "dw-pr-tools" });
    root.append(top, list);
    let meters = [];

    function add(type) {
      const P = Engine.project, n = (P.mods ||= []).length;
      P.mods.push({ id: uid(), type, name: { knob: "Ручка", env: "Огибающая", lfo: "LFO" }[type] + " " + (n + 1),
        color: PASTEL[(n + 5) % PASTEL.length], value: 0.5,
        env: { len: Math.max(4, Engine.songLength() || Engine.patLength()), loop: true, pts: [[0, 0], [Math.max(4, Engine.songLength() || Engine.patLength()), 1]] },
        lfo: { sync: 3, shape: "sine", phase: 0 }, wires: [] });
      Engine.touch({ mods: true });
    }

    function build() {
      const P = Engine.project;
      top.replaceChildren(
        dwBtn("＋ Ручка", () => add("knob"), { title: "Ручка, которой можно крутить много параметров сразу" }),
        dwBtn("＋ Огибающая", () => add("env"), { title: "Кривая во времени — едет вместе с песней/паттерном" }),
        dwBtn("＋ LFO", () => add("lfo"), { title: "Качание в такт" }),
        dwBtn(Mod.showWires ? "🔌 Провода: вкл" : "🔌 Провода: выкл", () => {
          Mod.showWires = !Mod.showWires; Mod.showWires ? Wires.show() : Wires.hide(); build();
        }, { className: "dw-btn" + (Mod.showWires ? " on" : ""), title: "Рисовать провода поверх всех окон" }),
        el("span", { className: "dw-dim", textContent: "Тяни ● на любую крутилку" }));
      meters = [];
      if (!P.mods?.length) {
        list.replaceChildren(el("div", { className: "dw-dim dw-empty", textContent: "Источников нет. Добавь ручку, огибающую или LFO — и тяни из ● провода к крутилкам синтов, микшера и даже к параметрам ОС." }));
        return;
      }
      list.replaceChildren(...P.mods.map(src => card(src)));
    }

    function card(src) {
      const jack = el("button", { className: "dw-jack", title: "Тяни провод на крутилку", "data-src": src.id });
      jack.dataset.src = src.id;
      jack.style.setProperty("--jc", src.color);
      jack.onpointerdown = e => Wires.start(e, src, jack);
      const meter = el("div", { className: "dw-modmeter" }, el("i"));
      meters.push({ src, meter });
      const name = el("input", { className: "dw-name dw-modname", value: src.name, maxLength: 24,
        onchange: () => { src.name = name.value.trim() || src.name; Engine.touch({ mods: true, param: true }); } });
      const head = el("div", { className: "dw-modhead" }, el("span", { className: "dw-modtype", textContent: { knob: "🎚", env: "📈", lfo: "∿" }[src.type] }),
        name, meter, jack,
        dwBtn("✕", () => { const P = Engine.project; P.mods = P.mods.filter(m => m !== src); Engine.touch({ mods: true }); }, { className: "dw-btn dw-x", title: "Удалить источник" }));
      let body;
      if (src.type === "knob") {
        body = el("div", { className: "dw-modbody" },
          knob({ spec: { min: 0, max: 1, def: 0.5, label: "Value" }, size: 56, color: src.color, get: () => src.value, set: v => { src.value = v; }, done: () => Engine.touch({ param: true }) }).node,
          el("span", { className: "dw-dim", textContent: "Одна ручка → все провода сразу" }));
      } else if (src.type === "lfo") {
        body = el("div", { className: "dw-modbody" },
          select(LFO_SYNC.map((s, i) => [i, "⏱ " + s[0]]), src.lfo.sync, v => { src.lfo.sync = +v; Engine.touch({ param: true }); }, "Период"),
          select(LFO_SHAPES.map(s => [s, s]), src.lfo.shape, v => { src.lfo.shape = v; Engine.touch({ param: true }); }, "Форма"),
          knob({ spec: { min: 0, max: 1, def: 0, label: "Phase" }, color: src.color, get: () => src.lfo.phase, set: v => { src.lfo.phase = v; }, done: () => Engine.touch({ param: true }) }).node);
      } else body = envEditor(src);
      const wires = el("div", { className: "dw-wirelist" }, ...src.wires.map(w => el("div", { className: "dw-wire" },
        el("span", { className: "dw-wire-to", textContent: "→ " + Mod.targetLabel(w.to), title: w.to }),
        knob({ spec: { min: -1, max: 1, def: 0.5, label: "Amt", bipolar: true }, size: 26, color: src.color, get: () => w.amt, set: v => { w.amt = v; }, done: () => Engine.touch({ param: true }) }).node,
        dwBtn("✕", () => { src.wires = src.wires.filter(x => x !== w); Engine.touch({ mods: true }); }, { className: "dw-btn dw-x", title: "Снять провод" }))));
      const targets = Mod.allTargets();
      const groups = [...new Set(targets.map(t => t.group))];
      const pick = el("select", { className: "dw-sel", title: "Подключить к параметру", onchange: () => { if (pick.value) Mod.connect(src, pick.value); } },
        el("option", { value: "", textContent: "＋ цель…" }),
        ...groups.map(g => el("optgroup", { label: g }, ...targets.filter(t => t.group === g).map(t => el("option", { value: t.addr, textContent: t.label })))));
      const cardEl = el("div", { className: "dw-modcard", style: `--mc:${src.color}` }, head, body, wires, pick);
      return cardEl;
    }

    /* огибающая: клик — точка, тянуть — двигать, ПКМ — удалить; длина в долях, повтор */
    function envEditor(src) {
      const e = src.env;
      const cv = el("canvas", { className: "dw-envcv" });
      const len = el("input", { className: "dw-num", type: "number", min: 0.25, step: 0.25, value: e.len, title: "Длина, долей",
        onchange: () => { e.len = Math.max(0.25, +len.value || 16); Engine.touch({ param: true }); draw(); } });
      const loop = dwBtn("🔁", () => { e.loop = !e.loop; loop.classList.toggle("on", e.loop); Engine.touch({ param: true }); }, { className: "dw-btn" + (e.loop ? " on" : ""), title: "Повторять" });
      const fitSong = dwBtn("= песня", () => { e.len = Math.max(1, Engine.songLength() || Engine.patLength()); len.value = e.len; Engine.touch({ param: true }); draw(); }, { title: "Длина как у песни" });
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
        const pos = Engine.playing ? Engine.position() : -1;
        if (pos >= 0) { const x = e.loop === false ? Math.min(pos, e.len) : pos % e.len; g.fillStyle = C.head; g.fillRect(X(x), 0, 2, H); }
      }
      const hitPt = (x, y) => e.pts.find(p => Math.hypot(X(p[0]) - x, Y(p[1]) - y) < 8);
      cv.onpointerdown = ev => {
        const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
        cv.setPointerCapture(ev.pointerId);
        let p = hitPt(x, y);
        if (ev.button === 2) { if (p && e.pts.length > 1) e.pts = e.pts.filter(q => q !== p); Engine.touch({ param: true }); draw(); return; }
        if (!p) { p = [Math.round(xb(x) * 4) / 4, +yv(y).toFixed(3)]; e.pts.push(p); }
        drag = p; draw();
      };
      cv.onpointermove = ev => {
        if (!drag) return;
        const r = cv.getBoundingClientRect();
        drag[0] = Math.round(xb(ev.clientX - r.left) * 4) / 4; drag[1] = +yv(ev.clientY - r.top).toFixed(3);
        draw();
      };
      cv.onpointerup = () => { if (drag) Engine.touch({ param: true }); drag = null; };
      const box = el("div", { className: "dw-modbody dw-envbox" }, el("div", { className: "dw-envtools" }, len, el("span", { className: "dw-dim", textContent: "долей" }), loop, fitSong), cv);
      box._draw = draw;
      requestAnimationFrame(draw);
      return box;
    }

    build();
    let raf = 0;
    const frame = () => {
      const lfoBeat = Engine.ctx ? Engine.ctx.currentTime / Engine.beatDur() : 0, pos = Engine.playing ? Math.max(0, Engine.position()) : 0;
      for (const m of meters) m.meter.firstChild.style.width = (srcValue(m.src, m.src.type === "lfo" ? lfoBeat : pos) * 100).toFixed(1) + "%";
      list.querySelectorAll(".dw-envbox").forEach(b => b._draw?.());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const offs = [Engine.on("change", w => { if (!w?.param) build(); }), Engine.on("theme", build)];
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

export { Wires };
