import { buildGraph } from "./graph.js";
import { loadCodeWorklet } from "./fx.js";
import { fromFile, patLen } from "./format.js";
import { ensureSample } from "./instruments.js";
import { computeOver } from "./modcore.js";
import { TICK, playTick, songLen } from "./tick.js";
import { fsUrl } from "../../core/util.js";

/* ================= DAWN — мини-плеер =================
 * Играет проект .dawn без окон DAWN (карточки треков на форумах NETWORK, профили). Свой AudioContext и свой граф —
 * открытый DAWN и его проект не трогает. Одновременно играет один проект.
 *   DawnMini.toggle(path)  — играть / остановить
 *   DawnMini.on(cb)        — cb({path, playing, pos, len}) на старт, стоп и ~5 раз в секунду (прогресс)
 * Песня (есть плейлист) играет один раз до конца, проект без плейлиста — текущий паттерн 4 круга.
 * Модуляция (огибающие, LFO) считается на каждом тике, как в рендере DAWN.
 */
const LOOKAHEAD = 0.15, TIMER_MS = 25;
const logNote = (log, id, t, v) => { const l = (log[id] ||= []); l.push({ t, v }); if (l.length > 12) l.shift(); };   // как в engine.js

export const DawnMini = {
  ctx: null, G: null, P: null, path: null, playing: false, timer: null, beat: 0, nextT: 0, t0: 0, len: 0, mode: "song",
  subs: new Set(), ui: 0, log: {},

  on(cb) { this.subs.add(cb); return () => this.subs.delete(cb); },
  emit() {
    const d = { path: this.path, playing: this.playing, pos: this.position(), len: this.len };
    for (const cb of this.subs) try { cb(d); } catch (e) { console.error(e); }
  },
  position() {
    if (!this.playing || !this.P) return 0;
    return Math.max(0, Math.min(this.len, (this.ctx.currentTime - this.t0) / (60 / this.P.bpm)));
  },

  async toggle(path) {
    if (this.playing && this.path === path) return this.stop();
    return this.play(path);
  },

  async play(path) {
    this.stop();
    this.path = path; this.emit();
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "playback" });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const raw = await (await fetch(fsUrl(path), { cache: "no-store" })).json();
    if (this.path !== path) return;            // пока грузили — нажали другой трек
    const P = this.P = fromFile(raw);
    await loadCodeWorklet(this.ctx).catch(() => {});
    await Promise.all(P.channels.filter(c => c.type === "sampler" && c.params.path).map(c => ensureSample(this.ctx, c.params.path)));
    if (this.path !== path) return;
    this.G?.dispose?.();
    this.G = buildGraph(this.ctx, P);
    this.log = {};
    this.G.onNote = (ch, t, v) => logNote(this.log, ch.id, t, v);
    this.mode = P.playlist?.length ? "song" : "pat";
    this.len = this.mode === "song" ? songLen(P) : patLen(P, P.cur) * 4;
    this.beat = 0;
    this.t0 = this.nextT = this.ctx.currentTime + 0.08;
    this.playing = true;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.ui = setInterval(() => this.emit(), 200);
    this.schedule();
    this.emit();
  },

  schedule() {
    const P = this.P, td = 60 / P.bpm / 4, hasMods = (P.mods || []).some(m => m.wires?.length);
    const rt = { now: this.ctx.currentTime, notes: id => this.log[id] || [], meter: () => 0 };
    while (this.nextT < this.ctx.currentTime + LOOKAHEAD) {
      if (this.beat >= this.len - 1e-9) {          // доиграли: ждём хвосты и останавливаемся
        if (this.ctx.currentTime > this.nextT + 1.2) this.stop();
        return;
      }
      const b = this.mode === "pat" ? this.beat % patLen(P, P.cur) : this.beat;
      if (hasMods) try { this.G.applyOver(computeOver(P, b, null, b, rt)); } catch {}
      playTick(this.G, P, this.mode, b, this.nextT);
      this.nextT += td; this.beat += TICK;
    }
  },

  stop() {
    clearInterval(this.timer); clearInterval(this.ui); this.timer = this.ui = null;
    if (this.G) {
      const G = this.G, g = G.final?.gain, t = this.ctx.currentTime;
      if (g) { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.06); }
      setTimeout(() => G.dispose?.(), 150);
      this.G = null;
    }
    const was = this.playing;
    this.playing = false;
    if (was || this.path) this.emit();
  },
};
