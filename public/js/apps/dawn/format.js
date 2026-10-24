import { fxDefaults, FX } from "./fx.js";
import { DEFAULT_PARAMS, TYPES } from "./instruments.js";
import { EDOS, degreeNames, parsePitch, pitchToFile, scalesOf } from "./tuning.js";

/* ================= DAWN — формат файла .dawn (dawn/2) =================
 * Обычный JSON, задуманный так, чтобы его могли читать и писать и люди, и нейросети:
 *  • время — в ДОЛЯХ (четвертях): 0.25 = шестнадцатая, 4 = такт 4/4;
 *  • высоты — именами нот ("C4", "F#3"; в 24-EDO "C↑4"), в остальных строях — "октава:ступень";
 *  • ссылки — короткими понятными id ("kick", "lead", "verse"), а не случайными строками;
 *  • всё необязательное можно пропустить — подставятся значения по умолчанию.
 * Полное описание — docs/dawn-format.md; короткая выжимка для нейросети — AI_BRIEF ниже.
 * Внутри приложения модель почти та же, только ноты — объекты {s, l, n, v} с числовой высотой.
 */
export const FORMAT = "dawn/2";
export const PASTEL = ["#ff9ecf", "#c3a6ff", "#8fe8cf", "#ffc59e", "#9fd3ff", "#fff09e", "#ffb3b3", "#b8f59e"];
const clamp = (v, a, b, d) => { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
const q = x => Math.round(x * 10000) / 10000;    // в файле — без хвостов 0.30000000004

export function slug(name, taken) {
  const base = String(name || "x").toLowerCase().normalize("NFKD").replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "x";
  let id = base, i = 2;
  while (taken.has(id)) id = base + i++;
  taken.add(id);
  return id;
}

/* ---------- внутренняя модель → файл ---------- */
export function toFile(P) {
  const edoOf = Object.fromEntries(P.channels.map(c => [c.id, c.edo || 12]));
  return {
    format: FORMAT,
    _about: "DAWN project (nikita.os). Times in beats (quarter notes); pitches are note names. Spec: docs/dawn-format.md",
    name: P.name, bpm: P.bpm, swing: q(P.swing || 0), mode: P.mode, current: P.cur,
    channels: P.channels.map(c => {
      const { path, ...params } = c.params;
      const roots = degreeNames(c.edo || 12);
      const out = { id: c.id, type: c.type, name: c.name, color: c.color, vol: q(c.vol), pan: q(c.pan), mixer: c.mix || 0 };
      if (c.type === "sampler") out.sample = path || null;
      if ((c.edo || 12) !== 12) out.edo = c.edo;
      if (c.scale && c.scale.mode !== "chromatic") out.scale = { root: roots[c.scale.root] ?? c.scale.root, mode: c.scale.mode, snap: !!c.scale.snap };
      if (c.mute) out.mute = true;
      if (c.solo) out.solo = true;
      out.params = roundDeep(params);
      return out;
    }),
    patterns: P.patterns.map(p => ({
      id: p.id, name: p.name, color: p.color, sig: `${p.sig[0]}/${p.sig[1]}`, ...(p.len ? { length: q(p.len) } : {}),
      notes: Object.fromEntries(Object.entries(p.notes || {}).filter(([, L]) => L.length).map(([ch, L]) =>
        [ch, [...L].sort((a, b) => a.s - b.s || a.n - b.n).map(n => [q(n.s), q(n.l), pitchToFile(n.n, edoOf[ch] || 12), q(n.v)])])),
    })),
    playlist: P.playlist.map(c => ({ pattern: c.p, track: c.t + 1, start: q(c.s), length: q(c.l) })),
    mixer: P.mixer.map((m, i) => ({ name: m.name, ...(i ? { color: m.color } : {}), vol: q(m.vol), pan: q(m.pan),
      ...(m.mute ? { mute: true } : {}), fx: m.fx.map(f => ({ type: f.type, on: f.on, ...roundDeep(f.p) })) })),
    layout: P.layout || {},
  };
}
const roundDeep = o => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "number" ? q(v) : v));

/* ---------- файл (dawn/2 или старый v1) → внутренняя модель ---------- */
export function fromFile(raw) {
  if (typeof raw === "string") raw = JSON.parse(raw);
  if (!raw || typeof raw !== "object") throw new Error("это не проект DAWN");
  if (raw.v === 1 && Array.isArray(raw.channels)) return fromV1(raw);
  if (!Array.isArray(raw.channels) || !Array.isArray(raw.patterns)) throw new Error("нет channels/patterns — это не проект DAWN");

  const ids = new Set(), chMap = {};
  const channels = raw.channels.map((c, i) => {
    const type = TYPES[c.type] ? c.type : "osc3";
    const id = slug(c.id || c.name || type, ids);
    chMap[c.id ?? id] = id;
    const edo = EDOS.includes(+c.edo) ? +c.edo : 12;
    const params = { ...DEFAULT_PARAMS[type](), ...(c.params || {}) };
    if (type === "sampler") params.path = c.sample ?? params.path ?? null;
    if (type === "osc3" && Array.isArray(params.oscs)) params.oscs = DEFAULT_PARAMS.osc3().oscs.map((d, k) => ({ ...d, ...(params.oscs[k] || {}) }));
    let scale = { root: 0, mode: "chromatic", snap: false };
    if (c.scale) {
      const r = typeof c.scale.root === "number" ? c.scale.root : degreeNames(edo).indexOf(String(c.scale.root));
      scale = { root: r >= 0 ? r % edo : 0, mode: scalesOf(edo)[c.scale.mode] ? c.scale.mode : "chromatic", snap: !!c.scale.snap };
    }
    return { id, type, name: String(c.name || TYPES[type].name).slice(0, 24), color: c.color || PASTEL[i % PASTEL.length],
      vol: clamp(c.vol, 0, 1.25, 0.8), pan: clamp(c.pan, -1, 1, 0), mute: !!c.mute, solo: !!c.solo,
      mix: Math.max(0, Math.round(+c.mixer || 0)), edo, scale, params };
  });

  const pids = new Set(), patMap = {};
  const patterns = raw.patterns.map((p, i) => {
    const id = slug(p.id || p.name || "pattern", pids);
    patMap[p.id ?? id] = id;
    const sig = parseSig(p.sig);
    const notes = {};
    for (const [chRef, list] of Object.entries(p.notes || {})) {
      const ch = chMap[chRef] && channels.find(c => c.id === chMap[chRef]);
      if (!ch || !Array.isArray(list)) continue;
      notes[ch.id] = list.map(n => parseNote(n, ch.edo)).filter(Boolean);
    }
    return { id, name: String(p.name || id).slice(0, 32), color: p.color || PASTEL[i % PASTEL.length], sig,
      len: p.length ? clamp(p.length, 0.25, 4096, null) : null, notes };
  });
  if (!patterns.length) patterns.push({ id: "pattern", name: "Pattern 1", color: PASTEL[0], sig: [4, 4], len: null, notes: {} });

  const mixer = (Array.isArray(raw.mixer) && raw.mixer.length ? raw.mixer : [{ name: "Master" }]).map((m, i) => ({
    id: i ? "ins" + i : "master", name: String(m.name || (i ? "Insert " + i : "Master")).slice(0, 20),
    color: m.color || PASTEL[(i + 3) % PASTEL.length], vol: clamp(m.vol, 0, 1.25, i ? 0.8 : 0.85), pan: clamp(m.pan, -1, 1, 0),
    mute: !!m.mute,
    fx: (Array.isArray(m.fx) ? m.fx : []).filter(f => FX[f?.type]).slice(0, 4).map(f => {
      const { type, on, ...pp } = f;
      return { type, on: on !== false, p: { ...fxDefaults(type), ...(pp.p || pp) } };
    }),
  }));
  while (mixer.length < 9) mixer.push(newInsert(mixer.length));

  const playlist = (Array.isArray(raw.playlist) ? raw.playlist : []).map((c, i) => {
    const p = patMap[c.pattern] || patterns.find(x => x.name === c.pattern)?.id;
    if (!p) return null;
    return { id: "c" + i, p, t: Math.max(0, Math.round((+c.track || 1) - 1)), s: clamp(c.start, 0, 1e6, 0),
      l: clamp(c.length, 0.25, 1e5, null) };
  }).filter(Boolean);

  for (const ch of channels) if (ch.mix >= mixer.length) ch.mix = 0;
  const P = { name: String(raw.name || "Трек").slice(0, 60), bpm: clamp(raw.bpm, 40, 300, 128), swing: clamp(raw.swing, 0, 0.6, 0),
    mode: raw.mode === "song" ? "song" : "pat", channels, patterns, playlist, tracks: 16, mixer,
    cur: patMap[raw.current] || patterns[0].id, songStart: 0, layout: raw.layout && typeof raw.layout === "object" ? raw.layout : {} };
  for (const c of playlist) if (!c.l) c.l = patLen(P, c.p);
  return P;
}

export function newInsert(i) {
  return { id: "ins" + i, name: "Insert " + i, color: PASTEL[(i + 3) % PASTEL.length], vol: 0.8, pan: 0, mute: false, fx: [] };
}
export function parseSig(s) {
  if (Array.isArray(s)) s = s.join("/");
  const m = String(s || "4/4").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  const n = m ? Math.min(32, Math.max(1, +m[1])) : 4, d = m && [1, 2, 4, 8, 16].includes(+m[2]) ? +m[2] : 4;
  return [n, d];
}
function parseNote(n, edo) {
  let s, l, p, v;
  if (Array.isArray(n)) [s, l, p, v] = n;
  else if (n && typeof n === "object") ({ start: s = n.s, length: l = n.l, pitch: p = n.n, vel: v = n.v } = n);
  else return null;
  s = +s; if (!isFinite(s) || s < 0) return null;
  return { s, l: clamp(l, 1 / 64, 1024, 0.25), n: parsePitch(p, edo), v: clamp(v, 0, 1, 0.8) };
}
export const barLen = p => p.sig[0] * 4 / p.sig[1];        // в долях (четвертях)
export function patLen(P, id) {
  const p = P.patterns.find(x => x.id === id);
  if (!p) return 4;
  if (p.len) return p.len;
  const bar = barLen(p);
  let end = bar;
  for (const L of Object.values(p.notes || {})) for (const n of L) end = Math.max(end, n.s + n.l);
  return Math.ceil(end / bar - 1e-9) * bar;
}

/* старый формат этапа 1: шаги по 1/16, notes[pattern][channel], master на проекте */
function fromV1(r) {
  const file = {
    format: FORMAT, name: r.name, bpm: r.bpm, swing: r.swing, current: r.cur, layout: r.layout,
    channels: r.channels.map(c => ({ ...c, mixer: 0, sample: c.params?.path })),
    patterns: r.patterns.map(p => ({ id: p.id, name: p.name, color: p.color, sig: "4/4", ...(p.bars ? { length: p.bars * 4 } : {}),
      notes: Object.fromEntries(Object.entries(r.notes?.[p.id] || {}).map(([ch, L]) => [ch, L.map(n => [n.s / 4, n.l / 4, n.n, n.v])])) })),
    mixer: [{ name: "Master", vol: r.master ?? 0.85 }],
  };
  return fromFile(file);
}

/* ---------- выжимка формата для нейросети (кнопка «Нейросеть» → «Скопировать с описанием») ---------- */
export const AI_BRIEF = `You are editing a DAWN project (a small browser DAW). The project is JSON in format "dawn/2".
Return ONLY the full JSON (no comments, no markdown). Rules:
- Time is in BEATS (quarter notes): 0.25 = 1/16, 1 = 1/4, 4 = one 4/4 bar. Tempo: "bpm".
- channels[]: { id, type: "osc3" | "sampler", name, vol 0..1.25, pan -1..1, mixer: insert index (0 = master),
  edo?: 12 (default) | 24 | 19 | 31 | 17 | 22 | 5 | 7, scale?: { root: "C", mode: "minor" },
  sample (sampler only): "builtin:kick" | "builtin:snare" | "builtin:clap" | "builtin:hat" | "builtin:openhat" | "builtin:tom" | "/path/in/site/fs.wav",
  params: osc3 → { oscs: [3 × { wave: "sine"|"triangle"|"sawtooth"|"square"|"noise", o_vol 0..1, o_crs -24..24 semitones, o_fin -100..100 cents, o_pan -1..1 }],
                    att, dec, sus 0..1, rel (seconds), cut 40..18000 Hz, res 0.1..18 };
          sampler → { root: MIDI note of the sample (60), tune -12..12, start 0..0.95, att, rel, oneshot: bool, rev: bool } }.
- patterns[]: { id, name, sig: "4/4" | "7/4" | "6/8" ..., length?: beats (omit = auto by notes, whole bars),
  notes: { <channel id>: [[start, length, pitch, velocity], ...] } }.
  pitch: note name "C4" (= MIDI 60), "F#3", "Bb2"; drums use "C4". In 24-EDO "C↑4" = quarter-tone up;
  in other EDOs use "octave:step", e.g. "4:7". velocity 0..1.
- playlist[]: { pattern: <pattern id>, track: 1.., start: beats, length: beats } — the song timeline; "mode": "song" plays it, "pat" loops "current".
- mixer[]: index 0 = Master, then inserts: { name, vol, pan, mute?, fx: [ { type: "delay", on, sync: 0..6 (1/16,1/8,1/8.,1/4,1/4.,1/2,1 bar), fb 0..0.92, mix 0..1, damp Hz, pp: 0|1 }
  | { type: "reverb", on, decay 0.3..8 s, pre 0..0.2 s, damp Hz, low Hz, mix 0..1 }
  | { type: "eq", on, lf, lg, mf, mg, mq, hf, hg (Hz / dB -18..18) } ] } (max 4 fx per insert).
- Keep ids short and readable; omit "layout". Unknown fields are ignored, missing ones get defaults.`;
