import { hz } from "./tuning.js";
import { gfDefaults } from "./grapefruit.js";
import { blDefaults } from "./bitterlemon.js";
import { CHIP_SPECS, chipDefaults } from "./chip.js";

/* ================= DAWN — инструменты =================
 * Голос = функция (ctx, out, params, t, dur, n, v, edo, bend) → ручка голоса
 *   { end — когда голос можно глушить, kill(t) — быстро заглушить (кража при полифонии), flt — фильтр (для модуляции) }.
 * bend — изгиб высоты к концу ноты, в ступенях строя (как slide в FL).
 * Работает в любом (Offline)AudioContext — живой звук и рендер в WAV идут через одни и те же функции.
 * Высота n — в ступенях строя канала (см. tuning.js), частота — hz(n, edo).
 */
/* ---------- описания параметров (для крутилок и, в этапе 3, для огибающих) ---------- */
export const SPECS = {
  vol:   { min: 0, max: 1.25, def: 0.8, label: "Vol" },
  pan:   { min: -1, max: 1, def: 0, label: "Pan", bipolar: true },
  // 3XOSC
  o_vol: { min: 0, max: 1, def: 0.6, label: "Vol" },
  o_crs: { min: -24, max: 24, def: 0, label: "Crs", step: 1, bipolar: true },
  o_fin: { min: -100, max: 100, def: 0, label: "Fine", bipolar: true },
  o_pan: { min: -1, max: 1, def: 0, label: "Pan", bipolar: true },
  att:   { min: 0.001, max: 2, def: 0.005, label: "Att", curve: 3 },
  dec:   { min: 0.01, max: 3, def: 0.25, label: "Dec", curve: 3 },
  sus:   { min: 0, max: 1, def: 0.7, label: "Sus" },
  rel:   { min: 0.01, max: 4, def: 0.25, label: "Rel", curve: 3 },
  // закругление участков ADSR: < 0 — быстро в начале (выпукло), > 0 — медленно в начале (изинг «вверх»)
  ac:    { min: -1, max: 1, def: 0, label: "A~", bipolar: true },
  dc:    { min: -1, max: 1, def: 0, label: "D~", bipolar: true },
  rc:    { min: -1, max: 1, def: 0, label: "R~", bipolar: true },
  cut:   { min: 40, max: 18000, def: 9000, label: "Cut", curve: 4 },
  res:   { min: 0.1, max: 18, def: 0.8, label: "Res", curve: 2 },
  // сэмплер
  root:  { min: 24, max: 96, def: 60, label: "Root", step: 1 },
  tune:  { min: -12, max: 12, def: 0, label: "Tune", bipolar: true },
  start: { min: 0, max: 0.95, def: 0, label: "Start" },
  // unison у 3XOSC: сколько голосов на осциллятор, их разброс по высоте и по панораме
  uni:   { min: 1, max: 8, def: 1, label: "Voices", step: 1 },
  udet:  { min: 0, max: 100, def: 20, label: "Detune" },
  uspr:  { min: 0, max: 1, def: 0.6, label: "Spread" },
  // общие для любого инструмента
  poly:  { min: 1, max: 32, def: 16, label: "Poly", step: 1 },
  // 👾 Chip — кадры, таблицы, биты (см. chip.js)
  ...CHIP_SPECS,
};

export const WAVES = ["sine", "triangle", "sawtooth", "square", "noise"];
export const WAVE_GLYPH = { sine: "∿", triangle: "⋀", sawtooth: "⊿", square: "⊓", noise: "≋" };

/* ---------- инструменты ---------- */
export const DEFAULT_PARAMS = {
  osc3: () => ({
    oscs: [
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: -6, o_pan: -0.2 },
      { wave: "sawtooth", o_vol: 0.55, o_crs: 0, o_fin: 6, o_pan: 0.2 },
      { wave: "square", o_vol: 0.3, o_crs: -12, o_fin: 0, o_pan: 0 },
    ],
    att: 0.005, dec: 0.3, sus: 0.6, rel: 0.3, cut: 6000, res: 1.2, uni: 1, udet: 20, uspr: 0.6,
  }),
  sampler: () => ({ path: null, root: 60, tune: 0, start: 0, att: 0.001, rel: 0.08, oneshot: true, rev: false }),
  grapefruit: () => gfDefaults(),
  bitterlemon: () => blDefaults(),
  chip: () => chipDefaults(),
};

export const TYPES = {
  osc3: { name: "3XOSC", icon: "🌈", color: "#c3a6ff" },
  grapefruit: { name: "Grapefruit", icon: "🍊", color: "#ffb3b3" },
  bitterlemon: { name: "Bitter Lemon", icon: "🍋", color: "#f4f19c" },
  sampler: { name: "Sampler", icon: "🎧", color: "#8fe8cf" },
  chip: { name: "Chip", icon: "👾", color: "#9ef5c8" },
};

let noiseBuf = null;
function getNoise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/* огибающая громкости: A → D → S, на note-off — R. Возвращает время, когда голос можно глушить */
/* кривая участка: x 0..1 → 0..1; c — изгиб (-1..1), 0 — прямая */
export function ease(x, c = 0) {
  if (Math.abs(c) < 0.01) return x;
  const k = c * 6;
  return (Math.exp(k * x) - 1) / (Math.exp(k) - 1);
}
/* ADSR с закруглёнными участками: ломаная из 16 отрезков на участок (setValueCurve нельзя прервать на note-off) */
function adsrCurved(g, t, dur, p, peak) {
  const a = Math.max(0.001, p.att), d = p.dec ?? 0.001, s = p.sus ?? 1, r = p.rel, off = t + Math.max(dur, a), SEG = 16;
  const seg = (t0, len, v0, v1, c) => { for (let i = 1; i <= SEG; i++) { const tt = t0 + len * i / SEG; if (tt > off) break; g.gain.linearRampToValueAtTime(v0 + (v1 - v0) * ease(i / SEG, c), tt); } };
  const at = x => x < t + a ? peak * ease((x - t) / a, p.ac || 0) : x < t + a + d ? peak + (peak * s - peak) * ease((x - t - a) / Math.max(1e-4, d), p.dc || 0) : peak * s;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0, t);
  seg(t, a, 0, peak, p.ac || 0);
  if (t + a < off) seg(t + a, d, peak, peak * s, p.dc || 0);
  const v = at(off);
  g.gain.linearRampToValueAtTime(v, off);
  for (let i = 1; i <= SEG; i++) g.gain.linearRampToValueAtTime(v * (1 - ease(i / SEG, p.rc || 0)), off + r * i / SEG);
  return off + r + 0.05;
}
export function adsr(g, t, dur, p, peak) {
  if (p.ac || p.dc || p.rc) return adsrCurved(g, t, dur, p, peak);
  const a = p.att, d = p.dec ?? 0.001, s = p.sus ?? 1, r = p.rel;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(peak * s, t + a, Math.max(0.001, d / 3));
  const off = t + Math.max(dur, a);
  g.gain.cancelScheduledValues(off);
  g.gain.setTargetAtTime(0, off, Math.max(0.001, r / 4));
  return off + r * 1.2 + 0.05;
}
/* ручка голоса: kill — быстрый спад и остановка источников (кража голоса, стоп) */
export function handle(ctx, env, srcs, end, extra = {}) {
  return {
    end, ...extra,
    kill(t = ctx.currentTime) {
      if (t >= this.end) return;
      try {
        env.gain.cancelScheduledValues(t);
        env.gain.setTargetAtTime(0, t, 0.006);
        for (const s of srcs) s.stop(t + 0.05);
      } catch { /* уже остановлен */ }
      this.end = t + 0.05;
    },
  };
}
/* изгиб: detune в центах от a к a + bend к концу ноты */
export function bendDetune(param, t, dur, base, bend, edo) {
  param.setValueAtTime(base, t);
  if (bend) param.linearRampToValueAtTime(base + bend * 1200 / edo, t + Math.max(0.01, dur));
}

export function playOsc3(ctx, out, p, t, dur, n, v, edo = 12, bend = 0) {
  const env = ctx.createGain();
  const flt = ctx.createBiquadFilter();
  flt.type = "lowpass"; flt.frequency.value = p.cut; flt.Q.value = p.res;
  flt.connect(env); env.connect(out);
  const end = adsr(env, t, dur, p, v * 0.35);
  const srcs = [];
  const uni = Math.max(1, Math.round(p.uni || 1));
  for (const o of p.oscs) {
    if (o.o_vol <= 0.001) continue;
    const voices = o.wave === "noise" ? 1 : uni;
    for (let u = 0; u < voices; u++) {
      const spread = voices > 1 ? u / (voices - 1) - 0.5 : 0;      // -0.5..0.5
      const g = ctx.createGain(); g.gain.value = o.o_vol / Math.sqrt(voices);
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, o.o_pan + spread * 2 * (p.uspr ?? 0.6)));
      let src;
      if (o.wave === "noise") { src = ctx.createBufferSource(); src.buffer = getNoise(ctx); src.loop = true; }
      else {
        src = ctx.createOscillator(); src.type = o.wave;
        src.frequency.value = hz(n, edo) * 2 ** (o.o_crs / 12);
        bendDetune(src.detune, t, dur, o.o_fin + spread * (p.udet ?? 20), bend, edo);
      }
      src.connect(g); g.connect(pan); pan.connect(flt);
      src.start(t + (u ? Math.random() * 0.003 : 0)); src.stop(end);   // крошечный разброс старта — фазы не совпадают
      srcs.push(src);
    }
  }
  return handle(ctx, env, srcs, end, { flt });
}

/* ---------- встроенные ударные (рендерятся при первом обращении, путь "builtin:имя") ---------- */
export const BUILTIN = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat", openhat: "Open hat", tom: "Tom",
  kickhard: "Kick punch", kick808: "808", snarefat: "Snare fat", rim: "Rim", snap: "Snap", shaker: "Shaker",
  crash: "Crash", ride: "Ride", cowbell: "Cowbell", conga: "Conga", metal: "Metal hit", impact: "Impact", revcrash: "Reverse crash", whip: "Whip", whoosh: "Whoosh", chime: "Chime", pop: "Pop", buzz: "Buzz", horn: "Horn", quack: "Quack", rain: "Rain", train: "Train", door: "Door", crunch: "Crunch", fry: "Fry", rewind: "Rewind", wind: "Wind", phone: "Phone", cluck: "Cluck", tap: "Tap", heart: "Heart", paper: "Paper", wood: "Wood", birdsong: "Birdsong", surf: "Surf", fabric: "Fabric", breath: "Breath", pour: "Pour", gulp: "Gulp", footstep: "Footstep", ship: "Ship", hiss: "Hiss", sparkle: "Sparkle", drop: "Drop", snow: "Snow", dream: "Dream", owl: "Owl", firework: "Firework", plane: "Plane", doorbell: "Doorbell", car: "Car", fire: "Fire", school: "School", slide: "Slide", steam: "Steam", clock: "Clock", box: "Box", elephant: "Elephant", deflate: "Deflate", sonar: "Sonar", keyboard: "Keyboard", monitor: "Monitor", pencil: "Pencil", rumble: "Rumble", glass: "Glass", ticket: "Ticket", projector: "Projector", bigben: "Bigben", modem: "Modem", alert: "Alert", fan: "Fan", elevator: "Elevator", cash: "Cash", football: "Football", bus: "Bus", slice: "Slice", flush: "Flush", tennis: "Tennis", cutlery: "Cutlery", rotor: "Rotor", miss: "Miss", laugh: "Laugh", radio: "Radio", golf: "Golf", whistle: "Whistle", dance: "Dance", guitar: "Guitar", mail: "Mail", dog: "Dog", cat: "Cat", keys: "Keys", camera: "Camera" };
const BUILTIN_DUR = { kick: 0.6, snare: 0.35, clap: 0.4, hat: 0.08, openhat: 0.45, tom: 0.5, kickhard: 0.5, kick808: 1.5, snarefat: 0.45, rim: 0.1,
  snap: 0.2, shaker: 0.15, crash: 2, ride: 1.3, cowbell: 0.4, conga: 0.3, metal: 0.35, impact: 2.5, revcrash: 2, whip: 0.3, whoosh: 0.36, chime: 0.48, pop: 0.16, buzz: 0.3, horn: 0.34, quack: 0.22, rain: 0.95, train: 0.95, door: 0.95, crunch: 0.95, fry: 0.95, rewind: 0.95, wind: 0.95, phone: 0.95, cluck: 0.95, tap: 0.95, heart: 0.95, paper: 0.95, wood: 0.95, birdsong: 0.95, surf: 0.95, fabric: 0.95, breath: 0.95, pour: 0.95, gulp: 0.95, footstep: 0.95, ship: 0.95, hiss: 0.95, sparkle: 0.95, drop: 0.95, snow: 0.95, dream: 0.95, owl: 0.95, firework: 0.95, plane: 0.95, doorbell: 0.95, car: 0.95, fire: 0.95, school: 0.95, slide: 0.95, steam: 0.95, clock: 0.95, box: 0.95, elephant: 0.95, deflate: 0.95, sonar: 0.95, keyboard: 0.95, monitor: 0.95, pencil: 0.95, rumble: 0.95, glass: 0.95, ticket: 0.95, projector: 0.95, bigben: 0.95, modem: 0.95, alert: 0.95, fan: 0.95, elevator: 0.95, cash: 0.95, football: 0.95, bus: 0.95, slice: 0.95, flush: 0.95, tennis: 0.95, cutlery: 0.95, rotor: 0.95, miss: 0.95, laugh: 0.95, radio: 0.95, golf: 0.95, whistle: 0.95, dance: 0.95, guitar: 0.95, mail: 0.95, dog: 0.95, cat: 0.95, keys: 0.95, camera: 0.95 };
/* новые ударные: из простых генераторов, с насыщением (tanh) — сразу «жирные» */
function extraDrum(oc, name, out, noise, env, sr) {
  const sat = (k = 2) => { const ws = oc.createWaveShaper(), c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } ws.curve = c; ws.connect(out); return ws; };
  const osc = (type, f, dest, g0, dec, t = 0) => { const o = oc.createOscillator(), g = oc.createGain(); o.type = type; o.frequency.value = f; env(g, g0, dec, t); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dec + 0.02); return o; };
  const nz = (type, f, q, dest, g0, dec, t = 0) => { const n = noise(), fl = oc.createBiquadFilter(), g = oc.createGain(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, g0, dec, t); n.connect(fl); fl.connect(g); g.connect(dest); n.start(t); return n; };
  const metal = (dest, g0, dec, freqs = [205, 304, 369, 522, 540, 800]) => { const bus = oc.createGain(); bus.gain.value = 1 / freqs.length; bus.connect(dest); freqs.forEach(f => osc("square", f * 1.71, bus, g0, dec)); };
  // Short procedural Foley. No samples, no external assets.
  const burst = (t,f,g=.45,d=.07,q=1) => nz("bandpass",f,q,out,g,d,t);
  const tone = (t,f,g=.25,d=.12,type="sine",to=f) => {
    const o=osc(type,f,out,g,d,t);
    if(to!==f){o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(to,t+d*.8);}
    return o;
  };
  const bed = (t,d,f0,f1,g=.35,type="bandpass",q=.8) => {
    const n=noise(),fl=oc.createBiquadFilter(),amp=oc.createGain();
    fl.type=type;fl.Q.value=q;
    fl.frequency.setValueAtTime(f0,t);fl.frequency.exponentialRampToValueAtTime(f1,t+d*.9);
    amp.gain.setValueAtTime(.0001,t);amp.gain.linearRampToValueAtTime(g,t+Math.min(.075,d*.25));amp.gain.exponentialRampToValueAtTime(.0001,t+d);
    n.connect(fl);fl.connect(amp);amp.connect(out);n.start(t);n.stop(t+d);
  };
  const taps = (times,f=1800,g=.4,d=.045) => times.forEach((t,i)=>burst(t,f*(i%2?.83:1),g,d,1.4));
  const bell = (t,f=880,g=.35,d=.34)=>{tone(t,f,g,d);tone(t,f*2.01,g*.22,d*.65);};
  const foley = {
    train(){bed(0,.92,180,360,.45,"lowpass");tone(0,55,.12,.87,"triangle",68);[.03,.12,.25,.34,.47,.56,.69,.78].forEach((t,i)=>{burst(t,1800,.5,.055,2);tone(t,i%2?145:95,.23,.07,"triangle");});bed(.56,.36,2200,4300,.2,"bandpass",2);},
    door(){bed(0,.32,380,950,.2);tone(.02,160,.15,.25,"triangle",420);burst(.35,750,.5,.08);tone(.35,85,.35,.15);},
    crunch(){taps([0,.025,.06,.12,.16],3600,.5,.045);burst(.1,850,.25,.08);},
    fry(){for(let i=0;i<12;i++)burst(i*.065,2600+(i%4)*1200,.22,.07);bed(0,.87,6500,4200,.2,"highpass");},
    rewind(){bed(0,.44,3500,550,.4);tone(0,1600,.12,.4,"triangle",230);burst(.45,1500,.4,.06);},
    wind(){bed(0,.9,320,1400,.45,"bandpass",.7);},
    phone(){[0,.21,.42].forEach(t=>tone(t,155,.32,.13,"sawtooth"));},
    cluck(){[0,.18,.37].forEach(t=>{tone(t,650,.28,.1,"triangle",280);burst(t,1100,.12,.05);});},
    tap(){burst(0,1900,.4,.035);tone(0,230,.15,.05);},
    heart(){[0,.18,.52,.7].forEach((t,i)=>tone(t,i%2?65:90,.38,.12,"sine",42));},
    paper(){[0,.12,.28,.43].forEach((t,i)=>bed(t,.14,1800+i*500,4800,.34));},
    wood(){tone(0,230,.45,.12,"triangle",155);burst(0,1200,.35,.05);},
    birdsong(){[0,.13,.31,.43].forEach((t,i)=>tone(t,1800+i%2*600,.2,.11,"sine",i%2?1400:2600));},
    surf(){bed(0,.86,250,2600,.45);bed(.25,.58,6000,2200,.15,"highpass");},
    fabric(){bed(0,.22,350,1500,.24);bed(.25,.22,700,400,.28);tone(.21,80,.11,.15);},
    breath(){bed(0,.36,650,1800,.24);bed(.43,.39,1500,650,.2);},
    pour(){for(let i=0;i<8;i++){const t=i*.085;tone(t,450+i*90,.12,.09,"sine",700+i*100);burst(t,1700,.17,.08);}bed(.02,.77,900,2600,.15);},
    gulp(){[0,.22,.42].forEach(t=>{tone(t,410,.3,.13,"sine",115);burst(t,850,.13,.06);});},
    footstep(){[0,.29,.58].forEach(t=>{tone(t,100,.32,.13,"triangle",45);burst(t,1000,.24,.065);});},
    ship(){tone(0,112,.25,.75,"triangle",105);tone(0,148,.22,.72,"triangle",138);bed(0,.8,160,650,.18);},
    hiss(){bed(0,.7,2600,7000,.46,"highpass");},
    sparkle(){[0,.08,.19,.3].forEach((t,i)=>bell(t,[1200,1800,2400,3000][i],.22,.25));},
    drop(){tone(0,550,.4,.15,"sine",1050);tone(.04,750,.12,.11,"sine",370);},
    snow(){[0,.27,.54].forEach(t=>{bed(t,.16,2200,5000,.32);burst(t,900,.2,.06);});},
    dream(){[0,.16,.32].forEach((t,i)=>bell(t,[440,660,880][i],.19,.43));},
    owl(){tone(0,430,.3,.25,"sine",330);tone(.35,390,.26,.34,"sine",300);},
    firework(){bed(0,.37,400,3200,.26);burst(.4,1100,.5,.11);for(let i=0;i<7;i++)burst(.48+i*.055,3000+i*200,.16,.06);},
    plane(){bed(0,.9,350,1800,.44,"lowpass");tone(0,100,.14,.8,"triangle",145);},
    doorbell(){bell(0,700,.4,.4);bell(.35,520,.36,.45);},
    car(){tone(0,65,.32,.75,"sawtooth",150);tone(0,120,.16,.77,"triangle",300);bed(0,.8,250,950,.22,"lowpass");},
    fire(){for(let i=0;i<9;i++)burst(i*.09,1700+i%3*800,.23,.04);bed(0,.85,700,1100,.12);},
    school(){[0,.22,.44].forEach(t=>bell(t,1040,.28,.21));},
    slide(){bed(0,.5,700,2400,.25);tone(0,250,.13,.45,"triangle",650);},
    steam(){bed(0,.7,2200,6500,.32,"highpass");},
    clock(){[0,.25,.5,.75].forEach((t,i)=>burst(t,i%2?1400:2100,.4,.035,3));},
    box(){burst(0,650,.45,.09);tone(0,100,.25,.15,"triangle");bed(.17,.18,1400,2700,.2);},
    elephant(){tone(0,520,.32,.52,"sawtooth",175);tone(.12,710,.18,.45,"triangle",280);},
    deflate(){bed(0,.67,6500,700,.4);tone(0,480,.15,.62,"sine",95);},
    sonar(){tone(0,1100,.27,.19);tone(.32,1100,.13,.16);tone(.59,1100,.07,.15);},
    keyboard(){taps([0,.09,.19,.29,.45,.55,.68],2900,.34,.035);},
    monitor(){tone(0,1100,.24,.08);tone(.46,1100,.24,.08);},
    pencil(){[0,.16,.31,.48,.65].forEach(t=>bed(t,.12,2600,3900,.22));},
    rumble(){tone(0,90,.32,.5,"triangle",45);tone(.2,110,.18,.42,"sine",60);},
    glass(){bell(0,1700,.38,.6);tone(0,2750,.12,.38);},
    ticket(){burst(0,1300,.35,.05);burst(.04,4500,.3,.06);bed(.1,.24,2700,4300,.23);},
    projector(){taps([0,.07,.14,.21,.28,.35,.42,.49,.56,.63,.7],1400,.19,.035);bed(0,.8,180,450,.1);},
    bigben(){bell(0,392,.35,.55);bell(.32,330,.3,.55);},
    modem(){[0,.13,.28,.45,.62].forEach((t,i)=>tone(t,[750,1200,980,1600,600][i],.18,.13,"square"));},
    alert(){tone(0,800,.23,.12,"triangle");tone(.17,640,.23,.12,"triangle");},
    fan(){bed(0,.9,180,850,.35,"lowpass");tone(0,70,.15,.84,"triangle",100);},
    elevator(){bell(0,880,.33,.32);bed(.35,.5,500,1300,.24);},
    cash(){taps([0,.06,.15],1900,.33,.05);bell(.21,1300,.3,.48);bell(.31,1700,.2,.4);},
    football(){tone(0,100,.45,.12,"triangle",50);burst(0,950,.33,.07);bed(.17,.54,500,1600,.19);},
    bus(){tone(0,82,.28,.78,"triangle",117);bed(0,.68,220,900,.24,"lowpass");bed(.62,.27,2300,600,.28);},
    slice(){bed(0,.19,3400,1300,.33);burst(.2,1100,.4,.055);tone(.2,185,.2,.09);},
    flush(){bed(0,.9,450,1100,.44);[.1,.29,.48,.67].forEach(t=>tone(t,270,.14,.18,"sine",90));},
    tennis(){[0,.48].forEach(t=>{burst(t,2300,.4,.06);tone(t,270,.26,.11,"triangle",155);});},
    cutlery(){[0,.19,.41].forEach((t,i)=>bell(t,1450+i*350,.3,.18));},
    rotor(){for(let i=0;i<12;i++)burst(i*.074,440,.34,.06);tone(0,72,.19,.85,"triangle");},
    miss(){tone(0,550,.2,.2,"triangle",220);tone(.21,170,.22,.35,"triangle",90);},
    laugh(){[0,.12,.26,.42].forEach((t,i)=>tone(t,370+i%2*65,.19,.11,"triangle",260));},
    radio(){bed(0,.36,3000,500,.3);tone(.36,880,.13,.12,"triangle");bed(.5,.31,4500,1600,.24);},
    golf(){bed(0,.18,500,3200,.25);burst(.17,2100,.45,.04);tone(.18,360,.22,.1,"triangle");},
    whistle(){tone(0,1800,.23,.27,"sine",2250);tone(.32,1950,.19,.2,"sine",1700);},
    dance(){[0,.22,.44,.66].forEach((t,i)=>{tone(t,i%2?180:80,.32,.14,"triangle",55);burst(t+.08,3500,.2,.04);});},
    guitar(){[0,.08,.16].forEach((t,i)=>{tone(t,[196,247,294][i],.3,.55,"triangle");tone(t,[392,494,588][i],.09,.24);});},
    mail(){bed(0,.18,1800,3200,.26);burst(.21,620,.43,.075);tone(.21,130,.18,.14);},
    dog(){[0,.28].forEach(t=>{tone(t,160,.3,.19,"sawtooth",95);burst(t,800,.28,.1);});},
    cat(){tone(0,480,.3,.44,"triangle",820);tone(.36,600,.15,.3,"sine",360);},
    rain(){for(let i=0;i<16;i++)burst(i*.052,1900+i%5*600,.13,.04);bed(0,.9,4400,3000,.15,"highpass");},
    keys(){[0,.07,.13,.23].forEach((t,i)=>bell(t,1900+i*270,.25,.15));},
    camera(){burst(0,2400,.4,.035);burst(.045,3600,.35,.035);tone(.08,200,.18,.08,"triangle");}
  };
  if (foley[name]) { foley[name](); return; }
  if (name === "whip" || name === "whoosh") {
    const n = noise(), fl = oc.createBiquadFilter(), g = oc.createGain();
    fl.type = "bandpass"; fl.Q.value = 0.8;
    fl.frequency.setValueAtTime(420, 0); fl.frequency.exponentialRampToValueAtTime(6200, 0.13);
    fl.frequency.exponentialRampToValueAtTime(1300, 0.27);
    g.gain.setValueAtTime(0.001, 0); g.gain.linearRampToValueAtTime(0.85, 0.12); g.gain.exponentialRampToValueAtTime(0.001, 0.29);
    n.connect(fl); fl.connect(g); g.connect(out); n.start();
    if (name === "whip") nz("highpass", 3500, 0.7, out, 0.75, 0.035, 0.13);
  } else if (name === "chime") {
    osc("sine", 880, out, 0.55, 0.42); osc("sine", 1320, out, 0.18, 0.28); osc("sine", 2200, out, 0.09, 0.17);
  } else if (name === "pop") {
    const o = osc("sine", 430, out, 0.65, 0.11); o.frequency.setValueAtTime(430,0); o.frequency.exponentialRampToValueAtTime(120,0.07);
    nz("bandpass", 1800, 1, out, 0.25, 0.025);
  } else if (name === "buzz" || name === "horn" || name === "quack") {
    const fl=oc.createBiquadFilter();fl.type="lowpass";fl.frequency.value=name==="buzz"?900:1300;fl.Q.value=1.5;fl.connect(out);
    const o=osc(name==="buzz"?"sawtooth":"triangle",name==="buzz"?150:name==="horn"?310:520,fl,0.5,name==="quack"?0.17:0.27);
    if(name==="quack")o.frequency.exponentialRampToValueAtTime(190,0.1);
    else if(name==="horn")osc("triangle",390,fl,0.22,0.25);
  } else if (name === "kickhard" || name === "kick808" || name === "impact") {
    const [f0, f1, sweep, dec, drive] = { kickhard: [230, 48, 0.07, 0.42, 3], kick808: [120, 46, 0.06, 1.35, 1.6], impact: [90, 28, 0.9, 2.3, 2.5] }[name];
    const s = sat(drive), o = osc("sine", f0, s, 1, dec);
    o.frequency.setValueAtTime(f0, 0); o.frequency.exponentialRampToValueAtTime(f1, sweep);
    if (name !== "kick808") nz("highpass", name === "impact" ? 200 : 2500, 0.7, s, name === "impact" ? 0.5 : 0.35, name === "impact" ? 1.6 : 0.015);
    if (name === "impact") nz("lowpass", 400, 0.7, out, 0.6, 2.2);
  } else if (name === "snarefat") {
    const s = sat(2.2);
    nz("bandpass", 1900, 0.7, s, 0.9, 0.3); nz("highpass", 6000, 0.7, s, 0.35, 0.12);
    const b = osc("triangle", 200, s, 0.8, 0.12); b.frequency.setValueAtTime(240, 0); b.frequency.exponentialRampToValueAtTime(170, 0.08); osc("sine", 330, s, 0.35, 0.08);
  } else if (name === "rim") { const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 3; bp.connect(out); osc("triangle", 820, bp, 1, 0.05); osc("square", 1650, bp, 0.5, 0.03); }
  else if (name === "snap") { for (const t of [0, 0.008, 0.016]) nz("bandpass", 2600, 2, out, 0.9, 0.012, t); nz("bandpass", 2400, 1.2, out, 0.6, 0.11, 0.022); }
  else if (name === "shaker") { const n = noise(), hp = oc.createBiquadFilter(), g = oc.createGain(); hp.type = "highpass"; hp.frequency.value = 5500; g.gain.setValueAtTime(0.001, 0); g.gain.linearRampToValueAtTime(0.5, 0.025); g.gain.exponentialRampToValueAtTime(0.001, 0.13); n.connect(hp); hp.connect(g); g.connect(out); n.start(); }
  else if (name === "crash" || name === "revcrash") { const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 5000; hp.connect(out); metal(hp, 0.6, 1.8); nz("highpass", 4000, 0.7, out, 0.55, 1.9); }
  else if (name === "ride") { const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000; hp.connect(out); metal(hp, 0.5, 1.2, [310, 435, 520, 690]); osc("sine", 5200, out, 0.12, 0.6); nz("highpass", 9000, 0.7, out, 0.15, 0.5); }
  else if (name === "cowbell") { const bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 1.5; const s = sat(1.5); bp.connect(s); osc("square", 545, bp, 0.8, 0.32); osc("square", 815, bp, 0.8, 0.32); }
  else if (name === "conga") { const o = osc("sine", 320, out, 0.9, 0.25); o.frequency.setValueAtTime(330, 0); o.frequency.exponentialRampToValueAtTime(230, 0.05); nz("bandpass", 2000, 1, out, 0.15, 0.02); }
  else if (name === "metal") { const s = sat(3); metal(s, 0.9, 0.3, [610, 870, 1131, 1420]); nz("bandpass", 3500, 2, s, 0.4, 0.06); }
}
async function renderBuiltin(name, sr) {
  const dur = BUILTIN_DUR[name] || 0.4;
  const oc = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
  const noise = () => { const b = oc.createBuffer(1, oc.length, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = oc.createBufferSource(); s.buffer = b; return s; };
  const env = (g, peak, decay, t = 0) => { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + decay); };
  const out = oc.createGain(); out.connect(oc.destination);
  if (name === "kick" || name === "tom") {
    const o = oc.createOscillator(), g = oc.createGain();
    const [f0, f1] = name === "kick" ? [150, 45] : [220, 110];
    o.frequency.setValueAtTime(f0, 0); o.frequency.exponentialRampToValueAtTime(f1, 0.12);
    env(g, 1, dur * 0.9); o.connect(g); g.connect(out); o.start(); o.stop(dur);
    const c = noise(), cg = oc.createGain(), hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    env(cg, 0.25, 0.012); c.connect(hp); hp.connect(cg); cg.connect(out); c.start();
  } else if (name === "snare") {
    const n = noise(), g = oc.createGain(), bp = oc.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = 1500;
    env(g, 0.8, 0.22); n.connect(bp); bp.connect(g); g.connect(out); n.start();
    const o = oc.createOscillator(), og = oc.createGain(); o.frequency.value = 190; env(og, 0.6, 0.1);
    o.connect(og); og.connect(out); o.start(); o.stop(dur);
  } else if (name === "clap") {
    const n = noise(), g = oc.createGain(), bp = oc.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.8;
    for (const t of [0, 0.012, 0.024]) { g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); }
    g.gain.setValueAtTime(0.7, 0.036); g.gain.exponentialRampToValueAtTime(0.0008, 0.3);
    n.connect(bp); bp.connect(g); g.connect(out); n.start();
  } else if (name === "hat" || name === "openhat") {
    const n = noise(), g = oc.createGain(), hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    env(g, 0.6, name === "hat" ? 0.06 : 0.4); n.connect(hp); hp.connect(g); g.connect(out); n.start();
  } else extraDrum(oc, name, out, noise, env, sr);
  const buf = await oc.startRendering();
  if (name === "revcrash") { const d = buf.getChannelData(0); d.reverse(); }   // тарелка задом наперёд — «засос» перед дропом
  return buf;
}

/* ---------- кэш сэмплов ---------- */
const buffers = new Map();      // путь -> Promise<AudioBuffer>
const reversed = new Map();     // путь -> AudioBuffer задом наперёд
const fsUrl = p => "/fs" + p.split("/").map(encodeURIComponent).join("/");
export function loadSample(ctx, path) {
  if (!path) return Promise.resolve(null);
  if (!buffers.has(path) && path.startsWith("builtin:"))
    buffers.set(path, renderBuiltin(path.slice(8), ctx.sampleRate).catch(() => null));
  if (!buffers.has(path))
    buffers.set(path, fetch(fsUrl(path)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(a => ctx.decodeAudioData(a)).catch(e => { buffers.delete(path); console.warn("DAWN sample", path, e); return null; }));
  return buffers.get(path);
}
export function sampleNow(path) { return buffers.get(path)?._v || null; }   // уже загруженный (для отрисовки волны)
/* загрузить и запомнить декодированный буфер (sampleNow отдаёт его синхронно) */
export async function ensureSample(ctx, path) {
  const b = await loadSample(ctx, path);
  if (b && buffers.get(path)) buffers.get(path)._v = b;
  return b;
}
function rev(buf, path) {
  if (reversed.has(path)) return reversed.get(path);
  const r = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) r.getChannelData(c).set([...buf.getChannelData(c)].reverse());
  reversed.set(path, r);
  return r;
}

export function playSampler(ctx, out, p, t, dur, n, v, buf, edo = 12, bend = 0) {
  if (!buf) return null;
  const b = p.rev ? rev(buf, p.path) : buf;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const rate = 2 ** (n / edo - p.root / 12 + p.tune / 12);   // root — MIDI-нота сэмпла
  src.playbackRate.setValueAtTime(rate, t);
  if (bend) src.playbackRate.exponentialRampToValueAtTime(rate * 2 ** (bend / edo), t + Math.max(0.01, dur));
  const env = ctx.createGain();
  src.connect(env); env.connect(out);
  const len = (b.duration * (1 - p.start)) / rate;
  const hold = p.oneshot ? len : Math.min(len, dur);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(v, t + p.att);
  const off = t + Math.max(hold, p.att);
  env.gain.setTargetAtTime(0, off, Math.max(0.001, p.rel / 4));
  const end = off + p.rel * 1.2 + 0.02;
  src.start(t, b.duration * p.start);
  src.stop(end);
  return handle(ctx, env, [src], end);
}

