import { store } from "../core/util.js";

/* Open JTalk: local WASM worker, no external TTS service.
 * Assets are installed by prepare_kana_tts.py, with pinned checksums.
 * Latest request wins; stale synthesis is never played after a new card or closing the window.
 */
const BASE = "/vendor/openjtalk-v1/";
const CACHE_LIMIT = 128;
const cache = new Map();
let engine = null, loading = null, serial = 0, queue = Promise.resolve();
let context = null, source = null, statusNode = null, statusText = "";
let nativeVoice = null, initialized = false;
let engineMode = store.get("kana.tts.engine", "jtalk") === "native" ? "native" : "jtalk";
let speed = Number(store.get("kana.tts.speed", 1));
if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.3) speed = 1;

function report(text) {
  statusText = text;
  if (statusNode) statusNode.textContent = text;
}
function refreshStatus() {
  report(engineMode === "jtalk"
    ? (engine ? "Open JTalk · Mei · готов" : "Open JTalk · загрузится при первом воспроизведении")
    : (nativeVoice ? "Системный голос: " + nativeVoice.name : "Нет системного японского голоса. Выбери Open JTalk."));
}
function pickVoice() {
  const voices = globalThis.speechSynthesis?.getVoices() || [];
  nativeVoice = voices.find(v => /^ja/i.test(v.lang) && /google/i.test(v.name))
    || voices.find(v => /^ja/i.test(v.lang)) || null;
  if (engineMode === "native") refreshStatus();
}
function audioContext() {
  if (!context) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error("Web Audio недоступен");
    context = new AC();
  }
  return context;
}
function silence() {
  if (source) {
    try { source.stop(); } catch {}
    source.disconnect();
    source = null;
  }
  globalThis.speechSynthesis?.cancel();
}
function stop() {
  serial++;
  silence();
}
function native(text, rate) {
  if (!nativeVoice || !globalThis.speechSynthesis) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  u.voice = nativeVoice;
  u.rate = rate;
  speechSynthesis.speak(u);
  return true;
}
function createWorker() {
  const worker = new Worker(BASE + "browser/worker.js", { type: "module" });
  let id = 0, closed = false;
  const pending = new Map();
  function close(reason) {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(reason); }
    pending.clear();
  }
  worker.addEventListener("error", e => close(new Error(e.message || "Ошибка Web Worker")));
  worker.addEventListener("messageerror", () => close(new Error("Ошибка сообщения Web Worker")));
  worker.addEventListener("message", e => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  });
  return {
    close,
    call(method, args, timeout) {
      if (closed) return Promise.reject(new Error("Движок остановлен"));
      return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => close(new Error("Превышено время ожидания Open JTalk")), timeout);
        pending.set(n, { resolve, reject, timer });
        try { worker.postMessage({ id: n, method, args }); }
        catch (e) { close(e); }
      });
    }
  };
}
async function load() {
  if (engine) return engine;
  if (!loading) {
    loading = (async () => {
      const w = createWorker();
      try {
        await w.call("configure", [{
          dicUrl: new URL(BASE + "dictionary/", location.href).href,
          voiceUrl: new URL(BASE + "mei_normal.htsvoice", location.href).href
        }], 120000);
        engine = w;
        return w;
      } catch (e) { w.close(e); throw e; }
    })().finally(() => { loading = null; });
  }
  return loading;
}
function bufferFor(data) {
  const pcm = data.pcm;
  if (!pcm?.length || !Number.isFinite(data.sampleRate) || data.sampleRate <= 0) throw new Error("Пустой ответ синтезатора");
  const buffer = audioContext().createBuffer(1, pcm.length, data.sampleRate);
  buffer.copyToChannel(pcm instanceof Float32Array ? pcm : new Float32Array(pcm), 0);
  return buffer;
}
function say(text, rate = 0.9) {
  if (!text) return;
  const ticket = ++serial;
  silence();
  const actual = Math.max(0.5, Math.min(1.6, rate * speed));
  if (engineMode === "native") {
    if (!native(text, actual)) refreshStatus();
    return;
  }
  // Resume synchronously in the click/keyboard event, before waiting for WASM.
  let ac;
  try {
    ac = audioContext();
    if (ac.state === "suspended") ac.resume().catch(() => {});
  } catch (e) { report(String(e.message || e)); return; }
  if (!engine) report("Open JTalk · загрузка словаря и голоса…");
  queue = queue.catch(() => {}).then(async () => {
    if (ticket !== serial || engineMode !== "jtalk") return;
    try {
      const w = await load();
      if (ticket !== serial || engineMode !== "jtalk") return;
      const key = text + "\u0000" + actual.toFixed(2);
      let buf = cache.get(key);
      if (!buf) {
        const data = await w.call("synthesize", [text, { speed: actual }], 20000);
        buf = bufferFor(data);
        cache.set(key, buf);
        if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
      }
      if (ticket !== serial || engineMode !== "jtalk") return;
      if (ac.state === "suspended") {
        report("Open JTalk · нажми «ещё раз», чтобы разрешить звук");
        return;
      }
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(ac.destination);
      source = node;
      node.onended = () => {
        node.disconnect();
        if (source === node) source = null;
      };
      node.start();
      report("Open JTalk · Mei · готов");
    } catch (e) {
      console.warn("Kana Open JTalk:", e);
      if (engine) { engine.close(e); engine = null; }
      if (ticket !== serial || engineMode !== "jtalk") return;
      const fallback = native(text, actual);
      report("Open JTalk: " + String(e?.message || e).slice(0, 250)
        + (fallback ? " · системный японский голос" : ""));
    }
  });
}

export const KanaTTS = {
  init() {
    if (initialized) return;
    initialized = true;
    pickVoice();
    globalThis.speechSynthesis?.addEventListener?.("voiceschanged", pickVoice);
    refreshStatus();
  },
  get mode() { return engineMode; },
  set mode(value) {
    stop();
    engineMode = value === "native" ? "native" : "jtalk";
    store.set("kana.tts.engine", engineMode);
    refreshStatus();
  },
  get speed() { return speed; },
  set speed(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    speed = Math.max(0.7, Math.min(1.3, next));
    store.set("kana.tts.speed", speed);
  },
  bindStatus(node) { statusNode = node; if (node) node.textContent = statusText; },
  say, stop
};
