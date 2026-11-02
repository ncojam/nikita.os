import { EASE, REDUCED } from "./anim.js";
import { store } from "./util.js";

/* ================= джус: отклик интерфейса на действия =================
 * Короткие звуки (синтез WebAudio, файлы не нужны) и маленькие анимации. Настройки — в Настройки → Отклик.
 *   Juice.grab(node) / Juice.drop(node) — окно взяли / отпустили (зовёт WM).
 *   Juice.spawn(nodes, opts) — шаблон «появилась новая штука»: зови для всего, что создаёт пользователь.
 *     nodes — узел или список (появляются по очереди); opts: { sound: false } — без звука, если их несколько групп.
 * Правила: только свойства scale / rotate / translate / opacity — они не спорят с transform, которым
 * двигают элементы WM и Leaflet; анимации не остаются после окончания (без fill "forwards").
 * Анимации выключаются сами при prefers-reduced-motion и на слабых устройствах (html.fx-calm).
 */
const DEFAULTS = { sound: true, volume: 0.35, motion: true, power: 1 };
const cfg = { ...DEFAULTS, ...store.get("juice", {}) };
const SPRING = "cubic-bezier(.3, 1.6, .5, 1)";
const SPAWN_MS = 340, STAGGER_MS = 50;

let ac = null, noise = null;

function audio() {
  if (!ac) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.1), ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

/* клик: щелчок шума + короткий тон, верх срезан фильтром низких частот (cut) */
function click({ freq, to = freq * 0.55, cut, len, gain = 1 }) {
  if (!cfg.sound || cfg.volume <= 0) return;
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.setValueAtTime(cfg.volume * gain, t);
  out.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = cut; lp.Q.value = 0.7;
  lp.connect(out); out.connect(a.destination);
  const osc = a.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + len);
  osc.connect(lp);
  const hiss = a.createBufferSource(), hissGain = a.createGain();
  hiss.buffer = noise; hissGain.gain.value = 0.35;
  hiss.connect(hissGain); hissGain.connect(lp);
  osc.start(t); hiss.start(t);
  osc.stop(t + len + 0.01); hiss.stop(t + len + 0.01);
  osc.onended = () => out.disconnect();
}

const canMove = () => cfg.motion && !REDUCED && !document.documentElement.classList.contains("fx-calm");
const play = (node, frames, opts) => (canMove() ? node.animate(frames, { easing: EASE, ...opts }) : null);

export const Juice = {
  cfg,
  set(key, value) {
    cfg[key] = value;
    store.set("juice", cfg);
  },

  // поза «в руке»; lift — на сколько окно приподнято, пока его держат
  grab(node, side = 0) {
    const p = cfg.power, lift = 1 + 0.008 * p;
    click({ freq: 1250, cut: 2800, len: 0.045 });
    node.style.setProperty("--juice-lift", canMove() ? lift : 1);
    node.classList.add("grabbed");
    play(node, [
      { scale: 1, rotate: "0deg" },
      { scale: 1 + 0.022 * p, rotate: 0.45 * p * side + "deg", offset: 0.4 },
      { scale: lift, rotate: "0deg" },
    ], { duration: 190 });
  },

  drop(node) {
    const p = cfg.power, lift = 1 + 0.008 * p;
    click({ freq: 520, cut: 1300, len: 0.06, gain: 0.9 });
    node.classList.remove("grabbed");
    play(node, [
      { scale: lift },
      { scale: 1 - 0.006 * p, offset: 0.55 },
      { scale: 1 },
    ], { duration: 170 });
  },

  // шаблон появления: вырастает с отскоком и вспышкой
  spawn(nodes, { sound = true } = {}) {
    const list = [nodes].flat().filter(Boolean);
    if (!list.length) return;
    if (sound) click({ freq: 620, to: 1150, cut: 3000, len: 0.08, gain: 0.7 });
    list.forEach((node, i) => play(node, [
      { opacity: 0, scale: 1 - 0.2 * cfg.power, translate: "0 10px", filter: "brightness(1.8)" },
      { opacity: 1, scale: 1 + 0.03 * cfg.power, translate: "0 0", filter: "brightness(1.3)", offset: 0.6 },
      { opacity: 1, scale: 1, translate: "0 0", filter: "brightness(1)" },
    ], { duration: SPAWN_MS, delay: i * STAGGER_MS, easing: SPRING, fill: "backwards" }));
  },
};
