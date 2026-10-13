/*
 * GBA-эмулятор для nikita.os на базе mGBA (WebAssembly, MPL-2.0).
 * Работает целиком в браузере. Открывается как /apps/gba.html?rom=/путь/в/fs/game.gba
 * Настройки: fs/etc/gba.json. Сохранения: IndexedDB этого браузера.
 */
import mGBA from "../vendor/mgba/mgba.js";

const $ = s => document.querySelector(s);
const fsUrl = p => "/fs" + p.split("/").map(encodeURIComponent).join("/");
const baseName = p => p.split("/").filter(Boolean).pop() || "";

const DEFAULTS = {
  keys: { A: "X", B: "Z", L: "A", R: "S", Start: "Return", Select: "Backspace", Up: "Up", Down: "Down", Left: "Left", Right: "Right" },
  hotkeys: { fastForward: "Tab", saveState: "F5", loadState: "F8", pause: "KeyP" },
  volume: 1.0,
  fastForwardSpeed: 3,
  integerScale: false,
  // звук: sampleRate "auto" = частота звуковой системы (без пересэмплирования внутри SDL),
  // bufferSize больше — меньше треска и «пожатости», но чуть больше задержка
  // output: "worklet" — звук играет в отдельном аудиопотоке (AudioWorklet) с запасом latencyMs,
  //         подвисания страницы его не рвут; "sdl" — старый вывод через ScriptProcessor
  // dcFilter — убирает постоянную составляющую, как конденсатор на выходе GBA
  // (выключен: на громких сценах сдвигает пики за предел и даёт клиппинг)
  // contextRate: частота звукового контекста — 48000 (по умолчанию; браузер сам пересчитает
  //              в частоту звуковой карты) или "device" — как у звуковой карты
  audio: { contextRate: 48000, sampleRate: "auto", bufferSize: 2048, output: "worklet", latencyMs: 120, dcFilter: false },
  core: {},
};

const params = new URLSearchParams(location.search);
const romPath = params.get("rom") || "";      // путь в fs сервера
const romUrl = params.get("url") || "";       // или прямая ссылка (например, raw.githubusercontent.com)
const romName = romPath ? baseName(romPath) : decodeURIComponent(baseName(new URL(romUrl || "x:/", location.href).pathname));
const canvas = $("#screen");
let M = null, cfg = DEFAULTS, romFile = "", romSize = 0;
let started = false, paused = false, autoPaused = false, ffLatched = false, ffHeld = false;

const ICON_PAUSE = '<svg class="f" viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>';
const ICON_PLAY = '<svg class="f" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

/* ---------- мелочи интерфейса ---------- */
let toastT = 0;
function toast(text, ms = 1600) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}
function fail(msg) {
  const m = $("#ov-msg");
  m.textContent = msg;
  m.classList.add("err");
  $("#ov-start").hidden = true;
  $("#overlay").classList.remove("gone");
}
/* ---------- скорость эмуляции ----------
 * mGBA растягивает звук вслед за скоростью: если эмуляция идёт на 30 fps вместо 60,
 * звук становится вдвое ниже и медленнее. Поэтому скорость видна прямо в статусе.
 */
const NATIVE_FPS = 59.7275;
const speed = { frames: 0, fps: 0, slowSec: 0, warned: false, timer: 0 };
function startSpeedMeter() {
  M.addCoreCallbacks({ videoFrameEndedCallback: () => { speed.frames++; } });
  let last = performance.now();
  speed.timer = setInterval(() => {
    const now = performance.now();
    speed.fps = speed.frames * 1000 / (now - last);
    speed.frames = 0; last = now;
    const ff = ffLatched || ffHeld;
    if (!paused && !ff && document.visibilityState === "visible" && speed.fps < NATIVE_FPS * 0.9) speed.slowSec++;
    else speed.slowSec = 0;
    if (speed.slowSec >= 3 && !speed.warned) {
      speed.warned = true;
      toast(`⚠ Эмуляция идёт на ${Math.round(speed.fps / NATIVE_FPS * 100)}% скорости — поэтому звук замедлен.\n` +
        `Браузер не успевает. Попробуй Chromium/Chrome, закрой тяжёлые вкладки\nили поставь "frameSkip": 1 в core в fs/etc/gba.json.`, 9000);
    }
    setStatus();
  }, 1000);
}
function setStatus() {
  const ff = ffLatched || ffHeld ? ` · ⏩ x${cfg.fastForwardSpeed}` : "";
  const st = $("#status");
  if (!started) return void (st.textContent = "");
  if (paused) { st.textContent = "пауза"; st.classList.remove("slow"); return; }
  const pct = speed.fps ? Math.round(speed.fps / NATIVE_FPS * 100) : 0;
  st.textContent = speed.fps ? `${speed.fps.toFixed(0)} fps · ${pct}%${ff}` : "играет" + ff;
  st.classList.toggle("slow", !!speed.fps && !ff && pct < 90);
  st.title = "Скорость эмуляции относительно настоящего GBA (59.73 кадра/с). Ниже 100% — игра и звук замедлены.";
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof a[k] === "object" ? deepMerge(a[k], v) : v;
  }
  return out;
}

/* ---------- масштаб экрана (3:2, по желанию — целочисленный) ---------- */
function fit() {
  const s = $("#stage").getBoundingClientRect();
  let k = Math.min(s.width / 240, s.height / 160);
  if (cfg.integerScale && k >= 1) k = Math.floor(k);
  canvas.style.setProperty("--w", Math.floor(240 * k) + "px");
  canvas.style.setProperty("--h", Math.floor(160 * k) + "px");
}
new ResizeObserver(fit).observe($("#stage"));

/* ---------- запуск ---------- */
async function boot() {
  $("#ov-title").textContent = romName || "Нет ROM";
  document.title = romName || "GBA";
  if (!romPath && !romUrl) return fail("Не указан ROM.");
  if (!crossOriginIsolated) {
    return fail("Браузер не дал включить многопоточность (cross-origin isolation).\nПерезапусти сервер — в server.py добавились нужные заголовки.");
  }
  try {
    const r = await fetch("/fs/etc/gba.json", { cache: "no-store" });
    if (r.ok) cfg = deepMerge(DEFAULTS, await r.json());
  } catch (e) { console.warn("gba.json:", e); toast("fs/etc/gba.json не прочитался — беру настройки по умолчанию", 3000); }
  fit();

  try {
    const romReq = fetch(romPath ? fsUrl(romPath) : romUrl).then(r => {
      if (!r.ok) throw new Error(`ROM не загрузился (${r.status})`);
      return r.arrayBuffer();
    });
    const [mod, rom] = await Promise.all([mGBA({ canvas }), romReq]);
    M = mod;
    await M.FSInit();
    const p = M.filePaths();
    // ROM'ы держим только на время игры, чтобы не копить их в IndexedDB
    for (const f of M.listRoms()) {
      if (f !== "." && f !== "..") try { M.FS.unlink(p.gamePath + "/" + f); } catch {}
    }
    romFile = p.gamePath + "/" + romName.replace(/[^\w.\-() Ѐ-ӿ]/g, "_");
    M.FS.writeFile(romFile, new Uint8Array(rom));
    romSize = rom.byteLength;
    console.log(M.version.projectName, M.version.projectVersion);
  } catch (e) {
    console.error(e);
    return fail("Ошибка: " + (e.message || e));
  }

  $("#ov-msg").textContent = "Готово. Нажми, чтобы начать — звуку нужен клик.";
  const btn = $("#ov-start");
  btn.hidden = false;
  btn.onclick = start;
  btn.focus();
}

let syncT = 0;
const syncSoon = () => { clearTimeout(syncT); syncT = setTimeout(() => M?.FSSync().catch(() => {}), 800); };

/* ---------- вывод звука через AudioWorklet ----------
 * SDL (внутри mGBA) играет звук через ScriptProcessorNode — он живёт в основном потоке страницы,
 * и любая заминка (анимации, блюр, сборка мусора) даёт щелчки и «рваньё», особенно в Firefox.
 * Мы забираем у SDL его функцию заполнения буфера, сами вызываем её с подставным буфером
 * и складываем сэмплы в кольцевой буфер в SharedArrayBuffer. Читает его AudioWorklet —
 * в отдельном аудиопотоке, с запасом latencyMs.
 */
const WORKLET_SRC = `
class NosRingOut extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const { sab, cap, dc } = o.processorOptions;
    this.idx = new Int32Array(sab, 0, 4);      // [read, write, underrunFrames, -]
    this.data = new Float32Array(sab, 16, cap * 2);
    this.cap = cap;
    // фильтр постоянной составляющей (как разделительный конденсатор на выходе GBA), ~10 Гц
    this.dc = dc; this.a = Math.exp(-2 * Math.PI * 10 / sampleRate);
    this.px = [0, 0]; this.py = [0, 0];
  }
  hp(c, x) { const y = x - this.px[c] + this.a * this.py[c]; this.px[c] = x; this.py[c] = y; return y; }
  process(_in, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L, n = L.length, cap = this.cap;
    const r = Atomics.load(this.idx, 0), w = Atomics.load(this.idx, 1);
    const take = Math.min(n, (w - r + cap) % cap);
    for (let i = 0; i < take; i++) {
      const k = ((r + i) % cap) * 2, l = this.data[k], rr = this.data[k + 1];
      L[i] = this.dc ? this.hp(0, l) : l; R[i] = this.dc ? this.hp(1, rr) : rr;
    }
    // при нехватке данных плавно гасим к нулю, а не обрываем — меньше щелчков
    for (let i = take; i < n; i++) {
      L[i] = this.dc ? this.hp(0, this.px[0] * 0.995) : 0; R[i] = this.dc ? this.hp(1, this.px[1] * 0.995) : 0;
    }
    if (take < n) Atomics.add(this.idx, 2, n - take);
    Atomics.store(this.idx, 0, (r + take) % cap);
    return true;
  }
}
registerProcessor("nos-ring-out", NosRingOut);`;

const audioOut = { mode: "sdl", timer: 0, idx: null, node: null };
const audioDiag = { deviceRate: 0 }; // частота звуковой карты — для «О программе»

async function setupWorkletAudio() {
  // SDL открывает аудиоустройство не сразу после loadGame, а чуть позже — ждём его
  for (let t = 0; t < 60 && !M.SDL2?.audio?.scriptProcessorNode?.onaudioprocess; t++) {
    await new Promise(r => setTimeout(r, 50));
  }
  const ctx = M.SDL2?.audioContext, sp = M.SDL2?.audio?.scriptProcessorNode;
  const fill = sp?.onaudioprocess;
  if (!ctx || !sp || !fill || !ctx.audioWorklet || !window.SharedArrayBuffer) return false;
  const frames = sp.bufferSize;                      // столько сэмплов SDL пишет за раз
  const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "text/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const cap = 1 << 15;                               // ~0.7 с при 44.1 кГц — с запасом
  const sab = new SharedArrayBuffer(16 + cap * 2 * 4);
  const idx = new Int32Array(sab, 0, 4), data = new Float32Array(sab, 16, cap * 2);
  const node = new AudioWorkletNode(ctx, "nos-ring-out",
    { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { sab, cap, dc: !!cfg.audio.dcFilter } });

  // отключаем родной вывод SDL и подключаем свой
  sp.onaudioprocess = null;
  try { sp.disconnect(); } catch {}
  node.connect(ctx.destination);

  const ch = [new Float32Array(frames), new Float32Array(frames)];
  const fake = { numberOfChannels: 2, length: frames, sampleRate: ctx.sampleRate, getChannelData: c => ch[c] };
  const target = Math.min(cap - frames - 1, Math.max(frames * 2, Math.round(ctx.sampleRate * (+cfg.audio.latencyMs || 120) / 1000)));

  const pump = () => {
    for (let guard = 0; guard < 16; guard++) {
      const r = Atomics.load(idx, 0), w = Atomics.load(idx, 1);
      if (((w - r + cap) % cap) + frames > target) break;   // запаса хватает
      fill({ outputBuffer: fake });
      for (let i = 0; i < frames; i++) { const k = ((w + i) % cap) * 2; data[k] = ch[0][i]; data[k + 1] = ch[1][i]; }
      Atomics.store(idx, 1, (w + frames) % cap);
    }
  };
  pump();
  Object.assign(audioOut, { mode: "worklet", idx, node, timer: setInterval(pump, 8), target, frames });
  return true;
}
function stopWorkletAudio() {
  clearInterval(audioOut.timer);
  try { audioOut.node?.disconnect(); } catch {}
}
window.gbaAudioOut = audioOut; // для отладки
window.gbaAudioStats = () => audioOut.idx
  ? { mode: audioOut.mode, underrunFrames: Atomics.load(audioOut.idx, 2), targetFrames: audioOut.target }
  : { mode: audioOut.mode };

// итоговые настройки ядра: секция audio важнее core.audio*
function coreSettings() {
  const core = { ...(cfg.core || {}) };
  const a = cfg.audio || {};
  const ctxRate = M.SDL2?.audioContext?.sampleRate;
  core.audioSampleRate = !a.sampleRate || a.sampleRate === "auto" ? (ctxRate || 48000) : +a.sampleRate;
  core.audioBufferSize = +a.bufferSize || 2048;
  if (a.sync !== undefined) core.audioSync = !!a.sync;
  return core;
}

async function start() {
  if (started) return;
  // Создаём AudioContext сами (по клику, поэтому он сразу «живой») и отдаём его SDL.
  // Частота контекста фиксированная (по умолчанию 48 кГц), а не «как у звуковой карты»:
  // mGBA выдаёт ровно её, а в частоту устройства (44.1/96/192 кГц…) пересчитывает уже сам
  // браузер своим качественным ресемплером. Так звук не зависит от настроек системы.
  try {
    M.SDL2 = M.SDL2 || {};
    if (!M.SDL2.audioContext) {
      try { const probe = new AudioContext(); audioDiag.deviceRate = probe.sampleRate; probe.close(); } catch {}
      const want = cfg.audio?.contextRate === "device" ? null : (+cfg.audio?.contextRate || 48000);
      try {
        M.SDL2.audioContext = new AudioContext(want ? { sampleRate: want, latencyHint: "playback" } : { latencyHint: "playback" });
      } catch (e) {
        console.warn("AudioContext с частотой", want, "не создался:", e);
        M.SDL2.audioContext = new AudioContext({ latencyHint: "playback" });
      }
    }
    await M.SDL2.audioContext.resume();
  } catch (e) { console.warn("AudioContext:", e); }
  const core = coreSettings();
  console.log("mGBA audio:", core.audioSampleRate, "Hz, buffer", core.audioBufferSize);
  try { M.setCoreSettings(core); } catch (e) { console.warn(e); }
  if (!M.loadGame(romFile)) return fail("mGBA не смог запустить этот файл.");
  started = true;
  try { M.setCoreSettings(core); } catch {}
  for (const [btn, key] of Object.entries(cfg.keys || {})) {
    try { M.bindKey(key, btn); } catch (e) { console.warn("bindKey", btn, key, e); }
  }
  M.setVolume(+cfg.volume || 1);
  $("#vol").value = M.getVolume();
  if ((cfg.audio?.output || "worklet") === "worklet") {
    try { if (!(await setupWorkletAudio())) console.warn("AudioWorklet недоступен — остаётся вывод SDL"); }
    catch (e) { console.warn("AudioWorklet:", e); }
  }
  console.log("audio output:", audioOut.mode);
  startSpeedMeter();
  M.addCoreCallbacks({
    saveDataUpdatedCallback: syncSoon,
    autoSaveStateCapturedCallback: syncSoon,
    coreCrashedCallback: () => fail("Эмулятор упал :("),
  });
  M.SDL2?.audioContext?.resume?.();
  $("#overlay").classList.add("gone");
  document.querySelectorAll("#bar button:disabled").forEach(b => (b.disabled = false));
  canvas.focus();
  setPaused(false);
}

function setPaused(on) {
  if (!started) return;
  paused = on;
  on ? M.pauseGame() : M.resumeGame();
  $("#b-pause").innerHTML = on ? ICON_PLAY : ICON_PAUSE;
  $("#b-pause").title = on ? "Продолжить (P)" : "Пауза (P)";
  setStatus();
}
function applyFF() {
  if (!started) return;
  const on = ffLatched || ffHeld;
  M.setFastForwardMultiplier(on ? Math.max(2, +cfg.fastForwardSpeed || 3) : 1);
  $("#b-ff").classList.toggle("on", on);
  setStatus();
}
function saveState() {
  if (!started) return;
  M.saveState(1) ? (toast("💾 Состояние сохранено"), syncSoon()) : toast("Не удалось сохранить");
}
function loadState() {
  if (!started) return;
  toast(M.loadState(1) ? "📂 Состояние загружено" : "Сохранённого состояния пока нет");
}

/* ---------- кнопки ---------- */
$("#b-pause").innerHTML = ICON_PAUSE;
$("#b-pause").onclick = () => { setPaused(!paused); canvas.focus(); };
$("#b-reset").onclick = () => { if (started) { M.quickReload(); toast("⟲ Перезапуск"); canvas.focus(); } };
$("#b-ff").onclick = () => { ffLatched = !ffLatched; applyFF(); canvas.focus(); };
$("#b-save").onclick = () => { saveState(); canvas.focus(); };
$("#b-load").onclick = () => { loadState(); canvas.focus(); };
$("#b-export").onclick = () => {
  const data = started && M.getSave();
  if (!data) return toast("У игры пока нет сохранения");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/octet-stream" }));
  a.download = romName.replace(/\.[^.]+$/, "") + ".sav";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("#b-import").onclick = () => $("#f-sav").click();
$("#f-sav").onchange = e => {
  const f = e.target.files[0];
  if (!f || !started) return;
  // mGBA ищет сохранение по имени ROM'а
  const renamed = new File([f], baseName(romFile).replace(/\.[^.]+$/, "") + "." + f.name.split(".").pop(), { type: f.type });
  M.uploadSaveOrSaveState(renamed, () => { M.quickReload(); syncSoon(); toast("Сохранение загружено, игра перезапущена"); });
  e.target.value = "";
};
$("#vol").oninput = e => { if (started) M.setVolume(+e.target.value); };
$("#b-keys").onclick = () => {
  const k = cfg.keys, h = cfg.hotkeys;
  toast(
    `A — ${k.A}   B — ${k.B}   L — ${k.L}   R — ${k.R}\n` +
    `Start — ${k.Start}   Select — ${k.Select}   Крестовина — стрелки\n` +
    `Ускорение — ${h.fastForward} (удерживать)   Сохранить — ${h.saveState}   Загрузить — ${h.loadState}   Пауза — ${h.pause}\n` +
    `Поменять: fs/etc/gba.json`, 6000);
};
/* ---------- о программе ---------- */
function showAbout(on) {
  const box = $("#about");
  if (on) {
    $("#ab-core").textContent = M ? `${M.version.projectName} ${M.version.projectVersion}` : "mGBA (загружается…)";
    const ctx = M?.SDL2?.audioContext;
    $("#ab-audio").textContent = ctx
      ? `mGBA ${started ? coreSettings().audioSampleRate : "—"} Гц → контекст ${ctx.sampleRate} Гц` +
        (audioDiag.deviceRate ? ` → звуковая карта ${audioDiag.deviceRate} Гц` : "") +
        `, буфер ${coreSettings().audioBufferSize}, ` +
        (audioOut.mode === "worklet" ? `AudioWorklet (запас ${cfg.audio.latencyMs} мс)` : "SDL ScriptProcessor")
      : "—";
    $("#ab-rom").textContent = romPath || romUrl || "—";
    $("#ab-speed").textContent = started && speed.fps
      ? `${speed.fps.toFixed(1)} fps (${Math.round(speed.fps / NATIVE_FPS * 100)}% от настоящего GBA)` : "—";
    const ua = navigator.userAgent.match(/(Firefox|LibreWolf|Chrome|Chromium|Edg|Safari)\/[\d.]+/g) || [];
    $("#ab-env").textContent = `${ua.join(", ") || navigator.userAgent} · потоков CPU: ${navigator.hardwareConcurrency || "?"} · изоляция: ${crossOriginIsolated ? "да" : "нет"}`;
    $("#ab-size").textContent = !romSize ? "—"
      : romSize < 1048576 ? (romSize / 1024).toFixed(1) + " КБ" : (romSize / 1048576).toFixed(2) + " МБ";
  }
  box.classList.toggle("show", on);
  if (!on) canvas.focus();
}
$("#b-about").onclick = () => showAbout(!$("#about").classList.contains("show"));
$("#ab-close").onclick = () => showAbout(false);
$("#about").addEventListener("pointerdown", e => { if (e.target.id === "about") showAbout(false); });

$("#b-full").onclick = () => {
  const st = $("#stage");
  document.fullscreenElement ? document.exitFullscreen() : st.requestFullscreen?.().catch(() => {});
  canvas.focus();
};
canvas.addEventListener("pointerdown", () => canvas.focus());

/* ---------- горячие клавиши окна ---------- */
addEventListener("keydown", e => {
  const h = cfg.hotkeys || {};
  if (e.key === "Escape" && $("#about").classList.contains("show")) return showAbout(false);
  if (!started) {
    if (e.key === "Enter" && !$("#ov-start").hidden) start();
    return;
  }
  if (e.code === h.fastForward) { e.preventDefault(); if (!ffHeld) { ffHeld = true; applyFF(); } }
  else if (e.code === h.saveState) { e.preventDefault(); if (!e.repeat) saveState(); }
  else if (e.code === h.loadState) { e.preventDefault(); if (!e.repeat) loadState(); }
  else if (e.code === h.pause && !e.repeat) setPaused(!paused);
}, true);
addEventListener("keyup", e => {
  if (started && e.code === (cfg.hotkeys || {}).fastForward) { ffHeld = false; applyFF(); }
}, true);
addEventListener("blur", () => { if (ffHeld) { ffHeld = false; applyFF(); } });

/* ---------- связь с окном ОС ---------- */
addEventListener("message", e => {
  if (e.origin !== location.origin || e.data?.type !== "gba") return;
  if (e.data.cmd === "pause" && started && !paused) { autoPaused = true; setPaused(true); }
  if (e.data.cmd === "resume" && autoPaused) { autoPaused = false; setPaused(false); }
});

// вызывается окном ОС при закрытии: сохранить всё и выгрузить ядро
window.gbaShutdown = async () => {
  if (!M) return;
  clearTimeout(syncT);
  stopWorkletAudio();
  try { if (started) { M.forceAutoSaveState(); M.quitGame(); } } catch (e) { console.warn(e); }
  try { M.FS.unlink(romFile); } catch {}
  try { await M.FSSync(); } catch (e) { console.warn(e); }
  try { M.quitMgba(); } catch {}
  M = null;
};
addEventListener("pagehide", () => { try { M?.FSSync(); } catch {} });
window.gbaModule = () => M; // для отладки из консоли

boot();
