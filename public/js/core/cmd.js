import { AudioOS } from "./audio.js";
import { Bus } from "./bus.js";
import { el } from "./util.js";
import { notify, copyText } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= Команды ОС =================
 * Каждое окно умеет описать себя командой (кнопка ⌘ в заголовке): выполни её — откроется такое же окно
 * с такими же настройками там же. Из команд собираются скрипты .nos (приложение «Скрипты»): открыть окна,
 * поставить педали, протянуть провода — одной кнопкой, а не руками каждый раз.
 *
 * Синтаксис: одна команда в строке, слова через пробел, "строка в кавычках", хвост строки с { или [ — JSON.
 * # — комментарий. Ошибка в строке не останавливает скрипт: строка пропускается, остальные выполняются.
 *
 * Окно описывает себя так: w.cmd() → текст (если приложение его задало), иначе по ключу окна (file:…, dawn:…,
 * settings…). В конец добавляется place x y w h — положение и размер.
 */
const q = s => /^[^\s"#{[]+$/.test(String(s)) ? String(s) : JSON.stringify(String(s));

/* разбор строки на слова; JSON-хвост — одним значением */
export function parseLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === " " || line[i] === "\t") i++;
    if (i >= line.length || line[i] === "#") break;
    if (line[i] === "{" || line[i] === "[") { out.push(JSON.parse(line.slice(i))); break; }
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
      out.push(JSON.parse(line.slice(i, j + 1)));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < line.length && line[j] !== " " && line[j] !== "\t") j++;
    out.push(line.slice(i, j));
    i = j;
  }
  return out;
}

const lastWin = () => { let w = null; for (const x of WM.wins.values()) if (!w || x.id > w.id) w = x; return w; };
const until = (f, ms = 3000) => new Promise(res => { const t0 = performance.now(); const k = () => { const v = f(); if (v || performance.now() - t0 > ms) res(v); else setTimeout(k, 40); }; k(); });
async function opened(before, run) {
  await run();
  return (await until(() => { const w = lastWin(); return w && w.id > before ? w : null; }, 1500)) || WM.focused || null;
}

export const Cmd = {
  list: new Map(),
  add(name, usage, help, run) { this.list.set(name, { usage, help, run }); },

  /* выполнить текст скрипта; log(строка, ок, сообщение) — для окна «Скрипты» */
  async run(text, log = () => {}) {
    const ctx = { win: null };
    let ok = 0, bad = 0;
    for (const [n, raw] of String(text).split("\n").entries()) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      try {
        const [name, ...args] = parseLine(line);
        const c = this.list.get(name);
        if (!c) throw new Error("нет такой команды: " + name);
        await c.run(args, ctx);
        ok++; log(n + 1, true, line);
      } catch (e) { bad++; log(n + 1, false, line + "  ← " + (e.message || e)); }
    }
    return { ok, bad };
  },

  /* команда, которая откроет это окно таким же */
  windowCommand(w) {
    let body = null;
    try { body = w.cmd?.() ?? byKey(w); } catch (e) { body = "# не получилось: " + e.message; }
    if (!body) return `# окно «${w.node.querySelector(".titlebar .title")?.textContent || ""}» пока не умеет описать себя командой`;
    const s = w.node.style, r = [s.left, s.top, s.width, s.height].map(v => Math.round(parseFloat(v) || 0));
    return body + `\nplace ${r.join(" ")}`;
  },
  /* снимок: системная стойка + все открытые окна */
  snapshot() {
    const parts = ["# снимок nikita.os · " + new Date().toLocaleString(globalThis.NOS_LOCALE)];
    if (Bus.rig.mods.length || Bus.rig.pedals.length) parts.push(rigScript());
    for (const w of [...WM.wins.values()].sort((a, b) => a.id - b.id)) {
      if (w.key?.startsWith("rig:")) continue;   // окна стойки — ниже, без повтора её состава
      parts.push(this.windowCommand(w));
    }
    for (const w of WM.wins.values()) if (w.key?.startsWith("rig:")) parts.push(winOnly(w));
    return parts.join("\n\n");
  },
};

/* окна, которые узнаются по ключу */
const APP_KEYS = ["sound", "dj", "settings", "about", "chat", "airhockey", "dungeon", "share", "trip", "thawlab", "kana", "palette", "scripts"];
function byKey(w) {
  const k = w.key || "";
  if (k.startsWith("file:")) return "open " + q(k.slice(5));
  if (APP_KEYS.includes(k)) return "app " + k;
  if (k.startsWith("dawn:")) {
    const path = globalThis.nosDawn?.path;
    const [, mod, arg] = k.split(":");
    return (path ? "dawn " + q(path) : "dawn") + (mod === "transport" ? "" : `\ndawn.win ${mod}${arg ? " " + q(arg) : ""}`);
  }
  return null;
}
function winOnly(w) {
  const s = w.node.style, r = [s.left, s.top, s.width, s.height].map(v => Math.round(parseFloat(v) || 0));
  const [, kind, id] = w.key.split(":");
  return `rig.open ${kind}${id ? " " + id : ""}\nplace ${r.join(" ")}`;
}

/* ---------- системная стойка → команды ---------- */
const SRC_FIELDS = { knob: ["value"], env: ["env"], lfo: ["lfo"], wind: ["wind"], mouse: ["mouse"], level: ["level"] };
export function srcLines(m) {
  const extra = { name: m.name, color: m.color };
  for (const f of SRC_FIELDS[m.type] || []) extra[f] = m[f];
  return [`rig.src ${m.id} ${m.type} ${JSON.stringify(extra)}`, ...m.wires.map(w => `rig.wire ${m.id} ${q(w.to)} ${+(+w.amt).toFixed(3)}`)];
}
export function pedalLine(p) { return `rig.pedal ${p.id} ${p.type}${p.on ? "" : " off"} ${JSON.stringify(p.p)}`; }
export function rigScript({ kinds = null, pedals = true, mods = true } = {}) {
  const L = [`rig.bpm ${Bus.rig.bpm || 120}`];
  if (mods) for (const m of Bus.rig.mods) if (!kinds || kinds.includes(m.type)) L.push(...srcLines(m));
  if (pedals) {
    for (const p of Bus.rig.pedals) L.push(pedalLine(p));
    const ids = new Set(Bus.rig.pedals.map(p => "pedal:" + p.id));   // и кабели педалей (звук ОС)
    for (const r of AudioOS.routes) if (ids.has(r.from) || ids.has(r.to)) L.push(`audio.route ${r.from}${r.fp ? "#" + r.fp : ""} ${r.to}${r.tp ? "#" + r.tp : ""}`);
  }
  return L.join("\n");
}

/* ---------- сами команды ---------- */
Cmd.add("open", "open <путь>", "Открыть файл или папку", async ([p], ctx) => {
  if (!p) throw new Error("нужен путь");
  const before = lastWin()?.id || 0;
  ctx.win = await opened(before, async () => (await import("../open.js")).openPath(p));
});
Cmd.add("app", "app <имя> [путь|адрес]", "Открыть приложение: settings, chat, browser, kana, trip, palette, scripts…", async ([name, path], ctx) => {
  const before = lastWin()?.id || 0;
  ctx.win = await opened(before, async () => {
    if (name === "scripts") return (await import("../apps/scripts.js")).openScripts(path);
    return (await import("../open.js")).Links.run({ app: name, path });
  });
});
Cmd.add("dawn", "dawn [проект.dawn]", "Открыть DAWN (с проектом или текущий)", async ([p], ctx) => {
  const { openDawn, Dawn } = await import("../apps/dawn/index.js");
  if (!p && globalThis.nosDawn?.open) { ctx.win = Dawn.open("transport"); return; }
  await openDawn(p);
  ctx.win = await until(() => Dawn.wins.get("transport"));
});
Cmd.add("dawn.win", "dawn.win <модуль> [аргумент]", "Окно DAWN: rack, piano, playlist, mixer, mods, pedals, lib, magic, inst <канал>…", async ([mod, arg], ctx) => {
  const { openDawn, Dawn } = await import("../apps/dawn/index.js");
  if (!globalThis.nosDawn?.open) { await openDawn(); await until(() => Dawn.wins.get("transport")); }
  ctx.win = Dawn.open(mod, arg) || null;
  if (!ctx.win) throw new Error("нет такого окна DAWN: " + mod);
});
Cmd.add("rig.open", "rig.open auto|gen|pedals|pedal <id>", "Окно системной стойки: автоматизация, генераторы, педали или одна педаль", async ([kind, id], ctx) => {
  ctx.win = await (await import("../apps/rig/index.js")).openRig(kind, id);
});
Cmd.add("place", "place <x> <y> <ширина> <высота>", "Поставить окно из предыдущей команды", async (a, ctx) => {
  const w = ctx.win;
  if (!w) throw new Error("нет окна: place идёт после команды, которая открывает окно");
  const [x, y, ww, hh] = a.map(Number);
  if ([x, y, ww, hh].some(v => !isFinite(v))) throw new Error("нужны 4 числа");
  if (w.maximized) WM.setMax(w, false);
  Object.assign(w.node.style, { left: x + "px", top: y + "px", width: Math.max(160, ww) + "px", height: Math.max(80, hh) + "px" });
});
Cmd.add("rig.bpm", "rig.bpm <темп>", "Темп часов ОС (LFO и огибающие стойки)", async ([b]) => {
  Bus.rig.bpm = Math.max(20, Math.min(300, +b || 120)); Bus.changed({});
});
Cmd.add("rig.clear", "rig.clear", "Очистить системную стойку (все источники, провода и педали)", async () => { Bus.reset(); });
Cmd.add("rig.src", "rig.src <id> <тип> [{настройки}]", "Источник: knob, env, lfo, wind, mouse, level. Есть такой id — заменится", async ([id, type, extra]) => {
  const { newSource, ALL_SYS_KINDS } = await import("../apps/dawn/mod.js");
  if (!ALL_SYS_KINDS.includes(type)) throw new Error("тип: " + ALL_SYS_KINDS.join(", "));
  if (!/^[\w-]{1,24}$/.test(id || "")) throw new Error("id — буквы и цифры");
  const old = Bus.rig.mods.find(m => m.id === id);
  const src = { ...newSource(type, Bus.rig.mods, null, true), ...(extra && typeof extra === "object" ? extra : {}), id, type, wires: old?.wires || [] };
  Bus.rig.mods = old ? Bus.rig.mods.map(m => m === old ? src : m) : [...Bus.rig.mods, src];
  Bus.changed({});
});
Cmd.add("rig.wire", "rig.wire <id источника> <адрес> [сила −1..1]", "Протянуть провод. Адреса — в ⌘ любого окна стойки или в списке «＋ цель»", async ([id, to, amt]) => {
  const src = Bus.rig.mods.find(m => m.id === id);
  if (!src) throw new Error("нет источника " + id);
  if (!to) throw new Error("нужен адрес");
  const a = Math.max(-1, Math.min(1, amt == null ? 0.5 : +amt || 0));
  const w = src.wires.find(x => x.to === to);
  if (w) w.amt = a; else src.wires.push({ to, amt: a });
  Bus.changed({});
});
Cmd.add("rig.pedal", "rig.pedal <id> <тип> [off] [{параметры}]", "Педаль ОС на звук плеера: delay, reverb, eq, dist… Есть такой id — заменится", async ([id, type, ...rest]) => {
  const { RIG_FX, newPedal, Pedalboard } = await import("../apps/rig/pedalboard.js");
  if (!RIG_FX.includes(type)) throw new Error("тип: " + RIG_FX.join(", "));
  const off = rest[0] === "off", p = rest.find(x => x && typeof x === "object");
  const pd = { ...newPedal(type), id, on: !off };
  if (p) Object.assign(pd.p, p);
  const i = Bus.rig.pedals.findIndex(x => x.id === id);
  if (i >= 0) Bus.rig.pedals[i] = pd; else Bus.rig.pedals.push(pd);
  Pedalboard.boot();
  Bus.changed({});
});
Cmd.add("photo", "photo <путь> [flat|parallax|3d] [{настройки}]", "Просмотрщик фото в режиме: фото, параллакс по глубине или 3D", async ([p, mode, set], ctx) => {
  if (!p) throw new Error("нужен путь к картинке");
  const { openPhoto } = await import("../apps/photo/viewer.js");
  ctx.win = openPhoto(p, { mode: ["flat", "parallax", "3d"].includes(mode) ? mode : "flat", set: set && typeof set === "object" ? set : undefined });
});
const port = s => { const i = String(s || "").lastIndexOf("#"); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
Cmd.add("audio.route", "audio.route <откуда[#порт]> <куда[#порт]>", "Кабель звука ОС: player, dj.a, dj.b, pedal:<id>, mixer; порты — pedal:p1#2, pedal:p2#B", async ([from, to]) => {
  if (!from || !to) throw new Error("нужно: откуда и куда");
  const [a, fp] = port(from), [b, tp] = port(to);
  AudioOS.connect(a, b, fp, tp);
});
Cmd.add("audio.unroute", "audio.unroute <откуда[#порт]> <куда[#порт]>", "Вынуть кабель звука ОС", async ([from, to]) => {
  const [a, fp] = port(from), [b, tp] = port(to);
  AudioOS.disconnect(a, b, fp, tp);
});
Cmd.add("wait", "wait <мс>", "Подождать", async ([ms]) => new Promise(r => setTimeout(r, Math.min(60000, Math.max(0, +ms || 0)))));
Cmd.add("say", "say <текст>", "Показать уведомление", async a => { notify(a.join(" ")); });

/* ---------- кнопка ⌘ в заголовке окна ---------- */
export function showWindowCommand(w, anchor) {
  document.querySelector(".cmd-pop")?.remove();
  const text = Cmd.windowCommand(w);
  const ta = el("textarea", { className: "cmd-text no-i18n", value: text, readOnly: true, spellcheck: false, rows: Math.min(14, text.split("\n").length + 1) });
  const pop = el("div", { className: "cmd-pop glass" },
    el("div", { className: "cmd-head" }, el("b", { textContent: "⌘ Команда этого окна" }), el("button", { className: "ngrid-x", textContent: "✕", onclick: () => pop.remove() })),
    el("div", { className: "cmd-hint", textContent: "Выполни её в «Скриптах» — откроется такое же окно с такими же настройками." }),
    ta,
    el("div", { className: "cmd-btns" },
      el("button", { className: "btn", textContent: "📋 Копировать", onclick: () => copyText(text, "Команда скопирована") }),
      el("button", { className: "btn", textContent: "📜 В скрипт", onclick: async () => { pop.remove(); (await import("../apps/scripts.js")).openScripts(null, text); } })));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(10, Math.min(r.right - 380, innerWidth - 390)) + "px";
  pop.style.top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 10) + "px";
  const away = e => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); removeEventListener("pointerdown", away, true); } };
  setTimeout(() => addEventListener("pointerdown", away, true));
  ta.focus(); ta.select();
}
