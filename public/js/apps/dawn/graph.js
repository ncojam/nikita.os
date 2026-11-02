import { FX } from "./fx.js";
import { fitOps, fitParams, stretchParams } from "./fit.js";
import { playOsc3, playSampler, sampleNow } from "./instruments.js";
import { playGrapefruit } from "./grapefruit.js";
import { chipSteal, playChip } from "./chip.js";
import { effOf, effParams } from "./modcore.js";

/* ================= DAWN — звуковой граф проекта =================
 * Отдельно от engine.js, чтобы проект можно было играть без самого приложения: игры подключают только этот
 * модуль и format.js — без демо-трека и окон. Голоса ставят сами: G.voice(канал, время, длительность, ступень, сила).
 */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function buildGraph(ctx, P) {
  const lim = ctx.createDynamicsCompressor();          // мягкий предохранитель на выходе
  lim.threshold.value = -3; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
  const final = ctx.createGain(), analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  final.connect(lim); lim.connect(analyser); analyser.connect(ctx.destination);

  const G = {
    ctx, P, final, analyser, inserts: [], strips: new Map(), bpm: P.bpm,
    over: new Map(),       // текущие значения модулируемых параметров (адрес → значение), см. modcore.js
    active: {},            // канал → звучащие голоса (для полифонии и живой модуляции фильтра)
    fxSig: "",

    ensureInserts() {
      while (G.inserts.length < P.mixer.length) {
        const i = G.inserts.length;
        const input = ctx.createGain(), post = ctx.createGain(), pan = ctx.createStereoPanner(), meter = ctx.createAnalyser();
        meter.fftSize = 256;
        post.connect(pan); pan.connect(meter);
        meter.connect(i === 0 ? final : G.inserts[0].input);
        G.inserts.push({ input, post, pan, meter, fx: [] });
        G.rebuildFx(i); G.applyInsert(i);
      }
    },
    /* цепочка эффектов инсерта: input → fx (вкл.) → post */
    rebuildFx(i) {
      const ins = G.inserts[i], m = P.mixer[i];
      ins.input.disconnect();
      ins.fx.forEach(f => f?.dispose());
      ins.fx = m.fx.map((f, k) => {
        const n = FX[f.type].create(ctx, G.fxParams(i, k));
        n.tempo(G.bpm);
        return n;
      });
      let node = ins.input;
      m.fx.forEach((f, k) => { if (f.on) { node.connect(ins.fx[k].input); node = ins.fx[k].output; } });
      node.connect(ins.post);
    },
    applyInsert(i) {
      const m = P.mixer[i], ins = G.inserts[i];
      ins.post.gain.value = m.mute ? 0 : effOf(G.over, `mix.${i}.vol`, m.vol);
      ins.pan.pan.value = effOf(G.over, `mix.${i}.pan`, m.pan);
    },
    fxParams(i, k) {
      const f = P.mixer[i].fx[k], pre = `mix.${i}.${k}.`;
      let p = f.p;
      for (const [a, v] of G.over) if (a.startsWith(pre)) { if (p === f.p) p = { ...f.p }; p[a.slice(pre.length)] = v; }
      return p;
    },
    fxSet(i, k) { G.inserts[i]?.fx[k]?.set(G.fxParams(i, k)); },
    /* ---------- педали: эффекты вне микшера. Вход — канал (ch:id) или инсерт (mix:i, после фейдера),
     * выход — инсерт (mix:i) или Master. Петли не даём: вход-инсерт ≠ выход, Master как вход нельзя. ---------- */
    pedals: new Map(),
    pedalParams(pd) {
      const pre = `pedal.${pd.id}.`;
      let p = pd.p;
      for (const [a, v] of G.over) if (a.startsWith(pre)) { if (p === pd.p) p = { ...pd.p }; p[a.slice(pre.length)] = v; }
      return p;
    },
    pedalSrc(ref) {
      const [k, id] = String(ref || "").split(":");
      if (k === "ch") { const ch = P.channels.find(c => c.id === id); return ch ? G.strip(ch).pan : null; }
      if (k === "mix" && +id > 0) return G.inserts[+id]?.meter || null;
      return null;
    },
    pedalDst(ref) {
      const [k, id] = String(ref || "mix:0").split(":");
      return k === "mix" ? G.inserts[clamp(+id || 0, 0, P.mixer.length - 1)]?.input : G.inserts[0].input;
    },
    rebuildPedals() {
      for (const g of G.pedals.values()) { try { g.src.disconnect(g.fx.input); } catch { /* уже отключён */ } g.fx.output.disconnect(); g.fx.dispose(); }
      G.pedals.clear();
      for (const pd of P.pedals || []) {
        if (!pd.on || !FX[pd.type]) continue;
        const src = G.pedalSrc(pd.in), dst = G.pedalDst(pd.out);
        if (!src || !dst || (pd.in.startsWith("mix:") && pd.in === pd.out)) continue;
        const fx = FX[pd.type].create(ctx, G.pedalParams(pd));
        fx.tempo(G.bpm);
        src.connect(fx.input); fx.output.connect(dst);
        G.pedals.set(pd.id, { fx, src });
      }
    },
    pedalSet(id) { const pd = (P.pedals || []).find(x => x.id === id); if (pd) G.pedals.get(id)?.fx.set(G.pedalParams(pd)); },
    /* модуляция: новые значения целей; непрерывные параметры (громкость, пан, фильтр, эффекты) — сразу */
    applyOver(over) {
      const prev = G.over;
      G.over = over;
      const changed = new Set([...prev.keys(), ...over.keys()].filter(a => prev.get(a) !== over.get(a)));
      if (!changed.size) return;
      for (const ch of P.channels) {
        const pre = `ch.${ch.id}.`;
        if (changed.has(pre + "vol") || changed.has(pre + "pan")) G.strip(ch);
        if (changed.has(pre + "cut") || changed.has(pre + "res")) {
          const p = effParams(ch, over), now = ctx.currentTime;
          for (const h of G.active[ch.id] || []) if (h.flt && h.end > now) { h.flt.frequency.value = p.cut; h.flt.Q.value = p.res; }
        }
      }
      P.mixer.forEach((m, i) => {
        if (changed.has(`mix.${i}.vol`) || changed.has(`mix.${i}.pan`)) G.applyInsert(i);
        m.fx.forEach((f, k) => { if ([...changed].some(a => a.startsWith(`mix.${i}.${k}.`))) G.fxSet(i, k); });
      });
      for (const pd of P.pedals || []) if ([...changed].some(a => a.startsWith(`pedal.${pd.id}.`))) G.pedalSet(pd.id);
    },
    tempo(bpm) { G.bpm = bpm; for (const ins of G.inserts) for (const f of ins.fx) f.tempo(bpm); for (const g of G.pedals.values()) g.fx.tempo(bpm); },
    audible(ch) {
      const anySolo = P.channels.some(c => c.solo);
      return !ch.mute && (!anySolo || ch.solo);
    },
    /* полоса канала; если канал переназначили на другой инсерт — переподключаем */
    strip(ch) {
      let s = G.strips.get(ch.id);
      const mix = clamp(ch.mix || 0, 0, P.mixer.length - 1);
      if (!s) {
        const gain = ctx.createGain(), pan = ctx.createStereoPanner(), out = ctx.createGain();
        gain.connect(pan); pan.connect(out);       // педали берут звук канала с pan (до инсерта)
        s = { gain, pan, out, mix: -1 };
        G.strips.set(ch.id, s);
      }
      if (s.mix !== mix) { s.out.disconnect(); s.out.connect(G.inserts[mix].input); s.mix = mix; }
      s.gain.gain.value = G.audible(ch) ? effOf(G.over, `ch.${ch.id}.vol`, ch.vol) : 0;
      s.pan.pan.value = effOf(G.over, `ch.${ch.id}.pan`, ch.pan);
      return s;
    },
    refresh() {
      G.ensureInserts();
      for (let i = 0; i < P.mixer.length; i++) G.applyInsert(i);
      for (const ch of P.channels) G.strip(ch);
      for (const [id, s] of G.strips) if (!P.channels.some(c => c.id === id)) { s.gain.disconnect(); s.pan.disconnect(); s.out.disconnect(); G.strips.delete(id); }
    },
    /* нота: параметры с учётом модуляции, изгиб, полифония (лишний старый голос крадём) */
    voice(ch, t, durSec, n, v, bend = 0, stretch = 1) {
      if (!G.audible(ch)) return;
      const out = G.strip(ch).gain, edo = ch.edo || 12;
      let p = effParams(ch, G.over);
      if (stretch !== 1 && ch.type !== "sampler" && ch.type !== "chip") p = stretchParams(p, ch.type, stretch);   // удлинённая нота: атака растянута так же
      if (ch.type === "grapefruit") p = fitOps(p, durSec, 60 / (P.bpm || 120));   // ⇔ у отдельных операторов — пропорционально ноте
      if (p.fit && ch.type !== "sampler" && ch.type !== "chip") p = fitParams(p, ch.type, durSec);   // ⇔ огибающая под длину ноты
      const h = ch.type === "osc3" ? playOsc3(ctx, out, p, t, durSec, n, v, edo, bend)
        : ch.type === "grapefruit" ? playGrapefruit(ctx, out, p, t, durSec, n, v, edo, bend)
        : ch.type === "chip" ? playChip(ctx, out, p, t, durSec, n, v, edo, bend)
        : playSampler(ctx, out, p, t, durSec, n, v, sampleNow(p.path), edo, bend);
      // сайдчейн: эффекты Sidechain, слушающие этот канал, ныряют ровно в момент ноты
      P.mixer.forEach((m, i) => m.fx.forEach((f, k) => { if (f.on && f.type === "side" && f.p.src === ch.id) G.inserts[i]?.fx[k]?.duck?.(t); }));
      for (const pd of P.pedals || []) if (pd.on && pd.type === "side" && pd.p.src === ch.id) G.pedals.get(pd.id)?.fx.duck?.(t);
      G.onNote?.(ch, t, v);
      if (!h) return;
      if (ch.type === "chip") chipSteal(G, P, ch, t, h);   // лимит каналов консоли: занятый слот уступает новой ноте
      const now = ctx.currentTime, list = (G.active[ch.id] = (G.active[ch.id] || []).filter(x => x.end > now));
      const sounding = list.filter(x => x.end > t);
      for (let k = sounding.length - Math.max(1, ch.poly || 16) + 1; k > 0; k--) sounding.shift().kill(t);
      list.push(h);
    },
    dispose() {
      for (const ins of G.inserts) { ins.input.disconnect(); ins.meter.disconnect(); ins.fx.forEach(f => f.dispose()); }
      for (const s of G.strips.values()) { s.gain.disconnect(); s.pan.disconnect(); s.out.disconnect(); }
      for (const g of G.pedals.values()) { g.fx.output.disconnect(); g.fx.dispose(); }
      final.disconnect(); lim.disconnect(); analyser.disconnect();
    },
  };
  G.ensureInserts();
  for (const ch of P.channels) G.strip(ch);
  G.rebuildPedals();
  return G;
}
