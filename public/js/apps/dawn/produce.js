import { Engine, PASTEL } from "./engine.js";
import { fxDefaults } from "./fx.js";
import { dawnParam } from "./modcore.js";
import { applyPreset } from "./presets.js";
import { DRUMS, ensureDrum } from "./library.js";
import { analyze, roleOf } from "./magic.js";
import { c4 } from "./tuning.js";
import { addMod, insertOf } from "./wubs.js";

/* ================= DAWN — «продюсер»: одна кнопка — одно улучшение =================
 * 🔊 саб — отдельный синус-бас под нотами синта во всех паттернах (моно, сайдчейн от бочки), у синта режется низ.
 * 🔥 прокачать — движение внутри ноты (глубина FM, Fold), питч-дайв в атаке, цепочка dist → OTT → EQ, LFO от ноты к ноте, саб.
 * 📈 автоматизация — огибающая по нотам паттерна на то, что звучит интереснее всего (FM, форма волны, фильтр).
 * 🔀 сосед — второй синт и два паттерна: перекличка (A и B по полтакта) и переход (A перетекает в B).
 * 🍖 жир — цепочка эффектов для бочки, малого/хлопка, хэтов.
 * 🚀 всё сразу — ударные (если нет), саб, жир, автоматизация и паттерны с соседом — из пары нарисованных нот.
 * Автоматизация с ручки на выделенный участок плейлиста — automateAddr.
 */
const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
const P = () => Engine.project;
const N = (s, l, n, v) => ({ s: +s.toFixed(4), l: +Math.max(0.03, l).toFixed(4), n, v: +Math.min(1, Math.max(0.05, v)).toFixed(3) });
const deep = o => JSON.parse(JSON.stringify(o));
/* по отзывам: основа — семейство Metal Crush (басовый звук с нарастающим металлом); Laser и Tearout в генерилки не берём,
 * Neuro Bass — изредка */
export const METAL_OSC3 = ["Metal Crush", "Metal Rise", "Metal Creak", "Metal Snap", "Metal Yoi", "Metal Deep", "Grind Fifth"];
/* демо 3: холодный Screech, Howl, Screech Rise, Growl Rise, Shred — в генерилки не берём */
export const RIDDIM_GF = ["Metal Creak FM", "Extreme Creak FM", "Metal Scream FM", "Iron Yoi Up FM", "Iron Yoi FM", "Creak Glide FM", "Metal Crush FM", "Riddim Heavy Slow"];
export function pickRiddim() { const r = rnd(); return r < 0.06 ? ["grapefruit", "Neuro Bass"] : r < 0.5 ? ["osc3", pick(METAL_OSC3)] : ["grapefruit", pick(RIDDIM_GF)]; }

/* эффекты на свой инсерт канала: такой же тип — подправить, нет — добавить (максимум 4) */
function chain(ch, list) {
  const i = insertOf(Engine, ch);
  if (i <= 0) return 0;
  const fx = P().mixer[i].fx;
  let n = 0;
  for (const [type, p] of list) {
    const f = fx.find(x => x.type === type);
    if (f) { Object.assign(f.p, p); f.on = true; n++; }
    else if (fx.length < 4) { fx.push({ type, on: true, p: { ...fxDefaults(type), ...p } }); n++; }
  }
  Engine.G.rebuildFx(i);
  return n;
}
const patsWith = ch => P().patterns.filter(p => p.notes[ch.id]?.length);
const kickCh = () => P().channels.find(c => roleOf(c) === "kick");

/* ---------- 🔊 саб ---------- */
function subLine(notes, E, lo) {
  const out = [];
  for (const n of [...notes].sort((a, b) => a.s - b.s)) {
    const pitch = lo + (((n.n - lo) % E) + E) % E, prev = out.at(-1);
    if (prev && prev.s + prev.l > n.s - 1e-6) prev.l = Math.max(0.03, n.s - prev.s);   // моно: одна нота за раз
    if (prev && prev.n === pitch && n.s - (prev.s + prev.l) < 0.13) { prev.l = n.s + n.l - prev.s; continue; }   // одна высота подряд — тянем
    out.push(N(n.s, n.l, pitch, 0.9));
  }
  return out;
}
export function addSub(ch, said = []) {
  if (!ch || ch.type === "sampler") return said;
  let sub = P().channels.find(c => c.subOf === ch.id) || P().channels.find(c => /^sub\b|саб/i.test(c.name) && c.type === "osc3");
  const made = !sub;
  if (made) {
    sub = Engine.addChannel("osc3", "Sub · " + ch.name.slice(0, 16));
    applyPreset(Engine, sub, "Sub Bass");
    Object.assign(sub, { subOf: ch.id, poly: 1, vol: 0.8, edo: ch.edo || 12, scale: { ...(ch.scale || {}) } });
    const k = kickCh(), i = sub.mix || 0;
    if (k && i > 0) chain(sub, [["side", { src: k.id, amount: 0.55, release: 0.18 }]]);
  }
  const E = sub.edo || 12, lo = c4(E) - 3 * E + Math.round(4 * E / 12);   // E1…D#2: 41–78 Гц
  let n = 0;
  for (const p of patsWith(ch)) { p.notes[sub.id] = subLine(p.notes[ch.id], E, lo); n++; }
  // синту — срез низа, низ теперь держит саб
  if (chain(ch, [["eq", { lf: 120, lg: -10, mf: 900, mg: 1, hf: 7000, hg: 0 }]])) said.push(`у «${ch.name}» срезан низ до 120 Гц`);
  said.unshift(`саб «${sub.name}» под нотами «${ch.name}» в ${n} паттерн(ах)` + (made ? ", сайдчейн от бочки" : ""));
  Engine.touch({ channels: true, notes: true, mixer: true });
  return said;
}

/* ---------- 🔥 прокачать риддим-синт ---------- */
export function pump(ch, said = []) {
  const p = ch.params;
  if (ch.type === "grapefruit") {
    const ops = p.ops, car = ops.reduce((a, b, i) => (b.out > ops[a].out ? i : a), 0), m = p.mod ||= {};
    // главный модулятор несущей; его огибающая громкости = глубина FM внутри ноты («йо-о-ой»)
    let mod = [0, 1, 2, 3].filter(i => i !== car).sort((a, b) => (m[`m${b + 1}${car + 1}`] || 0) - (m[`m${a + 1}${car + 1}`] || 0))[0];
    const key = `m${mod + 1}${car + 1}`;
    m[key] = Math.max(m[key] || 0, 0.45);
    const mo = ops[mod];
    mo.env ||= {};
    if (!mo.env.vol?.on) mo.env.vol = { on: true, sus: 3, pts: pick([[[0, 0.15], [0.09, 1], [0.22, 0.35], [0.4, 0.8], [0.5, 0.2]], [[0, 1], [0.06, 0.3], [0.2, 0.9], [0.32, 0.6], [0.45, 0]], [[0, 0.2], [0.18, 1], [0.24, 0.5], [0.4, 0]]]) };
    if ([1, 0.5, 2, 3, 4].every(r => Math.abs(mo.ratio * 2 ** (mo.oct || 0) - r) > 0.01)) mo.ratio = pick([1, 2, 0.5]);   // гармонично — злость даёт форма, а не расстройка
    const co = ops[car];
    co.env ||= {};
    co.wfold = Math.max(co.wfold || 0, 0.15 + rnd() * 0.2);
    if (!co.env.fold?.on) co.env.fold = { on: true, sus: 2, pts: [[0, 0.1], [0.1, 0.7 + rnd() * 0.3], [0.28, 0.35], [0.45, 0.05]] };
    if (!co.env.pitch?.on) co.env.pitch = { on: true, sus: -1, range: 12, pts: [[0, 0.62], [0.035, 0.5], [0.4, 0.5]] };   // питч-дайв в атаке — удар
    if (!ops.some(o => o.fit)) mo.fit = true;
    p.res = Math.max(p.res ?? 1, 2.5);
    addMod(Engine, ch, { type: "lfo", name: "🔥 " + ch.name.slice(0, 14), lfo: { sync: pick([0, 1, 1, 3]), shape: pick(["random", "square", "saw"]), phase: 0 },
      wires: [{ to: `ch.${ch.id}.op${car + 1}.wfold`, amt: 0.35 }, { to: `ch.${ch.id}.${key}`, amt: 0.25 }] });
    said.push(`глубина FM ${mod + 1}→${car + 1} «говорит» внутри ноты, Fold раскрывает атаку, питч-дайв, LFO меняет форму от ноты к ноте`);
  } else if (ch.type === "osc3") {
    // как Metal Crush: синус октавой ниже + немного квадрата, crush с закрытым Tone, Tone нарастает внутри ноты
    applyPreset(Engine, ch, pick(METAL_OSC3.slice(1)));
    said.push(`звук — «${ch.preset}»: басовый синус, металл и скрип нарастают внутри ноты`);
    if (!P().channels.some(c => c.subOf === ch.id)) addSub(ch, said);
    Engine.touch({ channels: true, mixer: true, mods: true });
    return said;
  }
  chain(ch, [["dist", { drive: 0.65, shape: pick([0, 2, 3]), tone: 7000, mix: 1, out: 0.55 }], ["ott", { depth: 0.85, time: 0.5, high: 3 }], ["eq", { lf: 120, lg: -10, mf: 900, mg: 2, hf: 6500, hg: -1 }]]);
  said.push("цепочка: дисторшн → OTT → EQ");
  ch.preset = undefined;
  if (!P().channels.some(c => c.subOf === ch.id)) addSub(ch, said);
  Engine.touch({ channels: true, mixer: true, mods: true });
  return said;
}

/* ---------- 📈 красивая автоматизация ---------- */
// сколько можно двинуть параметр от текущего значения (в долях диапазона), направление — туда, где есть место
function amtFor(addr, cap) {
  const t = dawnParam(P(), addr);
  if (!t?.spec) return 0;
  const { min, max } = t.spec, b = t.get(), up = (max - b) / (max - min), down = (b - min) / (max - min);
  return up >= down ? Math.min(up * 0.85, cap) : -Math.min(down * 0.85, cap);
}
const SHAPES = {
  talk: (k, q) => [0.15, 1, 0.45, 0.85, 0.25, 0.7][k % 6],          // «говорит»: от ноты к ноте
  rise: (k, q, bar) => (q * 4) % 1,                                   // нарастает каждый такт
  wave: (k, q) => 0.5 + 0.5 * Math.sin(q * Math.PI * 4),               // волна на два такта
  climb: (k, q) => q,                                                 // через весь паттерн
};
export function automate(ch, said = []) {
  const pat = (P().cur && Engine.pat()?.notes[ch.id]?.length) ? Engine.pat() : patsWith(ch)[0];
  if (!pat) { said.push("у синта нет нот — сначала нарисуй пару"); return said; }
  const L = Engine.patLength(pat.id), notes = [...pat.notes[ch.id]].sort((a, b) => a.s - b.s), p = ch.params;
  const targets = [];
  if (ch.type === "grapefruit") {
    const ops = p.ops, car = ops.reduce((a, b, i) => (b.out > ops[a].out ? i : a), 0);
    const mk = Object.keys(p.mod || {}).filter(k => +k[2] === car + 1 && p.mod[k] > 0.01).sort((a, b) => p.mod[b] - p.mod[a])[0] || `m2${car + 1}`;
    targets.push([`ch.${ch.id}.${mk}`, 0.45, "глубина FM"], [`ch.${ch.id}.op${car + 1}.${pick(["wfold", "wsk"])}`, 0.5, "форма волны"]);
  } else {
    const i = ch.mix || 0, d = i > 0 ? P().mixer[i].fx.findIndex(f => f.type === "dist") : -1;
    targets.push([`ch.${ch.id}.res`, 0.35, "резонанс"]);
    if (d >= 0) targets.push([`mix.${i}.${d}.tone`, 0.4, "тон дисторшна"]);
  }
  targets.push([`ch.${ch.id}.cut`, 0.22, "фильтр"]);
  const kinds = Object.keys(SHAPES).sort(() => rnd() - 0.5), made = [];
  targets.forEach(([addr, cap, label], ti) => {
    const amt = amtFor(addr, cap);
    if (!amt) return;
    const sh = SHAPES[kinds[ti % kinds.length]], pts = [];
    notes.forEach((n, k) => { const v = +Math.max(0, Math.min(1, sh(k, n.s / L))).toFixed(3); if (!pts.length || pts.at(-1)[0] < n.s - 1e-6) pts.push([+n.s.toFixed(4), v]); });
    if (pts[0]?.[0] > 0) pts.unshift([0, pts[0][1]]);
    pts.push([L, pts[0]?.[1] ?? 0]);
    made.push({ to: addr, amt: +amt.toFixed(3), pts, label, kind: kinds[ti % kinds.length] });
  });
  for (const m of made) {
    (P().mods ||= []).push({ id: "a" + Math.random().toString(36).slice(2, 8), type: "env", name: ("📈 " + m.label).slice(0, 24), color: ch.color, value: 0,
      env: { len: L, loop: true, pts: m.pts }, lfo: { sync: 3, shape: "sine", phase: 0 }, trig: {}, meter: {}, wind: {}, wires: [{ to: m.to, amt: m.amt }] });
  }
  said.push("автоматизация по нотам «" + pat.name + "»: " + made.map(m => `${m.label} (${{ talk: "от ноты к ноте", rise: "нарастает в такте", wave: "волна", climb: "через паттерн" }[m.kind]})`).join(", "));
  Engine.touch({ mods: true, param: true });
  return said;
}

/* ---------- 🔀 сосед: второй синт, перекличка и переход ---------- */
function newPattern(src, name, notes) {
  const prev = P().cur, p = Engine.addPattern(name);
  Object.assign(p, { sig: [...src.sig], len: src.len, notes, color: PASTEL[(P().patterns.length + 2) % PASTEL.length] });
  Engine.selectPattern(prev);
  return p;
}
export function neighbour(ch, said = []) {
  const src = Engine.pat()?.notes[ch.id]?.length ? Engine.pat() : patsWith(ch)[0];
  if (!src) { said.push("у синта нет нот — сначала нарисуй пару"); return said; }
  let [typeB, presetB] = pickRiddim();
  while (presetB === ch.preset) [typeB, presetB] = pickRiddim();
  const b = Engine.addChannel(typeB, (ch.name.replace(/ ⇄.*$/, "") + " ⇄ " + presetB.replace(/^Riddim /, "")).slice(0, 24));
  applyPreset(Engine, b, presetB);
  Object.assign(b, { edo: ch.edo || 12, scale: { ...(ch.scale || {}) }, poly: ch.poly || 1, vol: ch.vol, color: PASTEL[(P().channels.length + 3) % PASTEL.length] });
  b.params.fit = true;
  const L = Engine.patLength(src.id), bar = Engine.barLen(src), half = bar / 2, A = src.notes[ch.id];
  // перекличка: A и B по полтакта (вопрос — ответ)
  const call = deep(src.notes);
  call[ch.id] = A.filter(n => Math.floor(n.s / half) % 2 === 0).map(n => ({ ...n }));
  call[b.id] = A.filter(n => Math.floor(n.s / half) % 2 === 1).map(n => ({ ...n }));
  const p1 = newPattern(src, `${src.name} · перекличка`, call);
  // переход: первая четверть — A, последняя — B, в середине оба звучат и перетекают по громкости
  const tr = deep(src.notes);
  tr[ch.id] = []; tr[b.id] = [];
  for (const n of A) {
    const q = n.s / L, w = Math.max(0, Math.min(1, (q - 0.25) * 2));   // 0 → 1 между ¼ и ¾ паттерна
    if (w < 1) tr[ch.id].push({ ...n, v: +(n.v * (1 - w * 0.85)).toFixed(3) });
    if (w > 0) tr[b.id].push({ ...n, v: +(n.v * (0.15 + w * 0.85)).toFixed(3) });
  }
  const p2 = newPattern(src, `${src.name} · переход`, tr);
  said.push(`сосед «${b.name}» (${presetB}) — паттерны «${p1.name}» и «${p2.name}»`);
  Engine.touch({ channels: true, patterns: true, notes: true, mixer: true, mods: true });
  return said;
}

/* ---------- 🍖 жир на ударные ---------- */
const FAT = {
  kick: [["eq", { lf: 55, lg: 4, mf: 350, mg: -4, mq: 1, hf: 4500, hg: 3 }], ["dist", { drive: 0.35, shape: 0, tone: 9000, mix: 0.6, out: 0.75 }], ["comp", { thresh: -14, ratio: 4, attack: 0.012, release: 0.12, gain: 4 }]],
  snare: [["eq", { lf: 190, lg: 3, mf: 900, mg: -2, mq: 1, hf: 6000, hg: 4 }], ["dist", { drive: 0.3, shape: 0, tone: 10000, mix: 0.5, out: 0.75 }], ["comp", { thresh: -16, ratio: 5, attack: 0.003, release: 0.1, gain: 5 }], ["reverb", { decay: 0.9, pre: 0.01, mix: 0.18, low: 300 }]],
  hat: [["eq", { lf: 400, lg: -10, mf: 3000, mg: -1, hf: 9000, hg: 4 }], ["ott", { depth: 0.5, high: 3 }], ["delay", { sync: 0, fb: 0.15, mix: 0.08, pp: 1 }], ["reverb", { decay: 0.6, mix: 0.12, low: 500 }]],
};
const FAT_ROLE = { kick: "kick", snare: "snare", clap: "snare", tom: "snare", hat: "hat", ohat: "hat", perc: "hat" };
export function fatten(ch, said = []) {
  const r = FAT_ROLE[roleOf(ch)] || "hat";
  chain(ch, FAT[r]);
  said.push(`«${ch.name}»: ` + { kick: "низ +4 дБ на 55 Гц, щелчок, сатурация, компрессор", snare: "тело 190 Гц, верх, сатурация, компрессор, короткий ревер", hat: "низ срезан, верх, OTT, короткое эхо" }[r]);
  Engine.touch({ mixer: true });
  return said;
}

/* ---------- 🚀 всё сразу ---------- */
function drumsInto(pat, L, said) {
  const bpm = P().bpm, genre = bpm >= 160 ? "dnb" : bpm >= 128 ? pick(["riddim", "riddim", "trap"]) : "electro";
  const fits = DRUMS.filter(d => d.genre === genre && (d.sig || "4/4") === "4/4" && L % d.len < 1e-6);
  const g = pick(fits.length ? fits : DRUMS.filter(d => d.genre === "riddim"));
  for (let k = 0; k < L - 1e-9; k += g.len) for (const [role, list] of Object.entries(g.notes)) {
    const ch = ensureDrum(role), out = (pat.notes[ch.id] ||= []);
    for (const [s, l, , v] of list) if (s + k < L) out.push(N(s + k, l, Engine.defaultPitch(ch), v * (k ? 0.92 + 0.12 * rnd() : 1)));
  }
  said.push(`ударные: «${g.name}»`);
}
export function produceAll(said = []) {
  const A = analyze(), pat = A.pat;
  const main = A.wub?.ch || A.synths.at(-1)?.ch || A.synths[0]?.ch;
  if (!main) { said.push("нарисуй хотя бы пару нот синтом — дальше я сам"); return said; }
  if (!Object.keys(A.drums).length) drumsInto(pat, A.L, said);
  addSub(main, said);
  for (const ch of P().channels) if (roleOf(ch) && pat.notes[ch.id]?.length && !(P().mixer[ch.mix || 0]?.fx.length) && (ch.mix || 0) > 0) fatten(ch, said);
  automate(main, said);
  neighbour(main, said);
  Engine.touch({ channels: true, patterns: true, notes: true, mixer: true, mods: true });
  return said;
}

/* ---------- автоматизация на выделенный участок плейлиста (ПКМ по ручке) ---------- */
export const AUTO_SHAPES = { up: "↗ Нарастание", down: "↘ Спад", hill: "⛰ Вверх-вниз", wave: "∿ Волна (в такт)", steps: "▚ Ступеньки по долям" };
export function automateAddr(addr, shape = "up") {
  const t = dawnParam(P(), addr);
  if (!t?.spec) return null;
  const sel = Engine.plSel?.e > Engine.plSel?.s ? Engine.plSel : { s: 0, e: Math.max(4, Engine.songLength()) };
  const { s, e } = sel, len = e - s, pts = [[0, 0]];
  if (s > 0) pts.push([+(s - 0.001).toFixed(3), 0]);
  const at = (q, v) => pts.push([+(s + q * len).toFixed(3), +Math.max(0, Math.min(1, v)).toFixed(3)]);
  if (shape === "up") { at(0, 0); for (let i = 1; i <= 8; i++) at(i / 8, (i / 8) ** 2); }
  else if (shape === "down") { at(0, 1); for (let i = 1; i <= 8; i++) at(i / 8, 1 - Math.sqrt(i / 8)); }
  else if (shape === "hill") { for (let i = 0; i <= 16; i++) at(i / 16, Math.sin(Math.PI * i / 16)); }
  else if (shape === "wave") { const n = Math.max(1, Math.round(len / 4)) * 8; for (let i = 0; i <= n; i++) at(i / n, 0.5 - 0.5 * Math.cos(Math.PI * 2 * i / 8)); }
  else { for (let b = 0; b < len - 1e-9; b += 1) { const v = [0.2, 1, 0.5, 0.8][Math.round(b) % 4]; at(b / len, v); at(Math.min(1, (b + 0.999) / len), v); } }
  pts.push([+(e + 0.001).toFixed(3), 0]);
  const amt = amtFor(addr, 0.6) || 0.3;
  const label = t.label.split(" · ").pop();
  const m = { id: "a" + Math.random().toString(36).slice(2, 8), type: "env", name: ("📈 " + label).slice(0, 24), color: PASTEL[(P().mods?.length || 0) % PASTEL.length], value: 0,
    env: { len: e + 0.01, loop: false, pts }, lfo: { sync: 3, shape: "sine", phase: 0 }, trig: {}, meter: {}, wind: {}, wires: [{ to: addr, amt: +amt.toFixed(3) }] };
  (P().mods ||= []).push(m);
  Engine.touch({ mods: true, param: true });
  return { m, s, e, label };
}

/* кнопки в окне инструмента */
export const PRODUCE = {
  sub: { icon: "🔊", title: "Саб-бас под этот синт: синус на E1–D#2 по нотам во всех паттернах (моно, сайдчейн от бочки), у синта срезается низ", for: ch => ch.type !== "sampler" },
  pump: { icon: "🔥", title: "Прокачать риддим-синт: глубина FM и форма волны двигаются внутри ноты, питч-дайв, дисторшн → OTT → EQ, LFO от ноты к ноте, саб", for: ch => ch.type !== "sampler" },
  auto: { icon: "📈", title: "Красивая автоматизация: огибающие по нотам паттерна на FM, форму волны и фильтр", for: ch => ch.type !== "sampler" },
  pair: { icon: "🔀", title: "Сосед: новый риддим-синт и два паттерна — перекличка (по полтакта) и переход (один синт перетекает в другой)", for: ch => ch.type !== "sampler" },
  fat: { icon: "🍖", title: "Жир: EQ, сатурация, компрессор (и ревер / эхо) под бочку, малый или хэты", for: ch => ch.type === "sampler" },
};
export function produce(kind, ch) {
  try {
    return { sub: addSub, pump, auto: automate, pair: neighbour, fat: fatten }[kind]?.(ch, []) || [];
  } catch (e) { console.error("produce", kind, e); return ["⚠ " + e.message]; }
}
