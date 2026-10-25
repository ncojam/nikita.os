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
function slowNotes(A, notes, slowCh) {
  const out = clone(notes), id = A.wub.ch.id, src = (out[id] || []).sort((a, b) => a.s - b.s), nb = Math.max(1, Math.round(A.L / A.bar));
  const slowBars = new Set(nb === 1 ? [0] : [...Array(nb).keys()].filter(b => b % 2 === 1));
  out[slowCh.id] = [];
  out[id] = src.filter(n => !slowBars.has(Math.floor(n.s / A.bar + 1e-6)));
  for (const b of slowBars) {
    const inBar = src.filter(n => Math.floor(n.s / A.bar + 1e-6) === b);
    if (!inBar.length) continue;
    const parts = rnd() < 0.5 ? 1 : 2, seg = A.bar / parts;
    for (let k = 0; k < parts; k++) {
      const first = inBar.find(n => n.s >= b * A.bar + k * seg - 1e-6) || inBar[0];
      out[slowCh.id].push(N(b * A.bar + k * seg, seg * 0.98, first.n, Math.min(1, first.v + 0.1)));
    }
  }
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
export const SECTIONS = {
  intro: "Интро (пэд + хэты, потом бочка)",
  build: "Нарастание (ролл, райзер, тишина перед дропом)",
  drop: "Дроп (твой паттерн + вариации и брейки)",
  break: "Брейк (пэд, редкий бас, без бочки)",
  build2: "Второе нарастание",
  drop2: "Дроп B (вариация с октавой и брейками)",
  outro: "Аутро (хэты и пэд затихают)",
};
export function compose(opt) {
  const A = analyze(opt.from), P = Engine.project, prevCur = P.cur, said = [];
  const U = A.L, size = opt.size || 8;
  if (opt.mode === "replace") P.playlist = [];
  let at = opt.mode === "replace" ? 0 : Math.ceil((Engine.songLength() || 0) / A.bar) * A.bar;
  const clip = (p, t, s, l) => P.playlist.push({ id: "c" + Math.random().toString(36).slice(2, 8), p: p.id, t, s, l: l ?? Engine.patLength(p.id) });
  const T = { main: 3, pad: 0, hats: 1, fx: 2 };
  const cache = {};
  const once = (k, f) => cache[k] ||= f();
  // общие куски (создаются по требованию)
  const padPat = () => once("pad", () => { const ch = ensurePad(A, said); said.push("пэд по басовой линии: аккорды берутся из нот баса в каждом такте"); return mkPat("✨ Pad", A, U, { [ch.id]: padNotes(A, ch, U) }, "#c3a6ff"); });
  const hatsPat = () => once("hats", () => mkPat("✨ Hats", A, U, only(A, ch => ["hat", "ohat", "perc"].includes(roleOf(ch))), "#b8f59e"));
  const introKick = () => once("introk", () => mkPat("✨ Intro + kick", A, U, only(A, ch => isDrum(ch) && !["snare", "clap"].includes(roleOf(ch))), "#9fd3ff"));
  const buildPat = () => once("build", () => {
    const len = Math.max(8, Math.ceil(8 / A.bar) * A.bar), riser = opt.riser ? ensureRiser(A) : null, notes = buildNotes(A, len);
    if (riser) notes[riser.id] = [N(0, len - 0.5, c4(riser.edo || 12), 0.8)];
    said.push("перед дропом: ролл малого 8-е → 16-е → 32-е" + (riser ? ", райзер" : "") + " и тишина за полдоли до дропа");
    return mkPat("✨ Build", A, len, notes, "#ffb3b3");
  });
  const impact = () => once("impact", () => { said.push("«удар» на первой доле дропа: бочка + открытый хэт + хлопок"); return mkPat("✨ Impact", A, 1, impactNotes(A), "#fff09e"); });
  const fills = () => once("fills", () => { said.push("брейки ударных в конце фраз: " + Object.values(FILLS).join(", ").toLowerCase()); return Object.keys(FILLS).map(k => mkPat("✨ Fill · " + FILLS[k], A, U, fillNotes(A, k), "#fff09e")); });
  const varPat = () => once("var", () => { said.push("вариация дропа: синкопа в бочке, хэты 16-ми в конце, нота баса на октаву выше"); return mkPat("✨ Drop var", A, U, variationNotes(A), "#8fe8cf"); });
  const breakPat = () => once("break", () => {
    const notes = only(A, ch => ["hat", "ohat"].includes(roleOf(ch)));
    if (A.bass) notes[A.bass.ch.id] = A.bass.notes.filter((n, i, L) => i === 0 || Math.floor(n.s / A.bar) !== Math.floor(L[i - 1].s / A.bar)).map(n => ({ ...n, l: Math.max(n.l, A.bar * 0.75) }));
    return mkPat("✨ Break", A, U, notes, "#ffd59e");
  });
  // клоны вуба и саб — создаются, только если понадобились
  const slowCh = () => once("slowch", () => {
    const c = cloneWub(Engine, A.wub.ch, "Wub slow ✨"), barSec = A.bar * 60 / A.bpm;
    Object.assign(c.params, { fit: false, att: Math.min(2, barSec * 0.3), sus: Math.max(c.params.sus ?? 0, 0.8), rel: Math.max(c.params.rel ?? 0, 0.08) });
    enhance(Engine, c, "mod");
    said.push("медленные вубы: в части тактов один вуб на такт или два на полтакта, атака длиннее, на них — своё LFO на фильтр и Tone");
    return c;
  });
  const metalCh = () => once("metalch", () => { const c = cloneWub(Engine, A.wub.ch, "Wub metal ✨"); enhance(Engine, c, "metal"); said.push("металлические вариации: вуб на клоне с металлом (crush с низким Tone, раскрывается по нотам)"); return c; });
  const subCh = () => once("subch", () => { const r = findOrPreset(/sub|саб/i, "Sub Bass", "Sub ✨", A, 0.75); said.push("второй дроп глубже: саб-бас на 1–2 октавы ниже по корню каждого такта"); return r.ch; });
  const slowPat = () => once("slow", () => mkPat("✨ Slow wub", A, U, slowNotes(A, A.pat.notes, slowCh()), "#c3a6ff"));
  const metalPat = () => once("metal", () => mkPat("✨ Metal", A, U, moveNotes(A, A.pat.notes, metalCh()), "#9fd3ff"));
  const B = () => once("B", () => {   // второй дроп: всё то же, но с сабом, металлом, медленными вубами и брейками чаще
    const sub = opt.drama ? subCh() : null, add = n => sub ? withSub(A, n, sub) : n;
    const base = add(A.pat.notes), metal = A.wub && opt.metal ? add(moveNotes(A, A.pat.notes, metalCh())) : base;
    const slow = A.wub && opt.slow ? add(slowNotes(A, A.pat.notes, slowCh())) : base;
    if (opt.drama) said.push("во втором дропе брейки чаще: каждые 2 паттерна, в том числе «заикание» по металлическому вубу");
    return { base: mkPat("✨ Drop B", A, U, base, "#ff9e7a"), metal: mkPat("✨ Drop B metal", A, U, metal, "#9fd3ff"), slow: mkPat("✨ Drop B slow", A, U, slow, "#c3a6ff"),
      var: mkPat("✨ Drop B var", A, U, add(variationNotes(A)), "#8fe8cf"), stut: mkPat("✨ Drop B stutter", A, U, fillNotes(A, "stutter", metal), "#fff09e"),
      roll: mkPat("✨ Drop B roll", A, U, fillNotes(A, "roll", base), "#fff09e"), drop: mkPat("✨ Drop B drop-out", A, U, fillNotes(A, "dropout", slow), "#fff09e") };
  });
  const S = opt.sections;
  const units = n => n * U;
  const dropRun = (n, second) => {
    const F = opt.fills ? fills() : null;
    for (let k = 0; k < n; k++) {
      let p;
      if (second) {
        const b = B(), seq = opt.drama ? [b.base, b.metal, b.slow, F ? b.roll : b.var, b.var, F ? b.stut : b.metal, b.slow, F ? b.drop : b.base]
          : [b.var, b.base, b.var, F ? F[1] : b.base];
        p = seq[k % seq.length];
      } else if (k % 4 === 3 && F) p = F[Math.floor(k / 4) % F.length];
      else if (k % 8 === 5 && A.wub && opt.slow) p = slowPat();
      else if (k % 8 === 6 && A.wub && opt.metal) p = metalPat();
      else p = k % 4 === 1 ? varPat() : A.pat;
      clip(p, T.main, at + units(k));
    }
    if (opt.impact) clip(impact(), T.fx, at);
    at += units(n);
  };
  if (S.intro) {
    const n = Math.max(2, Math.round(size / 2));
    for (let k = 0; k < n; k++) { if (opt.pad) clip(padPat(), T.pad, at + units(k)); clip(k < n / 2 ? hatsPat() : introKick(), T.hats, at + units(k)); }
    at += units(n);
  }
  if (S.build) { const b = buildPat(); if (opt.pad) for (let s = 0; s < Engine.patLength(b.id); s += U) clip(padPat(), T.pad, at + s); clip(b, T.fx, at); at += Engine.patLength(b.id); }
  if (S.drop) dropRun(size, false);
  if (S.break) {
    const n = Math.max(2, Math.round(size / 2));
    for (let k = 0; k < n; k++) { if (opt.pad) clip(padPat(), T.pad, at + units(k)); clip(breakPat(), T.main, at + units(k)); }
    at += units(n);
  }
  if (S.build2) { const b = buildPat(); clip(b, T.fx, at); if (opt.pad) for (let s = 0; s < Engine.patLength(b.id); s += U) clip(padPat(), T.pad, at + s); at += Engine.patLength(b.id); }
  if (S.drop2) dropRun(size, true);
  if (S.outro) {
    const n = Math.max(2, Math.round(size / 2));
    for (let k = 0; k < n; k++) { if (opt.pad) clip(padPat(), T.pad, at + units(k)); if (k < n - 1) clip(hatsPat(), T.hats, at + units(k)); }
    at += units(n);
  }
  P.tracks = Math.max(P.tracks || 16, 6);
  Engine.selectPattern(prevCur);
  Engine.setMode("song");
  Engine.touch({ playlist: true, patterns: true, channels: true, mixer: true });
  return { said: [...new Set(said)], A, bars: at / A.bar };
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
const ALL = { intro: true, build: true, drop: true, break: true, build2: true, drop2: true, outro: true };
export const MAGIC_PRESETS = {
  "Стандарт": { sections: ALL, size: 8, pad: true, riser: true, impact: true, fills: true, slow: true, metal: true, drama: true },
  "Короткий (интро → дроп → аутро)": { sections: { intro: true, build: true, drop: true, outro: true }, size: 4, pad: true, riser: true, impact: true, fills: true, slow: true, metal: true, drama: true },
  "Длинный клубный": { sections: ALL, size: 16, pad: true, riser: true, impact: true, fills: true, slow: true, metal: true, drama: true },
  "Без пэдов и райзеров": { sections: ALL, size: 8, pad: false, riser: false, impact: true, fills: true, slow: true, metal: true, drama: true },
};
const MAGIC_KEYS = ["sections", "size", "mode", "pad", "riser", "impact", "fills", "slow", "metal", "drama", "style"];

/* ======================= окно «Магия» ======================= */
export const MAGIC = {
  title: () => "Магия",
  icon: "✨", color: "#ffd59e",
  size: () => [560, 640, Math.max(12, innerWidth - 600), 120],
  render(c) {
    const root = shell(c, "dw-magic", "#ffd59e");
    const body = el("div", { className: "dw-magic-body" });
    root.append(body);
    const opt = { sections: { intro: true, build: true, drop: true, break: true, build2: true, drop2: true, outro: true }, size: 8, mode: "append", pad: true, riser: true, impact: true, fills: true, slow: true, metal: true, drama: true, style: "auto" };
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
          el("div", { className: "dw-dim", textContent: "Из этого паттерна — трек: части по порядку. Сними галочку, если часть уже готова." }),
          el("div", { className: "dw-pr-tools" },
            select([["", "Пресет…"], ...UserLib.names("magic").map(n => ["★ " + n, "★ " + n]), ...Object.keys(MAGIC_PRESETS).map(n => [n, n])], "", v => {
              if (!v) return;
              const src = v.startsWith("★ ") ? UserLib.get("magic", v.slice(2)) : MAGIC_PRESETS[v];
              if (src) { Object.assign(opt, JSON.parse(JSON.stringify(src))); preset = v; build(); }
            }, "Набор настроек"),
            preset ? el("span", { className: "dw-dim no-i18n", textContent: preset }) : "",
            dwBtn("⭐", () => { const n = prompt("Имя своего набора настроек:", preset?.replace(/^★ /, "") || ""); const s = n && UserLib.put("magic", n, Object.fromEntries(MAGIC_KEYS.map(k => [k, opt[k]]))); if (s) { preset = "★ " + s; build(); } }, { title: "Сохранить эти настройки как свой пресет" }),
            preset?.startsWith("★ ") ? dwBtn("🗑", () => { if (UserLib.del("magic", preset.slice(2))) { preset = null; build(); } }, { title: "Удалить свой пресет", className: "dw-btn dw-x" }) : ""),
          el("div", { className: "dw-magic-grid" }, ...Object.entries(SECTIONS).map(([k, l]) => el("div", { className: "dw-magic-sec" }, chk(opt.sections, k, l),
            dwBtn("＋", () => run({ ...opt, sections: { [k]: true }, mode: "append" }), { title: "Добавить только эту часть в конец плейлиста" })))),
          el("div", { className: "dw-dim", textContent: "Добавки:" }),
          el("div", { className: "dw-magic-grid" }, chk(opt, "pad", "Пэд по басу (+ сайдчейн от бочки)"), chk(opt, "riser", "Райзер перед дропом"),
            chk(opt, "impact", "«Удар» в начале дропа"), chk(opt, "fills", "Брейки в конце каждой фразы"),
            chk(opt, "slow", "Медленные вубы (в 2–4 раза длиннее, долгая атака)"), chk(opt, "metal", "Металлические вариации вуба"),
            chk(opt, "drama", "Дроп B драматичнее: саб, металл, брейки чаще")),
          el("div", { className: "dw-pr-tools" },
            select([[4, "Дропы: 4 паттерна"], [8, "Дропы: 8 паттернов"], [16, "Дропы: 16 паттернов"]], opt.size, v => { opt.size = +v; }, "Длина дропов"),
            select([["append", "В конец плейлиста"], ["replace", "Заменить плейлист"]], opt.mode, v => { opt.mode = v; }, "Куда"),
            dwBtn("✨ Достроить", () => run(opt), { className: "dw-btn on" }),
            dwBtn("🎲", () => { seed = Math.floor(Math.random() * 1e6); notify("🎲 Новое зерно — следующий вариант будет другим"); }, { title: "Другой случайный вариант" }))),
        el("div", { className: "dw-magic-card" },
          el("h4", { textContent: "🥁 Ударные" }),
          el("div", { className: "dw-dim", textContent: "Драм-партия в размере паттерна: заменяет ударные, синты остаются. Потом — брейки." }),
          el("div", { className: "dw-pr-tools" },
            select(Object.entries(STYLES), opt.style, v => { opt.style = v; }, "Стиль"),
            dwBtn("🥁 Сделать ударные", () => { const s = drumsForStyle(opt.style); notify("🥁 Ударные: " + s); build(); }),
            dwBtn("🎲", () => { seed = Math.floor(Math.random() * 1e6); const s = drumsForStyle(opt.style); notify("🥁 Ещё вариант: " + s); build(); }, { title: "Другой вариант" })),
          el("div", { className: "dw-pr-tools" },
            dwBtn("💥 Брейки в плейлист", () => { const r = fillsInPlaylist(); notify(r.placed ? `💥 Брейков в плейлисте: ${r.placed}` : "💥 Брейки готовы как паттерны — в плейлисте нет клипов этого паттерна"); }, { title: "Каждый 4-й клип этого паттерна → брейк" }),
            ...Object.entries(FILLS).map(([k, l]) => dwBtn("＋ " + l, () => { const A2 = analyze(), prev = P.cur; const p = mkPat("✨ Fill · " + l, A2, A2.L, fillNotes(A2, k), "#fff09e"); Engine.selectPattern(prev); Engine.touch({ patterns: true }); notify("Паттерн «" + p.name + "» добавлен"); }, { title: "Брейк паттерном (концовка текущего)" })))),
        report ? el("div", { className: "dw-magic-card dw-magic-report" }, el("h4", { textContent: "✅ Готово — что я добавил" }), el("ul", {}, ...report.map(s => el("li", { textContent: s })))) : "");
    }
    function run(o) {
      if (!Object.values(o.sections).some(Boolean)) return notify("Выбери хотя бы одну часть");
      const r = compose(o);
      report = [`${Math.round(r.bars)} тактов в плейлисте`, ...r.said];
      notify("✨ Композиция достроена — смотри плейлист");
      build();
    }
    build();
    return Engine.on("change", w => { if (w?.all || w?.pattern || w?.channels) build(); });
  },
};
