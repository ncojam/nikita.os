import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { BUILTIN, Engine, FLASH_COLORS, PASTEL, TYPES, WAVES, WAVE_GLYPH, flashOf, newProject, sampleNow } from "./engine.js";
import { fromFile } from "./format.js";
import { aiPackage, aiDoc } from "./schema.js";
import { GF_PRESETS, GF_SPECS, GF_WAVES, MOD_KEYS, gfDefaults } from "./grapefruit.js";
import { MODS } from "./mod.js";
import { MAGIC } from "./magic.js";
import { DRUMS, KITS, LIB_MIME, MELODIC, instantiate } from "./library.js";
import { USER, applyPreset, presetsFor } from "./presets.js";
import { UserLib, captureSound, capturePattern } from "./userlib.js";
import { roleOf } from "./magic.js";
import { SPECS } from "./instruments.js";
import { FX, fxDefaults } from "./fx.js";
import { PIANO } from "./pianoroll.js";
import { PLAYLIST } from "./playlist.js";
import { applyTheme, dwBtn, knob, led, select, shell, theme } from "./ui.js";
import { noteNameE } from "./tuning.js";

/* ================= DAWN — окна модулей =================
 * Модуль: { title(arg), icon, color, size(arg) -> [w, h, left?, top?], render(c, win, arg, Dawn) -> cleanup }.
 * Окна подписываются на Engine.on("change") и перерисовываются; правка крутилок шлёт { param: true } —
 * на неё окна НЕ перестраиваются (иначе крутилка пропала бы из-под мыши).
 */
const SAMPLE_MIME = "application/x-dawn-sample";
const NOS_MIME = "application/x-nikita-paths";        // перетаскивание из проводника ОС
const AUDIO = /\.(wav|mp3|ogg|flac|m4a|aac|opus)$/i;
const vw = () => innerWidth;

function droppedPaths(e) {
  const dt = e.dataTransfer;
  const a = dt.getData(SAMPLE_MIME);
  if (a) return [a];
  try { return (JSON.parse(dt.getData(NOS_MIME) || "[]") || []).filter(p => AUDIO.test(p)); } catch { return []; }
}
const isSampleDrag = e => [...(e.dataTransfer?.types || [])].some(t => t === SAMPLE_MIME || t === NOS_MIME);
const rebuildOn = fn => Engine.on("change", w => { if (!w?.param) fn(w || {}); });
const frac = x => { const w = Math.floor(x + 1e-9), r = x - w, f = { 0.25: "¼", 0.5: "½", 0.75: "¾" }[Math.round(r * 4) / 4];
  return r < 1e-6 ? String(w) : f ? (w ? w + f : f) : x.toFixed(2); };

/* ======================= транспорт (хаб) ======================= */
const transport = {
  title: () => "DAWN — " + (Engine.project?.name || ""),
  icon: "🌸", color: "var(--dw-pink)",
  size: () => [Math.min(1060, vw() - 20), 178, 12, 12],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-transport", "var(--dw-pink)");
    const playB = el("button", { className: "dw-play", title: "Пуск / стоп (пробел)", onclick: () => Engine.toggle() });
    const stopB = el("button", { className: "dw-stop", title: "Стоп", onclick: () => Engine.stop() });
    const pos = el("div", { className: "dw-pos", textContent: "1:1:01" });
    const seg = el("div", { className: "dw-seg" });

    const bpm = el("div", { className: "dw-bpm", title: "Темп: тяни вверх-вниз, колесо, двойной клик — ввести" });
    const showBpm = () => bpm.replaceChildren(el("b", { textContent: (+Engine.project.bpm).toFixed(Engine.project.bpm % 1 ? 1 : 0) }), el("span", { textContent: "BPM" }));
    let bd = null;
    bpm.onpointerdown = e => { bpm.setPointerCapture(e.pointerId); bd = { y: e.clientY, v: Engine.project.bpm }; };
    bpm.onpointermove = e => { if (!bd) return; Engine.setBpm(Math.round(bd.v + (bd.y - e.clientY) * 0.4)); showBpm(); };
    bpm.onpointerup = () => { if (bd) { bd = null; Engine.touch({ param: true }); } };
    bpm.onwheel = e => { e.preventDefault(); Engine.setBpm(Engine.project.bpm - Math.sign(e.deltaY)); showBpm(); Engine.touch({ param: true }); };
    bpm.ondblclick = () => { const v = +prompt("Темп (BPM):", Engine.project.bpm); if (v >= 40 && v <= 300) { Engine.setBpm(v); showBpm(); Engine.touch({ param: true }); } };

    const patBox = el("div", { className: "dw-patbox" });
    const master = knob({ spec: "vol", label: "Master", color: "var(--dw-pink)",
      get: () => Engine.project.mixer[0].vol, set: v => { Engine.project.mixer[0].vol = v; Engine.applyInsert(0); }, done: () => Engine.touch({ param: true }) });
    const swing = knob({ spec: { min: 0, max: 0.6, def: 0, label: "Swing" }, color: "var(--dw-peach)",
      get: () => Engine.project.swing || 0, set: v => { Engine.project.swing = v; }, done: () => Engine.touch({ param: true }) });
    const scope = el("canvas", { className: "dw-scope", width: 170, height: 46 });
    const mod = (txt, name, title) => dwBtn(txt, () => Dawn.open(name), { title, className: "dw-btn dw-mod" });
    const themeB = dwBtn("", () => { applyTheme(theme() === "dark" ? "light" : "dark"); themeB.textContent = theme() === "dark" ? "☀" : "🌙"; Engine.emit("theme"); },
      { title: "Тема: тёмная / светлая пастельная" });
    themeB.textContent = theme() === "dark" ? "☀" : "🌙";
    const exportB = dwBtn("⬇ WAV", async () => {
      exportB.disabled = true; exportB.textContent = "⏳ рендер…";
      try {
        const blob = await Engine.render();
        const a = el("a", { href: URL.createObjectURL(blob), download: (Engine.project.name || "dawn") + ".wav" });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        notify(Engine.project.playlist.length ? "Песня отрендерена в WAV" : "Паттерн отрендерен в WAV (плейлист пуст)");
      } catch (e) { notify("⚠ Не отрендерилось: " + e.message); }
      exportB.disabled = false; exportB.textContent = "⬇ WAV";
    }, { title: "Экспорт в WAV: песня из плейлиста (или текущий паттерн)" });

    root.append(el("div", { className: "dw-logo" }, el("b", { textContent: "DAWN" }), el("span", { textContent: "pastel daw" })),
      el("div", { className: "dw-tbtns" }, playB, stopB), seg, pos, bpm, patBox, master.node, swing.node, scope,
      el("div", { className: "dw-mods" },
        mod("🎛 Стойка", "rack", "Стойка каналов"), mod("🎹 Пиано ролл", "piano", "Ноты канала"),
        mod("🎞 Плейлист", "playlist", "Общий таймлайн"), mod("🎚 Микшер", "mixer", "Микшер и эффекты"),
        mod("🔌 Модуляция", "mods", "Ручки, огибающие и LFO на проводках"),
        mod("✨ Магия", "magic", "Достроить композицию, ударные по стилю, брейки"),
        mod("🎛 Педали", "pedals", "Эффекты-педали: любой вход, любой выход, формула и свой код"),
        mod("📚 Библиотека", "lib", "Готовые грувы и паттерны в ладу"),
        mod("📂 Сэмплы", "browser", "Сэмплы из файловой системы"), mod("🤖", "ai", "Проект как текст — для нейросети")),
      el("div", { className: "dw-file" },
        dwBtn("💾", () => Dawn.save(), { title: "Сохранить (Ctrl+S)" }),
        dwBtn("💾…", () => Dawn.save(true), { title: "Сохранить как (Ctrl+Shift+S)" }),
        dwBtn("☁", () => Dawn.open("cloud"), { title: "Мои проекты на сервере" }),
        dwBtn("✚", () => {
          if (Engine.dirty && !confirm("Начать новый проект? Несохранённые изменения останутся черновиком в браузере.")) return;
          for (const k of [...Dawn.wins.keys()]) if (k.startsWith("inst:")) Dawn.close(...k.split(":"));
          Engine.load(newProject(), null);
          Dawn.pianoCh = Engine.project.channels.at(-1).id;
          Dawn.retitle();
        }, { title: "Новый проект" }),
        exportB, themeB,
        dwBtn("🔗", async () => {
          const url = location.origin + "/dawn" + (Engine.path ? Engine.path.split("/").map(encodeURIComponent).join("/") : "");
          try { await navigator.clipboard.writeText(url); notify("Ссылка скопирована: " + url + (Engine.path ? " (файл проекта есть только у тебя в браузере)" : "")); }
          catch { prompt("Ссылка:", url); }
        }, { title: "Ссылка на DAWN" })));

    function sync() {
      showBpm(); master.paint(); swing.paint();
      const P = Engine.project;
      seg.replaceChildren(
        el("button", { className: "dw-btn dw-live" + (P.live ? " on" : ""), textContent: "LIVE", title: "Живой режим: паттерн переключается на конце текущего, клик по ноте звучит ровно в сетку",
          onclick: () => { P.live = !P.live; Engine.touch({ param: true }); sync(); } }),
        el("button", { className: "dw-btn" + (Engine.project.mode === "pat" ? " on" : ""), textContent: "PAT", title: "Текущий паттерн по кругу", onclick: () => Engine.setMode("pat") }),
        el("button", { className: "dw-btn" + (Engine.project.mode === "song" ? " on" : ""), textContent: "SONG", title: "Песня из плейлиста", onclick: () => Engine.setMode("song") }));
      const ps = select(Engine.project.patterns.map(p => [p.id, (Engine.queued === p.id ? "⏳ " : "") + p.name]), Engine.queued || Engine.project.cur, v => Engine.selectPattern(v), "Паттерн");
      patBox.replaceChildren(ps,
        dwBtn("＋", () => Engine.addPattern(), { title: "Новый паттерн" }),
        dwBtn("⧉", () => Engine.clonePattern(), { title: "Копия паттерна" }),
        dwBtn("✎", () => { const p = Engine.pat(); const n = prompt("Имя паттерна:", p.name); if (n) { p.name = n.slice(0, 32); Engine.touch({ patterns: true }); } }, { title: "Переименовать" }),
        dwBtn("🗑", () => { const p = Engine.pat(); if (confirm(`Удалить паттерн «${p.name}» (и его клипы)?`) && !Engine.removePattern(p.id)) notify("Последний паттерн не удаляем"); }, { title: "Удалить паттерн" }));
      root.classList.toggle("playing", Engine.playing);
      Dawn.retitle();
    }
    sync();
    const offs = [rebuildOn(sync), Engine.on("play", sync), Engine.on("stop", sync), Engine.on("pattern", sync), Engine.on("mode", sync)];

    const sctx = scope.getContext("2d"), buf = new Uint8Array(1024);
    let raf = 0;
    const frame = () => {
      const st = Engine.position(), P = Engine.project;
      if (st >= 0) {
        const bar = P.mode === "song" ? 4 : Engine.barLen(), beatU = P.mode === "song" ? 1 : 4 / Engine.pat().sig[1];
        const b = Math.floor(st / bar) + 1, beat = Math.floor((st % bar) / beatU) + 1, sixt = Math.floor((st % beatU) * 4) + 1;
        pos.textContent = `${b}:${beat}:${String(sixt).padStart(2, "0")}`;
      } else pos.textContent = "1:1:01";
      if (Engine.analyser) {
        Engine.analyser.getByteTimeDomainData(buf);
        const W = scope.width, H = scope.height;
        sctx.clearRect(0, 0, W, H);
        const g = sctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, "#ff9ecf"); g.addColorStop(0.5, "#c3a6ff"); g.addColorStop(1, "#8fe8cf");
        sctx.strokeStyle = g; sctx.lineWidth = 2; sctx.beginPath();
        for (let i = 0; i < W; i++) { const v = buf[Math.floor(i / W * buf.length)] / 128 - 1, y = H / 2 - v * H * 0.45; i ? sctx.lineTo(i, y) : sctx.moveTo(i, y); }
        sctx.stroke();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

/* ======================= стойка каналов ======================= */
const LEN_STEPS = { bar: "такт", half: "½ такта", quarter: "¼ такта", beat: "доля", step: "1/16" };
const rack = {
  title: () => "Стойка каналов",
  icon: "🎛", color: "var(--dw-lav)",
  size: () => [Math.min(820, vw() - 30), 400, 12, 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-rack", "var(--dw-lav)");
    const head = el("div", { className: "dw-rack-head" });
    const body = el("div", { className: "dw-rack-body" });
    const foot = el("div", { className: "dw-rack-foot" });
    root.append(head, body, foot);
    let cols = [], inc = "bar";

    function header() {
      const pat = Engine.pat(), len = Engine.patLength(), bar = Engine.barLen(pat);
      const num = el("input", { className: "dw-num", type: "number", min: 1, max: 32, value: pat.sig[0], title: "Долей в такте",
        onchange: () => { pat.sig[0] = Math.max(1, Math.min(32, Math.round(+num.value) || 4)); Engine.touch({ notes: true }); } });
      const den = select([1, 2, 4, 8, 16].map(d => [d, d]), pat.sig[1], v => { pat.sig[1] = +v; Engine.touch({ notes: true }); }, "Длительность доли");
      const step = () => ({ bar, half: bar / 2, quarter: bar / 4, beat: 4 / pat.sig[1], step: 0.25 })[inc];
      const setLen = d => { pat.len = Math.max(0.25, Math.round(((pat.len || len) + d) * 4) / 4); Engine.touch({ notes: true }); };
      head.replaceChildren(
        el("span", { className: "dw-pat-chip", textContent: pat.name, style: `--chip:${pat.color}` }),
        el("span", { className: "dw-sig" }, num, el("span", { textContent: "/" }), den),
        el("span", { className: "dw-dim", textContent: `${frac(len / bar)} ${len / bar === 1 ? "такт" : "такта"} · ${frac(len)} долей` }),
        dwBtn("−", () => setLen(-step()), { title: "Короче" }),
        select(Object.entries(LEN_STEPS), inc, v => { inc = v; }, "На сколько менять длину"),
        dwBtn("＋", () => setLen(step()), { title: "Длиннее" }),
        dwBtn("авто", () => { pat.len = null; Engine.touch({ notes: true }); }, { title: "Длина по нотам (целыми тактами)", className: "dw-btn" + (pat.len ? "" : " on") }));
    }

    function build() {
      const P = Engine.project, pat = Engine.pat(), len = Engine.patLength();
      header();
      const steps = Math.round(len * 4), group = Math.max(1, 16 / pat.sig[1]), barSteps = Math.round(Engine.barLen(pat) * 4);
      cols = Array.from({ length: steps }, () => []);
      // стойка по категориям: ударные (сэмплы) и синты
      const drums = P.channels.filter(c => c.type === "sampler"), synths = P.channels.filter(c => c.type !== "sampler");
      const sec = (t, list) => list.length ? [el("div", { className: "dw-rack-sec", textContent: t }), ...list.map(ch => row(ch, steps, group, barSteps))] : [];
      body.replaceChildren(...sec("🥁 Ударные", drums), ...sec("🎹 Синты", synths));
      foot.replaceChildren(
        dwBtn("＋ 3XOSC", () => { const ch = Engine.addChannel("osc3"); Dawn.pianoCh = ch.id; Dawn.open("inst", ch.id); }),
        dwBtn("📚 Библиотека", () => Dawn.open("lib"), { title: "Готовые грувы и паттерны в ладу — одной кнопкой" }),
        dwBtn("＋ Grapefruit", () => { const ch = Engine.addChannel("grapefruit"); Dawn.pianoCh = ch.id; Dawn.open("inst", ch.id); }),
        dwBtn("＋ Sampler", () => { const ch = Engine.addChannel("sampler", "Sampler"); Dawn.open("inst", ch.id); }),
        select([["", "＋ Ударные…"], ...Object.entries(BUILTIN)], "", v => {
          if (!v) return;
          const ch = Engine.addChannel("sampler", BUILTIN[v], { path: "builtin:" + v });
          Engine.setSample(ch, "builtin:" + v);
        }),
        el("span", { className: "dw-dim dw-hint", textContent: "Перетащи сюда сэмпл из «Сэмплы» или из проводника" }));
    }

    function row(ch, count, group, barSteps) {
      const notes = Engine.notesOf(ch.id);
      const stepsBox = el("div", { className: "dw-steps" });
      for (let i = 0; i < count; i++) {
        const b0 = i / 4, at = notes.filter(n => n.s >= b0 - 1e-9 && n.s < b0 + 0.25 - 1e-9);
        const b = el("button", { className: "dw-step" + (at.length ? " on" : "") + (Math.floor(i / group) % 2 ? " alt" : "") + (i % barSteps === 0 && i ? " bar" : "") });
        if (at.length) { b.style.setProperty("--v", at[0].v); if (at.some(n => Math.abs(n.l - 0.25) > 1e-6 || n.n !== Engine.defaultPitch(ch))) b.classList.add("long"); }
        b.title = at.length ? at.map(n => noteNameE(n.n, ch.edo || 12)).join(" ") : "";
        b.onpointerdown = e => {
          e.preventDefault();
          if (e.button === 2 || at.length) { for (const n of at) notes.splice(notes.indexOf(n), 1); }
          else {
            const pitch = ch.type === "sampler" ? Engine.defaultPitch(ch) : (notes.at(-1)?.n ?? Engine.defaultPitch(ch));
            notes.push({ s: b0, l: 0.25, n: pitch, v: 0.85 });
            Engine.preview(ch, pitch, 0.85, Engine.stepDur());
          }
          Engine.touch({ notes: true });
        };
        cols[i].push(b);
        stepsBox.append(b);
      }
      const name = el("button", { className: "dw-ch-name", textContent: ch.name, title: "Открыть инструмент (двойной клик — пиано ролл)",
        onclick: () => Dawn.open("inst", ch.id), ondblclick: () => { Dawn.pianoCh = ch.id; Dawn.open("piano"); Engine.emit("change", { param: true, piano: true }); } });
      name.style.setProperty("--chc", ch.color);
      const mixB = el("button", { className: "dw-mixtag", textContent: ch.mix ? String(ch.mix) : "M", title: `Микшер: ${Engine.project.mixer[ch.mix]?.name || "Master"} — открыть`,
        onclick: () => { Dawn.mixSel = ch.mix || 0; Dawn.open("mixer"); Engine.emit("change", { param: true, mixsel: true }); } });
      const r = el("div", { className: "dw-row" + (Dawn.pianoCh === ch.id ? " sel" : ""), style: `--dw-row-c:${ch.color}` },
        led(!ch.mute, () => { ch.mute = !ch.mute; Engine.refreshStrips(); Engine.touch({ channels: true }); }, "Вкл/выкл (правый клик — соло)", ch.color),
        knob({ spec: "vol", size: 26, label: "", color: ch.color, path: `ch.${ch.id}.vol`, get: () => ch.vol, set: v => { ch.vol = v; Engine.refreshStrips(); }, done: () => Engine.touch({ param: true }) }).node,
        knob({ spec: "pan", size: 26, label: "", color: ch.color, path: `ch.${ch.id}.pan`, get: () => ch.pan, set: v => { ch.pan = v; Engine.refreshStrips(); }, done: () => Engine.touch({ param: true }) }).node,
        name, mixB, el("span", { className: "dw-ch-type", textContent: (ch.edo || 12) !== 12 ? ch.edo : TYPES[ch.type].icon, title: TYPES[ch.type].name + ((ch.edo || 12) !== 12 ? ` · ${ch.edo}-EDO` : "") }),
        stepsBox,
        dwBtn("🎹", () => { Dawn.pianoCh = ch.id; Dawn.open("piano"); Engine.emit("change", { param: true, piano: true }); build(); }, { title: "Пиано ролл этого канала" }),
        dwBtn("⧉", () => Engine.cloneChannel(ch.id), { title: "Клонировать канал (инструмент или сэмпл с настройками)" }),
        flashBtn(ch),
        dwBtn("✕", () => { if (confirm(`Удалить канал «${ch.name}»?`)) { Dawn.close("inst", ch.id); Engine.removeChannel(ch.id); } }, { title: "Удалить канал", className: "dw-btn dw-x" }));
      r.querySelector(".dw-led").oncontextmenu = e => { e.preventDefault(); ch.solo = !ch.solo; Engine.refreshStrips(); Engine.touch({ channels: true }); };
      if (ch.solo) r.classList.add("solo");
      if (ch.mute) r.classList.add("muted");
      if (ch.type === "sampler") {
        r.ondragover = e => { if (isSampleDrag(e)) { e.preventDefault(); e.stopPropagation(); r.classList.add("drop"); } };
        r.ondragleave = () => r.classList.remove("drop");
        r.ondrop = e => { e.preventDefault(); e.stopPropagation(); r.classList.remove("drop"); const p = droppedPaths(e)[0]; if (p) Engine.setSample(ch, p); };
      }
      return r;
    }

    root.ondragover = e => { if (isSampleDrag(e)) { e.preventDefault(); root.classList.add("drop"); } };
    root.ondragleave = e => { if (!root.contains(e.relatedTarget)) root.classList.remove("drop"); };
    root.ondrop = e => {
      e.preventDefault(); root.classList.remove("drop");
      const paths = droppedPaths(e);
      if (!paths.length) return notify("Сюда — аудиофайлы (wav, mp3, ogg…)");
      for (const p of paths.slice(0, 16)) { const ch = Engine.addChannel("sampler"); Engine.setSample(ch, p); }
    };

    build();
    let lastCol = -1, raf = 0;
    const frame = () => {
      const st = Engine.positionPattern(), col = st >= 0 ? Math.floor(st * 4 + 1e-6) : -1;
      if (col !== lastCol) { cols[lastCol]?.forEach(b => b.classList.remove("ph")); cols[col]?.forEach(b => b.classList.add("ph")); lastCol = col; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const offs = [rebuildOn(() => { lastCol = -1; build(); }), Engine.on("pattern", build)];
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

/* ✦ — цвет, которым этот канал зажигает живой фон ОС (клик — следующий цвет, потом «выкл») */
function flashBtn(ch) {
  const cur = flashOf(ch);
  const b = el("button", { className: "dw-btn dw-flash" + (cur ? " on" : ""), textContent: cur ? "✦" : "✧",
    title: cur ? "Вспышка фона этим цветом (клик — сменить)" : "Не зажигает фон (клик — включить)",
    onclick: () => {
      const i = FLASH_COLORS.indexOf(flashOf(ch));
      ch.flash = i < 0 ? FLASH_COLORS[0] : i === FLASH_COLORS.length - 1 ? null : FLASH_COLORS[i + 1];
      if (ch.flash) dispatchEvent(new CustomEvent("nos-pulse", { detail: { color: ch.flash, strength: 1 } }));
      Engine.touch({ channels: true });
    } });
  if (cur) b.style.setProperty("--fl", cur);
  return b;
}

/* ======================= окно инструмента ======================= */
function miniKeys(ch) {
  const box = el("div", { className: "dw-keys" });
  const E = ch.edo || 12, base = (E === 12 ? 48 : 4 * E), count = E === 12 ? 25 : Math.min(2 * E + 1, 49);
  if (E === 12) {   // пианино: белые в ряд, чёрные поверх
    const whites = [];
    for (let i = 0; i < count; i++) if (![1, 3, 6, 8, 10].includes((base + i) % 12)) whites.push(base + i);
    const wPct = 100 / whites.length;
    const key = (n, black, left) => {
      const k = el("div", { className: "dw-key" + (black ? " black" : ""), title: noteNameE(n) });
      if (black) Object.assign(k.style, { left: `calc(${left}% - ${wPct * 0.3}%)`, width: wPct * 0.6 + "%" });
      k.onpointerdown = e => { e.preventDefault(); k.classList.add("on"); Engine.preview(ch, n, 0.85, 0.4); };
      k.onpointerup = k.onpointerleave = () => k.classList.remove("on");
      return k;
    };
    for (const n of whites) box.append(key(n, false));
    for (let i = 0; i < count; i++) { const n = base + i; if ([1, 3, 6, 8, 10].includes(n % 12)) box.append(key(n, true, whites.indexOf(n - 1) * wPct + wPct)); }
  } else {          // другие строи: ряд одинаковых клавиш, октавы подписаны
    for (let i = 0; i < count; i++) {
      const n = base + i, k = el("div", { className: "dw-key edo" + (n % E === 0 ? " oct" : ""), title: noteNameE(n, E) });
      k.onpointerdown = e => { e.preventDefault(); k.classList.add("on"); Engine.preview(ch, n, 0.85, 0.4); };
      k.onpointerup = k.onpointerleave = () => k.classList.remove("on");
      box.append(k);
    }
  }
  return el("div", { className: "dw-keys-wrap" }, box);
}

function paramKnob(ch, key, obj = ch.params, extra = {}) {
  return knob({ spec: extra.spec || key, color: extra.color || ch.color, label: extra.label, path: `ch.${ch.id}.${extra.sub ? extra.sub + "." : ""}${key}`,
    size: extra.size, get: () => obj[key], set: v => { obj[key] = v; extra.onSet?.(); }, done: () => Engine.touch({ param: true }) }).node;
}

/* картинка огибающей ADSR: перерисовывается, пока крутишь */
function adsrView(p, color) {
  const cv = el("canvas", { className: "dw-adsr", width: 300, height: 70 });
  const draw = () => {
    const g = cv.getContext("2d"), W = cv.width, H = cv.height, pad = 6;
    const hold = 0.35, total = p.att + p.dec + hold + p.rel, sx = (W - pad * 2) / total, top = pad, bot = H - pad, y = v => bot - v * (bot - top);
    const xa = pad + p.att * sx, xd = xa + p.dec * sx, xs = xd + hold * sx, xr = xs + p.rel * sx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(127,127,127,0.12)"; g.fillRect(0, 0, W, H);
    g.beginPath(); g.moveTo(pad, bot); g.lineTo(xa, y(1)); g.lineTo(xd, y(p.sus)); g.lineTo(xs, y(p.sus)); g.lineTo(xr, bot);
    g.strokeStyle = color; g.lineWidth = 2.5; g.stroke();
    g.lineTo(pad, bot); g.globalAlpha = 0.2; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    g.fillStyle = "rgba(127,127,127,0.8)"; g.font = "9px system-ui";
    [["A", (pad + xa) / 2], ["D", (xa + xd) / 2], ["S", (xd + xs) / 2], ["R", (xs + xr) / 2]].forEach(([t, x]) => g.fillText(t, x - 3, H - 2));
  };
  draw();
  cv._draw = draw;
  return cv;
}

function osc3Panel(ch) {
  const p = ch.params;
  const oscRow = (o, i) => {
    const col = PASTEL[i];
    const waves = el("div", { className: "dw-waves" }, ...WAVES.map(wv => {
      const b = el("button", { className: "dw-wave" + (o.wave === wv ? " on" : ""), textContent: WAVE_GLYPH[wv], title: wv,
        onclick: () => { o.wave = wv; waves.querySelectorAll(".dw-wave").forEach(x => x.classList.toggle("on", x === b)); Engine.touch({ param: true }); Engine.preview(ch); } });
      return b;
    }));
    const sub = "osc" + (i + 1);
    return el("div", { className: "dw-osc", style: `--oc:${col}` }, el("div", { className: "dw-osc-n", textContent: "OSC " + (i + 1) }), waves,
      paramKnob(ch, "o_crs", o, { color: col, sub }), paramKnob(ch, "o_fin", o, { color: col, sub }),
      paramKnob(ch, "o_pan", o, { color: col, sub }), paramKnob(ch, "o_vol", o, { color: col, sub }));
  };
  const view = adsrView(p, "#ffc59e");
  const envK = k => paramKnob(ch, k, p, { color: "var(--dw-peach)", onSet: () => view._draw() });
  return el("div", { className: "dw-panel" }, ...p.oscs.map(oscRow),
    el("div", { className: "dw-sect" },
      el("div", { className: "dw-sect-h", textContent: "Фильтр" }), paramKnob(ch, "cut", p, { color: "var(--dw-sky)" }), paramKnob(ch, "res", p, { color: "var(--dw-sky)" }),
      el("div", { className: "dw-sect-h", textContent: "Огибающая" }), envK("att"), envK("dec"), envK("sus"), envK("rel"),
      el("div", { className: "dw-sect-h", textContent: "Unison" }), paramKnob(ch, "uni", p, { color: "var(--dw-pink)" }),
      paramKnob(ch, "udet", p, { color: "var(--dw-pink)" }), paramKnob(ch, "uspr", p, { color: "var(--dw-pink)" })),
    el("div", { className: "dw-sect dw-adsr-box" }, view));
}

/* Grapefruit: 4 оператора (волна, ratio, fine, level, out, ADSR + картинка), матрица модуляции, фильтр, пресеты */
function gfPanel(ch, rebuild) {
  const p = ch.params;
  const opRow = (o, i) => {
    const col = PASTEL[[0, 1, 2, 4][i]], sub = "op" + (i + 1), view = adsrView(o, col);
    const waves = el("div", { className: "dw-waves" }, ...GF_WAVES.map(wv => {
      const b = el("button", { className: "dw-wave" + (o.wave === wv ? " on" : ""), textContent: WAVE_GLYPH[wv], title: wv,
        onclick: () => { o.wave = wv; waves.querySelectorAll(".dw-wave").forEach(x => x.classList.toggle("on", x === b)); Engine.touch({ param: true }); Engine.preview(ch); } });
      return b;
    }));
    const k = (key, spec) => paramKnob(ch, key, o, { color: col, sub, spec, size: 30, onSet: () => view._draw() });
    view.classList.add("dw-adsr-mini");
    return el("div", { className: "dw-osc dw-op", style: `--oc:${col}` },
      el("div", { className: "dw-osc-n", textContent: "OP " + (i + 1) }), waves,
      k("ratio", GF_SPECS.ratio), k("fine", GF_SPECS.fine), k("level", GF_SPECS.level), k("out", GF_SPECS.out),
      k("att", SPECS.att), k("dec", SPECS.dec), k("sus", SPECS.sus), k("rel", SPECS.rel), view);
  };
  const matrix = el("div", { className: "dw-matrix" },
    ...MOD_KEYS.map(([key, from, to]) => paramKnob(ch, key, p.mod, { color: "var(--dw-pink)", spec: { ...GF_SPECS.mod, label: `${from}→${to}` }, size: 30 })));
  return el("div", { className: "dw-panel" },
    el("div", { className: "dw-sect" }, el("div", { className: "dw-sect-h", textContent: "Пресет" }),
      select(Object.keys(GF_PRESETS).map(n => [n, n]), p.preset, v => { Object.assign(ch.params, gfDefaults(v)); Engine.touch({ channels: true }); Engine.preview(ch); rebuild(); }),
      el("div", { className: "dw-sect-h", textContent: "Фильтр" }), paramKnob(ch, "cut", p, { color: "var(--dw-sky)" }), paramKnob(ch, "res", p, { color: "var(--dw-sky)" })),
    ...p.ops.map(opRow),
    el("div", { className: "dw-sect" }, el("div", { className: "dw-sect-h", textContent: "Модуляция (кто → кого)" }), matrix));
}

function samplerPanel(ch, Dawn) {
  const p = ch.params;
  const wave = el("canvas", { className: "dw-wavefile", width: 460, height: 90 });
  const label = el("div", { className: "dw-dim" });
  const draw = () => {
    const b = sampleNow(p.path), g = wave.getContext("2d"), W = wave.width, H = wave.height;
    g.clearRect(0, 0, W, H);
    label.textContent = p.path ? (p.path.startsWith("builtin:") ? "Встроенный: " + BUILTIN[p.path.slice(8)] : p.path) : "Сэмпл не выбран — перетащи сюда файл или открой «Сэмплы»";
    if (!b) return;
    const d = b.getChannelData(0), step = Math.max(1, Math.floor(d.length / W));
    const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, "#8fe8cf"); grad.addColorStop(1, "#c3a6ff");
    g.fillStyle = grad;
    for (let x = 0; x < W; x++) {
      let mx = 0; const i0 = p.rev ? d.length - (x + 1) * step : x * step;
      for (let j = 0; j < step; j++) mx = Math.max(mx, Math.abs(d[i0 + j] || 0));
      g.fillRect(x, H / 2 - mx * H / 2, 1, Math.max(1, mx * H));
    }
    g.fillStyle = "rgba(255,95,168,0.9)"; g.fillRect(p.start * W, 0, 2, H);
  };
  const toggle = (key, text) => {
    const b = el("button", { className: "dw-btn dw-tog" + (p[key] ? " on" : ""), textContent: text,
      onclick: () => { p[key] = !p[key]; b.classList.toggle("on", p[key]); Engine.touch({ param: true }); draw(); } });
    return b;
  };
  const drop = el("div", { className: "dw-dropzone" }, wave, label);
  drop.ondragover = e => { if (isSampleDrag(e)) { e.preventDefault(); drop.classList.add("drop"); } };
  drop.ondragleave = () => drop.classList.remove("drop");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("drop"); const x = droppedPaths(e)[0]; if (x) Engine.setSample(ch, x); };
  const panel = el("div", { className: "dw-panel" }, drop,
    el("div", { className: "dw-sect" },
      paramKnob(ch, "root"), paramKnob(ch, "tune"), paramKnob(ch, "start", p, { onSet: draw }), paramKnob(ch, "att"), paramKnob(ch, "rel"),
      toggle("oneshot", "One-shot"), toggle("rev", "Reverse"), dwBtn("📂 Сэмплы", () => Dawn.open("browser"))));
  panel._off = Engine.on("change", w => { if (w?.sample === ch.id || w?.channels) draw(); });
  requestAnimationFrame(draw);
  return panel;
}

const inst = {
  title: id => { const ch = Engine.chan(id); return ch ? `${TYPES[ch.type].icon} ${ch.name}` : "Инструмент"; },
  icon: "🎚", color: id => Engine.chan(id)?.color || "var(--dw-lav)",
  size: id => ({ sampler: [560, 400], grapefruit: [760, 640] })[Engine.chan(id)?.type] || [620, 640],
  render(c, win, id, Dawn) {
    const ch = Engine.chan(id);
    if (!ch) return;
    const root = shell(c, "dw-inst", ch.color);
    let panel = null;
    function build() {
      panel?._off?.();
      const name = el("input", { className: "dw-name", value: ch.name, maxLength: 24,
        onchange: () => { ch.name = name.value.trim() || ch.name; win.setTitle(inst.title(id)); Engine.touch({ channels: true }); } });
      const route = select(Engine.project.mixer.map((m, i) => [i, i ? `→ ${i}: ${m.name}` : "→ Master"]), ch.mix || 0,
        v => { ch.mix = +v; Engine.refreshStrips(); Engine.touch({ channels: true }); }, "Куда идёт звук в микшере");
      const head = el("div", { className: "dw-inst-head" },
        el("span", { className: "dw-inst-type", textContent: TYPES[ch.type].name }), name, route,
        paramKnob(ch, "vol", ch, { label: "Vol", onSet: () => Engine.refreshStrips() }), paramKnob(ch, "pan", ch, { label: "Pan", onSet: () => Engine.refreshStrips() }),
        knob({ spec: "poly", color: ch.color, get: () => ch.poly || 16, set: v => { ch.poly = v; }, done: () => Engine.touch({ param: true }) }).node,
        presetsFor(ch.type).length ? select([["", "✨ Пресет…"], ...presetsFor(ch.type).map(n => [n, n])], "", v => {
          if (!v) return;
          applyPreset(Engine, ch, v); Engine.preview(ch, null, 0.85, 0.6); build();
        }, "Готовый звук (вместе с эффектами на инсерте)") : "",
        ch.type !== "sampler" ? dwBtn("⭐", () => {
          const n = prompt("Имя своего пресета (звук + эффекты инсерта + его модуляция):", ch.preset?.startsWith(USER) ? ch.preset.slice(USER.length) : ch.name);
          const saved = n && UserLib.put("synth", n, captureSound(Engine, ch));
          if (saved) { ch.preset = USER + saved; build(); }
        }, { title: "Сохранить этот звук как свой пресет" }) : "",
        ch.preset?.startsWith(USER) ? dwBtn("🗑", () => { if (UserLib.del("synth", ch.preset.slice(USER.length))) { delete ch.preset; build(); } }, { title: "Удалить свой пресет «" + ch.preset.slice(USER.length) + "»", className: "dw-btn dw-x" }) : "");
      panel = ch.type === "osc3" ? osc3Panel(ch) : ch.type === "grapefruit" ? gfPanel(ch, build) : samplerPanel(ch, Dawn);
      root.replaceChildren(head, panel, miniKeys(ch));
    }
    build();
    const off = Engine.on("change", w => {
      if (w?.channels && !Engine.chan(id)) return Dawn.close("inst", id);
      if (w?.channels || w?.mixer || w?.all) { if (!root.contains(document.activeElement)) build(); }
    });
    return () => { off(); panel?._off?.(); };
  },
};

/* ======================= микшер ======================= */
const mixer = {
  title: () => "Микшер",
  icon: "🎚", color: "var(--dw-peach)",
  size: () => [Math.min(900, vw() - 40), 470, 40, 260],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-mixer", "var(--dw-peach)");
    const strips = el("div", { className: "dw-strips" });
    const fxBox = el("div", { className: "dw-fxbox" });
    root.append(strips, fxBox);
    Dawn.mixSel ??= 0;
    let meters = [];

    function build() {
      const P = Engine.project;
      meters = [];
      strips.replaceChildren(...P.mixer.map((m, i) => {
        const cv = el("canvas", { className: "dw-meter", width: 10, height: 120 });
        meters[i] = { cv, peak: 0 };
        const routed = P.channels.filter(ch => (ch.mix || 0) === i);
        const nm = el("div", { className: "dw-strip-name", textContent: i ? `${i} · ${m.name}` : "MASTER", title: "Двойной клик — переименовать",
          ondblclick: () => { if (!i) return; const n = prompt("Имя инсерта:", m.name); if (n) { m.name = n.slice(0, 20); Engine.touch({ mixer: true }); } } });
        const s = el("div", { className: "dw-strip" + (i === Dawn.mixSel ? " sel" : "") + (i ? "" : " master") },
          nm,
          el("div", { className: "dw-strip-mid" }, cv,
            el("div", { className: "dw-strip-knobs" },
              knob({ spec: "vol", label: "Vol", color: m.color || "var(--dw-pink)", path: `mix.${i}.vol`, get: () => m.vol, set: v => { m.vol = v; Engine.applyInsert(i); }, done: () => Engine.touch({ param: true }) }).node,
              knob({ spec: "pan", label: "Pan", color: m.color || "var(--dw-pink)", path: `mix.${i}.pan`, get: () => m.pan, set: v => { m.pan = v; Engine.applyInsert(i); }, done: () => Engine.touch({ param: true }) }).node,
              led(!m.mute, () => { m.mute = !m.mute; Engine.applyInsert(i); Engine.touch({ mixer: true }); }, "Вкл/выкл", m.color))),
          el("div", { className: "dw-strip-fx" }, ...m.fx.map(f => el("span", { className: "dw-fxdot" + (f.on ? " on" : ""), textContent: FX[f.type].icon, title: FX[f.type].name, style: `--fc:${FX[f.type].color}` }))),
          el("div", { className: "dw-dim dw-strip-ch", textContent: routed.length ? routed.map(x => x.name).join(", ") : "—", title: "Каналы, которые сюда идут" }));
        s.style.setProperty("--sc", m.color || "#ff9ecf");
        s.onclick = e => { if (e.target.closest(".dk, .dw-led")) return; Dawn.mixSel = i; build(); };
        return s;
      }), el("button", { className: "dw-btn dw-addins", textContent: "＋\nInsert", title: "Добавить инсерт", onclick: () => { const i = Engine.addInsert(); if (i == null) notify("Хватит инсертов (16)"); else Dawn.mixSel = i; } }));
      fxPanel();
    }

    function fxPanel() {
      const i = Math.min(Dawn.mixSel, Engine.project.mixer.length - 1), m = Engine.project.mixer[i];
      const slots = m.fx.map((f, k) => {
        const spec = FX[f.type];
        return el("div", { className: "dw-fx", style: `--fc:${spec.color}` },
          el("div", { className: "dw-fx-head" },
            led(f.on, () => Engine.fxToggle(i, k), "Вкл/выкл эффект", spec.color),
            el("b", { textContent: spec.icon + " " + spec.name }),
            select(Object.entries(FX).map(([t, s2]) => [t, s2.name]), f.type, v => Engine.setFx(i, k, v), "Тип эффекта"),
            dwBtn("⏏", () => { Engine.detachFx(i, k); Dawn.open("pedals"); }, { title: "Отсоединить в педаль: подключай к любому каналу или инсерту" }),
            dwBtn("✕", () => Engine.setFx(i, k, null), { title: "Убрать", className: "dw-btn dw-x" })),
          el("div", { className: "dw-fx-knobs" }, ...fxControls(spec, f, `mix.${i}.${k}.`, () => Engine.fxParam(i, k))));
      });
      fxBox.replaceChildren(
        el("div", { className: "dw-fx-title" }, el("b", { textContent: i ? `${i} · ${m.name}` : "Master" }), el("span", { className: "dw-dim", textContent: " — эффекты по порядку сверху вниз" })),
        ...slots,
        m.fx.length < 4 ? el("div", { className: "dw-fx-add" }, el("span", { className: "dw-dim", textContent: "Добавить:" }),
          ...Object.entries(FX).map(([t, s]) => dwBtn(s.icon + " " + s.name, () => Engine.setFx(i, m.fx.length, t)))) : el("div", { className: "dw-dim", textContent: "Максимум 4 эффекта" }));
    }

    build();
    let raf = 0;
    const frame = () => {
      meters.forEach((mt, i) => {
        const v = Engine.meter(i);
        mt.peak = Math.max(v, mt.peak * 0.92);
        const g = mt.cv.getContext("2d"), W = mt.cv.width, H = mt.cv.height, h = Math.min(1, mt.peak) * H;
        g.clearRect(0, 0, W, H);
        const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, "#8fe8cf"); gr.addColorStop(0.7, "#fff09e"); gr.addColorStop(1, "#ff7aa8");
        g.fillStyle = "rgba(127,127,127,0.18)"; g.fillRect(0, 0, W, H);
        g.fillStyle = gr; g.fillRect(0, H - h, W, h);
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const offs = [Engine.on("change", w => { if (!w?.param || w?.mixsel) build(); })];
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

/* ======================= браузер сэмплов ======================= */
const browser = {
  title: () => "Сэмплы",
  icon: "📂", color: "var(--dw-mint)",
  size: () => [300, 440, Math.max(12, vw() - 320), 202],
  render(c) {
    const root = shell(c, "dw-browser", "var(--dw-mint)");
    const tree = el("div", { className: "dw-tree" });
    root.append(el("div", { className: "dw-dim dw-hint", textContent: "Клик — послушать, двойной клик — новый канал, тащи в стойку" }), tree);
    const fileRow = (path, label, depth) => {
      const r = el("div", { className: "dw-file-row", draggable: true, textContent: "♪ " + label, title: path, style: `--d:${depth}` });
      r.onclick = async () => { if (!(await Engine.previewPath(path))) notify("Не получилось прочитать " + label); };
      r.ondblclick = () => { const ch = Engine.addChannel("sampler"); Engine.setSample(ch, path); };
      r.ondragstart = e => { e.dataTransfer.setData(SAMPLE_MIME, path); e.dataTransfer.setData("text/plain", path); e.dataTransfer.effectAllowed = "copy"; };
      return r;
    };
    async function dirRow(path, label, depth, open = false) {
      const kids = el("div", { className: "dw-kids", hidden: true });
      const r = el("div", { className: "dw-dir-row", textContent: "▸ 📁 " + label, style: `--d:${depth}` });
      let loaded = false;
      const toggle = async () => {
        kids.hidden = !kids.hidden;
        r.textContent = (kids.hidden ? "▸ 📁 " : "▾ 📂 ") + label;
        if (loaded || kids.hidden) return;
        loaded = true;
        kids.append(el("div", { className: "dw-dim", textContent: "…", style: `--d:${depth + 1}` }));
        try {
          const d = await (await fetch("/api/ls?path=" + encodeURIComponent(path), { cache: "no-store" })).json();
          kids.replaceChildren();
          for (const e of d.entries || []) {
            const p = (path === "/" ? "" : path) + "/" + e.name;
            if (e.type === "dir") kids.append(await dirRow(p, e.name, depth + 1));
            else if (AUDIO.test(e.name)) kids.append(fileRow(p, e.name, depth + 1));
          }
          if (!kids.children.length) kids.append(el("div", { className: "dw-dim", textContent: "(нет аудио)", style: `--d:${depth + 1}` }));
        } catch { kids.replaceChildren(el("div", { className: "dw-dim", textContent: "не открылось", style: `--d:${depth + 1}` })); }
      };
      r.onclick = toggle;
      const box = el("div", {}, r, kids);
      if (open) toggle();
      return box;
    }
    (async () => {
      tree.append(el("div", {}, el("div", { className: "dw-dir-row open", textContent: "▾ 🥁 Встроенные ударные", style: "--d:0" }),
        ...Object.entries(BUILTIN).map(([k, v]) => fileRow("builtin:" + k, v, 1))), await dirRow("/home/nikita", "nikita", 0, true));
    })();
  },
};

/* ======================= нейросеть: проект как текст ======================= */
const ai = {
  title: () => "Проект как текст",
  icon: "🤖", color: "#b8f59e",
  size: () => [620, 560],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-ai", "#b8f59e");
    const ta = el("textarea", { className: "dw-ai-ta", spellcheck: false });
    const refresh = () => { ta.value = Engine.serialize(); };
    const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); notify(msg); } catch { ta.select(); notify("Выдели и скопируй вручную (Ctrl+C)"); } };
    root.append(
      el("div", { className: "dw-ai-help dw-dim", textContent: "Формат dawn/2 — обычный JSON: время в долях, ноты именами (C4, F#3). «Дока + проект» — чтобы нейросеть доработала трек, «Только дока» — чтобы написала с нуля. Инструкция (микротональность, размеры, звуки, модуляция) собирается из кода DAWN, так что новые функции попадают туда сами. Отдай нейросети («допиши второй куплет в 11/8», «сделай бас в 19-EDO»), вставь ответ сюда и нажми «Загрузить»." }),
      el("div", { className: "dw-ai-btns" },
        dwBtn("🤖 Дока + проект", () => copy(aiPackage(Engine.serialize()), "Скопировано: инструкция + проект"), { className: "dw-btn dw-primary", title: "Чтобы нейросеть доработала этот трек" }),
        dwBtn("📘 Только дока", () => copy(aiDoc(), "Инструкция скопирована"), { title: "Чтобы нейросеть написала трек с нуля" }),
        dwBtn("📋 Только проект", () => copy(Engine.serialize(), "Проект скопирован")),
        dwBtn("↻ Обновить", refresh),
        dwBtn("⬆ Загрузить из текста", () => {
          const txt = ta.value.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");   // нейросеть любит обернуть в ```json
          const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
          try {
            const P = fromFile(txt.slice(start, end + 1));
            if (Engine.dirty && !confirm("Заменить текущий проект загруженным? (черновик останется в браузере)")) return;
            const path = Engine.path;
            for (const k of [...Dawn.wins.keys()]) if (k.startsWith("inst:")) Dawn.close(...k.split(":"));
            Engine.load(P, path); Engine.dirty = true;
            Engine.touch({ all: true });
            Dawn.pianoCh = P.channels.find(x => x.type === "osc3")?.id || P.channels[0]?.id;
            Dawn.retitle();
            notify(`Загружено: ${P.channels.length} каналов, ${P.patterns.length} паттернов, ${P.playlist.length} клипов`);
          } catch (e) { notify("⚠ Не похоже на проект DAWN: " + e.message); }
        }, { className: "dw-btn dw-primary" })),
      ta);
    refresh();
  },
};

/* ======================= библиотека паттернов ======================= */
/* ручки эффекта: числа — крутилки (с адресом для проводков), канал — выбор, текст — поле (формула, код) */
function fxControls(spec, f, pre, apply) {
  return Object.entries(spec.params).map(([key, ps]) => {
    if (ps.kind === "channel") return el("label", { className: "dw-fx-src" }, el("span", { className: "dw-dim", textContent: ps.label }),
      select(Engine.project.channels.map(c2 => [c2.id, c2.name]), f.p[key], v => { f.p[key] = v; apply(); Engine.touch({ param: true }); }, "Чьи ноты дёргают сайдчейн"));
    if (ps.kind === "text") {
      const box = el(ps.multiline ? "textarea" : "input", { className: "dw-code" + (ps.multiline ? " multi" : ""), value: f.p[key] ?? ps.def, spellcheck: false,
        title: ps.multiline ? "Тело функции (x, t, a, b, ch, state, sr) → новый сэмпл. Применяется по Ctrl+Enter или при уходе из поля" : "Формула от x (сэмпл), t (время), a, b. Есть sin, tanh, clip, fold, crush…" });
      const commit = () => { f.p[key] = box.value; apply(); Engine.touch({ param: true }); };
      box.onchange = commit;
      box.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || !ps.multiline)) { e.preventDefault(); commit(); } };
      return el("label", { className: "dw-fx-text" }, el("span", { className: "dw-dim", textContent: ps.label }), box);
    }
    return knob({ spec: ps, color: spec.color, path: pre + key, get: () => f.p[key], set: v => { f.p[key] = v; apply(); }, done: () => Engine.touch({ param: true }) }).node;
  });
}
addEventListener("dawn-code", e => notify("⚠ Код педали: " + e.detail.error, 4000));

/* ======================= педали: эффекты вне микшера ======================= */
const pedals = {
  title: () => "Педали",
  icon: "🎛", color: "#c3a6ff",
  size: () => [620, 520, Math.max(12, innerWidth - 640), 140],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-pedals", "#c3a6ff");
    const body = el("div", { className: "dw-pedal-list" }), foot = el("div", { className: "dw-fx-add" });
    root.append(el("div", { className: "dw-dim dw-hint", textContent: "Педаль берёт звук канала или инсерта и отдаёт в любой инсерт или Master (параллельно основному звуку). ⏏ в микшере отсоединяет эффект сюда, ⏎ — возвращает. Ручки педалей — цели для проводков." }), body, foot);
    function build() {
      const P = Engine.project, list = P.pedals || [];
      const ins = P.mixer.map((m, i) => [`mix:${i}`, i ? `🎚 ${i} · ${m.name}` : "🔊 Master"]);
      const srcs = [...P.channels.map(ch => [`ch:${ch.id}`, `${ch.type === "sampler" ? "🥁" : "🎹"} ${ch.name}`]), ...ins.slice(1)];
      body.replaceChildren(...(list.length ? list.map(pd => {
        const spec = FX[pd.type];
        const set = () => Engine.G.pedalSet(pd.id);
        return el("div", { className: "dw-fx dw-pedal", style: `--fc:${spec.color}` },
          el("div", { className: "dw-fx-head" },
            led(pd.on, () => { pd.on = !pd.on; Engine.pedalsChanged(); }, "Вкл/выкл", spec.color),
            el("b", { textContent: spec.icon + " " + spec.name }),
            select(Object.entries(FX).map(([t, s2]) => [t, s2.name]), pd.type, v => { pd.type = v; pd.p = fxDefaults(v); Engine.pedalsChanged(); }, "Тип эффекта"),
            dwBtn("⏎", () => { const i = +(pd.out.startsWith("mix:") && pd.out !== "mix:0" ? pd.out : pd.in).split(":")[1] || 0; if (!Engine.attachPedal(pd.id, i)) notify("В том инсерте уже 4 эффекта"); }, { title: "Вернуть в микшер (на инсерт выхода или входа)" }),
            dwBtn("✕", () => { P.pedals = P.pedals.filter(x => x !== pd); Engine.pedalsChanged(); }, { title: "Убрать", className: "dw-btn dw-x" })),
          el("div", { className: "dw-pedal-io" },
            el("span", { className: "dw-dim", textContent: "Вход" }), select(srcs, pd.in, v => { pd.in = v; Engine.pedalsChanged(); }, "Откуда педаль берёт звук"),
            el("span", { className: "dw-dim", textContent: "→ Выход" }), select(ins, pd.out, v => { pd.out = v; Engine.pedalsChanged(); }, "Куда педаль отдаёт звук"),
            pd.in === pd.out ? el("span", { className: "dw-dim", textContent: "⚠ вход = выход — педаль молчит" }) : ""),
          el("div", { className: "dw-fx-knobs" }, ...fxControls(spec, pd, `pedal.${pd.id}.`, set)));
      }) : [el("div", { className: "dw-dim dw-empty", textContent: "Педалей нет. Добавь снизу или отсоедини эффект в микшере (⏏)." })]));
      foot.replaceChildren(el("span", { className: "dw-dim", textContent: "＋ педаль:" }), ...Object.entries(FX).map(([t, s]) => dwBtn(s.icon + " " + s.name, () => Engine.addPedal(t))));
    }
    build();
    return Engine.on("change", w => { if (w?.pedals || w?.channels || w?.mixer || w?.all) build(); });
  },
};

/* ======================= мои проекты на сервере ======================= */
const cloud = {
  title: () => "Мои проекты",
  icon: "☁", color: "#9fd3ff",
  size: () => [420, 420, Math.max(12, innerWidth - 440), 160],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-cloud", "#9fd3ff"), body = el("div", { className: "dw-tree" });
    root.append(body);
    async function build() {
      const me = await Dawn.me();
      if (!me.user) {
        body.replaceChildren(el("div", { className: "dw-dim dw-empty", textContent: "Войди в чат nikita.os — и проекты будут сохраняться на сервере (до 10 штук, в любой папке)." }),
          dwBtn("💬 Войти / зарегистрироваться", async () => (await import("../chat.js")).openChat()));
        return;
      }
      body.replaceChildren(el("div", { className: "dw-dim", textContent: `${me.user} · ${me.projects.length} / ${me.max}` }),
        ...(me.projects.length ? me.projects.map(pr => el("div", { className: "dw-libcard" },
          el("div", {}, el("b", { className: "no-i18n", textContent: pr.path.split("/").pop() }), el("div", { className: "dw-dim no-i18n", textContent: pr.path + " · " + Math.ceil(pr.size / 1024) + " KB" })),
          dwBtn("📂", async () => (await import("./index.js")).openDawn(pr.path), { title: "Открыть" }),
          dwBtn("🗑", async () => { if (await (await import("../../remote/userfolders.js")).deleteServerProject(pr.path, pr.path.split("/").pop())) build(); }, { title: "Удалить с сервера", className: "dw-btn dw-x" })))
          : [el("div", { className: "dw-dim dw-empty", textContent: "Пока пусто — нажми 💾, и проект ляжет сюда." })]));
    }
    build();
    return Engine.on("change", w => { if (w?.saved) build(); });
  },
};

const lib = {
  title: () => "Библиотека",
  icon: "📚", color: "#ffb3b3",
  size: () => [380, 560, Math.max(12, innerWidth - 400), 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-lib", "#ffb3b3");
    const body = el("div", { className: "dw-tree dw-lib-list" });
    root.append(el("div", { className: "dw-dim dw-hint", textContent: "＋ — вписать в текущий паттерн: ударные заменяют ударные, синты — синты, остальное остаётся. Тащи карточку на плейлист — отдельный паттерн-клип. Мелодии строятся в ладу и строе выбранного канала." }), body);
    const card = (item, sub, del) => {
      const add = () => { const id = instantiate(item.id, Dawn, Engine.project.cur); if (id) notify(`«${item.name}» → паттерн «${Engine.pat(id).name}»`); };
      const r = el("div", { className: "dw-libcard", draggable: true },
        el("div", {}, el("b", { textContent: item.name }), el("div", { className: "dw-dim", textContent: sub })),
        dwBtn("＋", add, { title: "Вписать в текущий паттерн" }), del ? dwBtn("🗑", del, { title: "Удалить свой паттерн", className: "dw-btn dw-x" }) : "");
      r.ondragstart = e => { e.dataTransfer.setData(LIB_MIME, item.id); e.dataTransfer.effectAllowed = "copy"; };
      r.ondblclick = add;
      return r;
    };
    function build() {
      const ch = Engine.chan(Dawn.pianoCh), tgt = ch && ch.type !== "sampler" ? ch : Engine.project.channels.find(x => x.type !== "sampler");
      body.replaceChildren(
        el("div", { className: "dw-dir-row open", textContent: "⭐ Мои" }),
        el("div", { className: "dw-pr-tools" },
          el("span", { className: "dw-dim", textContent: "Сохранить текущий паттерн:" }),
          ...[["drums", "🥁 ударные"], ["synth", "🎹 синты"], ["all", "весь"]].map(([what, label]) => dwBtn(label, () => {
            const snap = capturePattern(Engine, what, roleOf);
            if (!Object.keys(snap.drums).length && !snap.synths.length) return notify("В паттерне нет таких нот");
            UserLib.put("patterns", prompt("Имя своего паттерна:", Engine.pat().name), snap);
          })),
          dwBtn("⬇", () => UserLib.export(), { title: "Экспорт моих пресетов (звуки, паттерны, магия) в файл" }),
          dwBtn("⬆", () => UserLib.import(), { title: "Импорт пресетов из файла" })),
        ...UserLib.names("patterns").map(n => { const u = UserLib.get("patterns", n);
          return card({ id: "u:" + n, name: n }, `${{ drums: "🥁", synth: "🎹", all: "🥁🎹" }[u.kind]} ${u.sig.join("/")} · ${u.len}`, () => { if (UserLib.del("patterns", n)) build(); }); }),
        el("div", { className: "dw-dir-row open", textContent: "🔥 Риддим" }),
        ...DRUMS.filter(d => d.riddim).map(d => card(d, `🥁 ${d.sig} · ${d.tags}`)),
        ...KITS.filter(k => k.riddim).map(k => card(k, "🎹 " + k.tags + " · лад выбранного канала")),
        el("div", { className: "dw-dir-row open", textContent: "🥁 Ударные грувы" }),
        ...DRUMS.filter(d => !d.riddim).map(d => card(d, `${d.sig} · ${d.tags}`)),
        ...(KITS.some(k => !k.riddim) ? [el("div", { className: "dw-dir-row open", textContent: "🔊 Звук + рифф" }),
          ...KITS.filter(k => !k.riddim).map(k => card(k, k.tags + " · лад выбранного канала"))] : []),
        el("div", { className: "dw-dir-row open", textContent: "🎼 В ладу канала" }),
        el("div", { className: "dw-dim dw-lib-tgt" }, "Для: ",
          select(Engine.project.channels.filter(x => x.type !== "sampler").map(x => [x.id, x.name + ((x.edo || 12) !== 12 ? ` · ${x.edo}-EDO` : "")]), tgt?.id || "",
            v => { Dawn.pianoCh = v; Engine.emit("change", { param: true, piano: true }); build(); }, "Канал для мелодии")),
        ...MELODIC.map(m => card(m, tgt ? `${tgt.name} · ${tgt.scale?.mode !== "chromatic" ? tgt.scale.mode : "минор"}` : "нужен синт-канал")));
    }
    build();
    const off = Engine.on("change", w => { if (w?.channels || w?.all || w?.piano) build(); });
    addEventListener("dawn-userlib", build);
    return () => { off(); removeEventListener("dawn-userlib", build); };
  },
};

export const MODULES = { transport, rack, piano: PIANO, playlist: PLAYLIST, mixer, inst, browser, ai, mods: MODS, lib, pedals, cloud, magic: MAGIC };
