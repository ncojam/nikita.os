import { FX } from "./fx.js";
import { GF_SPECS } from "./grapefruit.js";
import { SPECS } from "./instruments.js";
import { SYNC } from "./fx.js";

/* ================= DAWN — ядро модуляции (без UI, без звука) =================
 * Источник модуляции (project.mods[]):
 *   { id, type: "knob" | "env" | "lfo" | "meter" | "trig", name, color,
 *     meter: { mix, gain }                          — уровень инсерта микшера (бочка громче → больше)
 *     trig: { ch, att, hold, rel (мс), vel }        — огибающая, которая стартует от каждой ноты канала ch
 *     wind: { input: id источника | "", strength, gust } — ветер: качает провода на экране и сам служит источником
 *     value: 0..1                                   — knob: ручка, которую крутят руками
 *     env: { len (доли), loop, pts: [[x, y]] }      — огибающая: точки (x — доли, y — 0..1), едет вместе с песней
 *     lfo: { sync: 0..N, shape, phase }             — LFO: период из SYNC (как у дилея), формы sine/tri/saw/square/random
 *     wires: [{ to: адрес параметра, amt: -1..1 }] } — проводки
 * Значение источника 0..1. Цель = база + amt · (v − центр) · (max − min), центр 0.5 у LFO (качает в обе стороны)
 * и 0 у ручки/огибающей. Несколько проводов в одну цель складываются.
 *
 * Адреса DAWN: ch.<канал>.vol | pan | <параметр> | osc1.o_vol | op2.ratio | m21 ;  mix.<инсерт>.vol | pan | <слот>.<параметр>.
 * Адреса ОС (os.*) и любых других модулей — через core/params.js.
 */
export const LFO_SHAPES = ["sine", "triangle", "saw", "square", "random"];
export const LFO_SYNC = [...SYNC, ["2 такта", 8], ["4 такта", 16]];

/* rt — «живые» данные, которых нет в проекте: rt.meter(i) — уровень инсерта, rt.notes(chId) — [{t, v}] начала нот, rt.now — время звука */
export function srcValue(src, beat, rt) {
  if (src.type === "knob") return clamp01(src.value ?? 0.5);
  if (src.type === "meter") return clamp01((rt?.meter?.(src.meter?.mix ?? 1) || 0) * (src.meter?.gain ?? 1));
  if (src.type === "wind") {   // ветер: вход (другой источник или 1) × сила × порывы
    const w = src.wind || {}, inp = w.input ? (rt?.srcVal?.(w.input) ?? 0) : 1, t = (rt?.now ?? 0) * (0.3 + 3 * (w.gust ?? 0.4));
    const gust = 0.55 + 0.25 * Math.sin(t * 1.3) + 0.12 * Math.sin(t * 3.7 + 1) + 0.08 * Math.sin(t * 7.9 + 2);
    return clamp01((w.strength ?? 0.5) * inp * gust);
  }
  if (src.type === "trig") return trigValue(src.trig || {}, rt?.notes?.(src.trig?.ch) || [], rt?.now ?? 0);
  if (src.type === "env") {
    const e = src.env || {}, pts = (e.pts || []).slice().sort((a, b) => a[0] - b[0]), len = Math.max(0.25, e.len || 16);
    if (!pts.length) return 0;
    const x = e.loop === false ? Math.min(beat, len) : ((beat % len) + len) % len;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      if (x <= x2) return x2 === x1 ? y2 : y1 + (y2 - y1) * (x - x1) / (x2 - x1);
    }
    return pts.at(-1)[1];
  }
  if (src.type === "lfo") {
    const l = src.lfo || {}, per = LFO_SYNC[Math.round(l.sync ?? 3)]?.[1] || 1;
    const ph = beat / per + (l.phase || 0), f = ((ph % 1) + 1) % 1;
    switch (l.shape) {
      case "triangle": return f < 0.5 ? f * 2 : 2 - f * 2;
      case "saw": return f;
      case "square": return f < 0.5 ? 1 : 0;
      case "random": { const k = Math.floor(ph); const x = Math.sin(k * 12.9898 + (src.id?.length || 1) * 78.233) * 43758.5453; return x - Math.floor(x); }
      default: return 0.5 + 0.5 * Math.sin(f * Math.PI * 2);
    }
  }
  return 0;
}
/* огибающая по ноте: атака → удержание → спад (мс); стартует от каждой ноты канала-источника */
export function trigValue(tr, notes, now) {
  let last = null;
  for (const n of notes) if (n.t <= now && (!last || n.t > last.t)) last = n;
  if (!last) return 0;
  const dt = (now - last.t) * 1000, a = Math.max(0, tr.att ?? 5), h = Math.max(0, tr.hold ?? 40), r = Math.max(1, tr.rel ?? 250);
  const k = tr.vel === false ? 1 : last.v ?? 1;
  if (dt < a) return k * dt / a;
  if (dt < a + h) return k;
  return k * Math.max(0, 1 - (dt - a - h) / r) ** 2;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* параметр DAWN по адресу: { label, spec, get() } или null */
export function dawnParam(P, addr) {
  const a = addr.split(".");
  if (a[0] === "ch") {
    const ch = P.channels.find(c => c.id === a[1]);
    if (!ch) return null;
    const pre = ch.name + " · ";
    if (a[2] === "vol" || a[2] === "pan") return { label: pre + a[2], spec: SPECS[a[2]], get: () => ch[a[2]] };
    let m = a[2].match(/^osc(\d)$/);
    if (m && a[3] && ch.params.oscs?.[m[1] - 1]) { const o = ch.params.oscs[m[1] - 1]; return { label: pre + `OSC${m[1]} ${a[3]}`, spec: SPECS[a[3]], get: () => o[a[3]] }; }
    m = a[2].match(/^op(\d)$/);
    if (m && a[3] && ch.params.ops?.[m[1] - 1]) { const o = ch.params.ops[m[1] - 1]; return { label: pre + `OP${m[1]} ${a[3]}`, spec: GF_SPECS[a[3]] || SPECS[a[3]], get: () => o[a[3]] }; }
    if (/^m\d\d$/.test(a[2]) && ch.params.mod) return { label: pre + a[2].replace("m", "mod "), spec: GF_SPECS.mod, get: () => ch.params.mod[a[2]] || 0 };
    const spec = SPECS[a[2]];
    if (spec && typeof ch.params[a[2]] === "number") return { label: pre + a[2], spec, get: () => ch.params[a[2]] };
    return null;
  }
  if (a[0] === "mix") {
    const i = +a[1], m = P.mixer[i];
    if (!m) return null;
    const pre = (i ? m.name : "Master") + " · ";
    if (a[2] === "vol" || a[2] === "pan") return { label: pre + a[2], spec: SPECS[a[2]], get: () => m[a[2]] };
    const f = m.fx[+a[2]];
    if (f && a[3] && FX[f.type].params[a[3]] && !FX[f.type].params[a[3]].kind) return { label: pre + FX[f.type].name + " " + a[3], spec: FX[f.type].params[a[3]], get: () => f.p[a[3]] };
  }
  if (a[0] === "pedal") {
    const pd = (P.pedals || []).find(x => x.id === a[1]), s = pd && FX[pd.type]?.params[a[2]];
    if (s && !s.kind) return { label: "🎛 " + FX[pd.type].name + " " + a[2], spec: s, get: () => pd.p[a[2]] };
  }
  return null;
}

/* все цели DAWN — для списка «＋ цель» */
export function dawnTargets(P) {
  const out = [];
  const add = (addr, group) => { const p = dawnParam(P, addr); if (p) out.push({ addr, label: p.label, group }); };
  for (const ch of P.channels) {
    const g = "Канал: " + ch.name;
    add(`ch.${ch.id}.vol`, g); add(`ch.${ch.id}.pan`, g);
    for (const k of Object.keys(ch.params)) if (typeof ch.params[k] === "number" && SPECS[k]) add(`ch.${ch.id}.${k}`, g);
    (ch.params.oscs || []).forEach((o, i) => ["o_vol", "o_crs", "o_fin", "o_pan"].forEach(k => add(`ch.${ch.id}.osc${i + 1}.${k}`, g)));
    (ch.params.ops || []).forEach((o, i) => ["ratio", "fine", "level", "out", "pan"].forEach(k => add(`ch.${ch.id}.op${i + 1}.${k}`, g)));
    if (ch.params.mod) for (let f = 1; f <= 4; f++) for (let t = 1; t <= 4; t++) if (f !== t) add(`ch.${ch.id}.m${f}${t}`, g);
  }
  P.mixer.forEach((m, i) => {
    const g = "Микшер: " + (i ? m.name : "Master");
    add(`mix.${i}.vol`, g); add(`mix.${i}.pan`, g);
    m.fx.forEach((f, k) => Object.keys(FX[f.type].params).filter(key => !FX[f.type].params[key].kind).forEach(key => add(`mix.${i}.${k}.${key}`, g)));
  });
  for (const pd of P.pedals || []) Object.keys(FX[pd.type]?.params || {}).forEach(key => add(`pedal.${pd.id}.${key}`, "Педали"));
  return out;
}

/* итоговые значения целей в позиции beat: Map(адрес → значение). resolve(addr) → { spec, base() } для не-DAWN адресов.
 * lfoBeat — отдельные часы для LFO (на остановленном транспорте LFO всё равно качает) */
export function computeOver(P, beat, resolve, lfoBeat = beat, rt = null) {
  const acc = new Map();
  rt = withSrc(P, beat, lfoBeat, rt);
  for (const src of P.mods || []) {
    if (!src.wires?.length) continue;
    const v = srcValue(src, src.type === "lfo" ? lfoBeat : beat, rt), center = src.type === "lfo" ? 0.5 : 0;
    for (const w of src.wires) {
      const t = acc.get(w.to) || { sum: 0 };
      t.sum += (w.amt ?? 1) * (v - center);
      acc.set(w.to, t);
    }
  }
  const out = new Map();
  for (const [addr, { sum }] of acc) {
    const p = addr.startsWith("ch.") || addr.startsWith("mix.") || addr.startsWith("pedal.") ? dawnParam(P, addr) : resolve?.(addr);
    if (!p?.spec) continue;
    const { min, max } = p.spec, base = p.get ? p.get() : p.base?.();
    if (typeof base !== "number") continue;
    let v = base + sum * (max - min);
    v = v < min ? min : v > max ? max : v;
    if (p.spec.step) v = Math.round(v / p.spec.step) * p.spec.step;
    out.set(addr, v);
  }
  return out;
}

/* rt.srcVal(id) — значение другого источника (вход ветра); ветер от ветра не считается (без петель) */
export function withSrc(P, beat, lfoBeat, rt) {
  const r = { ...(rt || {}) };
  r.srcVal = id => { const s = (P.mods || []).find(m => m.id === id); return s && s.type !== "wind" ? srcValue(s, s.type === "lfo" ? lfoBeat : beat, r) : 0; };
  return r;
}

/* параметры канала с учётом модуляции (для нот: читаются в момент начала ноты) */
export function effParams(ch, over) {
  if (!over?.size) return ch.params;
  const pre = `ch.${ch.id}.`;
  let p = null;
  for (const [addr, v] of over) {
    if (!addr.startsWith(pre)) continue;
    p ||= { ...ch.params, oscs: ch.params.oscs?.map(o => ({ ...o })), ops: ch.params.ops?.map(o => ({ ...o })), mod: ch.params.mod && { ...ch.params.mod } };
    const k = addr.slice(pre.length).split(".");
    let m;
    if ((m = k[0].match(/^osc(\d)$/)) && p.oscs?.[m[1] - 1]) p.oscs[m[1] - 1][k[1]] = v;
    else if ((m = k[0].match(/^op(\d)$/)) && p.ops?.[m[1] - 1]) p.ops[m[1] - 1][k[1]] = v;
    else if (/^m\d\d$/.test(k[0]) && p.mod) p.mod[k[0]] = v;
    else if (k[0] !== "vol" && k[0] !== "pan") p[k[0]] = v;
  }
  return p || ch.params;
}
export const effOf = (over, addr, base) => over?.has(addr) ? over.get(addr) : base;
