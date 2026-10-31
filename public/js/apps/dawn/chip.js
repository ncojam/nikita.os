import { hz } from "./tuning.js";
import { notify } from "../../ui/notify.js";

/* ================= DAWN — 👾 Chip: 8-битный синт =================
 * Честно, как железо: никаких фильтров Web Audio. Волна — зацикленный одноцикловый буфер со ступеньками
 * (пульсы 12.5/25/50/75%, 4-битные треугольник и пила NES/Sunsoft, wavetable Game Boy 32×4 бита, шум LFSR),
 * а всё движение — по кадрам (tick, обычно 60 Гц): таблица громкости 0..15, арпеджио-таблица, свип высоты,
 * вибрато с задержкой, последовательность волн (PWM, «тон + шум» у гибридного малого). Значения меняются
 * ступенькой (setValueAtTime), без плавных рамп — отсюда тот самый «трекерный» звук.
 *
 * Консоль (P.chip): сколько каналов звучит одновременно. NES/GB — слоты по классам (2 пульса, волна, шум),
 * C64 — 3 любых голоса, «свободно» — N голосов. Новая нота в занятом слоте глушит старую — как на приставке.
 * Строгий режим: на чип-каналах нет эффектов. Повесил ревер на их инсерт или Master — режим сам выключается
 * (с уведомлением), индикатор в транспорте это показывает; вернуться — кнопкой в индикаторе.
 */

/* ---------- параметры ---------- */
export const CHIP_SPECS = {
  c_tr:  { min: -48, max: 48, def: 0, label: "Tr", step: 1, bipolar: true },
  arpR:  { min: 1, max: 8, def: 1, label: "Arp⏱", step: 1 },
  sweep: { min: -4, max: 4, def: 0, label: "Sweep", bipolar: true },
  vibD:  { min: 0, max: 2, def: 0, label: "Vib" },
  vibR:  { min: 0.5, max: 12, def: 6, label: "Rate" },
  vibW:  { min: 0, max: 60, def: 10, label: "Delay", step: 1 },
  bits:  { min: 1, max: 4, def: 4, label: "Bits", step: 1 },
  crel:  { min: 0, max: 60, def: 4, label: "Rel", step: 1 },
  tick:  { min: 30, max: 240, def: 60, label: "Hz", step: 1 },
};
export const chipDefaults = () => ({
  wave: "p25", seq: [], table: [15, 13, 11, 10, 9, 9], arp: [], arpR: 1, sweep: 0,
  vibD: 0, vibR: 6, vibW: 10, bits: 4, crel: 4, tick: 60, c_tr: 0, slot: "auto",
  wavetable: [8, 11, 13, 14, 15, 15, 14, 13, 11, 9, 8, 6, 4, 3, 2, 1, 1, 1, 2, 3, 4, 6, 7, 8, 9, 10, 10, 10, 9, 8, 8, 8],
});

export const CHIP_WAVES = {
  p125: ["⊓⅛", "пульс 12.5% — тонкий, «носовой»"], p25: ["⊓¼", "пульс 25% — классический NES-лид"],
  p50: ["⊓½", "квадрат 50% — полый, мягкий"], p75: ["⊓¾", "пульс 75% (звучит как 25%, но в другой фазе)"],
  tri4: ["⋀", "4-битный треугольник NES — бас и кик"], saw4: ["⊿", "4-битная пила — Sunsoft/VRC6 бас"],
  gbwave: ["〰", "wavetable Game Boy: 32 ступени × 4 бита, рисуется мышкой"],
  noise: ["≋", "шум LFSR, длинный — малый, тарелки, взрывы"], noise93: ["⁂", "шум LFSR, короткий 93 шага — металлический хэт"],
};
const isNoise = w => w === "noise" || w === "noise93";
const classOf = p => p.slot && p.slot !== "auto" ? null
  : isNoise((p.seq?.length ? p.seq : [p.wave]).find(isNoise) || p.wave) ? "noise" : /^p\d/.test(p.wave) ? "pulse" : "wave";

/* ---------- буферы волн (по частоте дискретизации контекста) ---------- */
const LEN = 2048, NOISE_K = 16, bufs = new Map();
function buf(ctx, key, len, fill) {
  const k = key + "@" + ctx.sampleRate;
  if (bufs.has(k)) return bufs.get(k);
  const b = new AudioBuffer({ length: len, sampleRate: ctx.sampleRate, numberOfChannels: 1 }), d = b.getChannelData(0);
  fill(d);
  if (bufs.size > 64) bufs.clear();   // wavetable-ы рисуются мышкой — не копим бесконечно
  bufs.set(k, b);
  return b;
}
const steps = (d, list, max = 15) => { for (let i = 0; i < d.length; i++) d[i] = list[Math.floor(i * list.length / d.length)] / (max / 2) - 1; };
function lfsr(d, short) {
  let x = 1;
  for (let i = 0; i < d.length; i++) { const fb = (x ^ (x >> (short ? 6 : 1))) & 1; x = (x >> 1) | (fb << 14); d[i] = x & 1 ? 1 : -1; }
}
function waveBuf(ctx, w, p) {
  if (/^p\d+$/.test(w)) { const duty = { p125: 0.125, p25: 0.25, p50: 0.5, p75: 0.75 }[w] || 0.5; return buf(ctx, w, LEN, d => { for (let i = 0; i < LEN; i++) d[i] = i / LEN < duty ? 1 : -1; }); }
  if (w === "tri4") return buf(ctx, w, LEN, d => steps(d, [...Array(16).keys()].reverse().concat([...Array(16).keys()])));
  if (w === "saw4") return buf(ctx, w, LEN, d => steps(d, [...Array(16).keys()]));
  if (w === "gbwave") { const t = (p.wavetable?.length ? p.wavetable : chipDefaults().wavetable).map(v => Math.max(0, Math.min(15, Math.round(v)))); return buf(ctx, "gb:" + t.join(","), LEN, d => steps(d, t)); }
  if (w === "noise93") return buf(ctx, w, 93, d => lfsr(d, true));
  return buf(ctx, "noise", 32767, d => lfsr(d, false));
}
/* высота → скорость чтения буфера; у шума — частота «тактирования» LFSR, ступеньками по полоктавы, как 16 периодов NES */
function rateOf(src, f, sr) {
  if (!src.noise) return f * LEN / sr;
  const r = Math.min(1, f * NOISE_K / sr);
  return 2 ** (Math.round(Math.log2(r) * 2) / 2);
}

/* ---------- голос ---------- */
export function playChip(ctx, out, p, t, dur, n, v, edo = 12, bend = 0) {
  const F = 1 / Math.max(30, p.tick || 60), seq = p.seq?.length ? p.seq : [p.wave || "p25"];
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, 0);
  env.connect(out);
  const srcs = [...new Set(seq)].map(w => {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = waveBuf(ctx, w, p); src.loop = true;
    g.gain.setValueAtTime(0, 0);
    src.connect(g); g.connect(env);
    return { w, src, g, noise: isNoise(w), last: -1 };
  });
  const table = p.table?.length ? p.table : [15], relF = Math.round(p.crel ?? 4), holdF = Math.max(1, Math.round(dur / F));
  const q = 2 ** Math.round(p.bits ?? 4) - 1, base = hz(n, edo) * 2 ** ((p.c_tr || 0) / 12), sr = ctx.sampleRate;
  const fades = table[table.length - 1] <= 0;   // таблица кончается нулём — нота сама затихает (ударные, блипы)
  let offVol = null, lastG = -1, lastW = null, endT = t + (holdF + relF + 1) * F;
  const total = Math.min(holdF + relF + 1, 60 * 30);
  for (let i = 0; i <= total; i++) {
    const tt = t + i * F;
    let vol;
    if (i < holdF) vol = table[Math.min(i, table.length - 1)];
    else { offVol ??= table[Math.min(holdF - 1, table.length - 1)]; vol = relF ? offVol * (1 - (i - holdF + 1) / relF) : 0; }
    let semis = 0;
    if (p.arp?.length) semis += +p.arp[Math.floor(i / Math.max(1, p.arpR || 1)) % p.arp.length] || 0;
    if (p.sweep) semis += p.sweep * i;
    if (p.vibD && i >= (p.vibW || 0)) semis += p.vibD * Math.sin(2 * Math.PI * (p.vibR || 6) * (i - (p.vibW || 0)) * F);
    if (bend) semis += bend * 12 / edo * Math.min(1, i * F / Math.max(0.01, dur));
    const f = base * 2 ** (Math.max(-72, Math.min(60, semis)) / 12);
    const g = Math.round(Math.max(0, Math.min(15, vol)) / 15 * Math.min(1, v) * q) / q * 0.42;
    if (g !== lastG) { env.gain.setValueAtTime(g, tt); lastG = g; }
    const w = seq[Math.min(i, seq.length - 1)];
    for (const s of srcs) {
      if (w !== lastW) s.g.gain.setValueAtTime(s.w === w ? 1 : 0, tt);
      const r = rateOf(s, f, sr);
      if (r !== s.last) { s.src.playbackRate.setValueAtTime(r, tt); s.last = r; }
    }
    lastW = w;
    if (vol <= 0 && (i >= holdF || (fades && i >= table.length - 1))) { endT = tt; break; }
  }
  const end = endT + 0.03;
  for (const s of srcs) { s.src.start(t); s.src.stop(end); }
  return {
    end,
    kill(tk = ctx.currentTime) {
      if (tk >= this.end) return;
      try { env.gain.cancelScheduledValues(tk); env.gain.setValueAtTime(0, tk); for (const s of srcs) s.src.stop(tk + 0.02); } catch { /* уже остановлен */ }
      this.end = tk + 0.02;
    },
  };
}

/* ---------- консоли и слоты ---------- */
export const CONSOLES = {
  nes:  { name: "NES", full: "NES (2A03): 2 пульса · треугольник · шум", voices: 4, pulse: ["p1", "p2"], wave: ["tri"], noise: ["noise"] },
  gb:   { name: "Game Boy", full: "Game Boy: 2 пульса · wave · шум", voices: 4, pulse: ["p1", "p2"], wave: ["wave"], noise: ["noise"] },
  c64:  { name: "C64", full: "C64 (SID): 3 голоса, любая волна", voices: 3, any: ["v1", "v2", "v3"] },
  free: { name: "Свободно", full: "Свободно: сколько голосов — решаешь ты", voices: 8 },
};
export const SLOT_NAMES = { p1: "Pulse 1", p2: "Pulse 2", tri: "Triangle", wave: "Wave", noise: "Noise", v1: "Voice 1", v2: "Voice 2", v3: "Voice 3" };
export const chipChannels = P => P.channels.filter(c => c.type === "chip");
export function slotOf(ch, P) {
  const C = CONSOLES[P.chip?.console] || CONSOLES.free, p = ch.params;
  if (p.slot && p.slot !== "auto" && (C.any || [C.pulse, C.wave, C.noise].flat()).includes(p.slot)) return p.slot;
  if (!C.any && !C.pulse) return "any";
  const auto = chipChannels(P).filter(c => !c.params.slot || c.params.slot === "auto");
  if (C.any) return C.any[Math.max(0, auto.indexOf(ch)) % C.any.length];
  const cls = classOf(p) || "pulse", same = auto.filter(c => classOf(c.params) === cls);
  return C[cls][Math.max(0, same.indexOf(ch)) % C[cls].length];
}
/* вызывается движком после каждой ноты чип-канала: занятый слот (или лишний голос) уступает новой ноте */
export function chipSteal(G, P, ch, t, h) {
  if (!P.chip?.on) return;
  const live = (G.chipLive ||= new Map());
  for (const [k, x] of live) if (x.end <= t) live.delete(k);
  let slot = slotOf(ch, P);
  if (slot === "any") {
    const lim = Math.max(1, P.chip.voices || 8), arr = [...live.entries()].sort((a, b) => a[1].t0 - b[1].t0);
    while (arr.length >= lim) { const [k, x] = arr.shift(); x.kill(t); live.delete(k); }
    slot = "v" + (G.chipSeq = (G.chipSeq || 0) + 1);
  } else { const prev = live.get(slot); if (prev && prev !== h) prev.kill(t); }
  h.t0 = t;
  live.set(slot, h);
}
/* сводка для индикатора: какая консоль, сколько каналов на сколько слотов, строго ли */
export function chipStatus(P) {
  const chans = chipChannels(P);
  if (!P.chip || (!chans.length && !P.chip.on)) return null;
  const C = CONSOLES[P.chip.console] || CONSOLES.free;
  const slots = C.any || C.pulse ? new Set(chans.map(c => slotOf(c, P))) : null;
  const voices = C.any || C.pulse ? (C.any || [C.pulse, C.wave, C.noise].flat()).length : P.chip.voices || 8;
  return { on: !!P.chip.on, strict: !!P.chip.strict, console: C, chans: chans.length, voices, shared: slots ? chans.length > slots.size : false };
}

/* ---------- строгий режим ---------- */
const touchesChip = (P, i) => i === 0 || P.channels.some(c => c.type === "chip" && (c.mix || 0) === i);
export function chipNewChannel(P) {
  P.chip ||= { on: true, console: "free", voices: 8, strict: !(P.mixer[0]?.fx || []).some(f => f.on) };
}
/* эффект ставят на инсерт чип-канала (или Master, или педалью) — выходим из строгого режима, звук не трогаем */
export function chipFxGuard(P, where) {
  if (!P.chip?.strict || !P.chip.on) return false;
  if (typeof where === "number" && !touchesChip(P, where)) return false;
  P.chip.strict = false;
  notify("👾 Эффекты на чиптюне — вышли из строгого режима. Вернуться: индикатор 👾 в транспорте", 5000);
  return true;
}
/* вернуться в строгий режим: эффекты на инсертах чип-каналов выключаются (не удаляются — можно включить обратно) */
export function chipEnterStrict(Engine) {
  const P = Engine.project, all = P.channels.every(c => c.type === "chip");
  let off = 0;
  P.mixer.forEach((m, i) => {
    if (!(i ? touchesChip(P, i) : all)) return;
    m.fx.forEach(f => { if (f.on) { f.on = false; off++; } });
    Engine.G.rebuildFx(i);
  });
  P.chip.strict = true; P.chip.on = true;
  Engine.touch({ mixer: true, chip: true });
  return off;
}

/* ---------- пресеты ---------- */
const PR = (params, tags = "") => ({ params, tags });
const fall = (from, to = 0, n = 8) => Array.from({ length: n }, (_, i) => Math.round(from + (to - from) * i / (n - 1)));
export const CHIP_PRESETS = {
  // лиды
  "NES Lead 25%":       PR({ wave: "p25", table: [15, 14, 12, 11, 10], crel: 5, vibD: 0.25, vibR: 6, vibW: 18 }, "лид"),
  "Thin Lead 12.5%":    PR({ wave: "p125", table: [15, 13, 12, 11], crel: 3, vibD: 0.15, vibW: 12 }, "лид"),
  "Hollow Square":      PR({ wave: "p50", table: [12, 11, 10, 9], crel: 8, vibD: 0.35, vibR: 5, vibW: 24 }, "лид"),
  "C64 PWM Lead":       PR({ wave: "p50", seq: ["p50", "p50", "p25", "p25", "p125", "p125", "p25", "p25", "p50"], table: [15, 14, 13, 12], crel: 6, vibD: 0.2, vibW: 20 }, "лид"),
  "Echo Lead":          PR({ wave: "p25", table: [8, 7, 6, 5], crel: 4 }, "эхо-канал: копия лида на 1/8 позже"),
  "GB Wave Flute":      PR({ wave: "gbwave", table: [11, 12, 13, 13, 12], crel: 10, vibD: 0.3, vibR: 5, vibW: 20,
    wavetable: [8, 10, 12, 13, 14, 15, 15, 15, 14, 13, 12, 10, 8, 6, 4, 3, 2, 1, 0, 0, 0, 1, 2, 3, 4, 6, 7, 8, 8, 8, 8, 8] }, "лид"),
  "Hero Fanfare":       PR({ wave: "p50", table: [15, 15, 14, 13, 12, 12], crel: 10, sweep: 0, vibD: 0.4, vibW: 30, arp: [0, 0, 12, 0], arpR: 2 }, "лид"),
  // аккорды-арпеджио: один канал играет весь аккорд
  "Arp Major 0-4-7":    PR({ wave: "p25", arp: [0, 4, 7], arpR: 1, table: [12, 11, 10, 9], crel: 4 }, "аккорд"),
  "Arp Minor 0-3-7":    PR({ wave: "p25", arp: [0, 3, 7], arpR: 1, table: [12, 11, 10, 9], crel: 4 }, "аккорд"),
  "Arp Sus 0-5-7-12":   PR({ wave: "p125", arp: [0, 5, 7, 12], arpR: 1, table: [11, 10, 9], crel: 3 }, "аккорд"),
  "Arp Octave Shimmer": PR({ wave: "p50", arp: [0, 12], arpR: 2, table: [10, 10, 9, 8], crel: 6 }, "аккорд"),
  // басы
  "Tri Bass":           PR({ wave: "tri4", c_tr: -12, table: [15], crel: 1 }, "бас"),
  "Sunsoft Saw Bass":   PR({ wave: "saw4", c_tr: -12, table: [15, 14, 13, 12], crel: 2 }, "бас"),
  "Pulse Bass":         PR({ wave: "p50", c_tr: -12, table: [13, 12, 10, 9, 8], crel: 2 }, "бас"),
  "GB Thick Bass":      PR({ wave: "gbwave", c_tr: -12, table: [15, 14], crel: 2, wavetable: [15, 15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 15, 15, 14, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0] }, "бас"),
  // перкуссия и колокольчики
  "Bell":               PR({ wave: "tri4", c_tr: 12, table: fall(15, 0, 24), crel: 0 }, "колокол"),
  "Pluck Blip":         PR({ wave: "p25", table: [15, 10, 6, 3, 1, 0], crel: 0 }, "плак"),
  // ударные (params.drum — роль, по ней находим канал в библиотеке)
  "Chip Kick":          PR({ drum: "kick", wave: "tri4", c_tr: -12, sweep: -1.8, table: [15, 15, 13, 10, 6, 2, 0], crel: 0 }, "бочка: треугольник падает вниз"),
  "Noise Kick":         PR({ drum: "kick", wave: "noise", seq: ["tri4", "tri4", "tri4", "noise"], c_tr: -12, sweep: -2, table: [15, 15, 12, 7, 3, 0], crel: 0 }, "бочка: тон + шумовой щелчок"),
  "Chip Snare":         PR({ drum: "snare", wave: "noise", c_tr: 14, table: [15, 13, 10, 8, 6, 4, 3, 2, 1, 0], crel: 0 }, "малый"),
  "Hybrid Snare":       PR({ drum: "snare", wave: "noise", seq: ["p50", "p50", "noise"], c_tr: 2, sweep: -1, slot: "auto", table: [15, 14, 12, 10, 7, 5, 3, 2, 1, 0], crel: 0 }, "малый: тон + шум"),
  "Chip Hat":           PR({ drum: "hat", wave: "noise", c_tr: 36, table: [10, 6, 3, 0], crel: 0 }, "хэт"),
  "Metal Hat":          PR({ drum: "metal", wave: "noise93", c_tr: 30, table: [9, 6, 3, 1, 0], crel: 0 }, "металлический хэт"),
  "Chip Open Hat":      PR({ drum: "ohat", wave: "noise", c_tr: 36, table: fall(10, 0, 14), crel: 0 }, "открытый хэт"),
  "Chip Tom":           PR({ drum: "tom", wave: "tri4", c_tr: -5, sweep: -0.6, table: [15, 14, 12, 9, 6, 3, 0], crel: 0 }, "том"),
  "Chip Crash":         PR({ drum: "crash", wave: "noise", c_tr: 24, table: fall(13, 0, 60), crel: 0 }, "тарелка"),
  // 🎮 блип-блупы: один нажим — один игровой звук
  "Blip · Coin":        PR({ wave: "p50", arp: [0, 5], arpR: 4, table: [15, 15, 15, 15, 14, 12, 10, 8, 6, 4, 2, 0], crel: 0, c_tr: 12 }, "блип"),
  "Blip · Jump":        PR({ wave: "p25", sweep: 0.9, table: [14, 13, 12, 10, 8, 6, 4, 2, 0], crel: 0 }, "блип"),
  "Blip · Laser":       PR({ wave: "p125", sweep: -2.2, c_tr: 24, table: [15, 14, 12, 10, 8, 6, 4, 2, 0], crel: 0 }, "блип"),
  "Blip · Power-Up":    PR({ wave: "p50", arp: [0, 4, 7, 12, 16, 19, 24], arpR: 3, table: [...Array(21).fill(13), 10, 6, 3, 0], crel: 0 }, "блип"),
  "Blip · 1-Up":        PR({ wave: "p25", arp: [0, 3, 7, 12, 7, 12], arpR: 6, c_tr: 12, table: [...Array(36).fill(12), 8, 4, 0], crel: 0 }, "блип"),
  "Blip · Menu":        PR({ wave: "p50", c_tr: 24, table: [12, 12, 8, 0], crel: 0 }, "блип"),
  "Blip · Hurt":        PR({ wave: "noise", seq: ["p125", "noise", "p125", "noise", "p125", "noise"], sweep: -0.8, table: [15, 14, 12, 10, 8, 6, 4, 2, 0], crel: 0 }, "блип"),
  "Blip · Warp":        PR({ wave: "tri4", vibD: 2, vibR: 12, vibW: 0, sweep: 0.5, table: [...Array(30).fill(12), 9, 6, 3, 0], crel: 0 }, "блип"),
  "Blip · Explosion":   PR({ wave: "noise", c_tr: 6, sweep: -0.35, table: fall(15, 0, 45), crel: 0 }, "блип"),
  // 🦇 чиптюн-металкор: 8-битные «гитары» и призраки
  "Power Chord Chug":   PR({ wave: "p25", arp: [0, 7, 12], arpR: 1, c_tr: -12, table: [15, 13, 11, 9, 8, 7], crel: 2 }, "гитара: пауэр-аккорд трелью"),
  "Shred Lead":         PR({ wave: "p125", table: [15, 14, 13, 12], crel: 4, vibD: 0.5, vibR: 7, vibW: 8 }, "гитара: соло"),
  "Ghost Wail":         PR({ wave: "tri4", c_tr: 12, table: [3, 5, 7, 9, 11, 12, 12], crel: 24, vibD: 1.2, vibR: 3, vibW: 6 }, "призрак: вой с глубоким вибрато"),
  "Noise Riser":        PR({ wave: "noise", c_tr: -12, sweep: 0.25, table: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], crel: 2 }, "свип шума вверх"),
};
