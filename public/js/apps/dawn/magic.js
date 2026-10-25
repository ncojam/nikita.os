import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { Engine, PASTEL } from "./engine.js";
import { fxDefaults } from "./fx.js";
import { DRUMS, ensureDrum } from "./library.js";
import { applyPreset } from "./presets.js";
import { c4, scaleSet } from "./tuning.js";
import { dwBtn, select, shell } from "./ui.js";
import { UserLib } from "./userlib.js";
import { cloneWub, enhance } from "./wubs.js";
import { METAL_OSC3, RIDDIM_GF, addSub, fatten, neighbour, produceAll } from "./produce.js";

/* ================= DAWN — «Магия»: умные функции поверх проекта =================
 * Достроить композицию: смотрит на паттерн (размер, лад, бас, ударные, темп → стиль) и собирает вокруг него трек:
 * интро, нарастание, дроп, брейк, второй дроп, аутро. Плюс то, до чего легко не додуматься: пэд по басовой линии
 * с сайдчейном от бочки, райзер и ролл малого перед дропом, тишина за полдоли до дропа, «удар» на первой доле дропа,
 * брейки ударных в конце фраз, вариация дропа с октавой в басе.
 * Ударные по стилю: драм-партия в размере паттерна (грув из библиотеки или по группам 2+2+3…).
 * Брейки: варианты концовки (ролл, заикание, провал, томы) — паттернами и по плейлисту.
 * Всё строится обычными паттернами и клипами — дальше их можно править руками.
 */

/* ---------- случайность с зерном: «🎲» даёт другой вариант, одно зерно — тот же результат ---------- */
let seed = Date.now() % 100000;
function rnd() { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = a => a[Math.floor(rnd() * a.length)];
const N = (s, l, n, v) => ({ s: +s.toFixed(4), l: +l.toFixed(4), n, v: +Math.min(1, Math.max(0.05, v)).toFixed(3) });

/* ---------- разбор паттерна ---------- */
const DRUM_RE = [["kick", /kick|бочк/i], ["snare", /snare|малый/i], ["clap", /clap|хлоп/i], ["ohat", /open/i], ["hat", /hat|хэт/i], ["tom", /tom/i]];
export function roleOf(ch) {
  if (ch.type !== "sampler") return null;
  const s = (ch.params.path || "") + " " + ch.id + " " + ch.name;
  for (const [r, re] of DRUM_RE) if (re.test(s)) return r;
  return "perc";
}
export function analyze(patId = Engine.project.cur) {
  const P = Engine.project, pat = Engine.pat(patId), L = Engine.patLength(patId), bar = Engine.barLen(pat);
  const drums = {}, synths = [];
  for (const ch of P.channels) {
    const notes = pat.notes[ch.id] || [];
    const r = roleOf(ch);
    if (r) { if (notes.length && !drums[r]) drums[r] = ch; continue; }
    if (!notes.length) continue;
    const E = ch.edo || 12, avg = notes.reduce((s, n) => s + n.n, 0) / notes.length;
    synths.push({ ch, notes, avg, rel: (avg - c4(E)) / E });
  }
  synths.sort((a, b) => a.rel - b.rel);
  // бас — среди низких синтов тот, что звучит дольше всех
  const lows = synths.filter(s => s.rel < -0.4), dur = s => s.notes.reduce((a, n) => a + n.l, 0);
  const bass = lows.sort((a, b) => dur(b) - dur(a))[0] || null;
  // главный вуб: синт с наибольшим числом нот (не пэд)
  const wub = synths.filter(s => !/pad|пэд/i.test(s.ch.name) && s.notes.length >= 2).sort((a, b) => b.notes.length * (b.rel < 0 ? 2 : 1) - a.notes.length * (a.rel < 0 ? 2 : 1) || (a === bass ? -1 : 1))[0] || null;   // низкие — в приоритете
  // лад: у канала задан — берём; иначе — по нотам (какая тоника и мажор/минор лучше покрывают ноты)
  const ref = synths.find(s => s.ch.scale?.mode && s.ch.scale.mode !== "chromatic")?.ch;
  let key;
  if (ref) key = { E: ref.edo || 12, root: ref.scale.root || 0, mode: ref.scale.mode };
  else {
    const E = synths[0]?.ch.edo || 12, hist = new Array(E).fill(0);
    for (const s of synths) for (const n of s.notes) hist[((n.n % E) + E) % E] += n.l * (s === bass ? 2 : 1);
    if (bass) hist[((bass.notes[0].n % E) + E) % E] += 4;   // первая нота баса — частая тоника
    let best = { score: -1, root: 0, mode: "minor" };
    for (let r = 0; r < E; r++) for (const mode of ["minor", "major"]) {
      const set = scaleSet(E, mode, r); let sc = 0;
      for (let k = 0; k < E; k++) if (set.has(k)) sc += hist[k];
      sc += hist[r] * 0.5 + (mode === "minor" ? 0.01 : 0);
      if (sc > best.score) best = { score: sc, root: r, mode };
    }
    key = { E, root: best.root, mode: best.mode };
  }
  // стиль: темп + где стоит малый/хлопок и как часто бочка
  const snare = [...(pat.notes[drums.snare?.id] || []), ...(pat.notes[drums.clap?.id] || [])];
  const kick = pat.notes[drums.kick?.id] || [];
  const half = snare.length && snare.every(n => Math.abs((n.s % bar) - bar / 2) < 0.3);
  const four = kick.length >= Math.round(L * 0.8) && kick.every(n => Math.abs(n.s - Math.round(n.s)) < 0.05);
  const bpm = P.bpm;
  const style = bpm >= 160 ? "dnb" : half && bpm >= 120 ? "riddim" : four ? "house" : bpm >= 130 && half ? "trap" : "break";
  return { P, pat, L, bar, sig: pat.sig, drums, synths, bass, wub, key, style, bpm };
}
export const STYLES = { auto: "Авто (по паттерну)", riddim: "Riddim / дабстеп halftime", dnb: "Drum'n'bass", jungle: "Jungle", house: "House", trap: "Trap", break: "Breakbeat", afro: "Afro 12/8" };
const GROOVE = { riddim: "riddim44", dnb: "dnb44", jungle: "jungle", house: "house", trap: "trap", break: "break54", afro: "afro128" };

/* ---------- каналы, которые магия добавляет сама ---------- */
function findOrPreset(re, preset, name, A, vol) {
  const P = Engine.project;
  let ch = P.channels.find(c => c.preset === preset || (c.type === "osc3" && re.test(c.name)));
  if (ch) return { ch, made: false };
  ch = Engine.addChannel("osc3", name);
  if (A.bass) { ch.edo = A.bass.ch.edo || 12; ch.scale = { ...A.bass.ch.scale }; }
  applyPreset(Engine, ch, preset);
  ch.vol = vol;
  return { ch, made: true };
}
function ensurePad(A, notes) {
  const r = findOrPreset(/pad|пэд/i, "Ambient Pad", "Pad ✨", A, 0.5);
  const kick = A.drums.kick, i = r.ch.mix || 0, m = Engine.project.mixer[i];
  // пэд приседает от бочки — сразу «дышит» в такт
  if (r.made && kick && i > 0 && m.fx.length < 4 && !m.fx.some(f => f.type === "side")) {
    m.fx.push({ type: "side", on: true, p: { ...fxDefaults("side"), src: kick.id, amount: 0.65 } });
    Engine.G.rebuildFx(i);
    notes?.push("пэду — сайдчейн от бочки (приседает на каждом ударе)");
  }
  return r.ch;
}
const ensureRiser = A => findOrPreset(/riser|райзер/i, "Noise Riser", "Riser ✨", A, 0.45).ch;

/* ---------- аккорды пэда: по басу (корень такта = нота баса), иначе — типовая последовательность ---------- */
function padNotes(A, ch, len) {
  const { E, root, mode } = A.key, steps = [...scaleSet(E, mode, 0)].sort((a, b) => a - b), out = [];
  const base = c4(E) - E;   // октава ниже «до» первой
  // аккорд под ноту баса: трезвучие лада, где эта нота — корень (если оно мажорное/минорное) или терция; уменьшённые — мимо
  const triad = i => [0, 2, 4].map(k => steps[(i + k) % steps.length] + Math.floor((i + k) / steps.length) * E);
  const good = t => { const third = t[1] - t[0], fifth = t[2] - t[0]; return Math.abs(fifth - Math.round(7 * E / 12)) <= Math.max(1, E / 24) && third > 0; };
  const chordAt = rel => {
    const pc = ((rel % E) + E) % E;
    let tri = null;
    const i = steps.indexOf(pc);
    if (i >= 0 && good(triad(i))) tri = triad(i);
    if (!tri) for (let j = 0; j < steps.length && !tri; j++) { const t = triad(j); if (good(t) && t.some(x => x % E === pc)) tri = t; }
    if (!tri) tri = [pc, pc + Math.round(3 * E / 12), pc + Math.round(7 * E / 12)];
    return tri.map(x => base + root + ((x + E * 4) % (E * 2)));
  };
  const prog = mode === "major" ? [0, 4, 5, 3] : [0, 5, 2, 6];
  for (let s = 0, k = 0; s < len - 1e-9; s += A.bar, k++) {
    let rel;
    if (A.bass) {
      const bn = A.bass.notes.filter(n => n.s % A.L < (s % A.L) + A.bar - 1e-9 && n.s % A.L >= (s % A.L) - 1e-9).sort((a, b) => a.s - b.s)[0] || A.bass.notes[0];
      rel = ((bn.n - root) % E + E) % E;
    } else rel = steps[prog[k % 4] % steps.length];
    const dur = Math.min(A.bar, len - s);
    for (const n of chordAt(rel)) out.push(N(s, dur, n, 0.55));
  }
  return out;
}

/* ---------- куски трека ---------- */
const clone = notes => Object.fromEntries(Object.entries(notes).map(([c, L]) => [c, L.map(n => ({ ...n }))]));
const only = (A, pred) => Object.fromEntries(Object.entries(A.pat.notes).filter(([c]) => pred(Engine.chan(c))).map(([c, L]) => [c, L.map(n => ({ ...n }))]));
const isDrum = ch => ch?.type === "sampler";
function mkPat(name, A, len, notes, color) {
  const p = Engine.addPattern(name);
  p.sig = [...A.sig]; p.len = len; p.notes = notes; p.color = color || PASTEL[(Engine.project.patterns.length + 3) % PASTEL.length];
  return p;
}
function buildNotes(A, len) {
  const sn = ensureDrum("snare"), kick = A.drums.kick || ensureDrum("kick"), hat = A.drums.hat || ensureDrum("hat");
  const pitch = ch => Engine.defaultPitch(ch), notes = { [sn.id]: [], [kick.id]: [], [hat.id]: [] };
  // ролл: восьмые → шестнадцатые → тридцатьвторые, громче к концу; бочка по долям; последние полдоли — тишина
  const end = len - 0.5;
  for (let s = 0; s < end - 1e-9;) {
    const q = s / len, st = q < 0.5 ? 0.5 : q < 0.75 ? 0.25 : 0.125;
    notes[sn.id].push(N(s, st * 0.8, pitch(sn), 0.3 + q * 0.7));
    s += st;
  }
  for (let s = 0; s < end; s += 1) notes[kick.id].push(N(s, 0.25, pitch(kick), 0.7 + 0.3 * s / len));
  for (let s = 0; s < end; s += 0.5) notes[hat.id].push(N(s, 0.2, pitch(hat), 0.35 + 0.3 * s / len));
  if (A.bass) {   // бас держит тонику и нагнетает
    const r = A.bass.notes[0].n;
    notes[A.bass.ch.id] = [];
    for (let s = 0; s < end; s += len > 8 ? 1 : 0.5) notes[A.bass.ch.id].push(N(s, 0.4, r, 0.5 + 0.5 * s / len));
  }
  return notes;
}
function impactNotes(A) {
  const notes = {}, add = (role, v, l = 0.5) => { const ch = A.drums[role] || ensureDrum(role); (notes[ch.id] ||= []).push(N(0, l, Engine.defaultPitch(ch), v)); };
  add("kick", 1); add("ohat", 0.9, 1); add(A.drums.clap ? "clap" : "snare", 1);
  return notes;
}
/* брейк в конце паттерна: kind = roll | stutter | dropout | toms */
export function fillNotes(A, kind, base = A.pat.notes) {
  const notes = clone(base), L = A.L, from = L - (A.bar >= 6 ? 2 : 1);
  const drumIds = Object.keys(notes).filter(c => isDrum(Engine.chan(c)));
  const cut = ids => ids.forEach(c => { notes[c] = notes[c].filter(n => n.s < from - 1e-9); });
  if (kind === "roll") {
    cut(drumIds);
    const sn = A.drums.snare || ensureDrum("snare"), p = Engine.defaultPitch(sn);
    (notes[sn.id] ||= []);
    for (let s = from, k = 0; s < L - 1e-9; s += 0.25, k++) notes[sn.id].push(N(s, 0.2, p, 0.45 + 0.55 * (s - from) / (L - from)));
  } else if (kind === "stutter") {
    const src = Object.fromEntries(Object.entries(notes).map(([c, Ls]) => [c, Ls.filter(n => n.s >= from && n.s < from + 0.25)]));
    for (const c of Object.keys(notes)) notes[c] = notes[c].filter(n => n.s < from);
    for (let s = from, k = 0; s < L - 1e-9; s += (s - from < (L - from) / 2 ? 0.25 : 0.125), k++)
      for (const [c, Ls] of Object.entries(src)) for (const n of Ls) notes[c].push(N(s + (n.s - from), Math.min(n.l, 0.12), n.n, n.v * (0.7 + 0.3 * rnd())));
  } else if (kind === "dropout") {
    const keep = [A.drums.snare?.id, A.drums.clap?.id].filter(Boolean);
    for (const c of Object.keys(notes)) if (!keep.includes(c)) notes[c] = notes[c].filter(n => n.s < from);
    for (const c of keep) notes[c] = notes[c].filter(n => n.s < from);
    const hit = A.drums.clap || A.drums.snare || ensureDrum("snare");
    (notes[hit.id] ||= []).push(N(from, 0.5, Engine.defaultPitch(hit), 1));
    const oh = A.drums.ohat || ensureDrum("ohat");
    (notes[oh.id] ||= []).push(N(from, 1, Engine.defaultPitch(oh), 0.7));
  } else if (kind === "toms") {
    cut(drumIds);
    const tom = ensureDrum("tom"), p = Engine.defaultPitch(tom), steps = [7, 5, 3, 0, -2, -5, -7, -9];
    (notes[tom.id] ||= []);
    let k = 0;
    for (let s = from; s < L - 1e-9; s += 0.25, k++) notes[tom.id].push(N(s, 0.22, p + steps[k % steps.length], 0.6 + 0.4 * (s - from) / (L - from)));
    const kick = A.drums.kick; if (kick) (notes[kick.id] ||= []).push(N(L - 0.25, 0.2, Engine.defaultPitch(kick), 0.9));
  }
  return notes;
}
export const FILLS = { roll: "Ролл малого", stutter: "Заикание", dropout: "Провал", toms: "Томы" };
/* вариация дропа: бочка с синкопой, хэты шестнадцатыми в конце, одна нота баса на октаву выше */
function variationNotes(A) {
  const notes = clone(A.pat.notes);
  const kick = A.drums.kick;
  if (kick) { const p = Engine.defaultPitch(kick), have = new Set(notes[kick.id].map(n => n.s)); for (const s of [0.75, A.bar / 2 + 1.75].filter(s => s < A.L && !have.has(s))) notes[kick.id].push(N(s, 0.2, p, 0.6)); }
  const hat = A.drums.hat;
  if (hat) { const p = Engine.defaultPitch(hat); for (let s = A.L - 1; s < A.L - 1e-9; s += 0.25) if (!notes[hat.id].some(n => Math.abs(n.s - s) < 0.01)) notes[hat.id].push(N(s, 0.15, p, 0.35)); }
  if (A.bass) {
    const bl = notes[A.bass.ch.id], E = A.bass.ch.edo || 12;
    const mid = bl.filter(n => n.s > 0.4 && n.s < A.L - 1);
    if (mid.length) { const n = pick(mid); n.n += E; }
  }
  return notes;
}

/* ---------- вубы в вариациях ----------
 * медленный: в части тактов вместо частых вубов — один на такт или два на полтакта, на клоне с длинной атакой и своей модуляцией;
 * металлический: те же ноты на клоне с металлом; саб: корень такта октавой-двумя ниже (глубже во втором дропе) */
function slowNotes(A, notes) {
  // удлинённые вубы на том же синте: соседние ноты такта сливаются в одну, атака растягивается во столько же раз (поле x)
  const out = clone(notes), id = A.wub.ch.id, src = (out[id] || []).sort((a, b) => a.s - b.s), nb = Math.max(1, Math.round(A.L / A.bar));
  const bars = nb === 1 ? [0] : [...Array(nb).keys()].filter(b => b % 2 === 1 || rnd() < 0.3);
  const merged = new Set(), add = [];
  for (const b of bars) {
    const inBar = src.filter(n => Math.floor(n.s / A.bar + 1e-6) === b);
    if (inBar.length < 2) continue;
    // варианты: «1-2 вместе», «весь такт», «пары», «3-4 вместе»
    const mode = pick(inBar.length >= 4 ? ["first2", "whole", "pairs", "last2", "first3"] : ["first2", "whole"]);
    const groups = mode === "whole" ? [inBar] : mode === "pairs" ? [inBar.slice(0, 2), inBar.slice(2, 4)] : mode === "last2" ? [inBar.slice(-2)]
      : mode === "first3" ? [inBar.slice(0, 3)] : [inBar.slice(0, 2)];
    for (const g of groups) {
      if (g.length < 2) continue;
      const first = g[0], end = Math.max(...g.map(n => n.s + n.l)), l = end - first.s;
      g.forEach(n => merged.add(n));
      add.push({ s: first.s, l: +l.toFixed(4), n: first.n, v: Math.min(1, first.v + 0.05), x: +Math.min(8, l / Math.max(0.05, first.l)).toFixed(3), ...(first.b ? { b: first.b } : {}) });
    }
  }
  out[id] = [...src.filter(n => !merged.has(n)), ...add].sort((a, b) => a.s - b.s);
  return out;
}
function moveNotes(A, notes, toCh) {
  const out = clone(notes), id = A.wub.ch.id;
  out[toCh.id] = (out[id] || []).map(n => ({ ...n })); out[id] = [];
  return out;
}
function withSub(A, notes, subCh) {
  const out = clone(notes), src = (A.bass || A.wub)?.notes || [], E = subCh.edo || 12, low = c4(E) - 2 * E;
  out[subCh.id] = [];
  for (let s = 0; s < A.L - 1e-9; s += A.bar) {
    const first = src.filter(n => n.s >= s - 1e-6 && n.s < s + A.bar - 1e-6).sort((a, b) => a.s - b.s)[0];
    if (!first) continue;
    let n = first.n; while (n >= low) n -= E;
    out[subCh.id].push(N(s, A.bar * 0.95, n, 0.9));
  }
  return out;
}

/* ---------- драм-партия по стилю — в текущий паттерн (ударные заменяются, остальное остаётся) ---------- */
export function drumsForStyle(style) {
  const A = analyze(), P = Engine.project, pat = A.pat, L = A.L;
  if (style === "auto") style = A.style;
  const out = {};
  const put = (role, s, v, l = 0.2) => { const ch = ensureDrum(role); (out[ch.id] ||= []).push(N(s, l, Engine.defaultPitch(ch), v)); };
  const g = DRUMS.find(d => d.id === GROOVE[style]);
  const [num, den] = A.sig;
  if (g && g.len <= L && Math.abs(L / g.len - Math.round(L / g.len)) < 1e-6) {
    // грув из библиотеки, повторённый на длину паттерна; во второй половине — немного живости
    for (let k = 0; k < L - 1e-9; k += g.len) for (const [role, list] of Object.entries(g.notes))
      for (const [s, l, , v] of list) put(role, s + k, v * (k ? 0.92 + 0.12 * rnd() : 1), l);
    if (rnd() < 0.7) put("snare", L - 0.25, 0.35);           // призрачная нота перед повтором
  } else {
    // размер не из библиотеки (7/8, 11/8, 5/4…) — по группам по 2 и 3 восьмых
    const unit = den === 8 ? 0.5 : den === 16 ? 0.25 : 1, n8 = Math.round(A.bar / unit);
    const groups = []; let left = n8;
    while (left > 0) { const gsz = left === 3 || left === 5 || (left > 4 && rnd() < 0.35) ? 3 : 2; groups.push(Math.min(gsz, left)); left -= gsz; }
    for (let b = 0; b < L - 1e-9; b += A.bar) {
      let pos = 0;
      groups.forEach((gsz, gi) => {
        const s = b + pos * unit, mid = gi === Math.floor(groups.length / 2);
        if (mid) put(style === "house" ? "clap" : "snare", s, 1); else put("kick", s, gi ? 0.85 : 1);
        for (let k = 0; k < gsz; k++) put("hat", s + k * unit, k ? 0.32 : 0.55, 0.15);
        if (style === "dnb" || style === "jungle") put("hat", s + unit / 2, 0.25, 0.1);
        pos += gsz;
      });
      if (rnd() < 0.5) put("snare", b + A.bar - unit / 2, 0.3);
    }
  }
  for (const c of Object.keys(pat.notes)) if (isDrum(Engine.chan(c))) pat.notes[c] = [];
  Object.assign(pat.notes, out);
  Engine.touch({ notes: true, channels: true });
  return STYLES[style] || style;
}

/* ---------- композиция ---------- */
/* ---------- основа: паттерн, самый частый паттерн трека или участок от маркера ▼ ---------- */
export function basePattern(basis = "pattern", bars = 8) {
  const P = Engine.project;
  if (basis === "pattern" || !P.playlist.length) return P.cur;
  const from = basis === "region" ? P.songStart || 0 : 0, to = basis === "region" ? from + bars * 4 : Infinity, score = {};
  for (const c of P.playlist) {
    const a = Math.max(c.s, from), b = Math.min(c.s + c.l, to);
    if (b <= a) continue;
    const pat = Engine.pat(c.p);
    if (!pat || /^✨ (Build|Fill|Impact|Pad|Hats|Arp|Break|Intro)/.test(pat.name) || / · /.test(pat.name)) continue;   // служебные куски магии — не основа
    const hasDrums = pat && Object.entries(pat.notes).some(([id, L]) => L.length && isDrum(Engine.chan(id)));
    const parts = pat ? Object.values(pat.notes).filter(L => L.length).length : 0;   // чем больше партий — тем вероятнее это дроп
    score[c.p] = (score[c.p] || 0) + (b - a) * (hasDrums ? 2 : 1) * parts * (/^✨/.test(pat?.name || "") ? 0.05 : 1);   // свой паттерн важнее результатов прошлой магии
  }
  const best = Object.entries(score).sort((x, y) => y[1] - x[1])[0];
  return best ? best[0] : P.cur;
}

/* «дырявость»: в полутактах случайно выпадают ударные и вуб (пэд и саб остаются) */
function holesNotes(A, notes, amount, wubId) {
  const out = clone(notes), half = A.bar / 2;
  for (let s = 0; s < A.L - 1e-9; s += half) {
    if (rnd() > amount * 0.6) continue;
    for (const [id, L] of Object.entries(out)) {
      const ch = Engine.chan(id);
      if (isDrum(ch) && roleOf(ch) === "kick" && s === 0) continue;   // первая бочка — опора
      if (isDrum(ch) || id === wubId) out[id] = L.filter(n => n.s < s - 1e-6 || n.s >= s + half - 1e-6);
    }
  }
  return out;
}
/* арпеджио по аккордам пэда — «мелодичность» */
function arpNotes(A, ch, len, density) {
  const chords = padNotes(A, ch, len), E = ch.edo || 12, out = [], step = density > 0.66 ? 0.25 : 0.5;
  for (let s = 0; s < len - 1e-9; s += step) {
    const ch3 = chords.filter(n => n.s <= s + 1e-6 && n.s + n.l > s + 1e-6).map(n => n.n).sort((a, b) => a - b);
    if (!ch3.length || rnd() > 0.35 + density * 0.6) continue;
    const k = Math.floor(s / step) % (ch3.length + 1), n = k < ch3.length ? ch3[k] + E : ch3[0] + 2 * E;
    out.push(N(s, step * 0.9, n, 0.55 + 0.3 * rnd()));
  }
  return out;
}
/* нарастание с саспенсом: длина и плотность — от «саспенса»; тизер нового синта следующего дропа */
function buildNotes2(A, len, suspense, teaser) {
  const notes = buildNotes(A, len), sn = ensureDrum("snare"), id = sn.id, p = Engine.defaultPitch(sn);
  // ролл занимает последние 4–8 долей, раньше — редкие удары малого раз в такт
  const rollFrom = Math.max(0, len - (len > 8 ? 4 + Math.round(4 * (1 - suspense)) : len));
  notes[id] = notes[id].filter(n => n.s >= rollFrom);
  for (let s = A.bar / 2; s < rollFrom - 1e-9; s += A.bar) notes[id].push(N(s, 0.2, p, 0.45 + 0.3 * s / len));
  if (suspense > 0.6) {   // долгий саспенс: в середине нарастания бочка выпадает — «вдох» перед последней волной
    const kick = A.drums.kick || ensureDrum("kick"), a = len * 0.5, b = a + A.bar;
    notes[kick.id] = (notes[kick.id] || []).filter(n => n.s < a || n.s >= b);
  }
  if (teaser) {   // новый синт следующего дропа тянет корень, фильтр открывает автоматизация
    const root = (A.wub?.notes || [])[0]?.n ?? c4(teaser.edo || 12) - 12;
    notes[teaser.id] = [];
    for (let s = Math.max(0, len - Math.min(len, 4 * A.bar)); s < len - 0.5 - 1e-9; s += A.bar) notes[teaser.id].push(N(s, Math.min(A.bar, len - 0.5 - s) * 0.95, root, 0.7));
  }
  return notes;
}

/* ---------- варианты интро и нарастаний: выбираются случайно или под синт дропа ---------- */
export const INTROS = { auto: "Интро: под трек", random: "Интро: случайное", padhats: "Пэд + хэты → бочка", filtered: "Рифф дропа за фильтром", arp: "Арпеджио + пэд",
  atmos: "Атмосфера без ударных", drums: "Только грув → пэд", dark: "Тёмный саб + малый на «3»" };
export const BUILDS = { auto: "Нарастание: под синт дропа", random: "Нарастание: случайное", roll: "Ролл малого", wubtease: "Вуб-чопы ускоряются", riff: "Рифф дропа + ролл",
  siren: "Сирена: синт ползёт вверх", stop: "Стоп-пауза перед дропом", triplet: "Триольный ролл + томы" };
function buildVariant(kind, A, len, suspense, teaser) {
  if (kind === "roll") return buildNotes2(A, len, suspense, teaser);
  const notes = {}, sn = ensureDrum("snare"), kick = A.drums.kick || ensureDrum("kick"), hat = A.drums.hat || ensureDrum("hat");
  const put = (ch, s, l, n, v, b) => { const x = N(s, l, n, v); if (b) x.b = b; (notes[ch.id] ||= []).push(x); };
  const pS = Engine.defaultPitch(sn), pK = Engine.defaultPitch(kick), pH = Engine.defaultPitch(hat), end = len - 0.5;
  const syn = teaser || A.wub?.ch, E = syn?.edo || 12, root = (A.wub?.notes || [])[0]?.n ?? c4(E) - E;
  const roll = (from, step, v0 = 0.5) => { for (let s = from; s < end - 1e-9; s += step) put(sn, s, step * 0.8, pS, v0 + (1 - v0) * (s - from) / Math.max(1, end - from)); };
  const hats = step => { for (let s = 0; s < end - 1e-9; s += step) put(hat, s, 0.15, pH, 0.3 + 0.35 * s / len); };
  if (kind === "wubtease") {   // корень на синте дропа: четверти → восьмые → шестнадцатые
    for (let s = 0; s < end - 1e-9;) { const q = s / len, st = q < 0.5 ? 1 : q < 0.8 ? 0.5 : 0.25; if (syn) put(syn, s, st * 0.6, root, 0.45 + q * 0.5); s += st; }
    roll(Math.max(0, len - A.bar), 0.25, 0.6); hats(0.5);
  } else if (kind === "riff") {   // рифф дропа звучит заранее, малый ускоряется
    if (syn && A.wub) for (let k = 0; k < len; k += A.L) for (const n of A.wub.notes) if (k + n.s < end) put(syn, k + n.s, Math.min(n.l, end - k - n.s), n.n, 0.5 + 0.4 * (k + n.s) / len);
    roll(0, 1, 0.35); roll(len / 2, 0.5, 0.55); roll(len * 0.8, 0.25, 0.75);
    for (let s = 0; s < end; s += A.bar) put(kick, s, 0.25, pK, 0.8);
  } else if (kind === "siren") {   // длинные ноты синта поднимаются тоном каждый такт, со скольжением
    let k = 0;
    if (syn) for (let s = 0; s < end - 1e-9; s += A.bar, k++) put(syn, s, Math.min(A.bar, end - s) * 0.97, root + k * Math.round(2 * E / 12), 0.55 + 0.4 * s / len, Math.round(2 * E / 12));
    roll(Math.max(0, len - 2 * A.bar), 0.25, 0.5); hats(1);
  } else if (kind === "stop") {   // halftime, а за 2 такта до дропа — пауза: только райзер и тарелка задом наперёд
    const stop = Math.max(A.bar, len - 2 * A.bar);
    for (let s = 0; s < stop - 1e-9; s += A.bar) { put(kick, s, 0.25, pK, 0.85); put(sn, s + A.bar / 2, 0.25, pS, 0.8); }
    for (let s = 0; s < stop - 1e-9; s += 0.5) put(hat, s, 0.15, pH, 0.35);
    const rc = ensureDrum("revcrash"), l = Math.min(4, len - stop);
    put(rc, len - l, l, Engine.defaultPitch(rc), 0.85);
  } else if (kind === "triplet") {   // триоли малого, в последнем такте — шестые, томы вниз на последней доле
    roll(0, 2 / 3, 0.35); roll(Math.max(0, len - A.bar), 1 / 3, 0.65);
    const tom = A.drums.tom || ensureDrum("tom"), tp = Engine.defaultPitch(tom);
    [0, 0.25, 0.5].forEach((d, i) => put(tom, end - 0.75 + d, 0.22, tp - i * 3, 0.7 + i * 0.1));
    for (let s = 0; s < end; s += 1) put(kick, s, 0.25, pK, 0.7 + 0.3 * s / len);
  }
  return notes;
}

export const SECTIONS = {
  intro: "Интро (пэд + хэты, потом бочка)",
  build: "Нарастание перед каждым дропом",
  drop: "Дропы (с вариациями и брейками)",
  break: "Брейк между дропами",
  outro: "Аутро (хэты и пэд затихают)",
};
export const LEVELS = {
  drama: ["Драматичность", "саб, «удары», медленные вубы, напряжение к поздним дропам"],
  remake: ["Переделывание", "насколько вариации и новые синты отличаются от исходника"],
  cool: ["Крутость", "металл, модуляция, резонанс"],
  melody: ["Мелодичность", "пэды, арпеджио, мелодические слои"],
  suspense: ["Саспенс", "длина и автоматизация нарастаний"],
  holes: ["Брейки и дыры", "как часто брейки и выпадения — чем больше, тем «дырявее» трек"],
};
export function compose(opt) {
  const base = basePattern(opt.basis, opt.regionBars);
  const A = analyze(base), P = Engine.project, prevCur = P.cur, said = [], lv = { drama: 0.5, remake: 0.5, cool: 0.5, melody: 0.5, suspense: 0.5, holes: 0.4, ...(opt.levels || {}) };
  const U = A.L, size = opt.size || 8, S = opt.sections, drops = S.drop ? Math.max(1, opt.drops || 2) : 0;
  if (opt.mode === "replace") P.playlist = [];
  let at = opt.mode === "replace" ? 0 : Math.ceil((Engine.songLength() || 0) / A.bar) * A.bar;
  const clip = (p, t, s, l) => P.playlist.push({ id: "c" + Math.random().toString(36).slice(2, 8), p: p.id, t, s, l: l ?? Engine.patLength(p.id) });
  const T = { pad: 0, hats: 1, fx: 2, main: 3, mel: 4 };
  const cache = {}, once = (k, f) => cache[k] ||= f(), units = n => n * U;
  if (opt.basis !== "pattern") said.push(`основа — «${A.pat.name}» (${opt.basis === "region" ? "участок от маркера ▼" : "самый частый паттерн трека"})`);

  const used = {};
  const padPat = () => once("pad", () => { const ch = used.pad = ensurePad(A, said); said.push("пэд по басовой линии: аккорды из нот баса в каждом такте"); return mkPat("✨ Pad", A, U, { [ch.id]: padNotes(A, ch, U) }, "#c3a6ff"); });
  const arpCh = () => once("arpch", () => findOrPreset(/pluck|арп/i, "Neon Pluck", "Arp ✨", A, 0.4).ch);
  const arpPat = () => once("arp", () => { const ch = arpCh(); said.push("арпеджио по аккордам пэда (мелодичность)"); return mkPat("✨ Arp", A, U, { [ch.id]: arpNotes(A, ch, U, lv.melody) }, "#ffd59e"); });
  const hatsPat = () => once("hats", () => mkPat("✨ Hats", A, U, only(A, ch => ["hat", "ohat", "perc"].includes(roleOf(ch))), "#b8f59e"));
  const introKick = () => once("introk", () => mkPat("✨ Intro + kick", A, U, only(A, ch => isDrum(ch) && !["snare", "clap"].includes(roleOf(ch))), "#9fd3ff"));
  const impact = () => once("impact", () => { said.push("«удар» на первой доле дропа"); return mkPat("✨ Impact", A, 1, impactNotes(A), "#fff09e"); });
  const subCh = () => once("subch", () => { said.push("саб-бас на 1–2 октавы ниже по корню такта"); return findOrPreset(/sub|саб/i, "Sub Bass", "Sub ✨", A, 0.75).ch; });
  const breakPat = () => once("break", () => {
    const notes = only(A, ch => ["hat", "ohat"].includes(roleOf(ch)));
    if (A.bass) notes[A.bass.ch.id] = A.bass.notes.filter((n, i, L) => i === 0 || Math.floor(n.s / A.bar) !== Math.floor(L[i - 1].s / A.bar)).map(n => ({ ...n, l: Math.max(n.l, A.bar * 0.75) }));
    return mkPat("✨ Break", A, U, notes, "#ffd59e");
  });
  // синт каждого дропа: первый — исходный вуб, дальше — изменённые клоны (сила — «переделывание», «крутость»)
  // v — смена синта внутри дропа (каждые 2–4 паттерна); у каждого дропа и каждой смены — свой звук из семейства
  const dropSynth = (d, v = 0) => once("syn" + d + "_" + v, () => {
    if (!A.wub || (d === 0 && v === 0)) return A.wub?.ch || null;   // каждый следующий дроп — со своим синтом, даже при малом «переделывании»
    const c = cloneWub(Engine, A.wub.ch, `Wub D${d + 1}${v ? "." + (v + 1) : ""} ✨`), got = [];
    // по отзывам: основа — семейство Metal Crush (бас + нарастающий металл); чем дальше дроп и выше «крутость», тем злее
    const fam = c.type === "osc3" ? METAL_OSC3 : RIDDIM_GF, k = Math.min(fam.length - 1, Math.floor((d / Math.max(1, drops - 1)) * 0.5 * fam.length + rnd() * fam.length * 0.5 * (0.5 + lv.cool)));
    let pr = fam[Math.max(1, k)] || fam[1];
    if (v) { const prev = dropSynth(d, 0)?.preset; for (let i = 0; i < 6 && pr === prev; i++) pr = fam[Math.floor(rnd() * fam.length)]; }
    applyPreset(Engine, c, pr); got.push(`звук «${c.preset}»`);
    if (rnd() < lv.drama * 0.4) enhance(Engine, c, "revatt", got);
    c.params.fit = true;
    said.push(`дроп ${d + 1}${v ? ` (смена ${v + 1})` : ""} — синт «${c.name}»: ` + got.map(s => s.split(":")[0]).join(", "));
    return c;
  });
  // паттерны дропа d: основа (вуб на синте дропа, саб на поздних), вариация, медленный вуб, дыры, брейки
  const dropPats = (d, v = 0) => once("dp" + d + "_" + v, () => {
    const syn = dropSynth(d, v), Ad = syn && A.wub ? { ...A, wub: { ...A.wub, ch: syn } } : A;
    let baseN = syn && A.wub && syn !== A.wub.ch ? moveNotes(A, A.pat.notes, syn) : clone(A.pat.notes);
    const deep = lv.drama * (d + 1) / Math.max(1, drops) > 0.45 && d > 0;
    if (deep) baseN = withSub(A, baseN, subCh());
    const tag = (drops > 1 ? ` D${d + 1}` : "") + (v ? `.${v + 1}` : ""), out = { base: mkPat(`✨ Drop${tag}`, A, U, baseN, PASTEL[(d * 2) % PASTEL.length]) };
    const vn = clone(baseN), kick = A.drums.kick;
    if (kick) { const p = Engine.defaultPitch(kick); (vn[kick.id] ||= []).push(N(0.75, 0.2, p, 0.6)); }
    if (A.bass && vn[A.bass.ch.id]?.length > 2 && rnd() < 0.5 + lv.remake / 2) { const n = pick(vn[A.bass.ch.id].slice(1, -1)); n.n += A.bass.ch.edo || 12; }
    out.var = mkPat(`✨ Drop${tag} var`, A, U, vn, "#8fe8cf");
    if (A.wub && opt.slow !== false && rnd() < 0.3 + lv.drama * 0.7) {
      out.slow = mkPat(`✨ Drop${tag} slow`, A, U, slowNotes(Ad, baseN), "#c3a6ff");
      said.push("удлинённые вубы: соседние ноты сливаются («1-2» вместе, весь такт, пары) прямо на том же синте, атака растягивается во столько же раз");
    }
    out.holes = mkPat(`✨ Drop${tag} holes`, A, U, holesNotes(A, baseN, Math.max(0.3, lv.holes), syn?.id || A.wub?.ch.id), "#ffb3b3");
    out.fills = Object.keys(FILLS).map(k => mkPat(`✨ Drop${tag} · ${FILLS[k]}`, A, U, fillNotes(Ad, k, baseN), "#fff09e"));
    return out;
  });
  // нарастание перед дропом d: длина — от саспенса, тизер синта дропа
  const buildLen = Math.max(A.bar, Math.round((8 + 24 * lv.suspense) / A.bar) * A.bar);
  const sweeps = [];
  const doBuild = d => {
    const syn = dropSynth(d), teaser = syn && A.wub && syn !== A.wub.ch ? syn : null;
    let kind = opt.build || "auto";
    if (kind === "auto") kind = teaser || A.wub ? pick(["wubtease", "riff", "siren", "roll", "stop"]) : pick(["roll", "triplet", "stop"]);
    if (kind === "random") kind = pick(Object.keys(BUILDS).slice(2));
    said.push(`нарастание ${d + 1}: ${BUILDS[kind]}`);
    const riser = opt.riser !== false ? (used.riser = ensureRiser(A)) : null, notes = buildVariant(kind, A, buildLen, lv.suspense, teaser);
    if (riser) notes[riser.id] = [N(0, buildLen - 0.5, c4(riser.edo || 12), 0.8)];
    const p = mkPat(`✨ Build ${d + 1}`, A, buildLen, notes, "#ffb3b3");
    if (opt.pad !== false) for (let s = 0; s < buildLen; s += U) clip(padPat(), T.pad, at + s);
    clip(p, T.fx, at);
    sweeps.push([at, at + buildLen - 0.5, teaser]);
    at += buildLen;
  };
  const doDrop = (d, n) => {
    // синт сменяется по ходу дропа: сколько звуков — от «переделывания», менять — на границе фразы
    const nv = Math.max(1, Math.min(3, 1 + Math.round(lv.remake * 2.4))), every = n >= 8 ? 4 : 2;
    const dp0 = dropPats(d), pFill = 0.08 + lv.holes * 0.5, pHole = lv.holes * 0.35;
    for (let k = 0; k < n; k++) {
      let p;
      const dp = nv > 1 ? dropPats(d, Math.floor(k / every) % nv) : dp0;
      const phraseEnd = k % 4 === 3, r = rnd();
      if ((phraseEnd && opt.fills !== false) || r < pFill * (d + 1) / Math.max(1, drops)) p = pick(dp.fills);
      else if (rnd() < pHole) p = dp.holes;
      else if (dp.slow && rnd() < 0.15 + lv.drama * 0.25) p = dp.slow;
      else p = rnd() < 0.25 + lv.remake * 0.5 ? dp.var : dp.base;
      clip(p, T.main, at + units(k));
      if (lv.melody > 0.4 && (d > 0 || lv.melody > 0.75) && k % 2 === 0) clip(arpPat(), T.mel, at + units(k));
    }
    if (opt.impact !== false && rnd() < 0.5 + lv.drama) clip(impact(), T.fx, at);
    at += units(n);
  };
  const introEnv = [];
  if (S.intro) {
    const n = Math.max(2, Math.round(size / 2)), pad = opt.pad !== false;
    let kind = opt.intro || "auto";
    const riddimy = A.wub && (A.style === "riddim" || A.wub.rel < 0);
    if (kind === "auto") kind = riddimy ? pick(["filtered", "drums", "dark", "padhats"]) : lv.melody > 0.5 ? pick(["arp", "padhats", "atmos"]) : pick(["padhats", "atmos", "drums"]);
    if (kind === "random") kind = pick(Object.keys(INTROS).slice(2));
    if ((kind === "filtered" || kind === "dark") && !A.wub) kind = "padhats";
    said.push(`интро: ${INTROS[kind]}`);
    const riffPat = () => once("introriff", () => mkPat("✨ Intro riff", A, U, { [A.wub.ch.id]: A.wub.notes.map(x => ({ ...x, v: +(x.v * 0.8).toFixed(3) })) }, "#9fd3ff"));
    const darkPat = () => once("introdark", () => {
      const sub = subCh(), sn = A.drums.snare || ensureDrum("snare"), kick = A.drums.kick || ensureDrum("kick"), E = sub.edo || 12, low = c4(E) - 2 * E;
      let r = A.wub.notes[0].n; while (r >= low) r -= E;
      const nt = { [sub.id]: [], [sn.id]: [], [kick.id]: [] };
      for (let s = 0; s < U - 1e-9; s += A.bar) { nt[sub.id].push(N(s, A.bar * 0.95, r, 0.8)); nt[sn.id].push(N(s + A.bar / 2, 0.25, Engine.defaultPitch(sn), 0.55)); }
      nt[kick.id].push(N(0, 0.25, Engine.defaultPitch(kick), 0.8));
      return mkPat("✨ Intro dark", A, U, nt, "#c3a6ff");
    });
    const atmosEnd = () => once("introatm", () => { const rc = ensureDrum("revcrash"), l = Math.min(4, U); return mkPat("✨ Intro swell", A, U, { [rc.id]: [N(U - l, l, Engine.defaultPitch(rc), 0.8)] }, "#ffd59e"); });
    for (let k = 0; k < n; k++) {
      const late = k >= n / 2, x = at + units(k);
      if (kind === "padhats") { if (pad) clip(padPat(), T.pad, x); clip(late ? introKick() : hatsPat(), T.hats, x); if (late && lv.melody > 0.6) clip(arpPat(), T.mel, x); }
      else if (kind === "filtered") { if (pad) clip(padPat(), T.pad, x); clip(riffPat(), T.main, x); if (late) clip(hatsPat(), T.hats, x); }
      else if (kind === "arp") { if (pad) clip(padPat(), T.pad, x); clip(arpPat(), T.mel, x); if (late) clip(introKick(), T.hats, x); }
      else if (kind === "atmos") { clip(padPat(), T.pad, x); if (k >= n * 0.75) clip(hatsPat(), T.hats, x); if (k === n - 1) clip(atmosEnd(), T.fx, x); }
      else if (kind === "drums") { clip(introKick(), T.hats, x); if (late && pad) clip(padPat(), T.pad, x); }
      else if (kind === "dark") { clip(darkPat(), T.main, x); if (late) { clip(hatsPat(), T.hats, x); if (pad) clip(padPat(), T.pad, x); } }
    }
    if (kind === "filtered") introEnv.push([at, at + units(n), A.wub.ch]);   // фильтр риффа открывается за всё интро
    at += units(n);
  }
  const dropAt = [];
  for (let d = 0; d < drops; d++) try {
    if (S.build) doBuild(d);
    else if (d > 0 && !S.break) { const f = dropPats(d - 1).fills[0]; clip(f, T.main, at); at += units(1); }   // без нарастаний и брейков — хотя бы брейк на стыке
    dropAt.push(at);
    doDrop(d, d === drops - 1 && lv.drama > 0.6 ? size + 4 : size);
    if (S.break && d < drops - 1) {
      const n = Math.max(2, Math.round(size / 2 * (0.6 + lv.melody * 0.8)));
      for (let k = 0; k < n; k++) { if (opt.pad !== false) clip(padPat(), T.pad, at + units(k)); clip(breakPat(), T.main, at + units(k)); if (lv.melody > 0.3) clip(arpPat(), T.mel, at + units(k)); }
      at += units(n);
    }
  } catch (e) {   // один дроп не собрался — остальные всё равно собираем, а причину пишем в отчёт
    console.error("magic drop", d + 1, e);
    said.push(`⚠ дроп ${d + 1} не собрался: ${e.message}`);
  }
  if (S.outro) {
    const n = Math.max(2, Math.round(size / 2));
    for (let k = 0; k < n; k++) { if (opt.pad !== false) clip(padPat(), T.pad, at + units(k)); if (k < n - 1) clip(hatsPat(), T.hats, at + units(k)); }
    at += units(n);
  }
  if (dropAt.length) said.unshift(`дропов: ${dropAt.length} — начинаются с тактов ` + dropAt.map(s => Math.floor(s / 4) + 1).join(", "));   // такты линейки плейлиста (4/4)
  // автоматизация нарастаний: одна огибающая по всей песне — 0 вне нарастаний, рост внутри, обрыв на дропе
  if (sweeps.length) {
    const pts = [[0, 0]];
    for (const [a, b] of sweeps) pts.push([a, 0], [a + (b - a) * (0.3 * (1 - lv.suspense)), 0.1], [b, 1], [b + 0.01, 0]);
    pts.push([at, 0]);
    const wires = [];
    const pad = used.pad, riser = used.riser;
    if (pad) wires.push({ to: `ch.${pad.id}.cut`, amt: 0.25 });
    if (riser) wires.push({ to: `ch.${riser.id}.cut`, amt: 0.45 });
    for (const [, , teaser] of sweeps) if (teaser && !wires.some(w => w.to.startsWith(`ch.${teaser.id}.`))) wires.push({ to: `ch.${teaser.id}.cut`, amt: 0.35 });
    if (lv.suspense > 0.5) wires.push({ to: "win.*.shake", amt: 0.04 + 0.06 * lv.suspense });
    P.mods = (P.mods || []).filter(m => m.name !== "✨ Build sweep");
    P.mods.push({ id: "mbuild" + Math.random().toString(36).slice(2, 5), type: "env", name: "✨ Build sweep", color: "#ffb3b3", value: 0,
      env: { len: Math.max(at, 4), loop: false, pts }, lfo: { sync: 3, shape: "sine", phase: 0 }, trig: {}, meter: {}, wind: {}, wires });
    said.push(`нарастания по ${buildLen / A.bar} такт(а): автоматизация открывает фильтры пэда, райзера` + (sweeps.some(s => s[2]) ? " и нового синта следующего дропа (тизер)" : "") + (lv.suspense > 0.5 ? ", окна подрагивают" : ""));
  }
  if (introEnv.length) P.mods ||= [];
  for (const [a, b, ch] of introEnv) {
    const cut = ch.params.cut ?? 9000, amt = -Math.min(0.9, (cut - 120) / (18000 - 40));
    P.mods.push({ id: "mintro" + Math.random().toString(36).slice(2, 5), type: "env", name: "✨ Intro filter", color: "#9fd3ff", value: 0,
      env: { len: b + 0.01, loop: false, pts: [[0, 0], [Math.max(0, a - 0.001), 0], [a, 1], [a + (b - a) * 0.6, 0.55], [b - 0.01, 0], [b, 0]] }, lfo: { sync: 3, shape: "sine", phase: 0 }, trig: {}, meter: {}, wind: {},
      wires: [{ to: `ch.${ch.id}.cut`, amt: +amt.toFixed(3) }] });
    said.push("интро: фильтр риффа медленно открывается");
  }
  P.tracks = Math.max(P.tracks || 16, 6);
  Engine.selectPattern(prevCur);
  Engine.setMode("song");
  Engine.touch({ playlist: true, patterns: true, channels: true, mixer: true, mods: true });
  return { said: [...new Set(said)], A, bars: at / A.bar };
}

/* брейки и дыры в готовом плейлисте: весь трек или участок от маркера ▼; плотность 0..1 */
export function addBreaks(scope = "all", density = 0.4, bars = 8) {
  const P = Engine.project, prev = P.cur, from = scope === "region" ? P.songStart || 0 : 0, to = scope === "region" ? from + bars * 4 : Infinity;
  const made = {}, variant = (pid, kind) => {
    const key = pid + "|" + kind;
    if (made[key]) return made[key];
    const A = analyze(pid);
    const notes = kind === "holes" ? holesNotes(A, A.pat.notes, density, A.wub?.ch.id) : fillNotes(A, kind);
    return made[key] = mkPat(`✨ ${A.pat.name} · ${kind === "holes" ? "дыры" : FILLS[kind]}`, A, A.L, notes, "#fff09e");
  };
  let n = 0;
  for (const c of P.playlist) {
    if (c.s < from || c.s >= to) continue;
    const pat = Engine.pat(c.p);
    if (!pat || /^✨ (Fill|Build|Impact|Pad|Hats|Arp)/.test(pat.name) || / · /.test(pat.name)) continue;
    if (!Object.entries(pat.notes).some(([id, L]) => L.length && isDrum(Engine.chan(id)))) continue;
    if (rnd() > density) continue;
    const kind = rnd() < density * 0.5 ? "holes" : pick(Object.keys(FILLS));
    const v = variant(c.p, kind); c.p = v.id; c.l = Engine.patLength(v.id); n++;
  }
  Engine.selectPattern(prev);
  Engine.touch({ playlist: true, patterns: true });
  return n;
}

/* брейки по плейлисту: каждый 4-й клип этого паттерна → вариант брейка */
export function fillsInPlaylist(patId = Engine.project.cur) {
  const A = analyze(patId), P = Engine.project, prev = P.cur;
  const F = Object.keys(FILLS).map(k => mkPat("✨ Fill · " + FILLS[k], A, A.L, fillNotes(A, k), "#fff09e"));
  const clips = P.playlist.filter(c => c.p === patId).sort((a, b) => a.s - b.s);
  let n = 0;
  clips.forEach((c, i) => { if (i % 4 === 3) { c.p = F[n++ % F.length].id; c.l = A.L; } });
  Engine.selectPattern(prev);
  Engine.touch({ playlist: true, patterns: true });
  return { made: F.length, placed: n };
}

/* готовые наборы настроек «Достроить»; свои — в UserLib (magic) */
const ALL = { intro: true, build: true, drop: true, break: true, outro: true };
const LV = (drama, remake, cool, melody, suspense, holes) => ({ drama, remake, cool, melody, suspense, holes });
export const MAGIC_PRESETS = {
  "Стандарт": { sections: ALL, size: 8, drops: 2, levels: LV(0.5, 0.5, 0.5, 0.5, 0.5, 0.4) },
  "Короткий (интро → дроп → аутро)": { sections: { intro: true, build: true, drop: true, outro: true }, size: 4, drops: 1, levels: LV(0.4, 0.3, 0.5, 0.3, 0.3, 0.3) },
  "Длинный клубный": { sections: ALL, size: 16, drops: 3, levels: LV(0.7, 0.6, 0.6, 0.5, 0.8, 0.4) },
  "Жёсткий риддим": { sections: ALL, size: 8, drops: 2, levels: LV(0.9, 0.8, 0.95, 0.15, 0.6, 0.7) },
  "Мелодичный": { sections: ALL, size: 8, drops: 2, levels: LV(0.4, 0.4, 0.3, 0.95, 0.6, 0.2) },
  "Долгий саспенс": { sections: ALL, size: 8, drops: 2, levels: LV(0.6, 0.5, 0.5, 0.5, 1, 0.3) },
};
const MAGIC_KEYS = ["intro", "build", "sections", "size", "drops", "mode", "basis", "regionBars", "levels", "pad", "riser", "impact", "fills", "slow", "style"];

/* ======================= окно «Магия» ======================= */
export const MAGIC = {
  title: () => "Магия",
  icon: "✨", color: "#ffd59e",
  size: () => [560, 640, Math.max(12, innerWidth - 600), 120],
  render(c) {
    const root = shell(c, "dw-magic", "#ffd59e");
    const body = el("div", { className: "dw-magic-body" });
    root.append(body);
    const opt = { sections: { ...ALL }, size: 8, drops: 2, mode: "append", basis: "pattern", regionBars: 8, levels: LV(0.5, 0.5, 0.5, 0.5, 0.5, 0.4),
      pad: true, riser: true, impact: true, fills: true, slow: true, style: "auto", brScope: "all", brDensity: 0.4 };
    const slider = (obj, k, label, hint, fmt = v => Math.round(v * 100) + "%") => {
      const val = el("span", { className: "dw-dim no-i18n", textContent: fmt(obj[k]) });
      const r = el("input", { type: "range", min: 0, max: 1, step: 0.05, value: obj[k], title: hint, oninput: () => { obj[k] = +r.value; val.textContent = fmt(obj[k]); } });
      return el("label", { className: "dw-magic-lv", title: hint }, el("span", { textContent: label }), r, val);
    };
    let report = null, preset = null;
    function build() {
      const A = analyze(), P = Engine.project;
      const keyName = `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][A.key.E === 12 ? A.key.root : 0] || ""}${A.key.E !== 12 ? A.key.root + "/" + A.key.E + "-EDO" : ""} ${A.key.mode}`;
      const chk = (obj, k, label) => { const i = el("input", { type: "checkbox", checked: obj[k], onchange: () => { obj[k] = i.checked; } }); return el("label", { className: "dw-magic-chk" }, i, el("span", { textContent: label })); };
      body.replaceChildren(
        el("div", { className: "dw-magic-card" },
          el("h4", { textContent: "🔍 Что я вижу в паттерне «" + A.pat.name + "»" }),
          el("div", { className: "dw-dim no-i18n", textContent: `${A.sig[0]}/${A.sig[1]} · ${A.L} долей · ${A.bpm} BPM · ${keyName}` }),
          el("div", { className: "dw-dim" }, "Стиль: ", el("b", { textContent: STYLES[A.style] })),
          el("div", { className: "dw-dim no-i18n", textContent: "🥁 " + (Object.keys(A.drums).join(", ") || "—") + " · 🎹 " + (A.synths.map(s => s.ch.name + (s === A.bass ? " (бас)" : "")).join(", ") || "—") })),
        el("div", { className: "dw-magic-card" },
          el("h4", { textContent: "🎼 Достроить композицию" }),
          el("div", { className: "dw-dim", textContent: "Каждый запуск — новый вариант: структура, синты дропов и брейки зависят от ползунков и случая." }),
          el("div", { className: "dw-pr-tools" },
            select([["pattern", "Основа: текущий паттерн"], ["track", "Основа: весь трек (самый частый паттерн)"], ["region", "Основа: участок от маркера ▼"]], opt.basis, v => { opt.basis = v; build(); }, "Что взять за основу"),
            opt.basis === "region" ? el("label", { className: "dw-dim" }, el("input", { className: "dw-num", type: "number", min: 1, max: 64, value: opt.regionBars, onchange: e => { opt.regionBars = Math.max(1, +e.target.value || 8); } }), " тактов") : ""),
          el("div", { className: "dw-pr-tools" },
            select([["", "Пресет…"], ...UserLib.names("magic").map(n => ["★ " + n, "★ " + n]), ...Object.keys(MAGIC_PRESETS).map(n => [n, n])], "", v => {
              if (!v) return;
              const src = v.startsWith("★ ") ? UserLib.get("magic", v.slice(2)) : MAGIC_PRESETS[v];
              if (src) { Object.assign(opt, JSON.parse(JSON.stringify(src))); preset = v; build(); }
            }, "Набор настроек"),
            preset ? el("span", { className: "dw-dim no-i18n", textContent: preset }) : "",
            dwBtn("⭐", () => { const n = prompt("Имя своего набора настроек:", preset?.replace(/^★ /, "") || ""); const s = n && UserLib.put("magic", n, Object.fromEntries(MAGIC_KEYS.map(k => [k, opt[k]]))); if (s) { preset = "★ " + s; build(); } }, { title: "Сохранить эти настройки как свой пресет" }),
            preset?.startsWith("★ ") ? dwBtn("🗑", () => { if (UserLib.del("magic", preset.slice(2))) { preset = null; build(); } }, { title: "Удалить свой пресет", className: "dw-btn dw-x" }) : ""),
          el("div", { className: "dw-magic-lvs" }, ...Object.entries(LEVELS).map(([k, [l, h]]) => slider(opt.levels, k, l, h))),
          el("div", { className: "dw-magic-grid" }, ...Object.entries(SECTIONS).map(([k, l]) => el("div", { className: "dw-magic-sec" }, chk(opt.sections, k, l),
            dwBtn("＋", () => run({ ...opt, sections: { [k]: true }, drops: k === "drop" ? 1 : opt.drops, mode: "append" }), { title: "Добавить только эту часть в конец плейлиста" })))),
          el("div", { className: "dw-magic-grid" }, chk(opt, "pad", "Пэд по басу (+ сайдчейн от бочки)"), chk(opt, "riser", "Райзер в нарастании"),
            chk(opt, "impact", "«Удар» в начале дропа"), chk(opt, "fills", "Брейк в конце каждой фразы"), chk(opt, "slow", "Медленные вубы")),
          el("div", { className: "dw-pr-tools" },
            select(Object.entries(INTROS), opt.intro || "auto", v => { opt.intro = v; }, "Какое интро"),
            select(Object.entries(BUILDS), opt.build || "auto", v => { opt.build = v; }, "Какие нарастания (у каждого дропа — своё, если «под синт» или «случайное»)")),
          el("div", { className: "dw-pr-tools" },
            select([[1, "1 дроп"], [2, "2 дропа"], [3, "3 дропа"]], opt.drops, v => { opt.drops = +v; }, "Сколько дропов"),
            select([[4, "Дропы: 4 паттерна"], [8, "Дропы: 8 паттернов"], [16, "Дропы: 16 паттернов"]], opt.size, v => { opt.size = +v; }, "Длина дропов"),
            select([["append", "В конец плейлиста"], ["replace", "Заменить плейлист"]], opt.mode, v => { opt.mode = v; }, "Куда"),
            dwBtn("✨ Достроить", () => run(opt), { className: "dw-btn on" }),
            dwBtn("🎲", () => { seed = Math.floor(Math.random() * 1e6); notify("🎲 Новое зерно — следующий вариант будет другим"); }, { title: "Другой случайный вариант" }))),
        el("div", { className: "dw-magic-card" },
          el("h4", { textContent: "🚀 Продюсер — одной кнопкой" }),
          el("div", { className: "dw-dim", textContent: "Нарисуй пару нот синтом и нажми: под них лягут ударные (если их нет), саб-бас, жир на ударные, автоматизация и два паттерна с соседним синтом — перекличка и переход." }),
          el("div", { className: "dw-pr-tools" },
            dwBtn("🚀 Всё сразу", () => { const s = produceAll(); notify("🚀 " + s.join(" · "), 7000); report = s; build(); }, { className: "dw-btn on" }),
            dwBtn("🔊 Саб", () => { const m = analyze().wub?.ch; if (!m) return notify("Нет синта в паттерне"); report = addSub(m); notify("🔊 " + report.join(" · "), 5000); build(); }, { title: "Саб-бас под главный синт паттерна" }),
            dwBtn("🔀 Сосед", () => { const m = analyze().wub?.ch; if (!m) return notify("Нет синта в паттерне"); report = neighbour(m); notify("🔀 " + report.join(" · "), 5000); build(); }, { title: "Второй синт: перекличка и переход" }),
            dwBtn("🍖 Жир на ударные", () => { const s = []; for (const ch of Engine.project.channels) if (roleOf(ch) && Engine.pat().notes[ch.id]?.length) fatten(ch, s); report = s.length ? s : ["в паттерне нет ударных"]; notify("🍖 " + report.join(" · "), 6000); build(); }, { title: "Бочке, малому и хэтам — EQ, сатурация, компрессор, ревер/эхо" }))),
        el("div", { className: "dw-magic-card" },
          el("h4", { textContent: "🥁 Ударные" }),
          el("div", { className: "dw-dim", textContent: "Драм-партия в размере паттерна: заменяет ударные, синты остаются. Потом — брейки." }),
          el("div", { className: "dw-pr-tools" },
            select(Object.entries(STYLES), opt.style, v => { opt.style = v; }, "Стиль"),
            dwBtn("🥁 Сделать ударные", () => { const s = drumsForStyle(opt.style); notify("🥁 Ударные: " + s); build(); }),
            dwBtn("🎲", () => { seed = Math.floor(Math.random() * 1e6); const s = drumsForStyle(opt.style); notify("🥁 Ещё вариант: " + s); build(); }, { title: "Другой вариант" })),
          el("div", { className: "dw-pr-tools" },
            select([["all", "Брейки: весь трек"], ["region", "Брейки: участок от маркера ▼"]], opt.brScope, v => { opt.brScope = v; }, "Где добавлять брейки"),
            slider(opt, "brDensity", "Плотность", "Чем больше — тем чаще брейки и выпадения: трек «дырявее»"),
            dwBtn("💥 Добавить брейки", () => { const n = addBreaks(opt.brScope, opt.brDensity, opt.regionBars); notify(n ? `💥 Брейков и дыр: ${n}` : "💥 Подходящих клипов не нашлось"); }, { title: "Клипы с ударными заменяются брейками и «дырами» с выбранной плотностью" })),
          el("div", { className: "dw-pr-tools" },
            ...Object.entries(FILLS).map(([k, l]) => dwBtn("＋ " + l, () => { const A2 = analyze(), prev = P.cur; const p = mkPat("✨ Fill · " + l, A2, A2.L, fillNotes(A2, k), "#fff09e"); Engine.selectPattern(prev); Engine.touch({ patterns: true }); notify("Паттерн «" + p.name + "» добавлен"); }, { title: "Брейк паттерном (концовка текущего)" })))),
        report ? el("div", { className: "dw-magic-card dw-magic-report" }, el("h4", { textContent: "✅ Готово — что я добавил" }), el("ul", {}, ...report.map(s => el("li", { textContent: s })))) : "");
    }
    function run(o) {
      if (!Object.values(o.sections).some(Boolean)) return notify("Выбери хотя бы одну часть");
      seed = (seed * 7919 + Date.now()) % 1e9;   // каждый запуск — свой вариант
      const r = compose(o);
      report = [`${Math.round(r.bars)} тактов в плейлисте`, ...r.said];
      notify("✨ Композиция достроена — смотри плейлист");
      build();
    }
    build();
    return Engine.on("change", w => { if (w?.all || w?.pattern || w?.channels) build(); });
  },
};
