import { fxDefaults } from "./fx.js";
import { PASTEL } from "./engine.js";

/* ================= DAWN — вубы: подстройка огибающей, улучшайзер, клоны для вариаций =================
 * fitParams — галочка «⇔ под длину ноты»: атака/спад/релиз ужимаются, если нота короче их (частые вубы слышны),
 *   у Grapefruit — и ADSR операторов, и нарисованные огибающие.
 * enhance — «улучшайзер» синта 3XOSC: + металл, + бас, + модуляция, реверс атаки, 🎲 случайный риддим-вуб.
 * cloneWub — клон канала со своим инсертом (эффекты копируются) — под «медленный» и «металлический» вуб в вариациях.
 */
const rnd = Math.random, pick = a => a[Math.floor(rnd() * a.length)];
const deep = o => JSON.parse(JSON.stringify(o));

/* огибающая под длину ноты: атака не дольше ~45% ноты, спад — 35%, релиз — половины */
export function fitParams(p, type, dur) {
  const fit = o => {
    const a = o.att ?? 0, k = a > dur * 0.45 ? (dur * 0.45) / a : 1;
    const q = { ...o, att: a * k, dec: Math.min(o.dec ?? 0, Math.max(0.005, dur * 0.35)), rel: Math.min(o.rel ?? 0, Math.max(0.01, dur * 0.5)) };
    return q;
  };
  if (type === "grapefruit") {
    return { ...p, ops: p.ops.map(o => {
      const q = fit(o);
      if (o.env) {   // нарисованные огибающие тоже сжимаем по времени, если они длиннее ноты
        q.env = {};
        for (const [k, e] of Object.entries(o.env)) {
          if (!e?.pts?.length) { q.env[k] = e; continue; }
          const end = e.sus >= 0 ? e.pts[e.sus]?.[0] ?? 0 : Math.max(...e.pts.map(x => x[0]));
          const s = end > dur * 0.9 && end > 0 ? (dur * 0.9) / end : 1;
          q.env[k] = s < 1 ? { ...e, pts: e.pts.map(([t, v]) => [t * s, v]) } : e;
        }
      }
      return q;
    }) };
  }
  return fit(p);
}

/* растяжение огибающей у отдельной ноты (поле x): атака и спад × k — «вууууб» из двух вубов */
export function stretchParams(p, type, k) {
  const st = o => ({ ...o, att: (o.att ?? 0) * k, dec: (o.dec ?? 0) * k });
  if (type === "grapefruit") return { ...p, ops: p.ops.map(o => {
    const q = st(o);
    if (o.env) { q.env = {}; for (const [kd, e] of Object.entries(o.env)) q.env[kd] = e?.pts ? { ...e, pts: e.pts.map(([t, v]) => [t * k, v]) } : e; }
    return q;
  }) };
  return st(p);
}

/* ---------- улучшайзер (3XOSC) ---------- */
function insertOf(Engine, ch) {
  const P = Engine.project;
  let i = ch.mix || 0;
  const shared = k => k <= 0 || P.channels.some(c => c !== ch && (c.mix || 0) === k);
  if (shared(i)) {   // эффекты нужны своему инсерту
    const free = P.mixer.findIndex((m, k) => k > 0 && !P.channels.some(c => c !== ch && c.mix === k));
    if (free > 0) { ch.mix = free; P.mixer[free].name = ch.name.slice(0, 20); Engine.G.refresh(); i = free; } else return -1;
  }
  return i;
}
function addMod(Engine, ch, m) {
  const P = Engine.project;
  (P.mods ||= []).push({ id: "w" + Math.random().toString(36).slice(2, 7), presetOf: ch.id, color: ch.color, value: 0.5,
    meter: { mix: ch.mix || 1, gain: 1.5 }, env: { len: 4, loop: true, pts: [[0, 0], [4, 1]] }, lfo: { sync: 2, shape: "sine", phase: 0 },
    trig: { ch: ch.id, att: 5, hold: 40, rel: 250, vel: true }, ...m });
}
export const ENHANCE = { metal: "＋ Металл", bass: "＋ Бас", mod: "＋ Модуляция", revatt: "⟲ Реверс атаки", fit: "⇔ Атака под длину ноты", random: "🎲 Случайный риддим-вуб" };
export function enhance(Engine, ch, kind, said = []) {
  const p = ch.params, P = Engine.project;
  if (kind === "metal") {
    // металл: квадрат на октаву выше с расстройкой + crush с низким Tone, который приоткрывает каждая нота
    const o = p.oscs.reduce((a, b) => (b.o_vol < a.o_vol ? b : a));
    Object.assign(o, { wave: "square", o_vol: 0.3, o_crs: 12, o_fin: 7 + Math.round(rnd() * 8) });
    const i = insertOf(Engine, ch);
    if (i > 0) {
      const fx = P.mixer[i].fx;
      let k = fx.findIndex(f => f.type === "dist");
      if (k < 0 && fx.length < 4) { fx.unshift({ type: "dist", on: true, p: fxDefaults("dist") }); k = 0; }
      if (k >= 0) {
        Object.assign(fx[k].p, { shape: 3, drive: 0.8, tone: 500 + Math.round(rnd() * 300), mix: 1, out: 1.1 });
        Engine.G.rebuildFx(i);
        addMod(Engine, ch, { type: "trig", name: "Metal tone", trig: { ch: ch.id, att: 40 + rnd() * 60, hold: 60 + rnd() * 60, rel: 250, vel: true }, wires: [{ to: `mix.${i}.${k}.tone`, amt: 0.45 }] });
      }
    }
    said.push("металл: квадрат +12 с расстройкой, crush с низким Tone, Tone раскрывается на каждой ноте");
  } else if (kind === "bass") {
    const o = p.oscs.find(x => x.wave === "sine") || p.oscs.reduce((a, b) => (b.o_vol < a.o_vol ? b : a));
    Object.assign(o, { wave: "sine", o_vol: Math.max(o.o_vol, 0.85), o_crs: Math.min(o.o_crs, -12), o_fin: 0, o_pan: 0 });
    const i = insertOf(Engine, ch);
    if (i > 0 && P.mixer[i].fx.length < 4 && !P.mixer[i].fx.some(f => f.type === "eq")) {
      P.mixer[i].fx.push({ type: "eq", on: true, p: { ...fxDefaults("eq"), lf: 60, lg: 4, mf: 300, mg: -2 } });
      Engine.G.rebuildFx(i);
    }
    said.push("бас: синус на октаву ниже + низкая полка EQ");
  } else if (kind === "mod") {
    const sync = pick([0, 1, 2, 3]), i = ch.mix || 0, dist = i > 0 ? P.mixer[i].fx.findIndex(f => f.type === "dist") : -1;
    const wires = [{ to: `ch.${ch.id}.cut`, amt: 0.2 + rnd() * 0.15 }];
    if (dist >= 0) wires.push({ to: `mix.${i}.${dist}.tone`, amt: 0.25 });
    addMod(Engine, ch, { type: "lfo", name: "Wub LFO", lfo: { sync, shape: pick(["sine", "triangle", "square", "saw"]), phase: 0 }, wires });
    p.res = Math.max(p.res, 4 + rnd() * 6);
    said.push("модуляция: LFO в такт на фильтр" + (dist >= 0 ? " и Tone дисторшна" : "") + ", резонанс выше");
  } else if (kind === "revatt") {
    Object.assign(p, { att: 0.25 + rnd() * 0.2, dec: 0.02, sus: 1, rel: 0.01, fit: true });
    said.push("реверс атаки: звук нарастает и обрывается (с подстройкой под длину ноты)");
  } else if (kind === "fit") {
    p.fit = !p.fit;
  } else if (kind === "random") {
    const waves = ["sawtooth", "square", "sawtooth", "square", "triangle"];
    p.oscs.forEach((o, k) => Object.assign(o, k === 1
      ? { wave: "sine", o_vol: 0.85, o_crs: -12, o_fin: 0, o_pan: 0 }
      : { wave: pick(waves), o_vol: 0.3 + rnd() * 0.35, o_crs: pick([0, 0, 12, 7, -12]), o_fin: Math.round((rnd() - 0.5) * 24), o_pan: (rnd() - 0.5) * 0.6 }));
    Object.assign(p, { att: pick([0.002, 0.03, 0.12, 0.25, 0.38]), dec: 0.1 + rnd() * 0.2, sus: pick([0, 0.6, 1]), rel: 0.02,
      cut: 400 + rnd() * 1400, res: 2 + rnd() * 9, uni: pick([1, 1, 2, 3]), udet: 10 + rnd() * 30, fit: true });
    if (rnd() < 0.6) enhance(Engine, ch, "metal", said);
    if (rnd() < 0.7) enhance(Engine, ch, "mod", said);
    said.unshift(`случайный вуб: атака ${p.att.toFixed(3)} с, фильтр ${Math.round(p.cut)} Гц`);
  }
  ch.preset = undefined;
  Engine.touch({ channels: true, mixer: true, mods: true });
  return said;
}

/* клон канала со своим инсертом (эффекты — копией) */
export function cloneWub(Engine, ch, name) {
  const P = Engine.project, c = Engine.cloneChannel(ch.id);
  if (!c) return null;
  c.name = name.slice(0, 24); c.color = PASTEL[(P.channels.length + 5) % PASTEL.length];
  const i = c.mix || 0, src = ch.mix || 0;
  if (i > 0 && src > 0) { P.mixer[i].fx = deep(P.mixer[src].fx); P.mixer[i].name = c.name.slice(0, 20); P.mixer[i].vol = P.mixer[src].vol; Engine.G.rebuildFx(i); }
  return c;
}
