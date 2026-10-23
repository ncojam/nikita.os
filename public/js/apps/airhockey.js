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
 */
const PAD_DRAW_H = 0.03;            // толщина платформы на экране (физика — P.padH с сервера)
const SND = "/apps/airhockey/";
const SIM_DT = 1 / 60;              // шаг локальной физики
const BOT_FORGET = 4000;            // одиночка ушёл совсем — через столько мс бот уходит тоже

// параметры физики по умолчанию; точные приходят с сервером в hello.phys
const P = { v0: 0.75, vmax: 2.4, gain: 0.035, freeze: 0.6, split: 64, maxBalls: 4, padW0: 0.22, padWmin: 0.06,
  padH: 0.022, ballR: 0.02, botSpeed: 0.6, botErr: 0.09, grace: 3, botNick: "primitiveAI" };

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
  constructor() { this.balls = []; this.combo = 0; this.resetAt = 0; this.bot = null; this.botErr = 0; this.acc = 0; }

  newBall(vx, vy, x = 0.5, y = 0.5, touch = null) { return { x, y, vx, vy, bounces: 0, touch }; }

  kick(towards) {   // towards: сторона одиночки — подача летит к нему
    const dy = towards === "top" ? -1 : towards === "bottom" ? 1 : (Math.random() < 0.5 ? -1 : 1);
    this.balls = [this.newBall((Math.random() * 0.6 - 0.3), dy * P.v0)];
    this.combo = 0;
  }

  seed(balls, towards) {
    const live = (balls || []).filter(b => Math.hypot(b.vx, b.vy) > 0.05);
    if (live.length) this.balls = live.map(b => this.newBall(b.vx, b.vy, b.x, b.y));
    else this.kick(towards);
    this.resetAt = 0; this.combo = 0;
  }

  addBalls(n) {
    for (let i = 0; i < n && this.balls.length < P.maxBalls; i++) {
      const a = Math.random() * 6.283;
      this.balls.push(this.newBall(Math.cos(a) * P.v0, Math.sin(a) * P.v0));
    }
  }

  static padW(n) { return clamp(P.padW0 / Math.sqrt(Math.max(1, n)), P.padWmin, P.padW0); }

  boost(b) {
    const sp = Math.hypot(b.vx, b.vy);
    if (sp <= 1e-6) return;
    const t = Math.min(P.vmax, sp * (1 + P.gain));
    b.vx *= t / sp; b.vy *= t / sp;
  }

  bounce(b, p, w, ev) {
    const hw = w / 2, hh = P.padH / 2, R = P.ballR;
    const cx = clamp(b.x, p.x - hw, p.x + hw), cy = clamp(b.y, p.y - hh, p.y + hh);
    const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
    if (d2 > R * R) return;
    let nx, ny;
    if (d2 < 1e-9) { nx = 0; ny = b.y < p.y ? -1 : 1; } else { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; }
    b.x = cx + nx * R; b.y = cy + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    b.vx += (b.x - p.x) / hw * 0.25;
    b.touch = { by: p.kind === "bot" ? "bot" : "me", side: p.side };
    b.bounces++; this.combo++; ev.hit++;
    if (p.kind !== "bot") ev.myCombo = Math.max(ev.myCombo, this.combo);
    this.boost(b);
  }

  advance(b, pads, w, ev) {
    const R = P.ballR;
    const n = Math.max(1, Math.min(24, Math.floor(Math.hypot(b.vx, b.vy) * SIM_DT / (R * 0.6)) + 1));
    const sdt = SIM_DT / n;
    for (let i = 0; i < n; i++) {
      b.x += b.vx * sdt; b.y += b.vy * sdt;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); b.bounces++; ev.wall++; this.boost(b); }
      else if (b.x > 1 - R) { b.x = 1 - R; b.vx = -Math.abs(b.vx); b.bounces++; ev.wall++; this.boost(b); }
      for (const side of ["top", "bottom"]) {
        if ((side === "top" && b.y < R) || (side === "bottom" && b.y > 1 - R)) {
          if (b.x > GOAL.l && b.x < GOAL.r) return { side, x: b.x };
          b.y = side === "top" ? R : 1 - R;
          b.vy = side === "top" ? Math.abs(b.vy) : -Math.abs(b.vy);
          b.bounces++; ev.wall++; this.boost(b);
        }
      }
      for (const p of pads) this.bounce(b, p, w, ev);
    }
    return null;
  }

  /* бот: едет к ближайшему по Y мячу с ограниченной скоростью и небольшим промахом прицела */
  stepBot(dt, w, zone) {
    const bt = this.bot;
    if (!bt) return;
    const [lo, hi] = bt.side === "top" ? [0, zone.top] : [zone.bot, 1];
    if (Math.random() < 0.03) this.botErr = (Math.random() * 2 - 1) * P.botErr;
    const ball = this.balls.reduce((m, b) => !m || Math.abs(b.y - bt.y) < Math.abs(m.y - bt.y) ? b : m, null);
    const maxd = P.botSpeed * dt, hh = P.padH / 2;
    const tx = ball ? clamp(ball.x + this.botErr, w / 2, 1 - w / 2) : 0.5;
    const ty = ball ? clamp(ball.y, lo + hh, hi - hh) : (bt.side === "top" ? lo + hh : hi - hh);
    bt.x = clamp(bt.x + clamp(tx - bt.x, -maxd, maxd), w / 2, 1 - w / 2);
    bt.y = clamp(bt.y + clamp(ty - bt.y, -maxd, maxd), lo + hh, hi - hh);
  }

  /* один кадр: fdt — прошедшее время, pads — мои активные платформы. Возвращает события кадра */
  frame(fdt, myPads, zone, towards, now) {
    const ev = { hit: 0, wall: 0, goals: [], myCombo: 0 };
    this.acc = Math.min(this.acc + fdt, 0.1);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const pads = this.bot ? [...myPads, this.bot] : myPads;
      const w = Sim.padW(pads.length);
      this.stepBot(SIM_DT, w, zone);
      if (this.resetAt) {
        if (now < this.resetAt) continue;
        this.resetAt = 0; this.kick(towards);
      }
      const add = [], remove = [];
      for (const b of this.balls) {
        const g = this.advance(b, pads, w, ev);
        if (g) { ev.goals.push({ ...g, touch: b.touch, combo: this.combo }); remove.push(b); }
        else if (b.bounces >= P.split && this.balls.length + add.length - remove.length < P.maxBalls) {
          b.bounces = 0;
          const sp = Math.hypot(b.vx, b.vy), base = Math.atan2(b.vy, b.vx), dv = 0.3 + Math.random() * 0.12;
          b.vx = Math.cos(base - dv) * sp; b.vy = Math.sin(base - dv) * sp;
          add.push(this.newBall(Math.cos(base + dv) * sp, Math.sin(base + dv) * sp, b.x, b.y, b.touch));
        }
      }
      this.balls = this.balls.filter(b => !remove.includes(b)).concat(add);
      if (!this.balls.length) {   // поле пусто — заморозка и новая подача
        this.balls = [this.newBall(0, 0)];
        this.resetAt = now + P.freeze * 1000;
        this.combo = 0;
      }
    }
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
  c.append(el("div", { className: "air" + (mobile ? " air-tg" : "") }, score, cv,
    ...(strip ? [strip] : []), el("div", { className: "air-row" }, feed, lbBtn), hint));

  const ctx = cv.getContext("2d");
  let W = 0, H = 0;
  const zone = { top: 0.35, bot: 0.65 };
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
  const mine = { m: { x: .5, y: .9, side: "bottom", active: false, leaveAt: 0, sendT: 0 },
                 k: { x: .5, y: .99, side: "top", active: false, leaveAt: 0, sendT: 0 } };
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
  const myPads = () => ["m", "k"].map(s => mine[s]).filter(p => p.active)
    .map(p => ({ x: p.x, y: p.y, side: p.side, kind: "me" }));
  const mySide = () => mine.m.active ? mine.m.side : mine.k.active ? opp(mine.k.side) : (touch.side || "bottom");

  function setSim(on) {
    if (on === simOn) return;
    simOn = on;
    if (on) {
      // продолжаем с того места, где была игра; ушедшего соперника заменяет бот (сразу)
      const now = performance.now(), dt = (now - srvT) / 1000;
      sim.seed((srv.balls || []).map(b => ({ x: clamp01(b.x + b.vx * dt), y: clamp01(b.y + b.vy * dt), vx: b.vx, vy: b.vy })), mySide());
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
    const ev = sim.frame(fdt, pads, zone, mySide(), now);
    if (ev.hit) Snd.play("click", true);
    if (ev.wall) Snd.play("wall", true);
    for (const g of ev.goals) {
      const by = g.touch?.by || null;
      const own = !!g.touch && g.touch.side === g.side;
      send({ t: "goal", side: g.side, x: +g.x.toFixed(4), by, own, combo: by === "me" ? ev.myCombo || g.combo : 0 });
      spawnBot();     // бот приходит с первого гола одиночки — даже если тот забил в свои
    }
    if (now - simReportT > 100) {   // снимок для зрителей и для подхвата сервером
      simReportT = now;
      send({ t: "sim", balls: sim.balls.map(b => ({ x: +b.x.toFixed(4), y: +b.y.toFixed(4), vx: +b.vx.toFixed(4), vy: +b.vy.toFixed(4) })),
             bot: sim.bot ? { x: +sim.bot.x.toFixed(4), y: +sim.bot.y.toFixed(4), side: sim.bot.side } : null });
    }
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
        if (typeof d.top === "number") { zone.top = d.top; zone.bot = d.bot; }  // зона гуляет на событии
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
        if (typeof d.top === "number") { zone.top = d.top; zone.bot = d.bot; GOAL.l = d.goalL; GOAL.r = d.goalR; }
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
    const side = y <= zone.top ? "top" : "bottom";
    const changed = !p.active || p.side !== side || p.leaveAt;
    const pw = simOn ? Sim.padW(myPads().length + (sim.bot ? 1 : 0) + (p.active ? 0 : 1)) : srv.pw;
    const [lo, hi] = side === "top" ? [0, zone.top] : [zone.bot, 1];
    p.x = clamp(x, pw / 2, 1 - pw / 2);
    p.y = clamp(y, lo + P.padH / 2, hi - P.padH / 2);
    p.side = side; p.active = true; p.leaveAt = 0;
    sendMove(slot, changed);   // смена стороны/возврат — сразу, остальное — не чаще ~30/сек
  }
  function sendMove(slot, now = false) {
    const p = mine[slot], t = performance.now();
    if (!now && t - p.sendT < 30) return;
    p.sendT = t;
    send({ t: "move", x: +p.x.toFixed(4), y: +p.y.toFixed(4), slot });
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
      const active = (y <= zone.top || y >= zone.bot) && x >= 0 && x <= 1;
      cv.classList.toggle("playing", active && canPlay);
      if (!active) return leaveMine("m");
      if (!canPlay) return playNah();
      if (!tut.sideDone) { tut.sideDone = true; syncTut(); }
      moveMine("m", clamp01(x), clamp01(y));
    };
    cv.onpointermove = applyPointer;
    cv.onpointerdown = e => { focused = true; applyPointer(e); };
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
      if (y <= zone.top) setSide("top"); else if (y >= zone.bot) setSide("bottom");
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
    const hw = (simOn ? Sim.padW(myPads().length + (sim.bot ? 1 : 0)) : srv.pw) / 2;
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
    if (simOn) {
      for (const s of ["m", "k"]) { const p = mine[s];
        if (p.active) out.push({ id: "me:" + s, x: p.x, y: p.y, kind: s, me: true, alpha: fade(p) }); }
      if (sim.bot) out.push({ id: "bot", x: sim.bot.x, y: sim.bot.y, kind: "bot", me: false, nick: P.botNick });
      return out;
    }
    for (const p of srv.pads) {
      const kind = p.kind || "m";
      if (p.me && (kind === "m" || kind === "k")) {
        const m = mine[kind];
        if (!m.active) continue;     // свою платформу знаем лучше сервера
        out.push({ id: "me:" + kind, x: m.x, y: m.y, kind, me: true, alpha: fade(m) });
      } else out.push({ id: (p.nick || "?") + ":" + kind + ":" + p.side, x: p.x, y: p.y, kind, me: false, nick: p.nick, alpha: p.away ? 0.45 : 1 });
    }
    // своя платформа, о которой сервер ещё не знает (только что поставили)
    for (const s of ["m", "k"]) if (mine[s].active && !out.some(o => o.id === "me:" + s))
      out.push({ id: "me:" + s, x: mine[s].x, y: mine[s].y, kind: s, me: true, alpha: fade(mine[s]) });
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

  let prevT = performance.now();
  function draw() {
    fitCanvas();
    const now = performance.now();
    const fdt = Math.min(0.05, (now - prevT) / 1000); prevT = now;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    expireMine(now);
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
    const pwN = simOn ? Sim.padW(myPads().length + (sim.bot ? 1 : 0)) : srv.pw;
    const pw = pwN * W, ph = PAD_DRAW_H * H;
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
      const color = p.me ? (rigid ? "#7be3a1" : "#8ab4ff") : "rgba(255,255,255,0.7)";
      drawPaddle(st.rx * W, st.ry * H, pw, ph, st.angle, bend, color, p.alpha ?? 1);
      if (!p.me && p.nick) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = Math.round(ph * 0.9) + "px system-ui";
        ctx.textAlign = "center"; ctx.fillText(p.nick, st.rx * W, st.ry * H - ph); }
    }
    for (const id of [...pstate.keys()]) if (!seen.has(id)) pstate.delete(id);

    // мячи: свои локальные — как есть; серверные — экстраполяция по вектору
    const dt = (now - srvT) / 1000;
    const R = P.ballR * Math.min(W, H);
    const balls = simOn ? sim.balls.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, e: 0 }))
                        : (srv.balls || []).map(b => ({ ...b, e: dt }));
    let lastHue = 90;
    for (const ball of balls) {
      const bx = clamp01(ball.x + ball.vx * ball.e) * W;
      const by = clamp01(ball.y + ball.vy * ball.e) * H;
      const sp = Math.hypot(ball.vx, ball.vy);
      const f = clamp((sp - 0.6) / 1.8, 0, 1);
      const hue = 55 + f * 95; lastHue = hue;          // жёлтый → зелёный
      const glow = `hsl(${hue} 100% 60%)`;
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
      ctx.save(); ctx.shadowColor = glow; ctx.shadowBlur = R * (1.5 + f * 4);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(bx, by, R, 0, 7); ctx.fill();
      ctx.fillStyle = glow; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(bx, by, R, 0, 7); ctx.fill();
      ctx.restore();
    }
    // кольцо запуска после гола: сужается, подсказывая момент старта
    const launch = simOn ? (sim.resetAt ? Math.max(0, (sim.resetAt - now) / 1000) : 0) : srv.launch_in;
    if (launch > 0 && P.freeze > 0) {
      const t = launch / P.freeze;
      ctx.strokeStyle = `hsla(${lastHue} 100% 65% / ${0.4 + 0.5 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0.5 * W, 0.5 * H, R + t * R * 6, 0, 7); ctx.stroke();
    }
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
