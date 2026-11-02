import { buildGraph } from "../dawn/graph.js";
import { loadCodeWorklet } from "../dawn/fx.js";
import { fromFile, patLen } from "../dawn/format.js";
import { ensureSample } from "../dawn/instruments.js";
import { arrangement } from "./arrange.js";

/* ================= Clown Dungeon — сборка кеша музыки =================
 * Синтез DAWN слишком тяжёл для слабых телефонов, поэтому трек заранее рендерится на ПК владельца в дорожки:
 * по одной на роль и ещё по одной на каждый сдвиг высоты из правил. Дорожки лежат на сервере, телефон только
 * включает и выключает их по тактам (music.js). Сервер сам рендерить не может: синтезатор живёт в браузере.
 *
 * Паттерн рендерится дважды и берётся второй проход: в него уже попали хвосты реверба и дилея из первого,
 * поэтому петля смыкается без щелчка и провала.
 */
const SAMPLE_RATE = 32000;        // хватает для этой музыки и вдвое легче 44100 в загрузке
const HIT_SEC = 1.5, HIT_SHIFT_SEC = 0.25;
const CHUNK = 48000;              // байт: nginx сайта пропускает тела запросов до 64 КБ
const STEP = 0.25;

/* все дорожки трека: каждая роль без сдвига + сдвиги, которые встречаются в правилах */
function stemList(A) {
  const seen = new Map();
  const add = (role, shift) => seen.set(`${role}|${shift}`, { role, shift });
  for (const role of A.all) add(role, 0);
  const scan = d => {
    for (const [name, semis] of Object.entries(d.shift || {})) {
      const roles = name === "pitched" ? [...A.pitched] : name === "all" ? [...A.all] : [name];
      for (const role of roles) if (A.all.has(role)) add(role, semis);
    }
  };
  for (const r of A.rules) { scan(r); (r.pick || []).forEach(scan); }
  return [...seen.values()].map((s, i) => ({ ...s, name: "s" + i }));
}

function wav(ch, from, length, sr) {
  const n = ch.numberOfChannels, d = new DataView(new ArrayBuffer(44 + length * n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); d.setUint32(4, 36 + length * n * 2, true); str(8, "WAVEfmt "); d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); d.setUint16(22, n, true); d.setUint32(24, sr, true); d.setUint32(28, sr * n * 2, true);
  d.setUint16(32, n * 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, length * n * 2, true);
  const data = Array.from({ length: n }, (_, c) => ch.getChannelData(c));
  let o = 44;
  for (let i = 0; i < length; i++) for (let c = 0; c < n; c++) {
    const s = Math.max(-1, Math.min(1, data[c][from + i]));
    d.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return d.buffer;
}

async function gzip(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function upload(track, name, bytes) {
  const q = `track=${encodeURIComponent(track.id)}&v=${track.v}&name=${name}`;
  for (let part = 0, at = 0; at < bytes.length || part === 0; part++, at += CHUNK) {
    const chunk = bytes.subarray(at, at + CHUNK), last = at + CHUNK >= bytes.length ? 1 : 0;
    const r = await fetch(`/api/dungeon/stem?${q}&part=${part}&last=${last}`, { method: "POST", body: chunk });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `сервер ответил ${r.status}`);
  }
}

/* отрендерить notes(G) в новом контексте той же проектной модели */
async function render(raw, sec, cur, notes) {
  const P = fromFile(JSON.parse(JSON.stringify(raw)));
  if (cur) P.cur = cur;
  const oc = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * sec), SAMPLE_RATE);
  await Promise.all(P.channels.filter(c => c.type === "sampler" && c.params.path).map(c => ensureSample(oc, c.params.path)));
  if (P.mixer.some(m => m.fx.some(f => f.type === "math" || f.type === "code"))) await loadCodeWorklet(oc);
  const G = buildGraph(oc, P);
  notes(G, P);
  return oc.startRendering();
}

/* собрать и отправить один трек; say(текст) — ход работы */
export async function buildTrack(track, say) {
  const rules = track.rules, raw = await (await fetch(rules.file)).json();
  const base = fromFile(JSON.parse(JSON.stringify(raw)));
  const cur = rules.pattern || base.cur;
  base.cur = cur;
  const pat = base.patterns.find(p => p.id === cur) || base.patterns[0], beatSec = 60 / base.bpm;
  const beats = patLen(base, pat.id), loopSec = beats * beatSec, A = arrangement(rules, base.channels);
  const stems = stemList(A), length = Math.round(loopSec * SAMPLE_RATE);

  let done = 0;
  for (const s of stems) {
    say(`${track.id}: дорожка ${++done} из ${stems.length}`);
    const buf = await render(raw, loopSec * 2, cur, (G, P) => {
      const p = P.patterns.find(x => x.id === pat.id);
      for (const ch of P.channels) {
        if (A.roleOf(ch.id) !== s.role) continue;
        const up = Math.round(s.shift * (ch.edo || 12) / 12);
        for (let loop = 0; loop < 2; loop++) for (const n of p.notes[ch.id] || [])
          G.voice(ch, (loop * beats + n.s) * beatSec, n.l * beatSec, n.n + up, n.v, n.b || 0, n.x || 1);
      }
    });
    await upload(track, s.name, await gzip(wav(buf, length, length, SAMPLE_RATE)));
  }

  // одна нота колокольчика для звука тапа: дальше её высоту меняет скорость проигрывания
  const lead = base.channels.find(c => A.roleOf(c.id) === "lead");
  const first = lead && [...(pat.notes[lead.id] || [])].sort((a, b) => a.s - b.s)[0];
  let hit = null;
  if (first) {
    const buf = await render(raw, HIT_SEC, cur, (G, P) => G.voice(P.channels.find(c => c.id === lead.id), 0, HIT_SHIFT_SEC, first.n, 0.85));
    await upload(track, "hit", await gzip(wav(buf, 0, buf.length, SAMPLE_RATE)));
    hit = { name: "hit", n: first.n, edo: lead.edo || 12 };
  }
  const r = await fetch("/api/dungeon/stems_done", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track: track.id, v: track.v, stems, hit }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `сервер ответил ${r.status}`);
}
