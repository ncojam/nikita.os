import { patLen } from "./format.js";

/* ================= DAWN — ноты одного тика =================
 * Общее для движка DAWN (engine.js) и мини-плеера (miniplayer.js): какие ноты начинаются в тике и как их поставить.
 * Тик — 1/16 (0.25 доли). Режимы: "pat" — текущий паттерн, "song" — плейлист.
 */
export const TICK = 0.25;
export const songLen = P => P.playlist.reduce((m, c) => Math.max(m, c.s + c.l), 0);

/* ноты, начинающиеся в тике [beat, beat + 0.25): cb(канал, нота, смещение от начала тика в долях) */
export function collect(P, mode, beat, cb) {
  if (mode === "pat") {
    const pat = P.patterns.find(p => p.id === P.cur);
    if (pat) emitPattern(P, pat, beat, beat + TICK, cb);
    return;
  }
  for (const c of P.playlist) {
    if (beat < c.s || beat >= c.s + c.l) continue;
    const pat = P.patterns.find(p => p.id === c.p);
    if (!pat) continue;
    const len = patLen(P, pat.id), local = (beat - c.s + (c.o || 0)) % len;   // o — сдвиг внутри паттерна (после разреза)
    const until = Math.min(local + TICK, local + (c.s + c.l - beat));   // нота должна начаться внутри клипа
    emitPattern(P, pat, local, until, cb);
  }
}
function emitPattern(P, pat, from, to, cb) {   // cb(канал, нота{s,l,n,v,b?}, смещение)
  for (const ch of P.channels) for (const n of pat.notes[ch.id] || []) if (n.s >= from - 1e-9 && n.s < to - 1e-9) cb(ch, n, n.s - from);
}

export function playTick(G, P, mode, beat, t) {
  const bd = 60 / P.bpm, td = bd / 4;
  const swing = (Math.round(beat * 4) % 2 === 1) ? (P.swing || 0) * td * 0.5 : 0;
  collect(P, mode, beat, (ch, n, off) => G.voice(ch, Math.max(t + off * bd + swing, G.ctx.currentTime), n.l * bd, n.n, n.v, n.b || 0, n.x || 1));
}
