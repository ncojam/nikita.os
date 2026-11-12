import { store } from "../../core/util.js";

/* ================= NETWORK — звуки =================
 * Всё синтезом WebAudio, файлов нет. Громкость и «звук вкл/выкл» — общие с откликом ОС (Настройки → Отклик, ключ juice).
 *   scratch()  — сайт что-то запрещает: скретч пластинки (вместе с тряской окна, см. site.js: deny)
 *   ding()     — что-то добавили (пост, ветка): приятный двузвучный «динь»
 *   spray(sec) — сохранили профиль: погремели шариком баллончика и «пшшш»
 *   hiss()     — живой пшик для стены: { level(0..1), stop() }
 *   clack()    — щелчок кэпа (смена размера на стене)
 */
let ac = null, noiseBuf = null;
const cfg = () => ({ sound: true, volume: 0.35, ...store.get("juice", {}) });

function audio() {
  const c = cfg();
  if (!c.sound || c.volume <= 0) return null;
  if (!ac) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}
const vol = (k = 1) => cfg().volume * k;
function out(a, g) { const n = a.createGain(); n.gain.value = g; n.connect(a.destination); return n; }
function noise(a, loop = false) { const s = a.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s; }

export function scratch() {
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = out(a, vol(1.1));
  // шум через полосовой фильтр, который «едет» туда-обратно, как игла по канавке при рывке пластинки
  const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3.5;
  bp.frequency.setValueAtTime(380, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.09);
  bp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
  bp.frequency.exponentialRampToValueAtTime(1900, t + 0.29);
  bp.frequency.exponentialRampToValueAtTime(320, t + 0.4);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(1, t + 0.02);
  g.gain.setValueAtTime(1, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.21);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.44);
  const n = noise(a); n.playbackRate.setValueAtTime(0.6, t); n.playbackRate.linearRampToValueAtTime(1.4, t + 0.1);
  n.connect(bp); bp.connect(g); g.connect(o);
  // «голос» пластинки: пила, тон тянется вверх-вниз
  const s = a.createOscillator(); s.type = "sawtooth";
  s.frequency.setValueAtTime(110, t);
  s.frequency.exponentialRampToValueAtTime(520, t + 0.09);
  s.frequency.exponentialRampToValueAtTime(85, t + 0.2);
  s.frequency.exponentialRampToValueAtTime(420, t + 0.29);
  s.frequency.exponentialRampToValueAtTime(70, t + 0.42);
  const sg = a.createGain(); sg.gain.value = 0.22;
  const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
  s.connect(lp); lp.connect(sg); sg.connect(g);
  n.start(t); s.start(t); n.stop(t + 0.46); s.stop(t + 0.46);
  s.onended = () => o.disconnect();
}

export function ding() {
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = out(a, vol(0.55));
  [[1318.5, 0], [1975.5, 0.075]].forEach(([f, d]) => {
    for (const [mul, type, k] of [[1, "sine", 1], [2, "triangle", 0.12]]) {
      const osc = a.createOscillator(), g = a.createGain();
      osc.type = type; osc.frequency.value = f * mul;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.5 * k, t + d + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.55);
      osc.connect(g); g.connect(o); osc.start(t + d); osc.stop(t + d + 0.6);
    }
  });
  setTimeout(() => o.disconnect(), 900);
}

/* шарик в баллончике: короткие металлические щелчки */
function rattle(a, o, t, n = 3) {
  for (let i = 0; i < n; i++) {
    const tt = t + i * 0.11 + Math.random() * 0.02;
    const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200 + Math.random() * 900; bp.Q.value = 9;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(1.6, tt + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.05);
    const s = noise(a); s.connect(bp); bp.connect(g); g.connect(o); s.start(tt, Math.random()); s.stop(tt + 0.06);
  }
  return t + n * 0.11 + 0.05;
}

/* струя: шум выше 2.5 кГц, лёгкая неровность давления */
function jet(a) {
  const s = noise(a, true);
  const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
  const pk = a.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = 6500; pk.gain.value = 6; pk.Q.value = 0.8;
  const g = a.createGain(); g.gain.value = 0;
  s.connect(hp); hp.connect(pk); pk.connect(g);
  return { s, g };
}

export function spray(sec = 0.85) {
  const a = audio(); if (!a) return;
  const o = out(a, vol(0.9));
  const t0 = rattle(a, o, a.currentTime, 3);
  const { s, g } = jet(a); g.connect(o);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.04);
  g.gain.setValueAtTime(0.7, t0 + sec - 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + sec);
  s.start(t0, Math.random()); s.stop(t0 + sec + 0.05);
  s.onended = () => o.disconnect();
}

export function hiss() {
  const a = audio(); if (!a) return { level() {}, stop() {} };
  const o = out(a, vol(0.7));
  const { s, g } = jet(a); g.connect(o);
  s.start(a.currentTime, Math.random());
  let alive = true;
  return {
    level(v) { if (alive) g.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.75, a.currentTime, 0.02); },
    stop() {
      if (!alive) return; alive = false;
      g.gain.setTargetAtTime(0, a.currentTime, 0.03);
      s.stop(a.currentTime + 0.2); s.onended = () => o.disconnect();
    },
  };
}

export function clack() {
  const a = audio(); if (!a) return;
  const o = out(a, vol(0.8));
  rattle(a, o, a.currentTime, 1);
  setTimeout(() => o.disconnect(), 300);
}
