import { BUILTIN, Engine, PASTEL } from "./engine.js";
import { c4, scaleSet, scalesOf } from "./tuning.js";
import { applyPreset } from "./presets.js";

/* ================= DAWN — библиотека паттернов =================
 * Готовые паттерны «одной кнопкой»: ударные грувы (в том числе в нечётных размерах) и мелодические
 * заготовки, которые строятся в ладу и строе выбранного канала — работают в любом EDO и любом ладу.
 * Клик — паттерн добавляется в проект и выбирается; перетащить на плейлист — сразу клип на дорожке.
 */
export const LIB_MIME = "application/x-dawn-lib";
const h = (s, v = 0.6) => [s, 0.25, "C4", v];
const range = (from, to, step) => { const out = []; for (let s = from; s < to - 1e-9; s += step) out.push(+s.toFixed(4)); return out; };
const hats8 = (len, acc = 0.65, off = 0.4) => range(0, len, 0.5).map((s, i) => h(s, i % 2 ? off : acc));
const hats16 = (len) => range(0, len, 0.25).map((s, i) => h(s, i % 4 === 0 ? 0.6 : i % 2 ? 0.28 : 0.42));

/* роли ударных → встроенные сэмплы */
const ROLES = { kick: "kick", snare: "snare", clap: "clap", hat: "hat", ohat: "openhat", tom: "tom" };

export const DRUMS = [
  { id: "dnb44", name: "DnB two-step", sig: "4/4", len: 4, tags: "174 BPM", notes: {
    kick: [h(0, 1), h(2.5, 0.9)], snare: [h(1, 1), h(3, 1)], hat: hats8(4), ohat: [h(3.5, 0.4)] } },
  { id: "dnb74", name: "DnB в 7/4 (2+2+3)", sig: "7/4", len: 7, tags: "odd · 174", notes: {
    kick: [h(0, 1), h(2.5, 0.9), h(4, 1), h(4.75, 0.8)], snare: [h(1, 1), h(3, 1), h(5.5, 1), h(6.25, 0.35), h(6.75, 0.45)],
    clap: [h(1, 0.5), h(3, 0.5), h(5.5, 0.6)], hat: hats8(7), ohat: [h(1.5, 0.45), h(3.5, 0.4), h(6, 0.45)] } },
  { id: "jungle", name: "Jungle (рубленый брейк)", sig: "4/4", len: 8, tags: "165 BPM", notes: {
    kick: [h(0, 1), h(0.75, 0.6), h(2.5, 0.9), h(4, 1), h(6.25, 0.8)],
    snare: [h(1, 1), h(1.75, 0.3), h(3, 1), h(3.5, 0.35), h(5, 1), h(5.75, 0.4), h(6.5, 0.7), h(7, 1), h(7.75, 0.5)],
    hat: hats16(8), ohat: [h(2, 0.35), h(6, 0.35)] } },
  { id: "riddim44", name: "Riddim halftime", sig: "4/4", len: 4, tags: "140 BPM", notes: {
    kick: [h(0, 1), h(0.75, 0.6)], snare: [h(2, 1)], clap: [h(2, 0.8)], hat: [0.5, 1, 1.5, 2.5, 3, 3.5].map(s => h(s, s % 1 ? 0.35 : 0.5)) } },
  { id: "riddim74", name: "Riddim в 7/4 (4+3)", sig: "7/4", len: 7, tags: "odd · halftime", notes: {
    kick: [h(0, 1), h(0.75, 0.7), h(4, 1), h(6.75, 0.6)], snare: [h(2, 1), h(5.5, 1)], clap: [h(2, 0.8), h(5.5, 0.8)],
    hat: [0.5, 1, 1.5, 2.5, 3, 3.5, 4.5, 5, 6, 6.5].map(s => h(s, s % 1 ? 0.35 : 0.55)), ohat: [h(3.5, 0.4)] } },
  { id: "break54", name: "Breakbeat в 5/4 (3+2)", sig: "5/4", len: 5, tags: "odd", notes: {
    kick: [h(0, 1), h(1.5, 0.8), h(3, 1)], snare: [h(1, 1), h(2.5, 0.8), h(4, 1), h(4.75, 0.4)], hat: hats8(5), ohat: [h(2, 0.4)] } },
  { id: "odd118", name: "11/8 (3+3+3+2)", sig: "11/8", len: 5.5, tags: "odd", notes: {
    kick: [h(0, 1), h(1.5, 0.85), h(3, 0.9)], snare: [h(1, 0.9), h(2.5, 0.9), h(4, 1), h(5, 0.5)], hat: hats8(5.5), ohat: [h(4.5, 0.4)] } },
  { id: "half98", name: "9/8 (2+2+2+3)", sig: "9/8", len: 4.5, tags: "odd · балканский", notes: {
    kick: [h(0, 1), h(2, 0.8), h(3, 0.9)], snare: [h(1, 1), h(3.5, 1)], clap: [h(3.5, 0.6)], hat: hats8(4.5), ohat: [h(4, 0.4)] } },
  { id: "bcore78", name: "Breakcore 7/8", sig: "7/8", len: 3.5, tags: "odd · хаос", notes: {
    kick: [h(0, 1), h(0.75, 0.8), h(1.5, 0.9), h(2.75, 0.8)], snare: [h(0.5, 1), h(1.25, 0.6), h(2, 1), h(2.25, 0.5), h(3, 1), h(3.25, 0.7)], hat: hats16(3.5) } },
  { id: "trap", name: "Trap / роллы хэтов", sig: "4/4", len: 4, tags: "140 BPM", notes: {
    kick: [h(0, 1), h(1.75, 0.8), h(2.5, 0.9)], snare: [h(1, 1), h(3, 1)], clap: [h(1, 0.6), h(3, 0.6)],
    hat: [...range(0, 2, 0.5).map(s => h(s, 0.5)), ...range(2, 2.5, 1 / 6).map(s => h(+s.toFixed(4), 0.4)), ...range(2.5, 3.5, 0.25).map(s => h(s, 0.45)), ...range(3.5, 4, 0.125).map(s => h(s, 0.35))] } },
  { id: "house", name: "House four-on-the-floor", sig: "4/4", len: 4, tags: "124 BPM", notes: {
    kick: [0, 1, 2, 3].map(s => h(s, 1)), clap: [h(1, 0.8), h(3, 0.8)], hat: [0.5, 1.5, 2.5, 3.5].map(s => h(s, 0.6)), ohat: [h(2.5, 0.3)] } },
  { id: "afro128", name: "Afro 12/8", sig: "12/8", len: 6, tags: "три на два", notes: {
    kick: [h(0, 1), h(2.5, 0.8), h(3, 1)], snare: [h(1.5, 0.7), h(4.5, 0.9)], tom: [h(2, 0.6), h(5, 0.6), h(5.5, 0.7)],
    hat: range(0, 6, 0.5).map((s, i) => h(s, [0, 2, 4, 5, 7, 9, 11].includes(i) ? 0.6 : 0.25)) } },
];

/* мелодические заготовки: degrees — ступени лада канала (0 = тоника), oct — октавный сдвиг */
export const MELODIC = [
  { id: "bassroot", name: "Бас: тоника восьмыми с октавой", make: (deg, bar) => range(0, bar, 0.5).map((s, i) => [s, 0.4, deg(i % 4 === 3 ? 7 : 0, -1), i % 2 ? 0.7 : 0.95]) },
  { id: "bassgroove", name: "Бас: грув I–IV–V", make: (deg, bar) => [[0, 1.5, deg(0, -1), 1], [1.75, 0.25, deg(0, -1), 0.7], [2, 1, deg(3, -1), 0.9], [3, 0.75, deg(4, -1), 0.9], [3.75, 0.25, deg.semi(-1, -1), 0.7]].filter(n => n[0] < bar) },
  { id: "arp", name: "Арпеджио по ладу", make: (deg, bar) => range(0, bar, 0.25).map((s, i) => [s, 0.22, deg([0, 2, 4, 7, 4, 2][i % 6], 0), i % 4 ? 0.55 : 0.85]) },
  { id: "chords", name: "Аккорды I–VI–III–VII", make: (deg, bar) => {
    const per = bar / 4, out = [];
    [0, 5, 2, 6].forEach((r, k) => [0, 2, 4].forEach(t => out.push([k * per, per, deg(r + t, 0), 0.7])));
    return out;
  } },
  { id: "melody", name: "Мелодия: вопрос-ответ", make: (deg, bar) => [[0, 0.75, deg(4)], [0.75, 0.25, deg(5)], [1, 1, deg(4)], [2, 0.5, deg(2)], [2.5, 0.5, deg(3)], [3, 1, deg(1)]]
    .filter(n => n[0] < bar).map(n => [n[0], n[1], n[2], 0.8]) },
];

/* готовые связки «звук + рифф»: создают свои каналы с пресетами (в ладу и строе выбранного канала) */
export const KITS = [
  { id: "crushriddim", name: "Crush-риддим (медленная + быстрая атака)", tags: "cojam · 2 баса",
    parts: [
      { name: "Crush Slow", preset: "Crush Bass Slow", make: deg => [[0, 1, deg(0, -1)], [1, 1, deg(0, -1)], [2, 1, deg(0, -1)]] },
      { name: "Crush Snap", preset: "Crush Bass Snap", make: deg => [[3, 0.5, deg.semi(-1, -1)], [3.5, 0.5, deg.semi(-1, -1)]] }] },
  { id: "crushriddim2", name: "Crush-риддим: вариация с октавой", tags: "cojam · 2 баса",
    parts: [
      { name: "Crush Slow", preset: "Crush Bass Slow", make: deg => [[0, 0.75, deg(0, -1)], [0.75, 0.25, deg(0, -1), 0.7], [1, 0.5, deg(0, -1)], [1.5, 0.5, deg(0, 0), 0.8], [2, 1, deg(0, -1)]] },
      { name: "Crush Snap", preset: "Crush Bass Snap", make: deg => [[3, 0.25, deg.semi(-1, -1)], [3.25, 0.25, deg.semi(-1, -1), 0.7], [3.5, 0.5, deg.semi(-3, -1)]] }] },
];

/* ступени лада канала → номер ноты: deg(k, octShift) с переходом через октаву */
function degreeFn(ch) {
  const E = ch.edo || 12, sc = ch.scale || { root: 0, mode: "chromatic" };
  let mode = sc.mode, root = sc.root || 0;
  if (mode === "chromatic") mode = scalesOf(E).minor ? "minor" : scalesOf(E).major ? "major" : "chromatic";
  const steps = [...scaleSet(E, mode, 0)].sort((a, b) => a - b);
  const base = c4(E) + root;
  return (k, oct = 0) => {
    const len = steps.length, o = Math.floor(k / len), i = ((k % len) + len) % len;
    return base + steps[i] + (o + oct) * E;
  };
}

function ensureDrum(role) {
  const P = Engine.project, name = BUILTIN[ROLES[role]];
  let ch = P.channels.find(c => c.id === role) || P.channels.find(c => c.type === "sampler" && c.params.path === "builtin:" + ROLES[role]);
  if (!ch) { ch = Engine.addChannel("sampler", name, { path: "builtin:" + ROLES[role] }); Engine.setSample(ch, "builtin:" + ROLES[role]); }
  return ch;
}

/* добавить элемент библиотеки в проект → id нового паттерна */
export function instantiate(id, Dawn) {
  const P = Engine.project;
  const d = DRUMS.find(x => x.id === id);
  if (d) {
    const pat = Engine.addPattern(d.name);
    const [n, den] = d.sig.split("/").map(Number);
    pat.sig = [n, den]; pat.len = d.len;
    for (const [role, list] of Object.entries(d.notes)) {
      const ch = ensureDrum(role), pitch = Engine.defaultPitch(ch);
      pat.notes[ch.id] = list.map(([s, l, , v]) => ({ s, l, n: pitch, v }));
    }
    Engine.touch({ patterns: true, notes: true, channels: true });
    return pat.id;
  }
  const kit = KITS.find(x => x.id === id);
  if (kit) {
    const ref = Engine.chan(Dawn?.pianoCh);
    const pat = Engine.addPattern(kit.name.split(" (")[0].split(":")[0]);
    pat.sig = [8, 8]; pat.color = PASTEL[(P.patterns.length + 4) % PASTEL.length];
    for (const part of kit.parts) {
      // канал с этим пресетом уже есть — переиспользуем, иначе новый (лад и строй — как у выбранного канала)
      let ch = P.channels.find(c => c.preset === part.preset);
      if (!ch) {
        ch = Engine.addChannel("osc3", part.name);
        if (ref && ref.type !== "sampler") { ch.edo = ref.edo; ch.scale = { ...ref.scale }; }
        ch.poly = 1;
        applyPreset(Engine, ch, part.preset);
      }
      const deg = degreeFn(ch), E = ch.edo || 12;
      deg.semi = (s, oct = 0) => deg(0, oct) + Math.round(s * E / 12);   // рифф держится на полутоне под тоникой (F → E), как в оригинале
      pat.notes[ch.id] = part.make(deg).map(([s, l, n, v = 0.85]) => ({ s, l, n, v }));
    }
    Engine.touch({ patterns: true, notes: true, channels: true });
    return pat.id;
  }
  const m = MELODIC.find(x => x.id === id);
  if (m) {
    let ch = Engine.chan(Dawn?.pianoCh);
    if (!ch || ch.type === "sampler") ch = P.channels.find(c => c.type !== "sampler") || Engine.addChannel("osc3");
    const cur = Engine.pat(), bar = Math.max(2, Engine.barLen(cur));
    const pat = Engine.addPattern(`${m.name.split(":")[0]} · ${ch.name}`);
    pat.sig = [...cur.sig]; pat.color = PASTEL[(P.patterns.length + 2) % PASTEL.length];
    const deg = degreeFn(ch);
    pat.notes[ch.id] = m.make(deg, bar).map(([s, l, nn, v]) => ({ s, l, n: nn, v }));
    if (Dawn) Dawn.pianoCh = ch.id;
    Engine.touch({ patterns: true, notes: true });
    return pat.id;
  }
  return null;
}
