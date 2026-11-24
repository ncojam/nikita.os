import { AudioOS } from "../core/audio.js";
import { kindOf } from "../core/types.js";
import { baseName, el, fmtTime, fsUrl, store } from "../core/util.js";
import { pickGrid } from "../ui/grid.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= 🎧 Пульт — две деки и кроссфейдер =================
 * Каждая дека — источник звука ОС («dj.a», «dj.b»): по умолчанию в микшер ОС, но можно провести через педали
 * (приложение «Звук»). Кроссфейдер — внутри пульта: он приглушает деки до того, как звук уйдёт по кабелям.
 *
 * Дека: трек (📂 или перетащить из проводника), обзор волны (клик — перемотка), ▶/⏸, CUE (на паузе — поставить
 * точку, играя — вернуться к ней), SYNC (подогнать темп к другой деке), ◀ ▶ — подтолкнуть (пока держишь),
 * Pitch ±10 % (как на виниле: тон вместе с темпом), Trim, эквалайзер High/Mid/Low (до −24 дБ — «кил»),
 * Filter (влево — низкие частоты, вправо — высокие, в центре — выкл), фейдер канала.
 * Темп трека определяется сам (по огибающей ударов), до 0.1 BPM.
 * Все ручки — обычные ползунки, значит цели проводков: LFO на Filter или на кроссфейдер — и пошло.
 */
const DB = v => Math.pow(10, v / 20);
let open = null;

export function openDJ() {
  if (open) { WM.restore(open); WM.focus(open); return open; }
  const ctx = AudioOS.context();
  const S = { xf: 0, ...store.get("dj.set", {}) };
  const decks = ["a", "b"].map(id => makeDeck(ctx, id));
  const applyXf = () => {
    const x = (S.xf + 1) / 2;   // 0 — только A, 1 — только B; равная мощность
    decks[0].xf.gain.setTargetAtTime(Math.cos(x * Math.PI / 2), ctx.currentTime, 0.01);
    decks[1].xf.gain.setTargetAtTime(Math.sin(x * Math.PI / 2), ctx.currentTime, 0.01);
  };
  applyXf();
  open = WM.open({ title: "Пульт", icon: "🎧", key: "dj", width: 940, height: 470, render(c, w) {
    const xf = el("input", { type: "range", className: "dj-xf", min: -1, max: 1, step: 0.01, value: S.xf, title: "Кроссфейдер (двойной клик — в центр)",
      oninput: () => { S.xf = +xf.value; applyXf(); store.set("dj.set", S); } });
    xf.ondblclick = () => { xf.value = S.xf = 0; applyXf(); store.set("dj.set", S); };
    c.append(el("div", { className: "dj" },
      el("div", { className: "dj-decks" }, deckUI(decks[0], decks[1]), deckUI(decks[1], decks[0])),
      el("div", { className: "dj-mid" }, el("b", { textContent: "A" }), xf, el("b", { textContent: "B" }),
        el("button", { className: "btn small", textContent: "🔀 Кабели", title: "Куда идут деки: микшер ОС, педали", onclick: () => import("./sound.js").then(m => m.openSound("patch")) }))));
    let raf = 0;
    const tick = () => { decks.forEach(d => d.paint?.()); raf = requestAnimationFrame(tick); };
    tick();
    w.onClose = () => {
      cancelAnimationFrame(raf);
      decks.forEach(d => { d.audio.pause(); AudioOS.unregister("dj." + d.id); });
      open = null;
    };
    w.cmd = () => decks.filter(d => d.path).map(d => `# дека ${d.id.toUpperCase()}: ${d.path}`).join("\n") + (decks.some(d => d.path) ? "\n" : "") + "app dj";
  } });
  return open;
}

/* ---------- звуковая часть деки ---------- */
function makeDeck(ctx, id) {
  const audio = new Audio();
  audio.preload = "auto";
  audio.preservesPitch = false;   // как винил: быстрее — выше
  const src = ctx.createMediaElementSource(audio);
  const trim = ctx.createGain();
  const hi = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), lo = ctx.createBiquadFilter();
  hi.type = "highshelf"; hi.frequency.value = 4000;
  mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8;
  lo.type = "lowshelf"; lo.frequency.value = 250;
  const lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 20000; lp.Q.value = 0.9;
  hp.type = "highpass"; hp.frequency.value = 20; hp.Q.value = 0.9;
  const fader = ctx.createGain(), xf = ctx.createGain(), meter = ctx.createAnalyser();
  meter.fftSize = 512;
  src.connect(trim).connect(lo).connect(mid).connect(hi).connect(lp).connect(hp).connect(fader).connect(xf);
  fader.connect(meter);
  const d = { id, audio, trim, hi, mid, lo, lp, hp, fader, xf, meter, path: null, bpm: 0, peaks: null, cue: 0,
    set: { trim: 0, hi: 0, mid: 0, lo: 0, filter: 0, pitch: 0, fader: 1, ...store.get("dj.deck." + id, {}) } };
  d.save = () => store.set("dj.deck." + id, d.set);
  d.apply = () => {
    const s = d.set, t = ctx.currentTime;
    trim.gain.setTargetAtTime(DB(s.trim), t, 0.01);
    hi.gain.setTargetAtTime(s.hi, t, 0.01); mid.gain.setTargetAtTime(s.mid, t, 0.01); lo.gain.setTargetAtTime(s.lo, t, 0.01);
    lp.frequency.setTargetAtTime(s.filter < 0 ? 20000 * Math.pow(200 / 20000, -s.filter) : 20000, t, 0.02);
    hp.frequency.setTargetAtTime(s.filter > 0 ? 20 * Math.pow(4000 / 20, s.filter) : 20, t, 0.02);
    fader.gain.setTargetAtTime(s.fader, t, 0.01);
    audio.playbackRate = (1 + s.pitch) * (d.nudge || 1);
  };
  d.apply();
  AudioOS.register({ id: "dj." + id, title: "Дека " + id.toUpperCase(), icon: "🎧", kind: "source", output: xf });
  d.load = async path => {
    d.path = path; d.bpm = 0; d.peaks = null; d.cue = 0;
    audio.src = fsUrl(path);
    d.onload?.();
    try {   // волна и темп — по декодированному звуку
      const buf = await ctx.decodeAudioData(await (await fetch(fsUrl(path))).arrayBuffer());
      if (d.path !== path) return;
      d.peaks = peaks(buf, 800);
      d.bpm = detectBpm(buf);
      d.onload?.();
    } catch (e) { notify("⚠ Не разобрать трек: " + (e.message || e)); }
  };
  return d;
}

/* пики для обзора волны */
function peaks(buf, n) {
  const ch = buf.getChannelData(0), ch2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch;
  const step = Math.floor(ch.length / n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = j + step; j < e; j += 8) { const v = Math.abs(ch[j]) + Math.abs(ch2[j]); if (v > m) m = v; }
    out[i] = m / 2;
  }
  return out;
}

/* темп: огибающая энергии низов → «атаки» → автокорреляция в диапазоне 70–180 BPM, свёрнутая к 85–175 */
function detectBpm(buf) {
  const sr = buf.sampleRate, x = buf.getChannelData(0), hop = 512;
  const from = Math.floor(x.length * 0.1), to = Math.min(x.length, from + sr * 90);   // до полутора минут из середины
  const env = [];
  let lp = 0;
  for (let i = from; i < to; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop && j < to; j++) { lp += 0.05 * (x[j] - lp); e += lp * lp; }
    env.push(e);
  }
  const on = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  const fps = sr / hop;
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(fps * 60 / 180); lag <= Math.ceil(fps * 60 / 70); lag++) {
    let s = 0;
    for (let i = lag; i < on.length; i++) s += on[i] * on[i - lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return 0;
  // уточнение по соседям (парабола) и сворачивание к привычному диапазону
  const ac = l => { let s = 0; for (let i = l; i < on.length; i++) s += on[i] * on[i - l]; return s; };
  const a = ac(bestLag - 1), b = best, c2 = ac(bestLag + 1), sh = (a - c2) / (2 * (a - 2 * b + c2) || 1);
  let bpm = 60 * fps / (bestLag + (isFinite(sh) ? sh : 0));
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;
  // точнее: гребёнка на всю длину — темп, при котором удары лучше всего ложатся на сетку
  let bestB = bpm, bestS = -1;
  for (let cand = bpm - 1.5; cand <= bpm + 1.5; cand += 0.05) {
    const P = 60 * fps / cand;
    for (let ph = 0; ph < P; ph += 1) {
      let s = 0;
      for (let t = ph; t < on.length; t += P) s += on[Math.round(t)] || 0;
      if (s > bestS) { bestS = s; bestB = cand; }
    }
  }
  return Math.round(bestB * 10) / 10;
}

/* ---------- интерфейс деки ---------- */
function deckUI(d, other) {
  const ac = d.id === "a" ? "#ff9ecb" : "#9fd3ff";
  const name = el("div", { className: "dj-name", textContent: "Перетащи трек сюда или 📂" });
  const info = el("div", { className: "dj-info no-i18n" });
  const wave = el("canvas", { className: "dj-wave", title: "Клик — перемотка" });
  const play = el("button", { className: "btn dj-play", textContent: "▶", onclick: () => { if (!d.path) return; d.audio.paused ? d.audio.play() : d.audio.pause(); } });
  const cue = el("button", { className: "btn", textContent: "CUE", title: "На паузе — поставить точку; играя — вернуться к ней и встать на паузу",
    onclick: () => { if (d.audio.paused) d.cue = d.audio.currentTime; else { d.audio.pause(); d.audio.currentTime = d.cue; } } });
  const sync = el("button", { className: "btn", textContent: "SYNC", title: "Подогнать темп к другой деке",
    onclick: () => {
      if (!d.bpm || !other.bpm) return notify("Темп ещё не определён");
      const want = other.bpm * (1 + other.set.pitch) / d.bpm - 1;
      d.set.pitch = Math.max(-0.1, Math.min(0.1, want)); pitchIn.value = d.set.pitch; d.apply(); d.save();
      if (Math.abs(want) > 0.1) notify("Темпы слишком разные — подогнал, сколько смог (±10 %)");
    } });
  const nudge = k => {
    const b = el("button", { className: "btn", textContent: k < 0 ? "◀" : "▶", title: "Подтолкнуть (держи)" });
    const on = () => { d.nudge = 1 + k * 0.04; d.apply(); }, off = () => { d.nudge = 1; d.apply(); };
    b.onpointerdown = on; b.onpointerup = off; b.onpointerleave = off;
    return b;
  };
  const knob = (label, key, min, max, step, title) => {
    const r = el("input", { type: "range", min, max, step, value: d.set[key], title: `${title || label} (двойной клик — сброс)`,
      oninput: () => { d.set[key] = +r.value; d.apply(); d.save(); } });
    r.ondblclick = () => { r.value = d.set[key] = key === "fader" ? 1 : 0; d.apply(); d.save(); };
    return [el("label", { className: "dj-k" }, el("span", { textContent: label }), r), r];
  };
  const [kTrim] = knob("Trim", "trim", -12, 12, 0.1, "Усиление, дБ");
  const [kHi] = knob("High", "hi", -24, 6, 0.1, "Высокие, дБ");
  const [kMid] = knob("Mid", "mid", -24, 6, 0.1, "Середина, дБ");
  const [kLo] = knob("Low", "lo", -24, 6, 0.1, "Низкие, дБ");
  const [kFilt] = knob("Filter", "filter", -1, 1, 0.01, "Фильтр: влево — убрать верх, вправо — убрать низ");
  const [kPitch, pitchIn] = knob("Pitch", "pitch", -0.1, 0.1, 0.001, "Темп ±10 %");
  const [kFader] = knob("Фейдер", "fader", 0, 1.2, 0.01, "Громкость деки");
  const meter = el("div", { className: "dj-meter" }, el("i"));
  const load = el("button", { className: "btn", textContent: "📂", title: "Выбрать трек", onclick: () => chooseTrack(d, load) });
  const root = el("div", { className: "dj-deck", style: `--dc:${ac}` },
    el("div", { className: "dj-head" }, el("b", { className: "dj-id", textContent: d.id.toUpperCase() }), name, load),
    info, wave,
    el("div", { className: "dj-row" }, play, cue, sync, nudge(-1), nudge(1)),
    el("div", { className: "dj-row dj-knobs" }, kTrim, kHi, kMid, kLo, kFilt),
    el("div", { className: "dj-row dj-knobs" }, kPitch, kFader, meter));
  // перетащить трек из проводника
  root.ondragover = e => { if (e.dataTransfer.types.includes("application/x-nikita-paths")) { e.preventDefault(); root.classList.add("drop"); } };
  root.ondragleave = () => root.classList.remove("drop");
  root.ondrop = e => {
    root.classList.remove("drop");
    try {
      const p = JSON.parse(e.dataTransfer.getData("application/x-nikita-paths") || "[]").find(x => kindOf(x) === "audio");
      if (p) { e.preventDefault(); d.load(p); } else notify("Это не аудио");
    } catch {}
  };
  wave.onclick = e => { if (!d.audio.duration) return; const r = wave.getBoundingClientRect(); d.audio.currentTime = (e.clientX - r.left) / r.width * d.audio.duration; };
  d.onload = () => { name.textContent = d.path ? baseName(d.path) : "—"; name.title = d.path || ""; };
  d.paint = () => {
    const a = d.audio, dur = a.duration || 0;
    play.textContent = a.paused ? "▶" : "⏸";
    info.textContent = `${d.bpm ? (d.bpm * (1 + d.set.pitch)).toFixed(1) + " BPM" : "— BPM"} · ${fmtTime(a.currentTime || 0)} / ${dur ? fmtTime(dur) : "—"} · ${(d.set.pitch * 100).toFixed(1)}%`;
    meter.firstChild.style.height = Math.min(100, AudioOS.level(d.meter) * 100).toFixed(1) + "%";
    const dpr = Math.min(devicePixelRatio || 1, 2), W = Math.round(wave.clientWidth * dpr), H = Math.round(wave.clientHeight * dpr);
    if (!W || !H) return;
    if (wave.width !== W || wave.height !== H) { wave.width = W; wave.height = H; }
    const g = wave.getContext("2d"), pos = dur ? a.currentTime / dur : 0;
    g.clearRect(0, 0, W, H);
    if (d.peaks) {
      const n = d.peaks.length;
      for (let i = 0; i < n; i++) {
        const x = i / n * W, h = Math.max(1, d.peaks[i] * H * 0.95);
        g.fillStyle = i / n < pos ? ac : "rgba(255,255,255,.35)";
        g.fillRect(x, (H - h) / 2, Math.max(1, W / n - 0.5), h);
      }
    } else { g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, H / 2 - 1, W, 2); }
    if (dur) {
      g.fillStyle = "#ffd36e"; g.fillRect(d.cue / dur * W - 1, 0, 2, H);
      g.fillStyle = "#fff"; g.fillRect(pos * W - 1, 0, 2, H);
    }
  };
  return root;
}

async function chooseTrack(d, anchor) {
  const dirs = [...new Set([d.path, (await import("./player.js")).Player.list[0], "/home/nikita/Music"].filter(Boolean).map(p => p.endsWith(".mp3") || kindOf(p) === "audio" ? p.slice(0, p.lastIndexOf("/")) : p))];
  const columns = [];
  for (const dir of dirs) {
    try {
      const r = await fetch("/api/ls?path=" + encodeURIComponent(dir));
      if (!r.ok) continue;
      const items = ((await r.json()).entries || []).filter(e => e.type === "file" && kindOf(e.name) === "audio")
        .map(e => ({ value: dir + "/" + e.name, label: e.name.replace(/\.[^.]+$/, ""), icon: "🎵" }));
      if (items.length) columns.push({ title: "📁 " + baseName(dir), items });
    } catch {}
  }
  const it = await pickGrid({ anchor, title: "Трек для деки " + d.id.toUpperCase(), columns, empty: "Треков не нашлось — перетащи файл из проводника на деку" });
  if (it) d.load(it.value);
}
