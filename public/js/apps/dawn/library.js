import { BUILTIN, Engine, PASTEL } from "./engine.js";
import { c4, scaleSet, scalesOf } from "./tuning.js";
import { applyPreset } from "./presets.js";
import { UserLib } from "./userlib.js";

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
const ROLES = { kick: "kick", snare: "snare", clap: "clap", hat: "hat", ohat: "openhat", tom: "tom",
  punch: "kickhard", k808: "kick808", fat: "snarefat", rim: "rim", snap: "snap", shaker: "shaker", crash: "crash", ride: "ride",
  cowbell: "cowbell", conga: "conga", metal: "metal", impact: "impact", revcrash: "revcrash" };

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
  { id: "riddim44", name: "Riddim halftime", sig: "4/4", len: 4, tags: "140 BPM", riddim: true, notes: {
    kick: [h(0, 1), h(0.75, 0.6)], snare: [h(2, 1)], clap: [h(2, 0.8)], hat: [0.5, 1, 1.5, 2.5, 3, 3.5].map(s => h(s, s % 1 ? 0.35 : 0.5)) } },
  { id: "riddim74", name: "Riddim в 7/4 (4+3)", sig: "7/4", len: 7, tags: "odd · halftime", riddim: true, notes: {
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

/* ---------- пак грувов по жанрам (genre: riddim | trap | dnb | electro | odd) ---------- */
const at = (list, v = 0.9) => list.map(s => h(s, v));
const tri = (from, to, v) => range(from, to, 1 / 3).map(s => h(+s.toFixed(4), v));
DRUMS.push(
  // риддим / дабстеп — 140 halftime
  { id: "rd-bounce", genre: "riddim", name: "Riddim · бочка с отскоком", sig: "4/4", len: 4, tags: "140 · halftime", notes: {
    kick: [h(0, 1), h(0.75, 0.7), h(3.25, 0.65)], snare: [h(2, 1)], clap: [h(2, 0.7)], hat: at([0.5, 1, 1.5, 2.5, 3, 3.5], 0.45), ohat: [h(3.5, 0.35)] } },
  { id: "rd-heavy", genre: "riddim", name: "Riddim · тяжёлый шаг", sig: "4/4", len: 8, tags: "140 · 2 такта", notes: {
    kick: [h(0, 1), h(1.5, 0.8), h(4, 1), h(5.75, 0.7), h(6.5, 0.8)], snare: [h(2, 1), h(6, 1)], clap: [h(2, 0.7), h(6, 0.75)],
    hat: at([1, 3, 5, 7], 0.4), ohat: [h(3.5, 0.45), h(7.5, 0.5)], tom: [h(7.25, 0.5), h(7.5, 0.6), h(7.75, 0.7)] } },
  { id: "rd-ghost", genre: "riddim", name: "Riddim · призрачные малые", sig: "4/4", len: 4, tags: "140 · грязно", notes: {
    kick: [h(0, 1), h(2.75, 0.6)], snare: [h(2, 1), h(1.25, 0.2), h(1.75, 0.25), h(3.25, 0.2), h(3.75, 0.3)], clap: [h(2, 0.75)], hat: hats16(4).map(n => [n[0], n[1], n[2], n[3] * 0.7]) } },
  { id: "rd-trip", genre: "riddim", name: "Riddim · триоли хэтов", sig: "4/4", len: 4, tags: "140 · качает", notes: {
    kick: [h(0, 1), h(1.33, 0.6)], snare: [h(2, 1)], clap: [h(2, 0.7)], hat: tri(0, 4, 0.4), ohat: [h(3.67, 0.35)] } },
  { id: "rd-brostep", genre: "riddim", name: "Brostep · крэш и ломка", sig: "4/4", len: 8, tags: "140 · 2 такта", notes: {
    kick: [h(0, 1), h(0.5, 0.7), h(3, 0.8), h(4, 1), h(4.5, 0.7), h(6.75, 0.8), h(7.25, 0.8)], snare: [h(2, 1), h(6, 1), h(7.5, 0.7), h(7.75, 0.85)], clap: [h(2, 0.8), h(6, 0.8)],
    hat: at([1, 1.5, 3.5, 5, 5.5], 0.4), ohat: [h(0, 0.6), h(4, 0.5)] } },
  // трэп / дрилл / фонк
  { id: "tr-trip", genre: "trap", name: "Trap · триольные роллы", sig: "4/4", len: 8, tags: "140 · 2 такта", notes: {
    kick: [h(0, 1), h(0.75, 0.7), h(2.5, 0.9), h(4, 1), h(5.5, 0.8), h(6.25, 0.8)], snare: [h(2, 1), h(6, 1)], clap: [h(2, 0.6), h(6, 0.6)],
    hat: [...range(0, 1.5, 0.5).map(s => h(s, 0.5)), ...tri(1.5, 2, 0.4), ...range(2, 5.5, 0.5).map(s => h(s, 0.5)), ...range(5.5, 6, 0.125).map(s => h(s, 0.35)), ...range(6, 7, 0.5).map(s => h(s, 0.5)), ...tri(7, 8, 0.4)], ohat: [h(3.5, 0.3)] } },
  { id: "tr-drill", genre: "trap", name: "UK Drill · скользящий", sig: "4/4", len: 8, tags: "142 · 2 такта", notes: {
    kick: [h(0, 1), h(2.75, 0.8), h(4.5, 0.9), h(6.25, 0.7)], snare: [h(2, 1), h(3.5, 0.8), h(6, 1), h(7.75, 0.6)], clap: [h(2, 0.6), h(6, 0.6)],
    hat: [...tri(0, 2, 0.4), ...at([2.5, 3, 3.75], 0.45), ...tri(4, 6, 0.4), ...at([6.5, 7, 7.5], 0.45)] } },
  { id: "tr-phonk", genre: "trap", name: "Phonk · каубелл-грув", sig: "4/4", len: 4, tags: "130 · хлопки", notes: {
    kick: [h(0, 1), h(1.5, 0.85), h(2.75, 0.7)], clap: [h(1, 0.9), h(3, 0.9)], snare: [h(3, 0.5)], hat: hats8(4, 0.6, 0.35), tom: [h(0.5, 0.5), h(2.25, 0.45), h(3.5, 0.5)] } },
  { id: "tr-half", genre: "trap", name: "Trap · полупустой", sig: "4/4", len: 4, tags: "70/140 · воздух", notes: {
    kick: [h(0, 1), h(2.5, 0.8)], snare: [h(2, 1)], hat: [h(0, 0.5), h(1, 0.5), h(1.5, 0.3), h(3, 0.5), ...range(3.5, 4, 1 / 6).map(s => h(+s.toFixed(4), 0.35))] } },
  // drum'n'bass / jungle
  { id: "dn-amen", genre: "dnb", name: "DnB · рубленый амен", sig: "4/4", len: 8, tags: "174 · 2 такта", notes: {
    kick: [h(0, 1), h(0.5, 0.7), h(2.5, 0.9), h(4, 1), h(4.5, 0.7), h(6.25, 0.8)], snare: [h(1, 1), h(1.75, 0.4), h(3, 1), h(3.75, 0.35), h(5, 1), h(5.75, 0.45), h(6.5, 0.6), h(7, 1), h(7.5, 0.5)],
    hat: hats8(8, 0.55, 0.35), ohat: [h(2, 0.35)] } },
  { id: "dn-roller", genre: "dnb", name: "DnB · роллер", sig: "4/4", len: 4, tags: "174 · катит", notes: {
    kick: [h(0, 1), h(2.5, 0.9), h(2.75, 0.5)], snare: [h(1, 1), h(3, 1)], hat: hats16(4), ohat: [h(1.5, 0.3), h(3.5, 0.35)] } },
  { id: "dn-liquid", genre: "dnb", name: "Liquid DnB · мягкий", sig: "4/4", len: 4, tags: "172 · шафл", notes: {
    kick: [h(0, 0.9), h(2.5, 0.8)], snare: [h(1, 0.85), h(3, 0.9), h(3.75, 0.25)], hat: range(0, 4, 0.25).map((s, i) => h(s, [0.5, 0.2, 0.35, 0.25][i % 4])), ohat: [h(1.5, 0.25)] } },
  { id: "dn-half", genre: "dnb", name: "DnB · halftime", sig: "4/4", len: 8, tags: "174 · тяжело", notes: {
    kick: [h(0, 1), h(0.75, 0.6), h(3.5, 0.7), h(4, 1), h(6.75, 0.7)], snare: [h(2, 1), h(6, 1)], clap: [h(2, 0.6), h(6, 0.6)], hat: hats8(8, 0.4, 0.25) } },
  { id: "dn-neuro", genre: "dnb", name: "Neurofunk · степпер", sig: "4/4", len: 4, tags: "174 · жёстко", notes: {
    kick: [h(0, 1), h(1.75, 0.7), h(2.5, 0.9)], snare: [h(1, 1), h(3, 1), h(3.25, 0.4)], clap: [h(1, 0.5), h(3, 0.5)], hat: at([0.5, 1.5, 2, 3.5], 0.45), tom: [h(3.75, 0.6)] } },
  { id: "dn-jump", genre: "dnb", name: "Jump-up · бодрый", sig: "4/4", len: 4, tags: "174 · прыгает", notes: {
    kick: [h(0, 1), h(1.75, 0.65), h(2.5, 1)], snare: [h(1, 1), h(3, 1), h(3.75, 0.35)], clap: [h(1, 0.55), h(3, 0.55)],
    hat: range(0, 4, 0.25).map((s, i) => h(s, i % 2 ? 0.25 : 0.45)), ohat: [h(0.5, 0.4), h(2.75, 0.35)] } },
  { id: "dn-dance", genre: "dnb", name: "Dancefloor · 2 такта с заходом", sig: "4/4", len: 8, tags: "174 · танцпол", notes: {
    kick: [h(0, 1), h(2.5, 0.95), h(4, 1), h(5.75, 0.7), h(6.5, 0.95), h(7.25, 0.6)],
    snare: [h(1, 1), h(3, 1), h(5, 1), h(7, 1), h(7.5, 0.45), h(7.625, 0.5), h(7.75, 0.6), h(7.875, 0.7)], clap: [h(1, 0.5), h(3, 0.5), h(5, 0.5), h(7, 0.5)],
    hat: hats8(8, 0.5, 0.3), ohat: [h(1.5, 0.35), h(3.5, 0.35), h(5.5, 0.35)], crash: [h(0, 0.5)] } },
  { id: "dn-ghost", genre: "dnb", name: "Two-step · призрачные малые", sig: "4/4", len: 4, tags: "174 · грув", notes: {
    kick: [h(0, 1), h(2.5, 0.9)], snare: [h(1, 1), h(1.75, 0.2), h(2.25, 0.25), h(3, 1), h(3.5, 0.2), h(3.75, 0.3)],
    hat: range(0, 4, 0.25).map((s, i) => h(s + (i % 2 ? 0.02 : 0), [0.5, 0.18, 0.32, 0.22][i % 4])), ride: at([0, 1, 2, 3], 0.25) } },
  { id: "dn-think", genre: "dnb", name: "Think-брейк · рубленый", sig: "4/4", len: 4, tags: "170 · брейк", notes: {
    kick: [h(0, 1), h(0.75, 0.55), h(2.25, 0.8), h(2.5, 0.9)], snare: [h(1, 1), h(1.5, 0.35), h(3, 1), h(3.25, 0.4), h(3.75, 0.55)],
    hat: hats8(4, 0.5, 0.3), ohat: [h(2, 0.4)], shaker: range(0, 4, 0.25).map((s, i) => h(s, i % 2 ? 0.3 : 0.15)) } },
  { id: "dn-intro", genre: "dnb", name: "DnB интро · хэты и райд (без бочки)", sig: "4/4", len: 4, tags: "174 · вход", notes: {
    hat: range(0, 4, 0.25).map((s, i) => h(s, i % 4 === 2 ? 0.45 : 0.22)), ride: at([0, 1, 2, 3], 0.35), snare: [h(3.75, 0.3)] } },
  // электроника
  { id: "el-techno", genre: "electro", name: "Techno · прямая бочка", sig: "4/4", len: 4, tags: "130", notes: {
    kick: at([0, 1, 2, 3], 1), clap: [h(1, 0.6), h(3, 0.6)], hat: at([0.5, 1.5, 2.5, 3.5], 0.6), ohat: at([0.5, 1.5, 2.5, 3.5], 0.3), tom: [h(3.75, 0.4)] } },
  { id: "el-ukg", genre: "electro", name: "UK Garage · 2-step", sig: "4/4", len: 4, tags: "132 · шафл", notes: {
    kick: [h(0, 1), h(1.75, 0.6), h(2.5, 0.8)], snare: [h(1, 0.9), h(3, 0.9)], clap: [h(1, 0.5), h(3, 0.5)], hat: range(0, 4, 0.5).map((s, i) => h(s + (i % 2 ? 0.08 : 0), i % 2 ? 0.55 : 0.3)), ohat: [h(3.5, 0.35)] } },
  { id: "el-breaks", genre: "electro", name: "Breaks · фанки", sig: "4/4", len: 8, tags: "128 · 2 такта", notes: {
    kick: [h(0, 1), h(0.75, 0.6), h(2.5, 0.9), h(4, 1), h(5.5, 0.8), h(6.25, 0.7)], snare: [h(1, 1), h(3, 1), h(3.75, 0.3), h(5, 1), h(7, 1), h(7.5, 0.4)], hat: hats8(8, 0.55, 0.35), ohat: [h(3.5, 0.35), h(7.75, 0.3)] } },
  { id: "el-electro", genre: "electro", name: "Electro · 808", sig: "4/4", len: 4, tags: "125 · робот", notes: {
    kick: [h(0, 1), h(1.75, 0.8), h(2.5, 0.9)], clap: [h(1, 0.9), h(3, 0.9)], hat: hats16(4), tom: [h(3.5, 0.5), h(3.75, 0.6)] } },
  { id: "el-hard", genre: "electro", name: "Hardstyle · реверс-бочка", sig: "4/4", len: 4, tags: "150", notes: {
    kick: at([0, 1, 2, 3], 1), clap: [h(1, 0.7), h(3, 0.7)], hat: at([0.5, 1.5, 2.5, 3.5], 0.5), ohat: at([0.75, 1.75, 2.75, 3.75], 0.25) } },
  { id: "el-boombap", genre: "electro", name: "Lo-fi boom bap", sig: "4/4", len: 4, tags: "86 · ленивый", notes: {
    kick: [h(0, 0.9), h(0.75, 0.5), h(2.5, 0.8)], snare: [h(1, 0.85), h(3, 0.85)], hat: range(0, 4, 0.5).map((s, i) => h(s + (i % 2 ? 0.1 : 0), i % 2 ? 0.3 : 0.45)) } },
  { id: "el-footwork", genre: "electro", name: "Footwork · джук", sig: "4/4", len: 4, tags: "160 · триоли", notes: {
    kick: [h(0, 1), h(0.67, 0.7), h(1.33, 0.8), h(2.5, 0.9), h(3.17, 0.7)], clap: [h(1, 0.8), h(3, 0.8)], hat: tri(0, 4, 0.35) } },
  { id: "el-dembow", genre: "electro", name: "Дембоу / реггетон", sig: "4/4", len: 4, tags: "95", notes: {
    kick: at([0, 1, 2, 3], 0.95), snare: [h(0.75, 0.8), h(1.5, 0.8), h(2.75, 0.8), h(3.5, 0.8)], hat: hats8(4, 0.4, 0.3) } },
);
// грувы на новых встроенных звуках (808, жирный малый, рим, шейкер, каубелл, конги, металл, тарелки)
DRUMS.push(
  { id: "rd-punch", genre: "riddim", name: "Riddim · панч + жирный малый", sig: "4/4", len: 8, tags: "140 · новые звуки", notes: {
    punch: [h(0, 1), h(0.75, 0.6), h(3.5, 0.7), h(4, 1), h(6.75, 0.7)], fat: [h(2, 1), h(6, 1)], clap: [h(2, 0.5), h(6, 0.55)],
    hat: at([1, 1.5, 3, 5, 5.5, 7], 0.4), metal: [h(3.75, 0.45), h(7.5, 0.55)], crash: [h(0, 0.6)] } },
  { id: "rd-metal", genre: "riddim", name: "Riddim · металлический", sig: "4/4", len: 4, tags: "140 · лязг", notes: {
    punch: [h(0, 1), h(1.75, 0.6)], fat: [h(2, 1)], metal: [h(1, 0.5), h(2.75, 0.4), h(3.5, 0.55)], rim: at([0.5, 3.25], 0.4), hat: at([1.5, 3], 0.35) } },
  { id: "rd-impact", genre: "riddim", name: "Riddim · удар на «раз»", sig: "4/4", len: 8, tags: "140 · начало дропа", notes: {
    punch: [h(0, 1), h(4, 1), h(5.5, 0.7)], impact: [h(0, 0.9)], crash: [h(0, 0.7)], fat: [h(2, 1), h(6, 1)], hat: at([1, 3, 5, 7], 0.4), ohat: [h(7.5, 0.4)] } },
  { id: "tr-808", genre: "trap", name: "Trap · 808 + рим", sig: "4/4", len: 8, tags: "140 · 808", notes: {
    k808: [h(0, 1), h(1.5, 0.85), h(4, 1), h(6.5, 0.85)], snap: [h(2, 0.9), h(6, 0.9)], rim: [h(3.75, 0.4), h(7.25, 0.4)],
    hat: [...range(0, 3, 0.5).map(s => h(s, 0.45)), ...range(3, 4, 0.125).map(s => h(s, 0.3)), ...range(4, 8, 0.5).map(s => h(s, 0.45))], ohat: [h(5.5, 0.35)] } },
  { id: "tr-cowbell", genre: "trap", name: "Phonk · каубелл", sig: "4/4", len: 4, tags: "130 · Memphis", notes: {
    k808: [h(0, 1), h(1.5, 0.8), h(2.75, 0.7)], clap: [h(1, 0.9), h(3, 0.9)], cowbell: [0, 0.5, 0.75, 1.5, 2, 2.5, 2.75, 3.5].map((s, i) => h(s, i % 3 ? 0.5 : 0.8)), hat: hats8(4, 0.45, 0.3) } },
  { id: "dn-ride", genre: "dnb", name: "DnB · райд и шейкер", sig: "4/4", len: 4, tags: "174 · катит", notes: {
    punch: [h(0, 1), h(2.5, 0.85)], fat: [h(1, 1), h(3, 1)], ride: at([0, 1, 2, 3], 0.4), shaker: range(0, 4, 0.25).map((s, i) => h(s, i % 2 ? 0.3 : 0.45)) } },
  { id: "el-perc", genre: "electro", name: "Tech house · перкуссия", sig: "4/4", len: 4, tags: "126 · конги", notes: {
    kick: at([0, 1, 2, 3], 1), clap: [h(1, 0.8), h(3, 0.8)], ohat: at([0.5, 1.5, 2.5, 3.5], 0.5), shaker: range(0, 4, 0.25).map((s, i) => h(s, i % 2 ? 0.4 : 0.25)),
    conga: [h(0.75, 0.5), h(1.25, 0.4), h(2.75, 0.55), h(3.25, 0.4), h(3.5, 0.5)], rim: [h(2.25, 0.35)] } },
  { id: "el-rim", genre: "electro", name: "Minimal · рим и шейкер", sig: "4/4", len: 4, tags: "124", notes: {
    kick: at([0, 1, 2, 3], 0.95), rim: [h(0.75, 0.5), h(2.5, 0.45), h(3.75, 0.4)], shaker: range(0, 4, 0.25).map((s, i) => h(s + (i % 2 ? 0.05 : 0), i % 2 ? 0.45 : 0.25)), snap: [h(1, 0.7), h(3, 0.7)] } },
);
for (const d of DRUMS) d.genre ||= d.riddim ? "riddim" : /dnb|jungle/.test(d.id) ? "dnb" : d.id === "trap" ? "trap" : ["house", "afro128"].includes(d.id) ? "electro" : "odd";
export const GENRES = { riddim: "🔥 Риддим / дабстеп", trap: "🪤 Трэп / дрилл / фонк", dnb: "⚡ Drum'n'bass / jungle", electro: "🎛 Электроника: house, techno, garage, breaks…", odd: "🌀 Нечётные размеры" };

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
const K = (s, l, n, v) => [s, l, n, v ?? 0.85];
export const KITS = [
  // риддим
  { id: "k-growl", genre: "riddim", name: "Riddim · рык-стабы", tags: "Riddim Growl", len: 4, parts: [
    { name: "Growl", preset: "Riddim Growl", make: d => [K(0, 0.75, d(0, -1)), K(0.75, 0.25, d(0, -1), 0.7), K(1, 0.5, d.semi(1, -1)), K(2, 1, d(0, -1)), K(3, 0.25, d(0, 0)), K(3.25, 0.25, d(0, -1)), K(3.5, 0.5, d.semi(-1, -1))] }] },
  { id: "k-fmchop", genre: "riddim", name: "Riddim · FM-чопы", tags: "Grapefruit Riddim FM", len: 4, parts: [
    { name: "FM chop", type: "grapefruit", preset: "Riddim FM", make: d => [0, 0.5, 1, 1.5, 2, 2.5, 3].map((s, i) => K(s, 0.45, i === 5 ? d.semi(1, -1) : d(0, -1), i % 2 ? 0.7 : 0.9)).concat([K(3.5, 0.25, d(0, 0)), K(3.75, 0.25, d.semi(-1, -1))]) }] },
  { id: "k-wobble", genre: "riddim", name: "Дабстеп · воббл", tags: "Wobble · длинные ноты", len: 8, parts: [
    { name: "Wobble", preset: "Wobble", make: d => [K(0, 2, d(0, -1)), K(2, 1, d(0, -1)), K(3, 1, d.semi(3, -1)), K(4, 2, d(0, -1)), K(6, 1.5, d.semi(-2, -1)), K(7.5, 0.5, d.semi(-1, -1))] }] },
  // трэп
  { id: "k-808", genre: "trap", name: "Trap · 808 со скольжением", tags: "Sub Bass · глайды", len: 8, parts: [
    { name: "808", preset: "Sub Bass", make: d => [K(0, 1.5, d(0, -1), 0.95), [2.5, 1, d(0, -1), 0.85, 3], K(4, 1.5, d(5, -2), 0.95), [5.75, 0.75, d(4, -2), 0.85, -2], K(6.5, 1.5, d(0, -1), 0.9)] }] },
  { id: "k-trapkeys", genre: "trap", name: "Trap · колокольчики", tags: "Neon Pluck · минор", len: 8, parts: [
    { name: "Trap keys", preset: "Neon Pluck", make: d => [[0, 4], [0.75, 2], [1.5, 4], [2, 7], [3, 5], [4, 4], [4.75, 2], [5.5, 1], [6, 2], [7, 0]].map(([s, k]) => K(s, 0.5, d(k, 1), 0.75)) }] },
  // dnb
  { id: "k-reese", genre: "dnb", name: "DnB · рис-бас", tags: "Reese · тянется", len: 8, parts: [
    { name: "Reese", preset: "Reese", make: d => [K(0, 3, d(0, -1)), K(3, 1, d(5, -2)), K(4, 2.5, d(6, -2)), K(6.5, 1.5, d(4, -2))] }] },
  { id: "k-neuro", genre: "dnb", name: "Neurofunk · бас", tags: "Grapefruit Neuro Bass", len: 4, parts: [
    { name: "Neuro", type: "grapefruit", preset: "Neuro Bass", make: d => [K(0, 0.5, d(0, -1)), K(0.75, 0.25, d(0, -1), 0.7), K(1.5, 0.5, d.semi(1, -1)), K(2.5, 0.25, d(0, 0)), K(2.75, 0.75, d(0, -1)), K(3.5, 0.5, d.semi(-1, -1))] }] },
  { id: "k-liquid", genre: "dnb", name: "Liquid · пэд + плак", tags: "Ambient Pad + Neon Pluck", len: 8, parts: [
    { name: "Liquid pad", preset: "Ambient Pad", make: d => [0, 2, 4].map(t => K(0, 4, d(t, 0), 0.55)).concat([5, 7, 9].map(t => K(4, 4, d(t, -1), 0.55))) },
    { name: "Liquid pluck", preset: "Neon Pluck", make: d => [0, 0.5, 1.5, 2, 3, 4, 4.5, 5.5, 6, 7].map((s, i) => K(s, 0.4, d([4, 2, 0, 2, 4, 5, 4, 2, 0, -1][i], 1), 0.7)) }] },
  { id: "k-jump", genre: "dnb", name: "Jump-up · прыгающий синт (октавы)", tags: "Wobble · скачет", len: 4, parts: [
    { name: "Jump", preset: "Wobble", make: d => [K(0, 0.25, d(0, -1)), K(0.25, 0.25, d(0, 0), 0.75), K(0.75, 0.25, d(0, -1)), K(1.5, 0.25, d(0, 0), 0.8), K(1.75, 0.25, d(0, -1)),
      K(2, 0.125, d(0, -1), 0.7), K(2.125, 0.125, d(0, -1), 0.6), K(2.25, 0.125, d(0, -1), 0.75), K(2.375, 0.125, d(0, -1), 0.65), K(2.75, 0.5, d.semi(3, -1)), K(3.5, 0.25, d(0, 0), 0.85), K(3.75, 0.25, d.semi(-2, -1))] }] },
  { id: "k-bounce", genre: "dnb", name: "DnB · FM-плак с ответом", tags: "Grapefruit Pluck · 3/4", len: 8, parts: [
    { name: "Bounce", type: "grapefruit", preset: "Pluck", make: d => [0, 0.75, 1.5, 2.25, 3, 3.5].map((s, i) => K(s, 0.3, d([0, 2, 4, 2, 7, 4][i], 0), i % 3 ? 0.65 : 0.9))
      .concat([K(4, 0.3, d(5, 0)), K(4.75, 0.3, d(4, 0), 0.7), K(5.5, 0.3, d(2, 0)), K(6.25, 0.125, d(0, 1), 0.7), K(6.375, 0.125, d(0, 1), 0.6), K(6.5, 0.125, d(0, 1), 0.75), K(6.625, 0.125, d(0, 1), 0.65), K(7, 0.5, d(4, 0))]) }] },
  { id: "k-dnbbass", genre: "dnb", name: "DnB · рис + саб (роллер)", tags: "Reese + Sub Bass", len: 4, parts: [
    { name: "Reese roll", preset: "Reese", make: d => [K(0, 0.75, d(0, -1)), K(0.75, 0.25, d(0, -1), 0.7), K(1.5, 0.5, d(0, -1)), K(2.5, 0.5, d.semi(3, -1)), K(3, 0.25, d(0, -1), 0.7), K(3.5, 0.5, d.semi(-2, -1))] },
    { name: "Sub roll", preset: "Sub Bass", make: d => [K(0, 1, d(0, -2), 0.95), K(1.5, 0.5, d(0, -2), 0.9), K(2.5, 0.75, d.semi(3, -2), 0.9), K(3.5, 0.5, d.semi(-2, -2), 0.9)] }] },
  { id: "k-neurostab", genre: "dnb", name: "Neuro · стабы-ответ", tags: "Grapefruit Iron Yoi FM", len: 4, parts: [
    { name: "Neuro stab", type: "grapefruit", preset: "Iron Yoi FM", make: d => [K(0.5, 0.25, d(0, 0)), K(1.25, 0.25, d(0, 0), 0.7), K(2, 0.125, d(0, 1), 0.8), K(2.125, 0.125, d(0, 1), 0.7), K(2.25, 0.25, d(0, 0)), K(3.25, 0.5, d.semi(-1, 0))] }] },
  // электроника
  { id: "k-hoover", genre: "electro", name: "Рейв · хувер-рифф", tags: "Hoover", len: 8, parts: [
    { name: "Hoover", preset: "Hoover", make: d => [K(0, 1.5, d(0, 0)), [1.5, 0.5, d(0, 0), 0.85, 2], K(2, 1, d(2, 0)), K(3, 1, d(0, 0)), K(4, 1.5, d(-1, 0)), K(5.5, 0.5, d(0, 0)), K(6, 2, d(-2, 0))] }] },
  { id: "k-trance", genre: "electro", name: "Транс · суперсо-арп", tags: "Supersaw Lead · 16-е", len: 8, parts: [
    { name: "Trance arp", preset: "Supersaw Lead", make: d => range(0, 8, 0.25).map((s, i) => K(s, 0.22, d([0, 2, 4, 7, 4, 2, 0, 4][i % 8] + (s >= 4 ? 5 : 0), 0), i % 4 ? 0.6 : 0.85)) }] },
  { id: "k-house", genre: "electro", name: "House · аккорды на слабую", tags: "Digital Keys · стабы", len: 4, parts: [
    { name: "House stabs", type: "grapefruit", preset: "Digital Keys", make: d => [0.5, 1.5, 2.5, 3.5].flatMap((s, i) => [0, 2, 4].map(t => K(s, 0.3, d(t + (i >= 2 ? 3 : 0), 0), 0.7))) }] },
  { id: "k-acid", genre: "electro", name: "Techno · кислотная линия", tags: "Wobble · 16-е", len: 4, parts: [
    { name: "Acid", preset: "Wobble", make: d => range(0, 4, 0.25).map((s, i) => K(s, 0.2, [d(0, -1), d(0, 0), d.semi(3, -1), d(0, -1), d.semi(7, -1), d(0, -1), d.semi(10, -1), d(0, 0)][i % 8], i % 3 ? 0.65 : 0.9)) }] },

  { id: "crushriddim", name: "Crush-риддим (медленная + быстрая атака)", tags: "cojam · 2 баса", riddim: true,
    parts: [
      { name: "Crush Slow", preset: "Crush Bass Slow", make: deg => [[0, 1, deg(0, -1)], [1, 1, deg(0, -1)], [2, 1, deg(0, -1)]] },
      { name: "Crush Snap", preset: "Crush Bass Snap", make: deg => [[3, 0.5, deg.semi(-1, -1)], [3.5, 0.5, deg.semi(-1, -1)]] }] },
  { id: "crushriddim2", name: "Crush-риддим: вариация с октавой", tags: "cojam · 2 баса", riddim: true,
    parts: [
      { name: "Crush Slow", preset: "Crush Bass Slow", make: deg => [[0, 0.75, deg(0, -1)], [0.75, 0.25, deg(0, -1), 0.7], [1, 0.5, deg(0, -1)], [1.5, 0.5, deg(0, 0), 0.8], [2, 1, deg(0, -1)]] },
      { name: "Crush Snap", preset: "Crush Bass Snap", make: deg => [[3, 0.25, deg.semi(-1, -1)], [3.25, 0.25, deg.semi(-1, -1), 0.7], [3.5, 0.5, deg.semi(-3, -1)]] }] },
  { id: "metal", name: "Metal Crush: C… B", tags: "cojam · металл, Tone дышит по нотам", riddim: true, sig: [4, 4], len: 8,
    parts: [{ name: "Metal Crush", preset: "Metal Crush", make: deg => [0, 1, 2, 3, 4].map(s => [s, 1, deg(0, -1)]).concat([5, 6, 7].map(s => [s, 1, deg.semi(-1, -1)])) }] },
];

/* ступени лада канала → номер ноты: deg(k, octShift) с переходом через октаву */
export function degreeFn(ch) {
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

export function ensureDrum(role) {
  const P = Engine.project, name = BUILTIN[ROLES[role]];
  let ch = P.channels.find(c => c.id === role) || P.channels.find(c => c.type === "sampler" && c.params.path === "builtin:" + ROLES[role]);
  if (!ch) { ch = Engine.addChannel("sampler", name, { path: "builtin:" + ROLES[role] }); Engine.setSample(ch, "builtin:" + ROLES[role]); }
  return ch;
}

/* что даёт элемент библиотеки: { name, kind: "drums" | "synth", sig?, len?, notes: { channelId: [нота] } } (каналы создаются здесь) */
function build(id, Dawn) {
  const P = Engine.project;
  if (id.startsWith("u:")) return buildOwn(id.slice(2));
  const d = DRUMS.find(x => x.id === id);
  if (d) {
    const notes = {};
    for (const [role, list] of Object.entries(d.notes)) {
      const ch = ensureDrum(role), pitch = Engine.defaultPitch(ch);
      notes[ch.id] = list.map(([s, l, , v]) => ({ s, l, n: pitch, v }));
    }
    return { name: d.name, kind: "drums", sig: d.sig.split("/").map(Number), len: d.len, notes };
  }
  const kit = KITS.find(x => x.id === id);
  if (kit) {
    const ref = Engine.chan(Dawn?.pianoCh), notes = {};
    for (const part of kit.parts) {
      // канал с этим пресетом уже есть — переиспользуем, иначе новый (лад и строй — как у выбранного канала)
      let ch = P.channels.find(c => c.preset === part.preset);
      if (!ch) {
        ch = Engine.addChannel(part.type || "osc3", part.name);
        if (ref && ref.type !== "sampler") { ch.edo = ref.edo; ch.scale = { ...ref.scale }; }
        ch.poly = 1;
        applyPreset(Engine, ch, part.preset);
      }
      const deg = degreeFn(ch), E = ch.edo || 12;
      deg.semi = (s, oct = 0) => deg(0, oct) + Math.round(s * E / 12);   // рифф от полутонов над тоникой (F → E — как в оригинале)
      notes[ch.id] = part.make(deg).map(([s, l, n, v = 0.85, b]) => ({ s, l, n, v, ...(b ? { b } : {}) }));
    }
    return { name: kit.name.split(" (")[0].split(":")[0], kind: "synth", sig: kit.sig || (kit.len ? [4, 4] : [8, 8]), len: kit.len, notes };
  }
  const m = MELODIC.find(x => x.id === id);
  if (m) {
    let ch = Engine.chan(Dawn?.pianoCh);
    if (!ch || ch.type === "sampler") ch = P.channels.find(c => c.type !== "sampler") || Engine.addChannel("osc3");
    const bar = Math.max(2, Engine.barLen(Engine.pat()));
    if (Dawn) Dawn.pianoCh = ch.id;
    return { name: `${m.name.split(":")[0]} · ${ch.name}`, kind: "synth", notes: { [ch.id]: m.make(degreeFn(ch), bar).map(([s, l, nn, v]) => ({ s, l, n: nn, v })) } };
  }
  return null;
}

/* свой паттерн: ударные — по ролям, синты — каналы с тем же именем и типом (нет — создаются со своим звуком) */
function buildOwn(name) {
  const u = UserLib.get("patterns", name), P = Engine.project;
  if (!u) return null;
  const notes = {};
  for (const [role, list] of Object.entries(u.drums || {})) {
    if (!ROLES[role]) continue;
    const ch = ensureDrum(role), pitch = Engine.defaultPitch(ch);
    notes[ch.id] = list.map(([s, l, v]) => ({ s, l, n: pitch, v }));
  }
  for (const sy of u.synths || []) {
    let ch = P.channels.find(c => c.type === sy.type && c.name === sy.name);
    if (!ch) {
      ch = Engine.addChannel(sy.type, sy.name);
      ch.params = JSON.parse(JSON.stringify(sy.params)); ch.edo = sy.edo || 12; ch.scale = { ...(sy.scale || ch.scale) };
      const i = ch.mix || 0;
      if (i > 0 && sy.fx?.length) { P.mixer[i].fx = JSON.parse(JSON.stringify(sy.fx)); Engine.G.rebuildFx(i); }
      for (const [k, m] of (sy.mods || []).entries()) P.mods.push({ id: `u${ch.id}${k}`.slice(0, 24), presetOf: ch.id, type: m.type, name: m.name, color: ch.color, value: m.value ?? 0.5,
        trig: { ch: ch.id, att: 5, hold: 40, rel: 250, vel: true, ...m.trig }, meter: { mix: i, gain: 1.5 }, env: m.env || { len: 16, loop: true, pts: [[0, 0], [16, 1]] },
        lfo: m.lfo || { sync: 3, shape: "sine", phase: 0 }, wires: m.wires.map(w => ({ to: w.to.replace(/^fx\./, `mix.${i}.`).replace(/^ch\./, `ch.${ch.id}.`), amt: w.amt })) });
    }
    notes[ch.id] = sy.notes.map(([s, l, n, v]) => ({ s, l, n, v }));
  }
  return { name: "⭐ " + name, kind: u.kind, sig: u.sig, len: u.len, notes };
}

/* добавить элемент библиотеки → id паттерна.
 * into — id паттерна, в который вписать: ноты той же категории (ударные или синты) заменяются, остальное остаётся.
 * Без into — новый паттерн (так работает перетаскивание на плейлист). */
export function instantiate(id, Dawn, into = null) {
  const P = Engine.project, b = build(id, Dawn);
  if (!b) return null;
  let pat = into && Engine.pat(into);
  if (!pat) {
    pat = Engine.addPattern(b.name);
    pat.color = PASTEL[(P.patterns.length + 2) % PASTEL.length];
    pat.sig = b.sig ? [...b.sig] : [...Engine.pat().sig];
    if (b.len) pat.len = b.len;
    Object.assign(pat.notes, b.notes);
  } else {
    const isDrum = chId => Engine.chan(chId)?.type === "sampler";
    const same = chId => b.kind === "all" || (b.kind === "drums") === isDrum(chId);
    const others = Object.entries(pat.notes).some(([c, L]) => L.length && !same(c));
    for (const c of Object.keys(pat.notes)) if (same(c)) pat.notes[c] = [];
    if (!others && b.sig) { pat.sig = [...b.sig]; pat.len = b.len || null; }
    // в паттерне уже есть другая категория — его длину не трогаем, новое повторяем/обрезаем по ней
    const L = Engine.patLength(pat.id), span = b.len || L;
    for (const [c, list] of Object.entries(b.notes)) {
      const out = [];
      for (let k = 0; k < L - 1e-9; k += span) for (const n of list) if (n.s + k < L - 1e-9) out.push({ ...n, s: +(n.s + k).toFixed(4) });
      pat.notes[c] = out;
    }
  }
  Engine.touch({ patterns: true, notes: true, channels: true });
  return pat.id;
}

for (const k of KITS) k.genre ||= k.riddim ? "riddim" : "electro";
