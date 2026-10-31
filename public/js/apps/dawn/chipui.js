import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { Engine } from "./engine.js";
import { CHIP_PRESETS, CHIP_WAVES, CONSOLES, SLOT_NAMES, chipEnterStrict, chipStatus, slotOf } from "./chip.js";
import { dwBtn, knob, select } from "./ui.js";

/* ================= DAWN — 👾 окно чип-синта и индикатор чиптюн-режима ================= */

const kn = (ch, key, color) => knob({ spec: key, color, path: `ch.${ch.id}.${key}`, get: () => ch.params[key], set: v => { ch.params[key] = v; },
  done: () => { Engine.touch({ param: true }); Engine.preview(ch); } }).node;
const touch = ch => { Engine.touch({ param: true }); Engine.preview(ch); };

/* редактор ступенек: колонки 0..max мышкой (таблица громкости, wavetable) */
function steps(arr, max, color, onDone, h = 64) {
  const cv = el("canvas", { className: "dw-chip-steps", width: 300, height: h });
  const draw = () => {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height, w = W / arr.length;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(127,127,127,0.12)"; g.fillRect(0, 0, W, H);
    g.fillStyle = color;
    arr.forEach((v, i) => { const y = H - (v / max) * (H - 2); g.fillRect(i * w + 1, y, Math.max(1, w - 2), H - y); });
  };
  let down = false;
  const set = e => {
    const r = cv.getBoundingClientRect(), i = Math.floor((e.clientX - r.left) / r.width * arr.length), v = Math.round((1 - (e.clientY - r.top) / r.height) * max);
    if (i >= 0 && i < arr.length) { arr[i] = Math.max(0, Math.min(max, v)); draw(); }
  };
  cv.onpointerdown = e => { down = true; cv.setPointerCapture(e.pointerId); set(e); };
  cv.onpointermove = e => { if (down) set(e); };
  cv.onpointerup = () => { if (down) { down = false; onDone(); } };
  draw();
  cv._draw = draw;
  return cv;
}
const parseNums = s => s.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite).slice(0, 32);
const parseWaves = s => s.split(/[\s,;]+/).filter(w => CHIP_WAVES[w]).slice(0, 64);

const ARPS = [["—", []], ["Maj", [0, 4, 7]], ["Min", [0, 3, 7]], ["Sus", [0, 5, 7, 12]], ["7", [0, 4, 7, 10]], ["Oct", [0, 12]], ["Трель", [0, 1]]];
const SEQS = [["—", []], ["PWM", ["p50", "p50", "p25", "p25", "p125", "p125", "p25", "p25", "p50"]], ["Тон → шум", ["p50", "p50", "noise"]], ["Треуг. → шум", ["tri4", "tri4", "tri4", "noise"]], ["Писк", ["p125", "p25", "p50", "p75"]]];
const TABLES = [["Орган", [15]], ["Плак", [15, 12, 9, 7, 5, 3, 2, 1, 0]], ["Мягкий", [6, 9, 11, 12, 12]], ["Тремоло", [15, 9, 15, 9, 15, 9, 15, 9]], ["Удар", [15, 15, 13, 10, 6, 2, 0]]];
const WTS = { "∿": i => 7.5 + 7.5 * Math.sin(i / 32 * 2 * Math.PI), "⊿": i => i / 2, "⊓": i => (i < 16 ? 15 : 0), "Орган": i => 7.5 + 4 * Math.sin(i / 16 * Math.PI) + 3.5 * Math.sin(i / 8 * Math.PI) };

export function chipPanel(ch, rebuild) {
  const p = ch.params, col = ch.color, P = Engine.project, C = CONSOLES[P.chip?.console] || CONSOLES.free;
  const waves = el("div", { className: "dw-waves" }, ...Object.entries(CHIP_WAVES).map(([w, [g, t]]) =>
    el("button", { className: "dw-wave" + (p.wave === w ? " on" : ""), textContent: g, title: t, onclick: () => { p.wave = w; touch(ch); rebuild(); } })));
  const slotOpts = C.any || C.pulse ? [["auto", `Слот: авто → ${SLOT_NAMES[slotOf(ch, P)] || "—"}`], ...(C.any || [C.pulse, C.wave, C.noise].flat()).map(s => [s, "Слот: " + SLOT_NAMES[s]])] : null;
  const vol = steps(p.table, 15, col, () => touch(ch));
  const lenBtns = el("span", { className: "dw-seg" },
    dwBtn("−", () => { if (p.table.length > 1) { p.table.pop(); vol._draw(); touch(ch); } }, { title: "Короче таблица" }),
    dwBtn("＋", () => { if (p.table.length < 64) { p.table.push(p.table[p.table.length - 1]); vol._draw(); touch(ch); } }, { title: "Длиннее таблица (последнее значение держится, пока нажата нота)" }));
  const arpIn = el("input", { className: "dw-chip-in no-i18n", value: (p.arp || []).join(" "), placeholder: "0 4 7", title: "Арпеджио-таблица в полутонах: каждый кадр (или каждые Arp⏱ кадров) — следующая",
    onchange: () => { p.arp = parseNums(arpIn.value); touch(ch); } });
  const seqIn = el("input", { className: "dw-chip-in no-i18n", value: (p.seq || []).join(" "), placeholder: "p50 p25 p125", title: "Волна по кадрам: PWM, «тон, потом шум» у гибридного малого. Пусто — одна волна",
    onchange: () => { p.seq = parseWaves(seqIn.value); touch(ch); rebuild(); } });
  const usesWT = p.wave === "gbwave" || (p.seq || []).includes("gbwave");
  const wt = usesWT ? steps(p.wavetable, 15, "#9fd3ff", () => touch(ch), 56) : null;
  const row = (label, ...xs) => el("div", { className: "dw-chip-row" }, el("span", { className: "dw-dim", textContent: label }), ...xs);
  return el("div", { className: "dw-chip", style: `--oc:${col}` },
    row("Волна", waves, slotOpts ? select(slotOpts, p.slot || "auto", v => { p.slot = v; Engine.touch({ param: true, chip: true }); rebuild(); }, "В какой канал консоли идёт этот инструмент. Одна нота на слот — новая глушит старую") : ""),
    row("Громкость по кадрам", vol, lenBtns, el("span", { className: "dw-seg" }, ...TABLES.map(([n, t]) => dwBtn(n, () => { p.table.splice(0, p.table.length, ...t); vol._draw(); touch(ch); })))),
    usesWT ? row("Wavetable", wt, el("span", { className: "dw-seg" }, ...Object.entries(WTS).map(([n, f]) => dwBtn(n, () => { for (let i = 0; i < 32; i++) p.wavetable[i] = Math.round(f(i)); wt._draw(); touch(ch); })))) : "",
    row("Арпеджио", arpIn, el("span", { className: "dw-seg" }, ...ARPS.map(([n, a]) => dwBtn(n, () => { p.arp = [...a]; arpIn.value = a.join(" "); touch(ch); })))),
    row("Волны по кадрам", seqIn, el("span", { className: "dw-seg" }, ...SEQS.map(([n, s]) => dwBtn(n, () => { p.seq = [...s]; seqIn.value = s.join(" "); touch(ch); rebuild(); })))),
    el("div", { className: "dw-chip-knobs" }, ...["c_tr", "arpR", "sweep", "vibD", "vibR", "vibW", "crel", "bits", "tick"].map(k => kn(ch, k, col))),
    el("div", { className: "dw-dim dw-hint", textContent: "Всё меняется ступенькой раз в кадр (Hz): 60 — NTSC, 50 — PAL, больше — быстрее трели. Bits — разрядность громкости. Реверб и прочие эффекты можно повесить в микшере — это выключит строгий 8-бит режим." }));
}

/* индикатор в транспорте: консоль · каналы · строгий / +FX; клик — настройки режима */
export function chipBadge() {
  const box = el("div", { className: "dw-chipbox" });
  let open = false;
  const draw = () => {
    const st = chipStatus(Engine.project), P = Engine.project;
    if (!st) { box.replaceChildren(); return; }
    const mode = !st.on ? "выкл" : st.strict ? "🔒 строго" : "✨ + FX";
    const btn = el("button", { className: "dw-chipbadge no-i18n" + (st.on ? st.strict ? " strict" : " fx" : " off") + (st.on && st.shared ? " warn" : ""),
      title: st.console.full + (st.shared ? "\n⚠ каналов больше, чем слотов — они делят слоты и перебивают друг друга" : "") + "\nКлик — настройки чиптюн-режима",
      onclick: () => { open = !open; draw(); } },
      el("b", { textContent: "👾 " + st.console.name }), el("span", { textContent: `${st.chans}/${st.voices} кан.` }), el("span", { textContent: mode }));
    const pop = open ? el("div", { className: "dw-chippop" },
      select(Object.entries(CONSOLES).map(([k, c]) => [k, c.full]), P.chip.console, v => { P.chip.console = v; Engine.touch({ chip: true, param: true }); }, "Консоль: сколько каналов и какие"),
      P.chip.console === "free" ? el("label", { className: "dw-dim" }, "Голосов: ", el("input", { className: "dw-num", type: "number", min: 1, max: 16, value: P.chip.voices || 8,
        onchange: e => { P.chip.voices = Math.max(1, Math.min(16, +e.target.value || 8)); Engine.touch({ chip: true, param: true }); } })) : "",
      el("div", { className: "dw-pr-tools" },
        dwBtn(st.on ? "⏻ Выключить лимит" : "⏻ Включить", () => { P.chip.on = !P.chip.on; Engine.touch({ chip: true, param: true }); }, { title: "Без лимита все чип-каналы звучат одновременно" }),
        st.strict ? "" : dwBtn("🔒 Строгий 8-бит", () => { const n = chipEnterStrict(Engine); notify(n ? `🔒 Строгий режим: выключено эффектов — ${n} (не удалены, включаются обратно в микшере)` : "🔒 Строгий режим"); }, { title: "Эффекты на чип-каналах выключаются — чистый звук приставки" })),
      el("div", { className: "dw-dim", textContent: st.strict ? "Строго: только то, что умеет приставка. Добавишь эффект на чип-канал — режим сменится на «+ FX»." : "Эффекты разрешены: лимит каналов работает, а звук — уже не «как на железе»." })) : "";
    box.replaceChildren(btn, pop);
  };
  draw();
  const off = Engine.on("change", w => { if (w?.chip || w?.mixer || w?.channels || w?.all || w?.pedals) draw(); });
  box._off = off;
  return box;
}
export const CHIP_PRESET_NAMES = Object.keys(CHIP_PRESETS);
