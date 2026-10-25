import { store } from "../../core/util.js";
import { notify } from "../../ui/notify.js";

/* ================= DAWN — свои пресеты =================
 * Всё, что в DAWN есть «готовым», можно сохранить своим: звук синта (параметры + эффекты инсерта + его модуляция),
 * паттерн (ударные по ролям и/или синты вместе со звуком), настройки «Магии».
 * Хранится в браузере (localStorage, ключ dawn.user); ⬇/⬆ — файл .json, чтобы перенести или поделиться.
 *   synth:    { имя: { type, params, fx: [...], mods: [{ type, name, trig|lfo|env|value, wires: [{ to: "ch.x" | "fx.N.x", amt }] }] } }
 *   patterns: { имя: { kind: "drums" | "synth" | "all", sig, len, drums: { роль: [[s, l, v]] }, synths: [{ name, type, params, edo, scale, fx, notes: [[s, l, n, v]] }] } }
 *   magic:    { имя: { sections, size, mode, pad, riser, impact, fills, style } }
 */
const KEY = "dawn.user";
const deep = o => JSON.parse(JSON.stringify(o));

export const UserLib = {
  data: { synth: {}, patterns: {}, magic: {}, ...store.get(KEY, {}) },
  save() { store.set(KEY, this.data); dispatchEvent(new Event("dawn-userlib")); },
  names(kind) { return Object.keys(this.data[kind] || {}).sort((a, b) => a.localeCompare(b)); },
  get(kind, name) { return this.data[kind]?.[name] || null; },
  put(kind, name, v) {
    name = String(name || "").trim().slice(0, 40);
    if (!name) return null;
    if (this.data[kind][name] && !confirm(`«${name}» уже есть. Заменить?`)) return null;
    this.data[kind][name] = deep(v); this.save();
    notify(`⭐ Сохранено: ${name}`);
    return name;
  },
  del(kind, name) {
    if (!confirm(`Удалить свой пресет «${name}»?`)) return false;
    delete this.data[kind][name]; this.save(); return true;
  },
  export() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ format: "dawn-presets/1", ...this.data }, null, 1)], { type: "application/json" }));
    a.download = "dawn-presets.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  import() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = async () => {
      try {
        const d = JSON.parse(await inp.files[0].text());
        let n = 0;
        for (const kind of ["synth", "patterns", "magic"]) for (const [k, v] of Object.entries(d[kind] || {})) if (v && typeof v === "object") { this.data[kind][k] = v; n++; }
        this.save();
        notify(`⭐ Импортировано: ${n}`);
      } catch (e) { notify("⚠ Не похоже на файл пресетов: " + e.message); }
    };
    inp.click();
  },
};

/* модуляция, которая относится к каналу: провода на сам канал или его инсерт → адреса относительно канала */
function relMods(P, ch, i) {
  const pre = `ch.${ch.id}.`, mpre = i > 0 ? `mix.${i}.` : null;
  return (P.mods || []).filter(m => ["trig", "lfo", "env", "knob"].includes(m.type) && (m.presetOf === ch.id || m.wires.length && m.wires.every(w => w.to.startsWith(pre) || (mpre && w.to.startsWith(mpre)))))
    .map(m => ({ type: m.type, name: m.name, value: m.value, lfo: m.lfo, env: m.env,
      trig: m.trig && { att: m.trig.att, hold: m.trig.hold, rel: m.trig.rel, vel: m.trig.vel, self: m.trig.ch === ch.id },
      wires: m.wires.map(w => ({ to: w.to.startsWith(pre) ? "ch." + w.to.slice(pre.length) : "fx." + w.to.slice(mpre.length), amt: w.amt })) }));
}
/* снимок звука канала: параметры + эффекты инсерта (если инсерт только его) + его модуляция */
export function captureSound(Engine, ch) {
  const P = Engine.project, i = ch.mix || 0, alone = i > 0 && !P.channels.some(c => c !== ch && (c.mix || 0) === i);
  return { type: ch.type, params: deep(ch.params), fx: alone ? deep(P.mixer[i].fx) : [], mods: alone ? relMods(P, ch, i) : [] };
}
/* снимок паттерна: what = drums | synth | all; roleOf — роль сэмпла (kick, snare…) */
export function capturePattern(Engine, what, roleOf) {
  const P = Engine.project, pat = Engine.pat(), out = { kind: what, sig: [...pat.sig], len: Engine.patLength(), drums: {}, synths: [] };
  for (const [cid, list] of Object.entries(pat.notes)) {
    const ch = Engine.chan(cid);
    if (!ch || !list.length) continue;
    if (ch.type === "sampler") {
      if (what === "synth") continue;
      const r = roleOf(ch) || "perc";
      if (r === "perc") continue;
      (out.drums[r] ||= []).push(...list.map(n => [n.s, n.l, n.v]));
    } else {
      if (what === "drums") continue;
      out.synths.push({ name: ch.name, ...captureSound(Engine, ch), edo: ch.edo || 12, scale: deep(ch.scale), notes: list.map(n => [n.s, n.l, n.n, n.v]) });
    }
  }
  return out;
}
