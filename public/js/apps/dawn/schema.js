import { BUILTIN, DEFAULT_PARAMS, SPECS, TYPES, WAVES } from "./instruments.js";
import { FX, SYNC } from "./fx.js";
import { GF_PRESETS, GF_SPECS, GF_WAVES, MOD_KEYS } from "./grapefruit.js";
import { LFO_SHAPES, LFO_SYNC } from "./modcore.js";
import { EDOS, EDO_NAME, SCALES, degreeNames } from "./tuning.js";

/* ================= DAWN — документация и JSON Schema для нейросетей =================
 * Всё собирается из тех же реестров, что использует движок (SPECS, FX, SCALES, Grapefruit, модуляция):
 * добавили эффект, лад или параметр — он сам появится и в схеме, и в инструкции. Руками ничего не дописываем.
 */
const num = (s, extra = {}) => ({ type: s.step ? "integer" : "number", minimum: s.min, maximum: s.max, default: s.def,
  ...(s.names ? { description: s.names.map((n, i) => `${i}=${n}`).join(", ") } : {}), ...extra });
const props = (keys, specs) => Object.fromEntries(keys.filter(k => specs[k]).map(k => [k, num(specs[k])]));

export function buildSchema() {
  const osc3 = DEFAULT_PARAMS.osc3(), smp = DEFAULT_PARAMS.sampler();
  const envKeys = ["att", "dec", "sus", "rel"];
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "DAWN project (dawn/2)",
    type: "object",
    required: ["format", "channels", "patterns"],
    properties: {
      format: { const: "dawn/2" },
      name: { type: "string" },
      bpm: { type: "number", minimum: 40, maximum: 300, default: 128 },
      swing: { type: "number", minimum: 0, maximum: 0.6, default: 0 },
      mode: { enum: ["pat", "song"], description: "pat = loop `current` pattern, song = play the playlist" },
      live: { type: "boolean", description: "while playing, pattern switches wait for the end of the current pattern" },
      current: { type: "string", description: "id of the selected pattern" },
      channels: { type: "array", items: {
        type: "object", required: ["id", "type"],
        properties: {
          id: { type: "string", description: "short readable id; patterns reference it" },
          type: { enum: Object.keys(TYPES) },
          name: { type: "string" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
          vol: num(SPECS.vol), pan: num(SPECS.pan), mute: { type: "boolean" }, solo: { type: "boolean" },
          poly: num(SPECS.poly, { description: "max simultaneous voices; 1 = mono (new note cuts the old one)" }),
          mixer: { type: "integer", minimum: 0, description: "mixer insert index, 0 = Master" },
          edo: { enum: EDOS, default: 12, description: "equal divisions of the octave for this channel" },
          scale: { type: "object", properties: {
            root: { type: ["string", "integer"], description: "tonic: degree name (see EDO table) or degree number" },
            mode: { type: "string", description: "scale id valid for the channel's edo (see doc)" },
            snap: { type: "boolean" } } },
          sample: { type: ["string", "null"], description: "sampler only: " + Object.keys(BUILTIN).map(k => `"builtin:${k}"`).join(", ") + ", or a path in the site file system" },
          params: { type: "object", description: "depends on type", oneOf: [
            { title: "osc3", properties: { oscs: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", properties: {
                wave: { enum: WAVES }, ...props(Object.keys(osc3.oscs[0]).filter(k => k !== "wave"), SPECS) } } },
              ...props([...envKeys, "cut", "res", "uni", "udet", "uspr"], SPECS) } },
            { title: "sampler", properties: { ...props(Object.keys(smp).filter(k => typeof smp[k] === "number"), SPECS),
              oneshot: { type: "boolean" }, rev: { type: "boolean" } } },
            { title: "grapefruit", properties: {
              preset: { enum: Object.keys(GF_PRESETS), description: "start from this preset; ops/mod given explicitly override it" },
              ops: { type: "array", minItems: 4, maxItems: 4, items: { type: "object", properties: {
                wave: { enum: GF_WAVES }, ...props(["ratio", "fine", "level", "out"], GF_SPECS), ...props(envKeys, SPECS) } } },
              mod: { type: "object", properties: Object.fromEntries(MOD_KEYS.map(([k, f, t]) => [k, num(GF_SPECS.mod, { description: `operator ${f} → frequency of operator ${t}` })])) },
              ...props(["cut", "res"], SPECS) } },
          ] },
        } } },
      patterns: { type: "array", items: {
        type: "object", required: ["id"],
        properties: {
          id: { type: "string" }, name: { type: "string" }, color: { type: "string" },
          sig: { type: "string", pattern: "^\\d+/(1|2|4|8|16)$", default: "4/4" },
          length: { type: "number", minimum: 0.25, description: "beats; omit = auto (by notes, whole bars)" },
          notes: { type: "object", description: "channel id → notes",
            additionalProperties: { type: "array", items: { type: "array", minItems: 3, maxItems: 5, prefixItems: [
              { type: "number", minimum: 0, description: "start, beats" },
              { type: "number", exclusiveMinimum: 0, description: "length, beats" },
              { type: ["string", "integer"], description: "pitch (see doc)" },
              { type: "number", minimum: 0, maximum: 1, default: 0.8, description: "velocity" },
              { type: "number", description: "bend: glide by this many EDO steps by the end of the note" }] } } },
        } } },
      playlist: { type: "array", items: { type: "object", required: ["pattern", "start"], properties: {
        pattern: { type: "string" }, track: { type: "integer", minimum: 1 }, start: { type: "number", minimum: 0 }, length: { type: "number" } } } },
      mixer: { type: "array", description: "index 0 = Master", items: { type: "object", properties: {
        name: { type: "string" }, vol: num(SPECS.vol), pan: num(SPECS.pan), mute: { type: "boolean" },
        fx: { type: "array", maxItems: 4, items: { oneOf: Object.entries(FX).map(([type, f]) => ({
          title: f.name, type: "object", properties: { type: { const: type }, on: { type: "boolean" }, ...props(Object.keys(f.params), f.params),
            ...Object.fromEntries(Object.entries(f.params).filter(([, s]) => s.kind === "channel").map(([k]) => [k, { type: "string", description: "channel id that triggers it (e.g. the kick)" }])) } })) } } } } },
      mods: { type: "array", description: "modulation sources wired to parameters", items: { type: "object", required: ["type", "wires"], properties: {
        id: { type: "string" }, name: { type: "string" }, type: { enum: ["knob", "env", "lfo"] },
        value: { type: "number", minimum: 0, maximum: 1, description: "knob position" },
        env: { type: "object", properties: { len: { type: "number", description: "beats" }, loop: { type: "boolean" },
          pts: { type: "array", items: { type: "array", prefixItems: [{ type: "number", description: "beat" }, { type: "number", minimum: 0, maximum: 1 }] } } } },
        lfo: { type: "object", properties: { sync: { type: "integer", minimum: 0, maximum: LFO_SYNC.length - 1, description: LFO_SYNC.map((s, i) => `${i}=${s[0]}`).join(", ") },
          shape: { enum: LFO_SHAPES }, phase: { type: "number", minimum: 0, maximum: 1 } } },
        wires: { type: "array", items: { type: "object", required: ["to"], properties: {
          to: { type: "string", description: "parameter address, see doc" }, amt: { type: "number", minimum: -1, maximum: 1 } } } },
      } } },
    },
  };
}

/* инструкция для нейросети: понятия + таблицы, сгенерированные из реестров */
export function aiDoc() {
  const edoRows = EDOS.map(e => {
    const names = degreeNames(e), named = e === 12 || e === 24 || e === 19;
    const scales = Object.entries(SCALES[e] || {}).map(([k, [, steps]]) => `${k} [${steps.join(",")}]`).join("; ");
    return `- ${e}-EDO (${EDO_NAME[e]}): step = ${(1200 / e).toFixed(1)} cents; pitch ${named ? `names: ${names.join(" ")} + octave, e.g. "${names[Math.min(1, e - 1)]}4"` : `"octave:degree", degree 0..${e - 1}, e.g. "4:${Math.floor(e / 2)}"`}; scales (steps in EDO degrees): ${scales}`;
  }).join("\n");
  return `# DAWN project format "dawn/2" — guide for AI
You read and write DAWN projects (a browser DAW on the site nikita.os). Return ONLY the complete JSON project (no markdown, no comments).
If a project is attached below, keep its structure and ids and change only what is asked. Unknown fields are ignored, missing ones get defaults.

## Time
- All times are in BEATS (quarter notes): 0.25 = 1/16, 0.5 = 1/8, 1 = 1/4. Triplets: 1/3, 1/6.
- pattern.sig is the time signature "N/D". Bar length in beats = N * 4 / D (7/8 → 3.5 beats, 11/4 → 11 beats, 6/8 → 3).
- pattern.length (beats) may be fractional; omit it to get whole bars covering the notes.
- playlist clips: start/length in beats on a 4/4 grid; a clip longer than its pattern repeats the pattern.

## Pitch and tuning (microtonality)
- Each channel has its own tuning "edo" (equal divisions of the octave). Pitch number n = (octave + 1) * edo + degree; frequency = 8.1758 * 2^(n / edo) Hz.
  For edo 12 this is exactly MIDI (C4 = 60, A4 = 69 = 440 Hz). Drums: use "C4".
- In 24-EDO "↑" raises by a quarter tone ("E↑3" is between E and F; "D#↑3" is the "half-flat E" of maqams).
- Notes may also use an integer pitch number n directly.
- Bend (5th note element): glide by that many EDO steps by the end of the note (negative = down). Use for slides.
- scale {root, mode} only highlights/snaps in the editor — it does not change sound; still, keep melodies in the scale you declare.
${edoRows}

## Instruments
- osc3 (3XOSC): 3 oscillators (wave, o_crs semitones, o_fin cents, o_pan, o_vol) → low-pass filter (cut Hz, res) → ADSR (att/dec/rel seconds, sus 0..1).
- grapefruit: 4-operator FM. Each op: wave, ratio (frequency multiple), fine (cents), level, ADSR, out (how much goes to audio; carriers > 0, modulators usually 0).
  mod.mJK = how strongly operator J modulates operator K (only higher → lower: ${MOD_KEYS.map(m => m[0]).join(", ")}). Presets: ${Object.keys(GF_PRESETS).join(", ")}.
  Bright metallic tones: non-integer ratios (3.5, 5.19). Warm: integer ratios, low mod.
- osc3 unison: uni (voices per oscillator 1..8), udet (cents spread), uspr (stereo spread) — big detuned supersaws/reeses.
- Ready sound presets (set the params yourself or ask the user to pick in the UI): osc3 — Sub Bass, Reese, Riddim Growl, Wobble, Hoover, Supersaw Lead, Neon Pluck, Ambient Pad, Chip Lead, Noise Riser.
- sampler: plays "sample" re-pitched (root = MIDI note of the original). Built-in drums: ${Object.keys(BUILTIN).map(k => "builtin:" + k).join(", ")}.
- poly: max voices per channel (1 = mono). vol/pan per channel; "mixer" routes the channel to an insert.

## Mixer
mixer[0] is Master, then inserts. Up to 4 effects per insert, processed in order: ${Object.entries(FX).map(([k, f]) => `${k} (${Object.keys(f.params).join(", ")})`).join("; ")}.
Heavy bass needs fx: dist (drive, shape 0 soft/1 hard/2 fold/3 crush, tone, mix, out) + ott (depth, time, low/mid/high dB) + eq. comp = compressor.
Sidechain: { type: "side", src: "<kick channel id>", amount, attack, release } on pads/bass inserts — ducks exactly on each kick note.
Delay "sync" index: ${SYNC.map((s, i) => `${i}=${s[0]}`).join(", ")}.

## Modulation ("mods") — sources wired to parameters
- Source types: knob (value 0..1, set by hand), env (points [beat, 0..1], len in beats, follows song/pattern position, loop), lfo (sync index, shape ${LFO_SHAPES.join("/")}).
- wires: [{to: address, amt: -1..1}]. Target value = base + amt * (source − c) * (max − min), c = 0.5 for LFO, 0 otherwise. Several wires into one target add up.
- Addresses: ch.<channel id>.vol | ch.<id>.pan | ch.<id>.<param> (cut, res, att, …) | ch.<id>.osc<1-3>.<o_vol|o_crs|o_fin|o_pan> |
  ch.<id>.op<1-4>.<ratio|fine|level|out> | ch.<id>.<m21..m43> | mix.<insert>.vol | mix.<insert>.pan | mix.<insert>.<fx slot>.<param> |
  os.<id> — the desktop OS itself (window hue, blur, wallpaper brightness…; see etc/params.json on the site).

## Musical tips
- Keep ids short (kick, bass, lead, verse). Velocities vary (0.5..1) for groove. Use the playlist to arrange intro / build / drop / outro.
- Odd meters: group beats (7/8 = 2+2+3 eighths) and accent group starts.`;
}

export function aiPackage(projectJson) {
  return `${aiDoc()}\n\n## Current project\n${projectJson}\n`;
}
