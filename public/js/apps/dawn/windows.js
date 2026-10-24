import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { BUILTIN, Engine, PASTEL, STEPS_PER_BAR, TYPES, WAVES, WAVE_GLYPH, sampleNow } from "./engine.js";
import { PIANO } from "./pianoroll.js";
import { dwBtn, knob, led, noteName, shell } from "./ui.js";

/* ================= DAWN — окна модулей =================
 * Каждый модуль: { title(arg), icon, size(arg) -> [w, h, left?, top?], render(c, win, arg, Dawn) -> cleanup }.
 * Окна подписываются на Engine.on("change") и перерисовываются; правка крутилок шлёт { param: true } —
 * на неё окна НЕ перестраиваются (иначе крутилка пропала бы из-под мыши).
 */
const SAMPLE_MIME = "application/x-dawn-sample";
const NOS_MIME = "application/x-nikita-paths";        // перетаскивание из проводника ОС
const AUDIO = /\.(wav|mp3|ogg|flac|m4a|aac|opus)$/i;
const vw = () => innerWidth, vh = () => innerHeight - 70;

/* что за сэмпл тащат: из браузера DAWN или из проводника */
function droppedPaths(e) {
  const dt = e.dataTransfer;
  const a = dt.getData(SAMPLE_MIME);
  if (a) return [a];
  try { return (JSON.parse(dt.getData(NOS_MIME) || "[]") || []).filter(p => AUDIO.test(p)); } catch { return []; }
}
const isSampleDrag = e => [...(e.dataTransfer?.types || [])].some(t => t === SAMPLE_MIME || t === NOS_MIME);

function rebuildOn(fn) {
  return Engine.on("change", w => { if (!w?.param) fn(w || {}); });
}

/* ======================= транспорт (хаб) ======================= */
const transport = {
  title: () => "DAWN — " + (Engine.project?.name || ""),
  icon: "🌸",
  size: () => [Math.min(1000, vw() - 20), 178, 12, 12],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-transport", "var(--dw-pink)");
    const playB = el("button", { className: "dw-play", title: "Пуск / стоп (пробел)", onclick: () => Engine.toggle() });
    const stopB = el("button", { className: "dw-stop", title: "Стоп", onclick: () => Engine.stop() });
    const pos = el("div", { className: "dw-pos", textContent: "1:1:01" });

    // темп: тянуть мышью вверх-вниз или колесо, двойной клик — ввести число
    const bpm = el("div", { className: "dw-bpm", title: "Темп: тяни вверх-вниз, колесо, двойной клик — ввести" });
    const showBpm = () => { bpm.replaceChildren(el("b", { textContent: Engine.project.bpm.toFixed(0) }), el("span", { textContent: "BPM" })); };
    let bd = null;
    bpm.onpointerdown = e => { bpm.setPointerCapture(e.pointerId); bd = { y: e.clientY, v: Engine.project.bpm }; };
    bpm.onpointermove = e => { if (!bd) return; Engine.project.bpm = Math.max(40, Math.min(300, Math.round(bd.v + (bd.y - e.clientY) * 0.4))); showBpm(); };
    bpm.onpointerup = () => { if (bd) { bd = null; Engine.touch({ param: true }); } };
    bpm.onwheel = e => { e.preventDefault(); Engine.project.bpm = Math.max(40, Math.min(300, Engine.project.bpm - Math.sign(e.deltaY))); showBpm(); Engine.touch({ param: true }); };
    bpm.ondblclick = () => { const v = +prompt("Темп (BPM):", Engine.project.bpm); if (v >= 40 && v <= 300) { Engine.project.bpm = v; showBpm(); Engine.touch({ param: true }); } };

    const patSel = el("select", { className: "dw-sel", title: "Паттерн", onchange: () => Engine.selectPattern(patSel.value) });
    const fillPats = () => {
      patSel.replaceChildren(...Engine.project.patterns.map(p => el("option", { value: p.id, textContent: p.name, selected: p.id === Engine.project.cur })));
    };
    const patBox = el("div", { className: "dw-patbox" }, patSel,
      dwBtn("＋", () => Engine.addPattern(), { title: "Новый паттерн" }),
      dwBtn("⧉", () => Engine.clonePattern(), { title: "Копия паттерна" }),
      dwBtn("✎", () => { const p = Engine.pat(); const n = prompt("Имя паттерна:", p.name); if (n) { p.name = n.slice(0, 32); Engine.touch({ patterns: true }); } }, { title: "Переименовать" }));

    const master = knob({ spec: "vol", label: "Master", color: "var(--dw-pink)",
      get: () => Engine.project.master, set: v => { Engine.project.master = v; Engine.master.gain.value = v; }, done: () => Engine.touch({ param: true }) });
    const swing = knob({ spec: { min: 0, max: 0.6, def: 0, label: "Swing" }, color: "var(--dw-peach)",
      get: () => Engine.project.swing || 0, set: v => { Engine.project.swing = v; }, done: () => Engine.touch({ param: true }) });

    const scope = el("canvas", { className: "dw-scope", width: 180, height: 46 });
    const mod = (txt, name, title, disabled) => dwBtn(txt, () => Dawn.open(name), { title, disabled, className: "dw-btn dw-mod" });
    const mods = el("div", { className: "dw-mods" },
      mod("🎛 Стойка", "rack", "Стойка каналов: паттерны по шагам"),
      mod("🎹 Пиано ролл", "piano", "Ноты канала"),
      mod("📂 Сэмплы", "browser", "Сэмплы из файловой системы"),
      mod("🎞 Плейлист", "rack", "Общий таймлайн — в следующем этапе", true),
      mod("🎚 Микшер", "rack", "Микшер и эффекты — в следующем этапе", true));
    const file = el("div", { className: "dw-file" },
      dwBtn("💾", () => Dawn.save(), { title: "Сохранить (Ctrl+S)" }),
      dwBtn("💾…", () => Dawn.save(true), { title: "Сохранить как (Ctrl+Shift+S)" }),
      dwBtn("✚", async () => {
        if (Engine.dirty && !confirm("Начать новый проект? Несохранённые изменения останутся черновиком в браузере.")) return;
        const { newProject } = await import("./engine.js");
        for (const [k, w] of [...Dawn.wins]) if (k !== "transport") Dawn.close(...k.split(":"));
        Engine.load(newProject(), null);
        Dawn.pianoCh = Engine.project.channels.at(-1).id;
        Dawn.open("rack"); Dawn.open("piano"); Dawn.retitle();
      }, { title: "Новый проект" }));

    root.append(el("div", { className: "dw-logo" }, el("b", { textContent: "DAWN" }), el("span", { textContent: "pastel daw" })),
      el("div", { className: "dw-tbtns" }, playB, stopB), pos, bpm, patBox, master.node, swing.node, scope, mods, file);

    const sync = () => { showBpm(); fillPats(); master.paint(); swing.paint(); root.classList.toggle("playing", Engine.playing); Dawn.retitle(); };
    sync();
    const offs = [rebuildOn(sync), Engine.on("play", sync), Engine.on("stop", sync), Engine.on("pattern", sync)];

    // позиция и осциллограф
    const sctx = scope.getContext("2d"), buf = new Uint8Array(Engine.analyser.fftSize);
    let raf = 0;
    const frame = () => {
      const st = Engine.position();
      if (st >= 0) {
        const bar = Math.floor(st / 16) + 1, beat = Math.floor((st % 16) / 4) + 1, step = Math.floor(st % 4) + 1;
        pos.textContent = `${bar}:${beat}:${String(step).padStart(2, "0")}`;
      } else pos.textContent = "1:1:01";
      Engine.analyser.getByteTimeDomainData(buf);
      const W = scope.width, H = scope.height;
      sctx.clearRect(0, 0, W, H);
      const g = sctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "#ff9ecf"); g.addColorStop(0.5, "#c3a6ff"); g.addColorStop(1, "#8fe8cf");
      sctx.strokeStyle = g; sctx.lineWidth = 2; sctx.beginPath();
      for (let i = 0; i < W; i++) { const v = buf[Math.floor(i / W * buf.length)] / 128 - 1, y = H / 2 - v * H * 0.45; i ? sctx.lineTo(i, y) : sctx.moveTo(i, y); }
      sctx.stroke();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

/* ======================= стойка каналов ======================= */
const rack = {
  title: () => "Стойка каналов",
  icon: "🎛",
  size: () => [Math.min(760, vw() - 30), 380, 12, 202],
  render(c, win, _a, Dawn) {
    const root = shell(c, "dw-rack", "var(--dw-lav)");
    const head = el("div", { className: "dw-rack-head" });
    const body = el("div", { className: "dw-rack-body" });
    const foot = el("div", { className: "dw-rack-foot" });
    root.append(head, body, foot);
    let cols = [];       // кнопки шагов по колонкам — для подсветки плейхеда

    function build() {
      const P = Engine.project, pat = Engine.pat(), len = Engine.patLength();
      head.replaceChildren(
        el("span", { className: "dw-pat-chip", textContent: pat.name, style: `--chip:${pat.color}` }),
        el("span", { className: "dw-dim", textContent: `${len / STEPS_PER_BAR} ${len / STEPS_PER_BAR === 1 ? "такт" : "такта"}` }),
        dwBtn("−", () => { pat.bars = Math.max(1, (pat.bars || len / STEPS_PER_BAR) - 1); Engine.touch({ notes: true }); }, { title: "Меньше тактов" }),
        dwBtn("＋", () => { pat.bars = Math.min(16, (pat.bars || len / STEPS_PER_BAR) + 1); Engine.touch({ notes: true }); }, { title: "Больше тактов" }));
      cols = Array.from({ length: len }, () => []);
      body.replaceChildren(...P.channels.map(ch => row(ch, len)));
      foot.replaceChildren(
        dwBtn("＋ 3XOSC", () => { const ch = Engine.addChannel("osc3"); Dawn.pianoCh = ch.id; Dawn.open("inst", ch.id); }),
        dwBtn("＋ Sampler", () => { const ch = Engine.addChannel("sampler", "Sampler"); Dawn.open("inst", ch.id); }),
        drumsMenu(),
        el("span", { className: "dw-dim dw-hint", textContent: "Перетащи сюда сэмпл из «Сэмплы» или из проводника" }));
    }

    function drumsMenu() {
      const s = el("select", { className: "dw-sel", onchange: () => {
        if (!s.value) return;
        const ch = Engine.addChannel("sampler", BUILTIN[s.value], { path: "builtin:" + s.value });
        Engine.setSample(ch, "builtin:" + s.value); s.value = "";
      } }, el("option", { value: "", textContent: "＋ Ударные…" }), ...Object.entries(BUILTIN).map(([k, v]) => el("option", { value: k, textContent: v })));
      return s;
    }

    function row(ch, len) {
      const notes = Engine.notesOf(ch.id);
      const steps = el("div", { className: "dw-steps" });
      for (let i = 0; i < len; i++) {
        const at = notes.filter(n => n.s >= i && n.s < i + 1);
        const b = el("button", { className: "dw-step" + (at.length ? " on" : "") + (Math.floor(i / 4) % 2 ? " alt" : "") + (i % 16 === 0 && i ? " bar" : "") });
        if (at.length) { b.style.setProperty("--v", at[0].v); if (at.some(n => n.l !== 1 || n.n !== (ch.type === "sampler" ? 60 : n.n))) b.classList.add("long"); }
        b.title = at.length ? at.map(n => noteName(n.n)).join(" ") : "";
        b.onpointerdown = e => {
          e.preventDefault();
          if (at.length) {   // выключаем шаг — убираем все ноты, начинающиеся в нём
            for (const n of at) notes.splice(notes.indexOf(n), 1);
          } else {
            const pitch = ch.type === "sampler" ? 60 : (notes.at(-1)?.n ?? 60);
            notes.push({ s: i, l: 1, n: pitch, v: 0.85 });
            Engine.preview(ch, pitch, 0.85, Engine.stepDur());
          }
          Engine.touch({ notes: true });
        };
        cols[i].push(b);
        steps.append(b);
      }
      const name = el("button", { className: "dw-ch-name", textContent: ch.name, title: "Открыть инструмент (двойной клик — пиано ролл)",
        onclick: () => Dawn.open("inst", ch.id), ondblclick: () => { Dawn.pianoCh = ch.id; Dawn.open("piano"); Engine.emit("pattern"); } });
      name.style.setProperty("--chc", ch.color);
      const r = el("div", { className: "dw-row" + (Dawn.pianoCh === ch.id ? " sel" : ""), style: `--dw-row-c:${ch.color}` },
        led(!ch.mute, () => { ch.mute = !ch.mute; Engine.refreshStrips(); Engine.touch({ channels: true }); }, "Вкл/выкл (правый клик — соло)", ch.color),
        knob({ spec: "vol", size: 26, label: "", color: ch.color, get: () => ch.vol, set: v => { ch.vol = v; Engine.refreshStrips(); }, done: () => Engine.touch({ param: true }) }).node,
        knob({ spec: "pan", size: 26, label: "", color: ch.color, get: () => ch.pan, set: v => { ch.pan = v; Engine.refreshStrips(); }, done: () => Engine.touch({ param: true }) }).node,
        name,
        el("span", { className: "dw-ch-type", textContent: TYPES[ch.type].icon, title: TYPES[ch.type].name }),
        steps,
        dwBtn("🎹", () => { Dawn.pianoCh = ch.id; Dawn.open("piano"); Engine.emit("pattern"); build(); }, { title: "Пиано ролл этого канала" }),
        dwBtn("✕", () => { if (confirm(`Удалить канал «${ch.name}»?`)) { Dawn.close("inst", ch.id); Engine.removeChannel(ch.id); } }, { title: "Удалить канал", className: "dw-btn dw-x" }));
      r.querySelector(".dw-led").oncontextmenu = e => { e.preventDefault(); ch.solo = !ch.solo; Engine.refreshStrips(); Engine.touch({ channels: true }); };
      if (ch.solo) r.classList.add("solo");
      if (ch.mute) r.classList.add("muted");
      if (ch.type === "sampler") {   // сэмпл бросили на строку — меняем сэмпл этого канала
        r.ondragover = e => { if (isSampleDrag(e)) { e.preventDefault(); e.stopPropagation(); r.classList.add("drop"); } };
        r.ondragleave = () => r.classList.remove("drop");
        r.ondrop = e => { e.preventDefault(); e.stopPropagation(); r.classList.remove("drop"); const p = droppedPaths(e)[0]; if (p) Engine.setSample(ch, p); };
      }
      return r;
    }

    // бросили сэмпл на пустое место — новый канал
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
      const st = Engine.position(), col = st >= 0 ? Math.floor(st) : -1;
      if (col !== lastCol) {
        cols[lastCol]?.forEach(b => b.classList.remove("ph"));
        cols[col]?.forEach(b => b.classList.add("ph"));
        lastCol = col;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const offs = [rebuildOn(() => { lastCol = -1; build(); }), Engine.on("pattern", build)];
    return () => { cancelAnimationFrame(raf); offs.forEach(f => f()); };
  },
};

/* ======================= окно инструмента ======================= */
function miniKeys(ch) {
  // белые — в ряд, чёрные — поверх, между соседними белыми
  const box = el("div", { className: "dw-keys" });
  const base = 48, count = 25, whites = [];
  for (let i = 0; i < count; i++) if (![1, 3, 6, 8, 10].includes((base + i) % 12)) whites.push(base + i);
  const wPct = 100 / whites.length;
  const key = (n, black, left) => {
    const k = el("div", { className: "dw-key" + (black ? " black" : ""), title: noteName(n) });
    if (black) Object.assign(k.style, { left: `calc(${left}% - ${wPct * 0.3}%)`, width: wPct * 0.6 + "%" });
    k.onpointerdown = e => { e.preventDefault(); k.classList.add("on"); Engine.preview(ch, n, 0.85, 0.4); };
    k.onpointerup = k.onpointerleave = () => k.classList.remove("on");
    return k;
  };
  for (const n of whites) box.append(key(n, false));
  for (let i = 0; i < count; i++) {
    const n = base + i;
    if ([1, 3, 6, 8, 10].includes(n % 12)) box.append(key(n, true, whites.indexOf(n - 1) * wPct + wPct));
  }
  return el("div", { className: "dw-keys-wrap" }, box);
}

function paramKnob(ch, key, obj = ch.params, extra = {}) {
  return knob({ spec: key, color: extra.color || ch.color, label: extra.label, path: `ch.${ch.id}.${key}`,
    get: () => obj[key], set: v => { obj[key] = v; }, done: () => Engine.touch({ param: true }) }).node;
}

function osc3Panel(ch) {
  const p = ch.params;
  const oscRow = (o, i) => {
    const waves = el("div", { className: "dw-waves" }, ...WAVES.map(wv => {
      const b = el("button", { className: "dw-wave" + (o.wave === wv ? " on" : ""), textContent: WAVE_GLYPH[wv], title: wv,
        onclick: () => { o.wave = wv; waves.querySelectorAll(".dw-wave").forEach(x => x.classList.toggle("on", x === b)); Engine.touch({ param: true }); Engine.preview(ch, 60); } });
      return b;
    }));
    const col = PASTEL[[0, 1, 2][i]];
    return el("div", { className: "dw-osc", style: `--oc:${col}` }, el("div", { className: "dw-osc-n", textContent: "OSC " + (i + 1) }), waves,
      paramKnob(ch, "o_crs", o, { color: col }), paramKnob(ch, "o_fin", o, { color: col }),
      paramKnob(ch, "o_pan", o, { color: col }), paramKnob(ch, "o_vol", o, { color: col }));
  };
  return el("div", { className: "dw-panel" },
    ...p.oscs.map(oscRow),
    el("div", { className: "dw-sect" },
      el("div", { className: "dw-sect-h", textContent: "Фильтр" }), paramKnob(ch, "cut", p, { color: "var(--dw-sky)" }), paramKnob(ch, "res", p, { color: "var(--dw-sky)" }),
      el("div", { className: "dw-sect-h", textContent: "Огибающая" }), paramKnob(ch, "att", p, { color: "var(--dw-peach)" }), paramKnob(ch, "dec", p, { color: "var(--dw-peach)" }),
      paramKnob(ch, "sus", p, { color: "var(--dw-peach)" }), paramKnob(ch, "rel", p, { color: "var(--dw-peach)" })));
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
    g.fillStyle = "rgba(255,158,207,0.9)"; g.fillRect(p.start * W, 0, 2, H);
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
  const startK = knob({ spec: "start", color: ch.color, path: `ch.${ch.id}.start`, get: () => p.start, set: v => { p.start = v; draw(); }, done: () => Engine.touch({ param: true }) }).node;
  const panel = el("div", { className: "dw-panel" }, drop,
    el("div", { className: "dw-sect" },
      paramKnob(ch, "root"), paramKnob(ch, "tune"), startK, paramKnob(ch, "att"), paramKnob(ch, "rel"),
      toggle("oneshot", "One-shot"), toggle("rev", "Reverse"), dwBtn("📂 Сэмплы", () => Dawn.open("browser"))));
  const off = Engine.on("change", w => { if (w?.sample === ch.id || w?.channels) draw(); });
  requestAnimationFrame(draw);
  panel._off = off;
  return panel;
}

const inst = {
  title: id => { const ch = Engine.chan(id); return ch ? `${TYPES[ch.type].icon} ${ch.name}` : "Инструмент"; },
  icon: "🎚",
  size: id => Engine.chan(id)?.type === "sampler" ? [540, 380] : [580, 540],
  render(c, win, id, Dawn) {
    const ch = Engine.chan(id);
    if (!ch) return;
    const root = shell(c, "dw-inst", ch.color);
    const name = el("input", { className: "dw-name", value: ch.name, maxLength: 24,
      onchange: () => { ch.name = name.value.trim() || ch.name; win.setTitle(inst.title(id)); Engine.touch({ channels: true }); } });
    const head = el("div", { className: "dw-inst-head" },
      el("span", { className: "dw-inst-type", textContent: TYPES[ch.type].name }), name,
      paramKnob(ch, "vol", ch, { label: "Vol" }), paramKnob(ch, "pan", ch, { label: "Pan" }));
    head.querySelectorAll(".dk").forEach(k => k.addEventListener("pointermove", () => Engine.refreshStrips()));
    const panel = ch.type === "osc3" ? osc3Panel(ch) : samplerPanel(ch, Dawn);
    root.append(head, panel, miniKeys(ch));
    const off = Engine.on("change", w => { if (w?.channels && !Engine.chan(id)) Dawn.close("inst", id); });
    return () => { off(); panel._off?.(); };
  },
};

/* ======================= браузер сэмплов ======================= */
const browser = {
  title: () => "Сэмплы",
  icon: "📂",
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
          const res = await fetch("/api/ls?path=" + encodeURIComponent(path), { cache: "no-store" });
          const d = await res.json();
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
      const builtin = el("div", {}, el("div", { className: "dw-dir-row open", textContent: "▾ 🥁 Встроенные ударные", style: "--d:0" }),
        ...Object.entries(BUILTIN).map(([k, v]) => fileRow("builtin:" + k, v, 1)));
      tree.append(builtin, await dirRow("/home/nikita", "nikita", 0, true));
    })();
  },
};

export const MODULES = { transport, rack, piano: PIANO, inst, browser };
