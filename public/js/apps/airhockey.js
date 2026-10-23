import { el } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= аэро-арканоид (общая арена) =================
 * Два режима (решает сервер, приходит в state.mode):
 *  • local  — реальный игрок один: физику и бота primitiveAI считает ЭТОТ браузер (state.sim = true),
 *             голы уходят на сервер в общий счёт, снимок мячей/бота — раз в ~100 мс для зрителей.
 *  • online — двое и больше: сервер авторитетный, шлёт состояние ~30/сек, клиент экстраполирует.
 * Управление зависит от устройства: телефон (pointer: coarse) и Telegram — тачпад-полоса под полем
 * и выбор стороны тапом; компьютер — мышь в светлой зоне + вторая платформа на A/D.
 * Убрал курсор/палец — платформа стоит ещё GRACE секунд (сменил сторону — сразу на новой стороне).
 * Ушёл второй игрок — на его место встаёт бот. Бот появляется у одиночки с первого гола (и в свои).
 * Платформа наклоняется от скорости по X и пружинисто «отыгрывает» по дуге (гибкость).
 * Гол трясёт окно игры; свой гол трясёт и остальные окна — тем слабее, чем дальше от эпицентра.
 * Юбилейные события (каждый 10-й гол): поле, круги, slowpad и чёрные дыры сервер шлёт в каждом кадре
 * (state.round / slowpad / holes / top-bot) — в обоих режимах; мячи и клейкость в local добавляет Sim.
 */
const PAD_DRAW_H = 0.03;            // толщина платформы на экране (физика — P.padH с сервера)
const SND = "/apps/airhockey/";
const SIM_DT = 1 / 60;              // шаг локальной физики
const BOT_FORGET = 4000;            // одиночка ушёл совсем — через столько мс бот уходит тоже

// параметры физики по умолчанию; точные приходят с сервером в hello.phys
const P = { v0: 0.75, vmax: 2.4, gain: 0.035, freeze: 0.6, split: 64, maxBalls: 4, padW0: 0.22, padWmin: 0.06,
  padH: 0.022, ballR: 0.02, botSpeed: 0.6, botErr: 0.09, grace: 3, botNick: "primitiveAI",
  spreeWin: 1.8, wideK: 1.6, wideDur: 8, slowK: 0.35, slowDur: 5, iceDur: 2.5, stickV: 1.3,
  barrageN: 32, barrageLives: 5, barrageV: 0.9,
  roundR: 0.05, slowbK: 0.3, slowbHold: 3, slowbRamp: 4, stickyHold: 2.5, stickyDur: 8, slowpadV: 0.35,
  holeG: 0.02, holeSwirl: 0.9, holePull: 0.035 };

/* притяжение платформы к чёрным дырам — как на сервере (hole_pull): от положения ввода, не копится */
function holePull(x, y, holes) {
  let ox = 0, oy = 0;
  for (const h of holes || []) {
    const dx = h.x - x, dy = h.y - y, d = Math.hypot(dx, dy);
    if (d > 1e-6 && d < 0.3) { const k = P.holePull * h.a * (1 - d / 0.3); ox += dx / d * k; oy += dy / d * k; }
  }
  return [ox, oy];
}
/* где платформа на самом деле: ввод + притяжение дыр, в пределах своей (возможно, сжатой) зоны */
function effPos(x, y, side, zone, holes) {
  const [ox, oy] = holePull(x, y, holes);
  const [lo, hi] = side === "top" ? [0, zone.top] : [zone.bot, 1];
  return [clamp01(x + ox), clamp(y + oy, lo + P.padH / 2, hi - P.padH / 2)];
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => clamp(v, 0, 1);
const opp = s => s === "top" ? "bottom" : "top";

/* ---- звуковой банк на WebAudio (для питча через playbackRate) ---- */
const Snd = {
  ctx: null, buf: {}, ready: false,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    for (const n of ["click", "wall", "goal", "goal10th", "goal100th", "goal150th"]) {
      fetch(SND + n + ".wav").then(r => r.arrayBuffer()).then(a => this.ctx.decodeAudioData(a))
        .then(b => { this.buf[n] = b; }).catch(() => {});
    }
    this.ready = true;
  },
  play(name, pitch = false) {
    if (!this.ctx || !this.buf[name]) return;
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    const s = this.ctx.createBufferSource();
    s.buffer = this.buf[name];
    s.playbackRate.value = pitch ? 1 + (Math.random() * 0.16 - 0.08) : 1;
    s.connect(this.ctx.destination); s.start();
  },
};

/* короткая тряска окна поверх его позиции (composite add — не ломает left/top) */
function shake(node, amp, dur = 420) {
  if (!node || amp < 0.5) return;
  const kf = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const d = amp * (1 - i / n);
    kf.push({ transform: `translate(${(Math.random() * 2 - 1) * d}px, ${(Math.random() * 2 - 1) * d}px)` });
  }
  kf.push({ transform: "translate(0,0)" });
  try { node.animate(kf, { duration: dur, easing: "ease-out", composite: "add" }); } catch {}
}

/* ================= локальная физика (режим local) =================
 * Те же правила, что в airhockey.py: субшаги против туннелинга, отскок от платформы с подкруткой,
 * ускорение за отскок, расщепление после P.split отскоков. Касание: "me" | "bot" + сторона.
 */
class Sim {
  constructor() {
    this.balls = []; this.combo = 0; this.resetAt = 0; this.bot = null; this.botErr = 0; this.acc = 0;
    this.prev = new Map();                       // id платформы -> положение в конце прошлого кадра
    this.spree = { gate: null, n: 0, t: 0 };
    this.fx = { wideUntil: 0, q: [], stickyUntil: 0 };   // мои бонусы (бот бонусов не получает)
    this.botEff = null;                          // где бот на самом деле (с притяжением дыр)
    this.slowUntil = 0; this.iceUntil = 0; this.iceSide = null;
    this.barrage = 0; this.barrageI = 0;
  }

  // k: 0 — обычный, 1 — салют (lives), 2 — приклеен к моей платформе stuck ("m" | "k")
  // sl — множитель скорости (медленные мячи юбилея разгоняются после slh); rel — когда отлипнет сам
  newBall(vx, vy, x = 0.5, y = 0.5, touch = null, k = 0) {
    return { x, y, vx, vy, bounces: 0, touch, k, lives: P.barrageLives, stuck: null, sl: 1, slh: 0, rel: 0 };
  }

  kick(towards) {   // towards: сторона одиночки — подача летит к нему
    const dy = towards === "top" ? -1 : towards === "bottom" ? 1 : (Math.random() < 0.5 ? -1 : 1);
    this.balls = this.balls.filter(b => b.k !== 0).concat(this.newBall((Math.random() * 0.6 - 0.3), dy * P.v0));
    this.combo = 0;
  }

  seed(balls, towards, fx) {
    const live = (balls || []).filter(b => !b.k && Math.hypot(b.vx, b.vy) > 0.05);
    this.balls = [];
    if (live.length) this.balls = live.map(b => this.newBall(b.vx, b.vy, b.x, b.y));
    else this.kick(towards);
    this.resetAt = 0; this.combo = 0;
    if (fx) {   // бонусы переезжают из сетевой игры (кроме приклеенного мяча — он стал обычным)
      this.fx.wideUntil = fx.wide ? performance.now() + fx.wide * 1000 : 0;
      this.fx.q = (fx.q || []).filter(x => x !== "ball");
    }
  }

  addBalls(n, slow = false) {
    const cap = P.maxBalls + (slow ? 4 : 0);
    for (let i = 0, have = this.balls.filter(b => !b.k).length; i < n && have + i < cap; i++) {
      const a = Math.random() * 6.283;
      const b = this.newBall(Math.cos(a) * P.v0, Math.sin(a) * P.v0);
      if (slow) { b.sl = P.slowbK; b.slh = performance.now() + P.slowbHold * 1000; }
      this.balls.push(b);
    }
  }

  static padW(n) { return clamp(P.padW0 / Math.sqrt(Math.max(1, n)), P.padWmin, P.padW0); }
  barrageOn() { return this.barrage > 0 || this.balls.some(b => b.k === 1); }
  slowLeft(now) { return Math.max(0, (this.slowUntil - now) / 1000); }
  iceLeft(now) { return Math.max(0, (this.iceUntil - now) / 1000); }
  wideLeft(now) { return Math.max(0, (this.fx.wideUntil - now) / 1000); }

  boost(b) {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp <= 1e-6) return;
    const t = Math.min(P.vmax, sp * (1 + P.gain));
    b.vx *= t / sp; b.vy *= t / sp;
  }

  wall(b, ev) { ev.wall++; if (b.k === 1) { b.lives--; return; } b.bounces++; this.boost(b); }

  /* удар о платформу pad в точке (x, y), едущую со скоростью (pvx, pvy): отражаем относительную скорость */
  bounce(b, pad, x, y, pvx, pvy, ev, rnd, now) {
    const hw = pad.w / 2, hh = P.padH / 2, R = P.ballR;
    let nx, ny;
    if (rnd) {   // круглая платформа (аэрохоккей)
      const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy);
      if (d > R + P.roundR) return false;
      if (d > 1e-9) { nx = dx / d; ny = dy / d; } else { nx = 0; ny = b.y < y ? -1 : 1; }
      b.x = x + nx * (R + P.roundR); b.y = y + ny * (R + P.roundR);
    } else {
      const cx = clamp(b.x, x - hw, x + hw), cy = clamp(b.y, y - hh, y + hh);
      const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
      if (d2 > R * R) return false;
      if (d2 < 1e-9) { nx = 0; ny = b.y < y ? -1 : 1; } else { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; }
      b.x = cx + nx * R; b.y = cy + ny * R;
    }
    const vn = (b.vx - pvx) * nx + (b.vy - pvy) * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    if (!rnd) b.vx += (b.x - x) / hw * 0.25;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > P.vmax) { b.vx *= P.vmax / sp; b.vy *= P.vmax / sp; }
    ev.hit++;
    b.touch = { by: pad.kind === "bot" ? "bot" : "me", side: pad.side, kind: pad.kind };
    if (b.k === 1) { b.lives--; return true; }   // салют: теряет жизнь, касание помним — гол засчитаем
    // клейкая платформа (юбилей sticky): мяч прилипает, отлипнет сам через stickyHold
    if (pad.kind !== "bot" && now < this.fx.stickyUntil && !this.balls.some(o => o.k === 2 && o.stuck === pad.kind)) {
      Object.assign(b, { k: 2, stuck: pad.kind, rel: now + P.stickyHold * 1000, vx: 0, vy: 0 });
      return true;
    }
    b.bounces++; this.combo++;
    if (pad.kind !== "bot") ev.myCombo = Math.max(ev.myCombo, this.combo);
    this.boost(b);
    return true;
  }

  /* мяч за шаг; платформы внутри шага едут из (ox, oy) в (x, y) — субшагов хватает и на резкий взмах */
  advance(b, pads, tscale, ev, env, now) {
    const R = P.ballR, holes = env.holes || [];
    tscale *= b.sl;
    const pmove = pads.reduce((m, p) => Math.max(m, Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy)), 0);
    const n = Math.max(1, Math.min(32, Math.floor((Math.hypot(b.vx, b.vy) * SIM_DT * tscale + pmove) / (R * 0.6)) + 1));
    const sdt = SIM_DT * tscale / n;
    for (let i = 0; i < n; i++) {
      for (const h of holes) {   // чёрная дыра: тянет к центру и закручивает
        const dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy + 0.004, d = Math.sqrt(d2);
        const f = P.holeG * h.a / d2;
        b.vx += (dx / d * f + h.s * P.holeSwirl * f * -dy / d) * sdt;
        b.vy += (dy / d * f + h.s * P.holeSwirl * f * dx / d) * sdt;
      }
      if (holes.length) { const sp = Math.hypot(b.vx, b.vy); if (sp > P.vmax) { b.vx *= P.vmax / sp; b.vy *= P.vmax / sp; } }
      b.x += b.vx * sdt; b.y += b.vy * sdt;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); this.wall(b, ev); }
      else if (b.x > 1 - R) { b.x = 1 - R; b.vx = -Math.abs(b.vx); this.wall(b, ev); }
      for (const side of ["top", "bottom"]) {
        if ((side === "top" && b.y < R) || (side === "bottom" && b.y > 1 - R)) {
          if (b.x > GOAL.l && b.x < GOAL.r) return { side, x: b.x };
          b.y = side === "top" ? R : 1 - R;
          b.vy = side === "top" ? Math.abs(b.vy) : -Math.abs(b.vy);
          this.wall(b, ev);
        }
      }
      const t = (i + 1) / n;
      for (const p of pads)
        if (this.bounce(b, p, p.ox + (p.x - p.ox) * t, p.oy + (p.y - p.oy) * t, (p.x - p.ox) / SIM_DT, (p.y - p.oy) / SIM_DT, ev, env.round, now)
            && b.k === 2) return null;   // прилип
      if (b.k === 1 && b.lives <= 0) return { dead: true };
    }
    return null;
  }

  /* бот: едет к ближайшему по Y мячу с ограниченной скоростью и небольшим промахом прицела */
  stepBot(dt, w, zone, now, env) {
    const bt = this.bot;
    if (!bt || (now < this.iceUntil && this.iceSide === bt.side)) return;   // заморожен
    const [lo, hi] = bt.side === "top" ? [0, zone.top] : [zone.bot, 1];
    if (Math.random() < 0.03) this.botErr = (Math.random() * 2 - 1) * P.botErr;
    const ball = this.balls.filter(b => b.k !== 2).reduce((m, b) => !m || Math.abs(b.y - bt.y) < Math.abs(m.y - bt.y) ? b : m, null);
    const maxd = (env.slowpad === bt.side ? Math.min(P.botSpeed, P.slowpadV) : P.botSpeed) * dt, hh = P.padH / 2;
    const tx = ball ? clamp(ball.x + this.botErr, w / 2, 1 - w / 2) : 0.5;
    const ty = ball ? clamp(ball.y, lo + hh, hi - hh) : (bt.side === "top" ? lo + hh : hi - hh);
    bt.x = clamp(bt.x + clamp(tx - bt.x, -maxd, maxd), w / 2, 1 - w / 2);
    bt.y = clamp(bt.y + clamp(ty - bt.y, -maxd, maxd), lo + hh, hi - hh);
  }

  /* ---------- спри и бонусы ---------- */
  goalSpree(side, now) {
    if (this.barrageOn()) return 0;            // салют летит — серию не считаем
    const sp = this.spree;
    sp.n = sp.gate === side && now - sp.t <= P.spreeWin * 1000 ? sp.n + 1 : 1;
    sp.gate = side; sp.t = now;
    return sp.n;
  }

  award(n, kind, myPads) {
    if (n === 2) this.fx.wideUntil = performance.now() + P.wideDur * 1000;
    else if (n === 3) this.fx.q.push("slow");
    else if (n === 4) {
      const p = myPads.find(q => q.kind === kind) || myPads[0];
      if (p) { const b = this.newBall(0, 0, p.x, p.y, null, 2); b.stuck = p.kind; this.balls.push(b); this.fx.q.push("ball"); }
    } else if (n === 5) this.fx.q.push("ice");
    else if (n >= 6) { this.barrage = P.barrageN; this.barrageI = 0; }
    this.fx.q.splice(6);
  }

  /* применить бонус: сначала бросаем мяч, прилипший к клейкой платформе, потом — очередь */
  use(now, mySide, myPads, ang) {
    const sticky = this.balls.filter(b => b.k === 2 && b.rel);
    if (sticky.length) { for (const b of sticky) this.throwBall(b, myPads, ang); return "throw"; }
    const what = this.fx.q.shift();
    if (what === "slow") this.slowUntil = now + P.slowDur * 1000;
    else if (what === "ice") { this.iceUntil = now + P.iceDur * 1000; this.iceSide = opp(mySide); }
    else if (what === "ball") for (const b of this.balls) if (b.k === 2) this.throwBall(b, myPads, ang);
    return what;
  }
  stuckSticky() { return this.balls.some(b => b.k === 2 && b.rel); }

  /* бросок приклеенного мяча: направление — нормаль наклонённой платформы (ang — наклон, как на экране) */
  throwBall(b, myPads, ang) {
    const p = myPads.find(q => q.kind === b.stuck);
    const bottom = (p ? p.side : "bottom") === "bottom";
    if (ang == null) ang = p ? clamp((p.x - (this.prev.get(p.kind)?.x ?? p.x)) / SIM_DT * 1.1, -0.5, 0.5) : 0;
    ang = clamp(ang, -0.7, 0.7);
    const [nx, ny] = bottom ? [Math.sin(ang), -Math.cos(ang)] : [-Math.sin(ang), Math.cos(ang)];
    Object.assign(b, { vx: nx * P.stickV, vy: ny * P.stickV, k: 0, stuck: null, rel: 0 });
  }

  stickFollow(myPads, now, rnd) {
    for (const b of this.balls) {
      if (b.k !== 2) continue;
      const p = myPads.find(q => q.kind === b.stuck);
      if (!p || (b.rel && now >= b.rel)) { this.throwBall(b, myPads); continue; }   // ушла платформа / отлип сам
      const off = (rnd ? P.roundR : P.padH / 2) + P.ballR + 0.003;
      b.x = p.x; b.y = p.side === "bottom" ? p.y - off : p.y + off;
    }
  }

  /* один кадр: fdt — прошедшее время, myPads — мои активные платформы {kind, x, y, side}. События кадра */
  frame(fdt, myPads, zone, towards, now, env = {}) {
    const ev = { hit: 0, wall: 0, goals: [], myCombo: 0 };
    this.acc = Math.min(this.acc + fdt, 0.1);
    const steps = Math.floor(this.acc / SIM_DT);
    const wide = now < this.fx.wideUntil;
    // откуда мои платформы едут в этом кадре (сменили сторону — без «взмаха» через поле)
    const from = myPads.map(p => { const o = this.prev.get(p.kind); return o && o.side === p.side ? o : p; });
    for (let j = 0; j < steps; j++) {
      this.acc -= SIM_DT;
      const base = Sim.padW(myPads.length + (this.bot ? 1 : 0));
      const t0 = j / steps, t1 = (j + 1) / steps;
      const pads = myPads.map((p, i) => ({ kind: p.kind, side: p.side, w: wide ? base * P.wideK : base,
        ox: from[i].x + (p.x - from[i].x) * t0, oy: from[i].y + (p.y - from[i].y) * t0,
        x: from[i].x + (p.x - from[i].x) * t1, y: from[i].y + (p.y - from[i].y) * t1 }));
      if (this.bot) {
        const [ox, oy] = this.botEff || effPos(this.bot.x, this.bot.y, this.bot.side, zone, env.holes);
        this.stepBot(SIM_DT, base, zone, now, env);
        const [x, y] = this.botEff = effPos(this.bot.x, this.bot.y, this.bot.side, zone, env.holes);
        pads.push({ kind: "bot", side: this.bot.side, w: base, ox, oy, x, y });
      }
      this.stickFollow(pads.filter(p => p.kind !== "bot"), now, env.round);
      for (const b of this.balls)   // медленные мячи юбилея постепенно разгоняются
        if (b.sl < 1 && now >= b.slh) b.sl = Math.min(1, b.sl + SIM_DT * (1 - P.slowbK) / P.slowbRamp);
      if (this.resetAt) {
        if (now < this.resetAt) continue;
        this.resetAt = 0; this.kick(towards);
      }
      if (this.barrage > 0) {   // салют: по мячу за шаг, веером по кругу (предсказуемо)
        const a = this.barrageI * 2 * Math.PI / P.barrageN + Math.PI / P.barrageN;
        this.balls.push(this.newBall(Math.cos(a) * P.barrageV, Math.sin(a) * P.barrageV, 0.5, 0.5, null, 1));
        this.barrage--; this.barrageI++;
      }
      if (now < this.iceUntil) continue;        // заморозка: мячи стоят
      const tscale = now < this.slowUntil ? P.slowK : 1;
      const add = [], remove = [];
      for (const b of this.balls) {
        if (b.k === 2) continue;
        const g = this.advance(b, pads, tscale, ev, env, now);
        if (g) {
          remove.push(b);
          if (g.dead) continue;
          const by = b.touch?.by || null, own = !!b.touch && b.touch.side === g.side;
          const salute = b.k === 1;                  // голы салюта засчитываются, но спри не двигают
          const n = this.goalSpree(g.side, now);
          if (n >= 2 && by === "me" && !own) this.award(n, b.touch.kind, myPads);
          ev.goals.push({ ...g, touch: b.touch, combo: this.combo, spree: n, salute });
        } else if (b.k === 0 && b.bounces >= P.split && this.balls.filter(q => q.k === 0).length + add.length - remove.length < P.maxBalls) {
          b.bounces = 0;
          const sp = Math.hypot(b.vx, b.vy), base2 = Math.atan2(b.vy, b.vx), dv = 0.3 + Math.random() * 0.12;
          b.vx = Math.cos(base2 - dv) * sp; b.vy = Math.sin(base2 - dv) * sp;
          add.push(this.newBall(Math.cos(base2 + dv) * sp, Math.sin(base2 + dv) * sp, b.x, b.y, b.touch));
        }
      }
      this.balls = this.balls.filter(b => !remove.includes(b)).concat(add);
      if (!this.balls.some(b => b.k !== 1)) {   // обычных мячей нет — заморозка и новая подача
        this.balls.push(this.newBall(0, 0));
        this.resetAt = now + P.freeze * 1000;
        this.combo = 0;
      }
    }
    for (const p of myPads) this.prev.set(p.kind, { x: p.x, y: p.y, side: p.side });
    return ev;
  }
}
const GOAL = { l: 0.33, r: 0.67 };

function openAirHockey() {
  WM.open({ title: "Джус", icon: "🍒", width: 560, height: 680, key: "airhockey",
    render(c, w) { mountAirHockey(c, w); } });
}

/* мобильная раскладка: Telegram или устройство с «грубым» основным указателем (палец) */
function isMobileDevice() {
  try { return matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

/* opts.tg = { initData } — режим Telegram Mini App: ник из Телеграма, лидерборд поверх поля.
 * opts.mobile — принудительно задать раскладку (по умолчанию — по устройству). */
function mountAirHockey(c, w, opts = {}) {
  const tg = opts.tg || null;
  const mobile = opts.mobile ?? (!!tg || isMobileDevice());
  const cv = el("canvas", { className: "air-cv" });
  const score = el("div", { className: "air-score" });
  const lbBtn = el("button", { className: "btn small air-lb-btn", textContent: "🏆 Лидерборд", onclick: openLeaderboard });
  const feed = el("div", { className: "air-last" });
  const HINT = mobile ? "Тапни по верхней или нижней зоне, чтобы выбрать сторону, и води пальцем по тачпаду внизу"
                      : "Веди курсор в светлую зону у ворот · вторая платформа — A/D";
  const hint = el("div", { className: "air-hint", textContent: HINT });
  const strip = mobile ? el("div", { className: "air-strip" }) : null;
  // кнопка бонуса из очереди (на ПК то же делает ЛКМ по полю)
  const bonusBtn = el("button", { className: "btn air-bonus", hidden: true, onclick: () => useBonus() });
  const root = el("div", { className: "air" + (mobile ? " air-tg" : "") }, score, cv,
    ...(strip ? [strip] : []), bonusBtn, el("div", { className: "air-row" }, feed, lbBtn), hint);
  c.append(root);

  const ctx = cv.getContext("2d");
  let W = 0, H = 0;
  const zone = { top: 0.35, bot: 0.65, itop: 0.35, ibot: 0.65 };   // top/bot — где можно стоять, itop/ibot — граница ввода
  let canPlay = false, nahCooldown = 0, myNick = null;
  const nah = new Audio(SND + "nah.wav"); nah.volume = 0.6;

  // серверное состояние + время получения (для экстраполяции)
  let srv = { mode: "local", sim: false, balls: [{ x: .5, y: .5, vx: 0, vy: 0 }], pads: [], pw: .22, combo: 0,
              score: { top: 0, bottom: 0 }, last: [], players: 0, cap: 8, gid: 0, hid: 0, wid: 0, goal: null };
  let srvT = performance.now();
  let lastGid = 0, lastHid = 0, lastWid = 0, gotState = false;
  let lastOnlinePads = [];        // чужие платформы из последнего online-кадра — бот встанет на место ушедшего
  const pstate = new Map();       // id -> {rx, ry, prevX, angle, angVel}

  /* ---------- мои платформы: m — мышь/палец, k — клавиатура ----------
   * active — держит слот; leaveAt — ушёл, но платформа стоит до этого момента (GRACE). */
  // tx/ty — куда тянет ввод; x/y — где платформа (при slowpad догоняет ввод медленно)
  const mine = { m: { x: .5, y: .9, tx: .5, ty: .9, side: "bottom", active: false, leaveAt: 0, sendT: 0 },
                 k: { x: .5, y: .99, tx: .5, ty: .99, side: "top", active: false, leaveAt: 0, sendT: 0 } };
  /* глобальные эффекты юбилея — их считает сервер в обоих режимах */
  const env = () => ({ round: (srv.round || 0) > (performance.now() - srvT) / 1000, holes: srv.holes || [], slowpad: srv.slowpad || null });
  let goneAt = 0;                 // когда у меня не осталось ни одной платформы (для ухода бота)

  function fitCanvas() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w2 = Math.max(1, Math.round(r.width * dpr)), h2 = Math.max(1, Math.round(r.height * dpr));
    if (w2 !== W || h2 !== H) { W = cv.width = w2; H = cv.height = h2; }
  }

  /* ---------- локальная игра ---------- */
  const sim = new Sim();
  let simOn = false, simReportT = 0;
  const myPads = () => ["m", "k"].filter(s => mine[s].active).map(s => {
    const [x, y] = effPos(mine[s].x, mine[s].y, mine[s].side, zone, srv.holes);
    return { x, y, side: mine[s].side, kind: s };
  });
  /* мои платформы догоняют ввод (мгновенно, или медленно при slowpad); зона могла сжаться — прижимаем */
  function stepMine(fdt) {
    const sp = srv.slowpad;
    for (const s of ["m", "k"]) {
      const p = mine[s];
      if (!p.active) continue;
      if (sp === p.side) { const md = P.slowpadV * fdt; p.x += clamp(p.tx - p.x, -md, md); p.y += clamp(p.ty - p.y, -md, md); }
      else { p.x = p.tx; p.y = p.ty; }
      const [lo, hi] = p.side === "top" ? [0, zone.top] : [zone.bot, 1];
      p.y = clamp(p.y, lo + P.padH / 2, hi - P.padH / 2);
    }
  }
  const mySide = () => mine.m.active ? mine.m.side : mine.k.active ? opp(mine.k.side) : (touch.side || "bottom");

  function setSim(on) {
    if (on === simOn) return;
    simOn = on;
    if (on) {
      // продолжаем с того места, где была игра; ушедшего соперника заменяет бот (сразу)
      const now = performance.now(), dt = (now - srvT) / 1000;
      sim.seed((srv.balls || []).map(b => ({ x: clamp01(b.x + b.vx * dt), y: clamp01(b.y + b.vy * dt), vx: b.vx, vy: b.vy, k: b.k })), mySide(), srv.fx);
      const gone = lastOnlinePads.find(p => !p.me && p.kind !== "bot");
      sim.bot = gone ? { x: gone.x, y: gone.y, side: gone.side, kind: "bot" } : null;
      lastOnlinePads = [];
    } else {
      sim.bot = null;
    }
  }

  function spawnBot() {
    if (sim.bot) return;
    const side = opp(mySide());
    sim.bot = { x: 0.5, y: side === "top" ? 0.06 : 0.94, side, kind: "bot" };
  }

  function stepSim(fdt, now) {
    if (!simOn) return;
    const pads = myPads();
    // одиночка ушёл совсем — бот тоже уходит, поле затихает до его возвращения
    if (!pads.length) { if (!goneAt) goneAt = now; if (sim.bot && now - goneAt > BOT_FORGET) sim.bot = null; }
    else goneAt = 0;
    if (sim.bot && mine.m.active) sim.bot.side = opp(mine.m.side);   // бот всегда напротив игрока
    const ev = sim.frame(fdt, pads, zone, mySide(), now, env());
    if (ev.hit) Snd.play("click", true);
    if (ev.wall) Snd.play("wall", true);
    for (const g of ev.goals) {
      const by = g.touch?.by || null;
      const own = !!g.touch && g.touch.side === g.side;
      lastSent = { by, own };
      send({ t: "goal", side: g.side, x: +g.x.toFixed(4), by, own, combo: by === "me" ? ev.myCombo || g.combo : 0,
             spree: g.spree, salute: g.salute || undefined });
      spawnBot();     // бот приходит с первого гола одиночки — даже если тот забил в свои
    }
    if (now - simReportT > 100) {   // снимок для зрителей и для подхвата сервером
      simReportT = now;
      send({ t: "sim", balls: sim.balls.map(b => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), vx: +b.vx.toFixed(4), vy: +b.vy.toFixed(4), k: b.k, l: b.lives, s: +b.sl.toFixed(3) })),
             bot: sim.bot ? { x: +sim.bot.x.toFixed(4), y: +sim.bot.y.toFixed(4), side: sim.bot.side } : null });
    }
  }

  /* ---------- бонусы и эффекты: единый вид для локальной и сетевой игры ---------- */
  let fxShow = null;            // анимация спри: {n, t0, side}
  let lastSent = null;          // мой последний гол в local: {by, own} — кому достанется юбилей sticky
  function view() {
    const now = performance.now();
    if (simOn) return { q: sim.fx.q, wide: sim.wideLeft(now), slow: sim.slowLeft(now), ice: sim.iceLeft(now),
      iceSide: sim.iceLeft(now) > 0 ? sim.iceSide : null, barrage: sim.barrageOn(),
      sticky: Math.max(0, (sim.fx.stickyUntil - now) / 1000), stuck: sim.stuckSticky() };
    const el2 = (now - srvT) / 1000, f = srv.fx || {};
    return { q: f.q || [], wide: Math.max(0, (f.wide || 0) - el2), slow: Math.max(0, (srv.slow || 0) - el2),
      ice: Math.max(0, (srv.ice || 0) - el2), iceSide: srv.ice > el2 ? srv.ice_side : null, barrage: !!srv.barrage,
      sticky: Math.max(0, (f.sticky || 0) - el2), stuck: (srv.balls || []).some(b => b.k === 2 && b.r > 0 && b.m) };
  }
  function myPadW(extra = 0) {
    const base = simOn ? Sim.padW(myPads().length + (sim.bot ? 1 : 0) + extra) : srv.pw;
    return view().wide > 0 ? base * P.wideK : base;
  }
  const canUse = v => v.q.length > 0 || v.stuck;
  function useBonus() {
    if (!canUse(view())) return;
    Snd.init();
    const ang = +(pstate.get("me:m")?.angle || 0).toFixed(3);   // наклон платформы — направление броска
    if (simOn) sim.use(performance.now(), mySide(), myPads(), ang);
    else send({ t: "use", ang });
  }
  const BONUS_NAME = { slow: "🐢 Замедление", ball: "🎯 Бросить мяч", ice: "❄️ Заморозка" };
  function syncBonusUi(v) {
    const q = v.q;
    bonusBtn.hidden = !canUse(v);
    const tail = mobile ? "" : "  · ЛКМ";
    if (v.stuck) bonusBtn.textContent = "🎯 Бросить мяч" + (q.length ? `  +${q.length}` : "") + tail;
    else if (q.length) bonusBtn.textContent = BONUS_NAME[q[0]] + (q.length > 1 ? `  +${q.length - 1}` : "") + tail;
    const slow = v.slow > 0;
    root.classList.toggle("air-slow", slow);
    w.node?.classList?.toggle("air-slow-win", slow);
  }

  /* ---------- WebSocket ---------- */
  let ws = null, closed = false;
  const send = d => { if (ws?.readyState === 1) ws.send(JSON.stringify(d)); };
  function connect() {
    if (closed) return;
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/air/ws");
    ws.onopen = () => {
      if (tg?.initData) send({ t: "tg", init: tg.initData });
      for (const s of ["m", "k"]) if (mine[s].active) sendMove(s, true);   // переподключились — вернём платформы
    };
    ws.onmessage = e => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "state") {
        if (d.mode === "online") lastOnlinePads = d.pads;
        srv = d; srvT = performance.now();
        if (typeof d.top === "number") { zone.top = d.top; zone.bot = d.bot; }  // зона гуляет/сжимается на событии
        if (typeof d.itop === "number") { zone.itop = d.itop; zone.ibot = d.ibot; }
        setSim(!!d.sim);
        if (!simOn) {
          if (d.hid !== lastHid) { lastHid = d.hid; Snd.play("click", true); }
          if (d.wid !== lastWid) { lastWid = d.wid; Snd.play("wall", true); }
        } else { lastHid = d.hid; lastWid = d.wid; }
        if (d.gid !== lastGid) {
          lastGid = d.gid;
          if (gotState) onGoal(d.goal);   // первый кадр после входа — без звука прошлого гола
        }
        gotState = true;
      } else if (d.t === "hello") {
        canPlay = d.can_play;
        if (d.phys) Object.assign(P, d.phys);
        if (typeof d.top === "number") { zone.top = zone.itop = d.top; zone.bot = zone.ibot = d.bot; GOAL.l = d.goalL; GOAL.r = d.goalR; }
        myNick = d.nick || myNick;
        hint.textContent = d.anon ? (tg ? "Не удалось войти через Телеграм — играешь анонимно"
                                        : "Играешь анонимно — в счёте будет случайный номер (войди в чат для ника)")
                                  : (d.nick && tg ? `Ты — ${d.nick}. ` : "") + HINT;
      } else if (d.t === "full") { playNah(); hint.textContent = "Все места заняты — подожди, пока кто-то выйдет"; }
    };
    ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
  }
  function playNah() { const t = performance.now(); if (t < nahCooldown) return; nahCooldown = t + 1500;
    try { nah.currentTime = 0; nah.play().catch(() => {}); } catch {} }

  /* поставить свою платформу в точку поля (x, y уже в координатах поля, y — внутри активной зоны) */
  function moveMine(slot, x, y) {
    const p = mine[slot];
    const side = y <= Math.max(zone.top, zone.itop) ? "top" : "bottom";
    const v0 = view();
    if (!simOn && v0.ice > 0 && v0.iceSide === (p.active ? p.side : side)) return;   // меня заморозили
    const changed = !p.active || p.side !== side || p.leaveAt;
    const pw = myPadW(p.active ? 0 : 1);
    const [lo, hi] = side === "top" ? [0, zone.top] : [zone.bot, 1];
    p.tx = clamp(x, pw / 2, 1 - pw / 2);
    p.ty = clamp(y, lo + P.padH / 2, hi - P.padH / 2);
    if (!p.active || p.side !== side || srv.slowpad !== side) { p.x = p.tx; p.y = p.ty; }   // телепорт / без slowpad
    p.side = side; p.active = true; p.leaveAt = 0;
    sendMove(slot, changed);   // смена стороны/возврат — сразу, остальное — не чаще ~30/сек
  }
  function sendMove(slot, now = false) {
    const p = mine[slot], t = performance.now();
    if (!now && t - p.sendT < 30) return;
    p.sendT = t;
    send({ t: "move", x: +p.tx.toFixed(4), y: +p.ty.toFixed(4), slot });   // сервер сам замедлит при slowpad
  }
  /* убрал курсор/палец: платформа ещё стоит GRACE секунд */
  function leaveMine(slot) {
    const p = mine[slot];
    if (!p.active || p.leaveAt) return;
    p.leaveAt = performance.now() + P.grace * 1000;
    send({ t: "leave", slot });
  }
  function expireMine(now) {
    for (const s of ["m", "k"]) { const p = mine[s]; if (p.active && p.leaveAt && now >= p.leaveAt) { p.active = false; p.leaveAt = 0; } }
  }

  /* ---------- гол: звук + тряска ---------- */
  function onGoal(g) {
    if (!g) return;
    if (simOn && g.ev === "balls" && g.add) sim.addBalls(g.add);   // юбилейное событие в локальной игре
    if (simOn && g.ev === "slowballs" && g.add) sim.addBalls(g.add, true);
    if (simOn && g.ev === "sticky" && lastSent?.by === "me" && !lastSent.own)
      sim.fx.stickyUntil = performance.now() + P.stickyDur * 1000;
    if (g.spree >= 2) fxShow = { n: g.spree, t0: performance.now(), side: g.side };
    const s = g.score || 0;
    if (s % 100 === 0) Snd.play("goal100th");
    else if (s % 100 === 50) Snd.play("goal150th");
    else if (s % 10 === 0) Snd.play("goal10th");
    else Snd.play("goal", true);
    const r = cv.getBoundingClientRect();
    const ex = r.left + g.x * r.width, ey = g.side === "top" ? r.top : r.bottom;
    shake(w.node, 16);
    if (g.own && !tg) {  // свой гол — трясёт все окна, слабее и с затуханием по расстоянию
      const diag = Math.hypot(innerWidth, innerHeight);
      for (const win of WM.wins.values()) {
        if (win.node === w.node || win.minimized) continue;
        const b = win.node.getBoundingClientRect();
        const dist = Math.hypot(b.left + b.width / 2 - ex, b.top + b.height / 2 - ey);
        shake(win.node, 11 * Math.max(0, 1 - dist / diag));
      }
    }
  }

  /* ---------- обучение ----------
   * ПК: шаг «choose side» — пока курсор ни разу не зашёл в зону.
   * Мобилка: «choose side» (подсвечены обе зоны) → подсвечен тачпад, пока по нему ни разу не провели. */
  const tut = { sideDone: false, padDone: !mobile };
  const tutStep = () => !tut.sideDone ? "side" : !tut.padDone ? "pad" : null;
  function syncTut() { strip?.classList.toggle("tut", tutStep() === "pad"); }

  /* ---------- ввод: компьютер (мышь) ---------- */
  if (!mobile) {
    const applyPointer = e => {
      Snd.init();
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const active = (y <= zone.itop || y >= zone.ibot) && x >= 0 && x <= 1;   // strip не выкидывает игрока
      cv.classList.toggle("playing", active && canPlay);
      if (!active) return leaveMine("m");
      if (!canPlay) return playNah();
      if (!tut.sideDone) { tut.sideDone = true; syncTut(); }
      moveMine("m", clamp01(x), clamp01(y));
    };
    cv.onpointermove = applyPointer;
    cv.onpointerdown = e => { focused = true; applyPointer(e); if (e.button === 0 && canUse(view()) && mine.m.active) useBonus(); };
    cv.onpointerleave = () => { cv.classList.remove("playing"); leaveMine("m"); };
  }

  /* ---------- ввод: телефон (тачпад под полем) ----------
   * X пальца → X платформы; Y внутри полосы → Y внутри своей зоны (без зеркала).
   * Сторону игрок выбирает тапом по зоне поля (запоминается). */
  let savedSide = null; try { savedSide = localStorage.getItem("air-tg-side"); } catch {}
  const touch = { on: false, x: 0.5, fy: 1, side: savedSide === "top" || savedSide === "bottom" ? savedSide : null };
  const touchY = () => touch.side === "top" ? touch.fy * zone.top : zone.bot + touch.fy * (1 - zone.bot);
  function setSide(sd) {
    const was = touch.side;
    touch.side = sd;
    try { localStorage.setItem("air-tg-side", sd); } catch {}
    strip?.classList.toggle("locked", !sd);
    if (!tut.sideDone) { tut.sideDone = true; syncTut(); }
    // сменил сторону, пока платформа ещё стоит, — сразу переносим её на новую сторону
    if (was !== sd && mine.m.active && canPlay) {
      moveMine("m", mine.m.x, touchY());
      if (!touch.on) leaveMine("m");   // палец не на тачпаде — отсчёт GRACE пошёл заново
    }
  }
  if (strip) {
    if (touch.side) setSide(touch.side); else strip.classList.add("locked");
    cv.onpointerdown = e => {
      Snd.init();
      const r = cv.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      if (y <= zone.itop) setSide("top"); else if (y >= zone.ibot) setSide("bottom");
    };
    const onStrip = e => {
      const r = strip.getBoundingClientRect();
      touch.x = clamp01((e.clientX - r.left) / r.width);
      touch.fy = clamp01((e.clientY - r.top) / r.height);   // 0 — верх полосы, 1 — низ
    };
    strip.onpointerdown = e => {
      Snd.init();
      strip.setPointerCapture?.(e.pointerId); touch.on = true; strip.classList.add("on");
      onStrip(e);
      if (!canPlay || !touch.side) return playNah();
      if (!tut.padDone) { tut.padDone = true; syncTut(); }
    };
    strip.onpointermove = e => { if (touch.on) onStrip(e); };
    const up = () => { if (!touch.on) return; touch.on = false; strip.classList.remove("on"); leaveMine("m"); };
    strip.onpointerup = up; strip.onpointercancel = up;
  }
  function stepTouch() {
    if (!strip || !touch.on || !canPlay || !touch.side) return;
    moveMine("m", touch.x, touchY());
  }
  syncTut();

  /* ---------- клавиатурная вторая платформа (A/D, только ПК) ----------
   * Жёсткая, у ворот на стороне НАПРОТИВ мыши. Линейное ускорение, не выходит за край. */
  const KB_ACCEL = 2.4, KB_VMAX = 1.6, KB_FRICTION = 6;   // единиц поля в сек
  const kb = { x: 0.5, vx: 0, lastInput: 0, left: false, right: false };
  let focused = true;

  function onKey(e, down) {
    if (closed || !focused || mobile) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;   // не мешаем печатать
    if (e.code === "KeyA") kb.left = down;
    else if (e.code === "KeyD") kb.right = down;
    else return;
    e.preventDefault();
    if (down && canPlay) { kb.lastInput = performance.now(); Snd.init(); if (!mine.k.active || mine.k.leaveAt) kbPlace(); }
  }
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  document.addEventListener("keydown", kd); document.addEventListener("keyup", ku);
  const focusOn = e => { focused = w.node.contains(e.target); };
  document.addEventListener("pointerdown", focusOn, true);

  function kbPlace() {
    const side = mine.m.active ? opp(mine.m.side) : "top";
    const y = side === "top" ? P.padH / 2 + 0.001 : 1 - P.padH / 2 - 0.001;
    moveMine("k", kb.x, y);
  }
  function stepKB(dt) {
    if (mobile || !canPlay) return;
    if (kb.left) kb.vx -= KB_ACCEL * dt;
    if (kb.right) kb.vx += KB_ACCEL * dt;
    if (!kb.left && !kb.right) {
      const f = KB_FRICTION * dt;
      kb.vx = Math.abs(kb.vx) <= f ? 0 : kb.vx - Math.sign(kb.vx) * f;
    }
    kb.vx = clamp(kb.vx, -KB_VMAX, KB_VMAX);
    const hw = myPadW() / 2;
    kb.x += kb.vx * dt;
    if (kb.x < hw) { kb.x = hw; kb.vx = 0; } else if (kb.x > 1 - hw) { kb.x = 1 - hw; kb.vx = 0; }
    if (kb.left || kb.right) kb.lastInput = performance.now();
    if (!mine.k.active || mine.k.leaveAt) return;
    // клавиши отпущены и платформа стоит 3 с — уходим (дальше ещё GRACE, как у мыши)
    if (!kb.left && !kb.right && Math.abs(kb.vx) < 1e-3 && performance.now() - kb.lastInput > 3000) return leaveMine("k");
    kbPlace();
  }

  /* ---------- отрисовка ---------- */
  function drawPaddle(cx, cy, pw, ph, angle, bend, color, alpha = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.globalAlpha = alpha;
    const hw = pw / 2, hh = ph / 2, r = hh;
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(-hw + r, -hh);
    ctx.quadraticCurveTo(0, -hh - bend, hw - r, -hh);
    ctx.arcTo(hw, -hh, hw, -hh + r, r); ctx.lineTo(hw, hh - r); ctx.arcTo(hw, hh, hw - r, hh, r);
    ctx.quadraticCurveTo(0, hh - bend, -hw + r, hh);
    ctx.arcTo(-hw, hh, -hw, hh - r, r); ctx.lineTo(-hw, -hh + r); ctx.arcTo(-hw, -hh, -hw + r, -hh, r);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  /* что рисовать: платформы {id, x, y, kind, me, nick, away} */
  function padsToDraw(now) {
    const out = [];
    const fade = p => p.leaveAt ? 0.35 + 0.65 * Math.max(0, (p.leaveAt - now) / (P.grace * 1000)) : 1;
    const v = view(), myW = myPadW();
    const meP = s => { const [x, y] = effPos(mine[s].x, mine[s].y, mine[s].side, zone, srv.holes);
      return { id: "me:" + s, x, y, kind: s, me: true, alpha: fade(mine[s]), w: myW, ice: v.iceSide === mine[s].side }; };
    if (simOn) {
      for (const s of ["m", "k"]) if (mine[s].active) out.push(meP(s));
      if (sim.bot) out.push({ id: "bot", x: (sim.botEff || [sim.bot.x])[0], y: (sim.botEff || [0, sim.bot.y])[1], kind: "bot", me: false, nick: P.botNick,
        w: Sim.padW(myPads().length + 1), ice: v.iceSide === sim.bot.side });
      return out;
    }
    for (const p of srv.pads) {
      const kind = p.kind || "m";
      if (p.me && (kind === "m" || kind === "k")) {
        if (!mine[kind].active) continue;     // свою платформу знаем лучше сервера
        out.push(meP(kind));
      } else out.push({ id: (p.nick || "?") + ":" + kind + ":" + p.side, x: p.x, y: p.y, kind, me: false, nick: p.nick,
                        alpha: p.away ? 0.45 : 1, w: p.pw || srv.pw, ice: !!p.ice });
    }
    // своя платформа, о которой сервер ещё не знает (только что поставили)
    for (const s of ["m", "k"]) if (mine[s].active && !out.some(o => o.id === "me:" + s)) out.push(meP(s));
    return out;
  }

  function bigText(text, sub, y, pulse) {
    const fs = Math.round(Math.min(W, H) * 0.085);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `800 ${fs}px system-ui, sans-serif`;
    ctx.shadowColor = "rgba(138,180,255,0.9)"; ctx.shadowBlur = fs * 0.5 * pulse;
    ctx.fillStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`;
    ctx.fillText(text, W / 2, y);
    if (sub) { ctx.shadowBlur = 0; ctx.font = `${Math.round(fs * 0.32)}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillText(sub, W / 2, y + fs * 0.85); }
    ctx.restore();
  }

  /* ---------- эффекты: вспышка и число спри, таймеры замедления и заморозки ---------- */
  const SPREE_HUE = { 2: 190, 3: 130, 4: 52, 5: 22, 6: 300 };
  const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
  const easeOutCubic = t => 1 - (1 - t) ** 3;
  function timerBar(y, left, total, color, label) {
    const bw = W * 0.42, bh = Math.max(3, H * 0.007), x0 = (W - bw) / 2;
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x0, y, bw, bh);
    ctx.fillStyle = color; ctx.fillRect(x0, y, bw * clamp(left / total, 0, 1), bh);
    ctx.font = `600 ${Math.round(H * 0.026)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(`${label} ${left.toFixed(1)}`, W / 2, y - 2);
  }
  function drawEffects(fx, now) {
    if (fx.ice > 0 && fx.iceSide) {   // замороженная сторона — ледяная дымка
      ctx.fillStyle = "rgba(180,225,255,0.12)";
      if (fx.iceSide === "top") ctx.fillRect(0, 0, W, zone.top * H); else ctx.fillRect(0, zone.bot * H, W, (1 - zone.bot) * H);
    }
    let y = H * 0.42;
    if (fx.slow > 0) { timerBar(y, fx.slow, P.slowDur, "#cfeaff", "🐢"); y += H * 0.05; }
    if (fx.ice > 0) timerBar(y, fx.ice, P.iceDur, "#8fd8ff", "❄️");
    if (!fxShow) return;
    const t = now - fxShow.t0, n = fxShow.n;
    if (t > 1700) { fxShow = null; return; }
    // вспышка всего стола: цвет по множителю, яркость растёт с каждым ×
    const hue = SPREE_HUE[Math.min(6, n)] ?? 300;
    const peak = Math.min(0.75, 0.14 + 0.12 * (n - 1));
    const a = peak * Math.exp(-t / 260);
    if (a > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${hue} 100% 60% / ${a})`; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // число: резко появляется большим и повёрнутым, с изингом садится на место, потом гаснет
    const k = clamp(t / 450, 0, 1);
    const scale = 3.2 - 2.2 * easeOutBack(k), rot = -0.9 * (1 - easeOutCubic(k));
    const alpha = t < 1300 ? Math.min(1, t / 60) : 1 - (t - 1300) / 400;
    const fs = Math.round(Math.min(W, H) * 0.16);
    ctx.save();
    ctx.translate(W / 2, fxShow.side === "top" ? H * 0.22 : H * 0.78);
    ctx.rotate(rot); ctx.scale(scale, scale); ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 ${fs}px system-ui, sans-serif`;
    ctx.shadowColor = `hsl(${hue} 100% 60%)`; ctx.shadowBlur = fs * 0.35;
    ctx.fillStyle = "#fff"; ctx.fillText("×" + n, 0, 0);
    ctx.shadowBlur = 0; ctx.font = `800 ${Math.round(fs * 0.22)}px system-ui, sans-serif`;
    ctx.fillStyle = `hsl(${hue} 100% 75%)`; ctx.fillText("SPREE", 0, fs * 0.62);
    ctx.restore();
  }

  /* чёрные дыры: тёмный центр, светящийся аккреционный диск, вращающиеся рукава */
  function drawHoles(holes, now) {
    for (const h of holes || []) {
      const cx = h.x * W, cy = h.y * H, r = Math.min(W, H) * 0.055;
      ctx.save(); ctx.globalAlpha = h.a;
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2.2);
      g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.35, "rgba(10,0,25,0.95)");
      g.addColorStop(0.55, "rgba(150,70,255,0.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, 7); ctx.fill();
      ctx.translate(cx, cy); ctx.rotate(h.s * now / 400);
      ctx.strokeStyle = "rgba(255,170,90,0.7)"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.rotate(2.094);
        ctx.beginPath(); ctx.arc(0, 0, r * (0.9 + i * 0.25), 0, 1.6 * h.s, h.s < 0); ctx.stroke();
      }
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  let prevT = performance.now();
  function draw() {
    fitCanvas();
    const now = performance.now();
    const fdt = Math.min(0.05, (now - prevT) / 1000); prevT = now;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    expireMine(now);
    stepMine(fdt);
    stepKB(fdt);
    stepTouch();
    stepSim(fdt, now);
    const step = tutStep();
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fillRect(0, 0, W, H);
    // активные зоны; на шаге «choose side» — обе пульсируют
    ctx.fillStyle = step === "side" ? `rgba(138,180,255,${0.16 + 0.22 * pulse})` : "rgba(138,180,255,0.13)";
    ctx.fillRect(0, 0, W, zone.top * H);
    ctx.fillRect(0, zone.bot * H, W, (1 - zone.bot) * H);
    if (mobile && touch.side) {   // своя зона ярче
      ctx.fillStyle = "rgba(138,180,255,0.14)";
      if (touch.side === "top") ctx.fillRect(0, 0, W, zone.top * H);
      else ctx.fillRect(0, zone.bot * H, W, (1 - zone.bot) * H);
    }
    ctx.strokeStyle = "rgba(138,180,255,0.4)"; ctx.setLineDash([5, 5]);
    line(0, zone.top * H, W, zone.top * H); line(0, zone.bot * H, W, zone.bot * H);
    ctx.strokeStyle = "rgba(255,255,255,0.1)"; line(0, 0.5 * H, W, 0.5 * H); ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(123,227,161,0.9)"; ctx.lineWidth = 4;
    line(GOAL.l * W, 2, GOAL.r * W, 2); line(GOAL.l * W, H - 2, GOAL.r * W, H - 2); ctx.lineWidth = 1;

    // платформы (с наклоном и гибкостью)
    const fx = view(), E = env();
    syncBonusUi(fx);
    drawHoles(E.holes, now);
    const ph = PAD_DRAW_H * H;
    const seen = new Set();
    for (const p of padsToDraw(now)) {
      seen.add(p.id);
      let st = pstate.get(p.id);
      if (!st) { st = { rx: p.x, ry: p.y, prevX: p.x, angle: 0, angVel: 0 }; pstate.set(p.id, st); }
      const rigid = p.kind === "k";
      const k = p.me ? 0.6 : p.kind === "bot" && simOn ? 1 : 0.25;
      st.rx += (p.x - st.rx) * k; st.ry += (p.y - st.ry) * k;
      if (rigid) { st.angle = 0; st.angVel = 0; st.prevX = st.rx; }
      else {
        const vx = (st.rx - st.prevX) / Math.max(fdt, 1e-3); st.prevX = st.rx;
        const target = clamp(vx * 1.1, -0.5, 0.5);
        st.angVel += ((target - st.angle) * 55 - st.angVel * 9) * fdt;
        st.angle += st.angVel * fdt;
      }
      const bend = rigid ? 0 : clamp(st.angVel * ph * 0.25, -ph, ph);
      const color = p.ice ? "#bfe8ff" : p.me ? (rigid ? "#7be3a1" : "#8ab4ff") : "rgba(255,255,255,0.7)";
      if (E.round) {   // юбилей round: платформы-круги, как биты аэрохоккея
        const rr = P.roundR * Math.min(W, H);
        ctx.save(); ctx.globalAlpha = p.alpha ?? 1; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(st.rx * W, st.ry * H, rr, 0, 7); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(st.rx * W, st.ry * H, rr * 0.45, 0, 7); ctx.fill();
        ctx.restore();
      } else drawPaddle(st.rx * W, st.ry * H, (p.w || srv.pw) * W, ph, p.ice ? 0 : st.angle, p.ice ? 0 : bend, color, p.alpha ?? 1);
      if (p.me && fx.sticky > 0) {   // клейкая платформа — липкая зелёная кромка
        ctx.save(); ctx.strokeStyle = `rgba(150,255,120,${0.5 + 0.3 * pulse})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(st.rx * W, st.ry * H, (E.round ? P.roundR * Math.min(W, H) : (p.w || srv.pw) * W / 2) + 4, E.round ? P.roundR * Math.min(W, H) + 4 : ph, 0, 0, 7);
        ctx.stroke(); ctx.restore();
      }
      if (!p.me && p.nick) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = Math.round(ph * 0.9) + "px system-ui";
        ctx.textAlign = "center"; ctx.fillText(p.nick, st.rx * W, st.ry * H - ph); }
    }
    for (const id of [...pstate.keys()]) if (!seen.has(id)) pstate.delete(id);

    // мячи: свои локальные — как есть; серверные — экстраполяция по вектору
    const dt = (now - srvT) / 1000;
    const R = P.ballR * Math.min(W, H);
    const balls = simOn ? sim.balls.map(b => ({ x: b.x, y: b.y, vx: b.vx * b.sl, vy: b.vy * b.sl, e: 0, k: b.k, l: b.lives,
                                                s: b.sl, r: b.rel ? Math.max(0, (b.rel - now) / 1000) : 0 }))
                        : (srv.balls || []).map(b => ({ ...b, e: dt }));
    const frozen = fx.ice > 0, slowK = fx.slow > 0 && simOn ? P.slowK : 1;
    let lastHue = 90;
    for (const ball of balls) {
      const bx = clamp01(ball.x + ball.vx * ball.e) * W;
      const by = clamp01(ball.y + ball.vy * ball.e) * H;
      const sp = frozen || ball.k === 2 ? 0 : Math.hypot(ball.vx, ball.vy) * slowK;
      const f = clamp((Math.hypot(ball.vx, ball.vy) - 0.6) / 1.8, 0, 1);
      const salute = ball.k === 1;
      // салют: чем меньше жизней, тем краснее; заморозка — ледяной; обычный — жёлтый → зелёный
      // медленный мяч юбилея — голубой, по мере разгона возвращает свой цвет
      const slowT = clamp((1 - (ball.s ?? 1)) / (1 - P.slowbK), 0, 1);
      const hue = salute ? 50 * clamp((ball.l - 1) / (P.barrageLives - 1), 0, 1) : frozen ? 195 : (55 + f * 95) * (1 - slowT) + 200 * slowT;
      if (!salute) lastHue = hue;
      const glow = `hsl(${hue} 100% ${salute ? 55 : 60}%)`;
      if (sp > 0.05) {
        const ang = Math.atan2(ball.vy, ball.vx);
        const tl = R * (2 + f * 6);
        ctx.save(); ctx.translate(bx, by); ctx.rotate(ang);
        const grad = ctx.createLinearGradient(0, 0, -tl, 0);
        grad.addColorStop(0, glow); grad.addColorStop(1, "transparent");
        ctx.fillStyle = grad; ctx.beginPath();
        ctx.moveTo(0, -R * 0.9); ctx.lineTo(-tl, 0); ctx.lineTo(0, R * 0.9); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      const r = salute ? R * 0.75 : R;
      ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = r * (1.5 + f * 4);
      ctx.fillStyle = salute ? glow : "#fff"; ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fill();
      ctx.fillStyle = glow; ctx.globalAlpha = salute ? 0.6 : 0.35; ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fill();
      ctx.restore();
      if (ball.k === 2 && ball.r > 0) {   // прилип к клейкой платформе: кольцо сужается к моменту, когда отлипнет сам
        const t = clamp(ball.r / P.stickyHold, 0, 1);
        ctx.strokeStyle = `hsla(110 100% 65% / ${0.4 + 0.5 * (1 - t)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, R + t * R * 6, 0, 7); ctx.stroke();
      }
    }
    // кольцо запуска после гола: сужается, подсказывая момент старта
    const launch = simOn ? (sim.resetAt ? Math.max(0, (sim.resetAt - now) / 1000) : 0) : srv.launch_in;
    if (launch > 0 && P.freeze > 0) {
      const t = launch / P.freeze;
      ctx.strokeStyle = `hsla(${lastHue} 100% 65% / ${0.4 + 0.5 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0.5 * W, 0.5 * H, R + t * R * 6, 0, 7); ctx.stroke();
    }
    drawEffects(fx, now);
    // обучение поверх поля
    if (step === "side") bigText("CHOOSE SIDE", mobile ? "тапни по верхней или нижней зоне" : "наведи курсор на светлую зону", H * 0.5, pulse);
    else if (step === "pad") bigText("TOUCHPAD ↓", "води пальцем по полосе внизу", H * 0.5, pulse);
    raf = requestAnimationFrame(draw);
  }
  const line = (a, b, cc, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(cc, d); ctx.stroke(); };

  /* ---------- табло ---------- */
  const goalCls = s => s % 100 === 0 ? " jub100" : s % 100 === 50 ? " jub100" : s % 10 === 0 ? " jub10" : "";
  function renderHud() {
    const combo = simOn ? sim.combo : srv.combo;
    score.replaceChildren(
      el("span", { className: "air-goal" + goalCls(srv.score.top), textContent: "▲ " + srv.score.top }),
      el("span", { className: "air-mid" },
        el("div", { textContent: `${srv.players}/${srv.cap} игроков` }),
        combo > 1 ? el("div", { className: "air-combo", textContent: "комбо ×" + combo }) : el("div")),
      el("span", { className: "air-goal" + goalCls(srv.score.bottom), textContent: srv.score.bottom + " ▼" }));
    feed.replaceChildren(el("span", { className: "air-last-l", textContent: "Забили:" }),
      ...srv.last.map(s => el("span", { className: "air-nick" + (s.own ? " own" : ""),
        textContent: s.nick + (s.own ? " (в свои)" : "") })));
    hudRaf = requestAnimationFrame(renderHud);
  }

  function openLeaderboard() {
    if (tg || mobile) {
      const ov = el("div", { className: "air-lb-ov" });
      ov.append(el("button", { className: "btn small air-lb-x", textContent: "✕", onclick: () => ov.remove() }));
      c.append(ov); lbRender(ov); return;
    }
    const lw = 300, lh = 440;
    const win = WM.open({ title: "Лидерборд — Джус", icon: "🏆", width: lw, height: lh, key: "air-lb",
      render: lbRender });
    placeLb(win, lw, lh);
  }
  function lbRender(cc) {
    const body = el("div", { className: "air-lb-body", textContent: "Загрузка…" });
    const refresh = el("button", { className: "btn small", textContent: "⟳ Обновить", onclick: () => load() });
    cc.append(el("div", { className: "air-lb2" }, body, refresh));
    const section = (title, rows, unit) => {
      const box = el("div", { className: "air-lb-sec" }, el("div", { className: "air-lb-sec-h", textContent: title }));
      if (!rows.length) box.append(el("div", { className: "air-lb-empty", textContent: "пока пусто" }));
      else rows.forEach((e, i) => box.append(el("div", { className: "air-lb-row" },
        el("span", { className: "air-lb-rank", textContent: (i + 1) + "." }),
        el("span", { className: "air-lb-nick", textContent: e.nick }),
        el("span", { className: "air-lb-pts" + (e.points < 0 ? " neg" : ""), textContent: e.points + (unit || "") }))));
      return box;
    };
    async function load() {
      body.textContent = "Загрузка…";
      try {
        const r = await fetch("/api/air/leaderboard", { cache: "no-store" });
        const d = await r.json();
        body.replaceChildren(section("⚽ Очки (гол +1, в свои −1)", d.board || []),
          section("🔥 Лучшее комбо", d.combo || [], "×"));
      } catch { body.textContent = "Не удалось загрузить"; }
    }
    load();
  }
  function placeLb(win, lw, lh) {
    // ставим окно РЯДОМ с игрой (справа, иначе слева/снизу — чтобы не перекрывать поле)
    const g = w.node.getBoundingClientRect();
    let left = g.right + 12;
    if (left + lw > innerWidth - 10) left = g.left - lw - 12;
    if (left < 10) left = Math.max(10, innerWidth - lw - 10);
    const top = Math.max(10, Math.min(g.top, innerHeight - 70 - lh));
    Object.assign(win.node.style, { left: left + "px", top: top + "px" });
  }

  fitCanvas(); connect();
  let raf = requestAnimationFrame(draw);
  let hudRaf = requestAnimationFrame(renderHud);
  w.onClose = () => { closed = true; cancelAnimationFrame(raf); cancelAnimationFrame(hudRaf);
    document.removeEventListener("keydown", kd); document.removeEventListener("keyup", ku);
    document.removeEventListener("pointerdown", focusOn, true); try { ws?.close(); } catch {} };
}

export { openAirHockey, mountAirHockey };
