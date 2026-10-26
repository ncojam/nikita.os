import { GF_PRESETS, snapRatio } from "./grapefruit.js";
import { scaleSet } from "./tuning.js";
import { UserLib } from "./userlib.js";

/* ================= DAWN — «соус»: хорошие практики, которые применяются вместе =================
 * sauce      — приёмы фразы поверх нот: срыв на октаву выше, зацикливание ноты (рэтчет 1/16…1/32), укороченные
 *              «чопы», удлинённые ноты, перегруппировка по 3/4 доли (3 против 4 — новый ритм). Всё сразу, с одной силой.
 * GRAPH      — граф «что с чем дружит»: пресеты синтов, грувы, киты. Встроенные связи + то, что ты отметил 👍.
 * gfVariant  — умная вариация Grapefruit: смотрит на исходный синт и меняет 4 оператора согласованно
 *              (ratio, матрица, огибающие, уровни — по одному шаблону связи), а не одну крутилку.
 * Функции принимают генератор случайных чисел R — у «Магии» он с зерном, повтор зерна = тот же результат.
 */
const deep = o => JSON.parse(JSON.stringify(o));
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const r4 = v => +(+v).toFixed(4);
const pickR = (R, a) => a[Math.floor(R() * a.length)];

/* ---------------------------------------------------------------- соус фразы */
export const SAUCE = { oct: "срыв на октаву", ratchet: "зацикленная нота", chop: "укороченные чопы", long: "удлинённые", three: "перегруппировка 3/4" };
/* notes — ноты ОДНОГО канала; ctx = { bar, L, E, amount 0..1, R, only?: [kinds] }. Возвращает { notes, used } */
export function sauce(notes, ctx) {
  const { bar, L, E = 12, amount = 0.5, R = Math.random } = ctx, on = k => !ctx.only || ctx.only.includes(k);
  let out = notes.map(n => ({ ...n })).sort((a, b) => a.s - b.s);
  const used = new Set();
  if (!out.length || amount <= 0) return { notes: out, used: [] };
  // 3/4: окно в 3 доли (или 1.5 на коротких) — ноты окна идут сеткой по 0.75 (или 0.375): «3 против 4»
  if (on("three") && L >= 4 && R() < amount * 0.55) {
    const win = R() < 0.6 ? 3 : 1.5, st = win === 3 ? 0.75 : 0.375;
    let a = Math.floor(R() * Math.max(1, Math.floor(L / bar))) * bar + (win <= bar - 1 && R() < 0.5 ? 1 : 0);
    if (a + win > L) a = Math.max(0, L - win);
    const inW = out.filter(n => n.s >= a - 1e-6 && n.s < a + win - 1e-6);
    if (inW.length) {
      out = out.filter(n => !inW.includes(n));
      const pitches = inW.map(n => n.n);
      for (let s = a, k = 0; s < a + win - 1e-6; s += st, k++) out.push({ ...inW[k % inW.length], s: r4(s), l: r4(st * (k % 3 === 2 ? 0.5 : 0.85)), n: pitches[k % pitches.length] });
      used.add("three");
    }
  }
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const n = out[i], next = out[i + 1], posInBar = (n.s % bar) / bar, phraseEnd = posInBar >= 0.74 && Math.floor(n.s / bar) % 2 === 1;
    // срыв на октаву выше: чаще в конце фразы; иногда «пробежка» из 2–3 нот подряд
    if (on("oct") && R() < amount * (phraseEnd ? 0.45 : 0.14)) {
      const run = R() < 0.35 ? 2 + Math.floor(R() * 2) : 1;
      for (let k = 0; k < run && out[i + k]; k++) out[i + k].n += E, out[i + k].v = Math.min(1, out[i + k].v + 0.05);
      used.add("oct");
    }
    // зацикленная нота: длинная нота дробится на 1/8 → 1/16 → 1/32, громкость волной
    if (on("ratchet") && n.l >= 0.24 && R() < amount * (posInBar >= 0.5 ? 0.38 : 0.18)) {
      const fast = amount > 0.7 && R() < 0.5, st = n.l >= 1 && !fast ? 0.125 : fast ? 0.0625 : 0.125, end = n.s + n.l;
      for (let s = n.s, k = 0; s < end - 1e-6; s += (k > 3 && fast ? 0.0625 : st), k++)
        res.push({ ...n, s: r4(s), l: r4(Math.min(st * 0.8, end - s)), v: +clamp(n.v * (k % 2 ? 0.72 : 1) * (1 - 0.15 * (s - n.s) / n.l + 0.15 * R()), 0.05, 1).toFixed(3), x: undefined });
      used.add("ratchet");
      continue;
    }
    // укороченный чоп: нота обрывается на половине — дырка даёт грув
    if (on("chop") && n.l >= 0.2 && R() < amount * 0.22) { res.push({ ...n, l: r4(n.l * (R() < 0.5 ? 0.5 : 0.33)) }); used.add("chop"); continue; }
    // удлинённая: тянется до следующей ноты, огибающая растягивается (поле x)
    if (on("long") && next && next.s - n.s <= bar / 2 + 1e-6 && R() < amount * 0.12) {
      const l = next.s + next.l - n.s;
      res.push({ ...n, l: r4(l), x: r4(Math.min(8, l / Math.max(0.05, n.l))) }); i++; used.add("long"); continue;
    }
    res.push(n);
  }
  for (const n of res) if (n.x === undefined) delete n.x;
  return { notes: res.sort((a, b) => a.s - b.s), used: [...used].map(k => SAUCE[k]) };
}

/* «ответ» второго синта: заполняет паузы первого мотивом из его нот — терция/квинта лада или октава выше,
 * со сдвигом на полдоли (эхо-перекличка). key = { E, root, mode } */
export function answerNotes(lead, ctx) {
  const { bar, L, key, R = Math.random, amount = 0.5 } = ctx, E = key.E, set = scaleSet(E, key.mode, key.root);
  const snap = n => { for (let d = 0; d < E; d++) { if (set.has(((n + d) % E + E) % E)) return n + d; if (set.has(((n - d) % E + E) % E)) return n - d; } return n; };
  const src = [...lead].sort((a, b) => a.s - b.s), out = [];
  const busy = s => src.some(n => s >= n.s - 1e-6 && s < n.s + n.l - 1e-6);
  const shift = pickR(R, [E, Math.round(7 * E / 12), Math.round(4 * E / 12), E, Math.round(3 * E / 12)]);
  for (let b = 0; b < L - 1e-6; b += bar / 2) {
    const prev = src.filter(n => n.s >= b - bar / 2 - 1e-6 && n.s < b - 1e-6);
    const motif = prev.length ? prev : src.filter(n => n.s < bar / 2);
    // если в этой половине первый синт молчит хотя бы полдоли — отвечаем
    let free = 0; for (let s = b; s < b + bar / 2 - 1e-6; s += 0.25) if (!busy(s)) free++;
    if (free < 2 && R() > amount * 0.3) continue;
    for (const n of motif) {
      const s = b + (n.s - (prev.length ? b - bar / 2 : 0));
      if (s >= L - 1e-6 || (busy(s) && R() > 0.25)) continue;
      out.push({ s: r4(s), l: r4(Math.min(n.l, 0.5, L - s)), n: snap(n.n + shift), v: +clamp(n.v * 0.85, 0.05, 1).toFixed(3) });
    }
  }
  return out;
}

/* ---------------------------------------------------------------- граф «что с чем дружит» */
// узлы: имя пресета, "g:<грув>", "k:<кит>", "s:<стиль>". Вес 0..1. Связи неориентированные.
const EDGES = [
  // стиль → грувы
  ["s:dnb", "g:dnb44", 0.6], ["s:dnb", "g:dn-roller", 0.9], ["s:dnb", "g:dn-jump", 0.95], ["s:dnb", "g:dn-dance", 0.9], ["s:dnb", "g:dn-ghost", 0.8],
  ["s:dnb", "g:dn-amen", 0.7], ["s:dnb", "g:dn-neuro", 0.75], ["s:dnb", "g:dn-think", 0.7], ["s:jungle", "g:jungle", 0.9], ["s:jungle", "g:dn-amen", 0.9], ["s:jungle", "g:dn-think", 0.8],
  ["s:riddim", "g:riddim44", 0.8], ["s:riddim", "g:rd-bounce", 0.8], ["s:riddim", "g:rd-heavy", 0.8], ["s:riddim", "g:rd-ghost", 0.7], ["s:riddim", "g:rd-brostep", 0.6],
  ["s:trap", "g:tr-trip", 0.8], ["s:trap", "g:tr-drill", 0.7], ["s:house", "g:house", 0.8], ["s:break", "g:el-breaks", 0.7],
  // стиль → синты дропа
  ["s:dnb", "Reese", 0.9], ["s:dnb", "Neuro Bass", 0.9], ["s:dnb", "Hoover", 0.7], ["s:dnb", "Wobble", 0.75], ["s:dnb", "FM Bass", 0.7], ["s:dnb", "Iron Yoi FM", 0.65],
  ["s:dnb", "Riddim Yoi", 0.55], ["s:dnb", "Metal Crush", 0.5], ["s:dnb", "Grind Fifth", 0.55], ["s:dnb", "Neon Pluck", 0.6], ["s:dnb", "Pluck", 0.7], ["s:dnb", "Supersaw Lead", 0.55],
  ["s:riddim", "Metal Crush", 0.95], ["s:riddim", "Metal Creak FM", 0.85], ["s:riddim", "Iron Yoi FM", 0.8], ["s:riddim", "Riddim Heavy Slow", 0.8], ["s:riddim", "Metal Rise", 0.8], ["s:riddim", "Extreme Creak FM", 0.75],
  // синт ↔ грув
  ["Reese", "g:dn-roller", 0.9], ["Reese", "g:dn-ghost", 0.8], ["Neuro Bass", "g:dn-neuro", 0.95], ["Neuro Bass", "g:dn-dance", 0.8], ["Wobble", "g:dn-jump", 0.95], ["Hoover", "g:dn-amen", 0.8],
  ["Hoover", "g:dn-jump", 0.75], ["FM Bass", "g:dn-dance", 0.75], ["Metal Crush", "g:riddim44", 0.9], ["Metal Crush", "g:rd-bounce", 0.85],
  // синт ↔ синт: кто кому хорошо отвечает (перекличка, бас + лид)
  ["Reese", "Neon Pluck", 0.85], ["Reese", "Supersaw Lead", 0.7], ["Reese", "Pluck", 0.8], ["Neuro Bass", "Iron Yoi FM", 0.8], ["Neuro Bass", "Metal Pluck", 0.75],
  ["Wobble", "Hoover", 0.8], ["Wobble", "Chip Lead", 0.7], ["FM Bass", "Pluck", 0.8], ["FM Bass", "Bell", 0.6], ["Hoover", "Supersaw Lead", 0.6],
  ["Pluck", "Glass Pad", 0.7], ["Neon Pluck", "Ambient Pad", 0.8], ["Metal Crush", "Metal Creak FM", 0.85], ["Metal Crush", "Iron Yoi FM", 0.8], ["Riddim Yoi", "Metal Pluck", 0.6],
  ["Sub Bass", "Reese", 0.8], ["Sub Bass", "Neuro Bass", 0.7], ["Sub Bass", "Wobble", 0.7],
  // кит ↔ грув
  ["k:k-jump", "g:dn-jump", 0.95], ["k:k-reese", "g:dn-roller", 0.9], ["k:k-neuro", "g:dn-neuro", 0.9], ["k:k-bounce", "g:dn-dance", 0.85], ["k:k-dnbbass", "g:dn-ghost", 0.85],
];
const W = new Map();
const key = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
for (const [a, b, w] of EDGES) W.set(key(a, b), w);
const learned = () => (UserLib.data.graph ||= {});
export function weight(a, b) { return clamp((W.get(key(a, b)) || 0) + (learned()[key(a, b)] || 0), 0, 1.5); }
/* «понравилось» / «не то»: связи между всеми узлами списка усиливаются (или ослабевают) — следующая генерация учтёт */
export function like(nodes, delta = 0.15) {
  const L = learned(), list = [...new Set(nodes.filter(Boolean))];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const k = key(list[i], list[j]); L[k] = +clamp((L[k] || 0) + delta, -1, 1).toFixed(3); }
  UserLib.save();
  return list.length;
}
/* выбрать кандидата, который лучше всех дружит со всеми узлами контекста; случайность — по весам (рулетка) */
export function pickFriend(context, candidates, R = Math.random, avoid = []) {
  const cand = candidates.filter(c => !avoid.includes(c));
  if (!cand.length) return candidates[0];
  const sc = cand.map(c => 0.12 + context.filter(Boolean).reduce((s, x) => s + weight(x, c), 0));
  let t = R() * sc.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cand.length; i++) if ((t -= sc[i]) <= 0) return cand[i];
  return cand.at(-1);
}

/* ---------------------------------------------------------------- умная вариация Grapefruit */
/* шаблоны связи 4 операторов (лучшие практики FM): ratio, матрица, кто несущая */
export const GF_REL = {
  stack: { r: [1, 1, 2, 0.5], m: { m21: 0.6, m32: 0.4 }, out: [1, 0, 0, 0.45], name: "цепочка 3→2→1 + саб-несущая" },
  pairs: { r: [1, 2, 0.5, 1], m: { m21: 0.55, m43: 0.45 }, out: [0.8, 0, 0.5, 0], name: "две FM-пары 2→1 и 4→3" },
  fan:   { r: [1, 1, 2, 3], m: { m21: 0.5, m31: 0.3, m41: 0.2 }, out: [1, 0, 0, 0], name: "веер 2,3,4 → 1" },
  yoi:   { r: [1, 1, 2, 0.5], m: { m21: 0.65, m32: 0.35 }, out: [0.9, 0, 0, 0.45], yoi: true, name: "«йо-ой»: глубина FM говорит внутри ноты" },
  pluck: { r: [1, 2, 3, 1], m: { m21: 0.7, m32: 0.4 }, out: [1, 0, 0, 0.3], pluck: true, name: "плак: модуляторы гаснут быстрее несущей" },
  bell:  { r: [1, 3.5, 1, 5.19], m: { m21: 0.5, m43: 0.35 }, out: [1, 0, 0.5, 0], metal: true, name: "металл: негармоничные пары" },
};
const ROLE_REL = { drop: ["stack", "yoi", "pairs", "fan"], bass: ["stack", "yoi", "pairs"], answer: ["pluck", "pairs", "fan", "bell"], lead: ["pluck", "pairs", "fan"], variant: Object.keys(GF_REL) };
const MODK = ["m21", "m31", "m41", "m32", "m42", "m43"];
const brightness = p => MODK.reduce((s, k) => { const j = +k[1] - 1; return s + (p.mod?.[k] || 0) * (p.ops[j]?.ratio || 1) * (p.ops[j]?.level ?? 1); }, 0);
const closestRel = p => Object.entries(GF_REL).sort(([, a], [, b]) => dist(p, a) - dist(p, b))[0][0];
function dist(p, rel) { return p.ops.reduce((s, o, i) => s + Math.abs(Math.log2((o.ratio || 1) / rel.r[i])) + Math.abs((o.out || 0) - rel.out[i]), 0) + MODK.reduce((s, k) => s + Math.abs((p.mod?.[k] || 0) - (rel.m[k] || 0)), 0); }

/* лучшие найденные Grapefruit-синты: встроенные пресеты + твои сохранённые ★ */
export function bestGF() {
  const own = Object.entries(UserLib.data.synth || {}).filter(([, v]) => v?.type === "grapefruit" && v.params?.ops).map(([n, v]) => ["★ " + n, v.params]);
  return [...Object.entries(GF_PRESETS), ...own];
}
/* src — params Grapefruit; opt = { amount 0..1, role, cool 0..1, from: имя пресета (для графа), context: узлы графа, R }
 * возвращает { params, said, preset } — preset: чей «характер» подмешан */
export function gfVariant(src, opt = {}) {
  const R = opt.R || Math.random, amount = clamp(opt.amount ?? 0.5), role = opt.role || "variant", t = deep(src);
  t.mod ||= {};
  const said = [];
  // 1. характер лучшего синта, который дружит с исходным (и со стилем) — подмешиваем частично
  const best = bestGF(), names = best.map(b => b[0]);
  const chosen = pickFriend([opt.from, ...(opt.context || [])], names, R, [opt.from]);
  const bp = best.find(b => b[0] === chosen)?.[1];
  if (bp?.ops && amount > 0.15) {
    const k = amount * 0.5;
    t.ops.forEach((o, i) => {
      const b = bp.ops[i] || {};
      for (const f of ["level", "out", "att", "dec", "sus", "rel", "wfold", "wsk", "wcrush"]) if (typeof b[f] === "number") o[f] = +lerp(o[f] ?? 0, b[f], k).toFixed(4);
      if (b.env && R() < k) o.env = deep(b.env);
      if (i > 0 && b.wave && R() < k) o.wave = b.wave;   // у несущей волна своя — это «лицо» синта
    });
    for (const m of MODK) t.mod[m] = +lerp(t.mod[m] || 0, bp.mod?.[m] || 0, k).toFixed(3);
    said.push(`характер «${chosen}» на ${Math.round(k * 100)}%`);
  }
  // 2. шаблон связи — другой, чем сейчас (иначе вариации не слышно)
  const now = closestRel(src), relName = pickR(R, ROLE_REL[role].filter(r => r !== now).concat(ROLE_REL[role].length === 1 ? ROLE_REL[role] : []));
  const rel = GF_REL[relName], w = clamp(0.35 + amount * 0.65), car = t.ops[0];
  const darkSrc = brightness(src) < 0.9;
  const lift = role === "answer" && darkSrc ? 2 : 1;   // ответ тёмному синту — на октаву светлее
  t.ops.forEach((o, i) => {
    let r = lerp(o.ratio || 1, rel.r[i] * (i === 0 ? lift : 1), w);
    o.ratio = rel.metal && opt.cool > 0.6 ? +r.toFixed(3) : snapRatio(r);
    o.harmonic = !rel.metal;
    o.out = +lerp(o.out || 0, rel.out[i], w).toFixed(3);
  });
  for (const m of MODK) t.mod[m] = +lerp(t.mod[m] || 0, rel.m[m] || 0, w).toFixed(3);
  // 3. огибающие согласованно: высокий модулятор гаснет быстрее (естественное потемнение), уровень ~ 1/√ratio
  const cd = car.dec ?? 0.3, ca = car.att ?? 0.003;
  t.ops.forEach((o, i) => {
    if (i === 0) return;
    const isMod = o.out < 0.15;
    if (isMod) { o.level = +clamp(lerp(o.level ?? 1, 1 / Math.sqrt(o.ratio || 1), w), 0.2, 1).toFixed(3); o.dec = +Math.max(0.03, cd * (0.35 + 0.65 / (o.ratio || 1))).toFixed(3); }
    o.att = +lerp(o.att ?? ca, ca, w).toFixed(4);   // общая атака — без щелчков и «разъезда»
  });
  if (rel.pluck || role === "answer") {   // прыгающий ответ: короткий, без сустейна у модуляторов
    car.dec = +clamp(car.dec ?? 0.3, 0.15, 0.4).toFixed(3); car.sus = Math.min(car.sus ?? 0.5, 0.25);
    t.ops.slice(1).forEach(o => { if (o.out < 0.15) o.sus = Math.min(o.sus ?? 0, 0.1); });
  }
  if (rel.yoi) { const m = t.ops[1]; m.env ||= {}; m.env.vol = { on: true, sus: 3, pts: pickR(R, [[[0, 0.15], [0.09, 1], [0.22, 0.35], [0.4, 0.8], [0.5, 0.2]], [[0, 1], [0.06, 0.3], [0.2, 0.9], [0.32, 0.6], [0.45, 0]]]) }; }
  // 4. яркость: ответ — контраст исходнику, вариация дропа — рядом (±20%), с «крутостью» — злее
  const target = brightness(src) * (role === "answer" ? (darkSrc ? 1.5 : 0.7) : 0.85 + 0.3 * R()) * (1 + 0.35 * ((opt.cool ?? 0.5) - 0.5));
  const nowB = brightness(t);
  if (nowB > 0.01 && target > 0.01) { const f = clamp(target / nowB, 0.4, 2.2); for (const m of MODK) t.mod[m] = +clamp(t.mod[m] * f, 0, 0.95).toFixed(3); }
  // 5. несущие в сумме ~1 — громкость не прыгает
  const so = t.ops.reduce((s, o) => s + (o.out || 0), 0);
  if (so > 1.3) t.ops.forEach(o => { o.out = +(o.out / so * 1.2).toFixed(3); });
  // волна несущей: у ответа — дополняющая, у вариаций — своя
  if (role === "answer") car.wave = { sawtooth: "square", square: "sawtooth", sine: "triangle", triangle: "square" }[car.wave] || "square";
  said.unshift(`связь операторов: ${rel.name} (ratio ${t.ops.map(o => +(+o.ratio).toFixed(2)).join(":")})`);
  t.fit = true;
  return { params: t, said, preset: chosen };
}
