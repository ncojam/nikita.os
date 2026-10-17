import { el } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= аэро-арканоид (общая арена) =================
 * Сервер шлёт состояние ~30/сек с вектором мяча → клиент экстраполирует и рисует во весь refresh (120+).
 * Платформа наклоняется от скорости по X и пружинисто «отыгрывает» по дуге (гибкость).
 * Звуки: удар по платформе (рандом питч), гол (рандом питч), юбилейные 10/100/150 (без питча).
 * Гол трясёт окно игры; свой гол трясёт и остальные окна — тем слабее, чем дальше от эпицентра.
 */
const PAD_H = 0.03, BALL_R = 0.02;
const SND = "/apps/airhockey/";

/* ---- звуковой банк на WebAudio (для питча через playbackRate) ---- */
const Snd = {
  ctx: null, buf: {}, ready: false,
  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    for (const n of ["click", "goal", "goal10th", "goal100th", "goal150th"]) {
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

function openAirHockey() {
  WM.open({ title: "Аэро-арканоид", icon: "🏒", width: 560, height: 680, key: "airhockey",
    render(c, w) {
      const cv = el("canvas", { className: "air-cv" });
      const score = el("div", { className: "air-score" });
      const feed = el("div", { className: "air-last" });
      const hint = el("div", { className: "air-hint", textContent: "Веди курсор в светлую зону у ворот" });
      c.append(el("div", { className: "air" }, score, cv, feed, hint));

      const ctx = cv.getContext("2d");
      let W = 0, H = 0;
      let TOP_ACTIVE = 0.35, BOT_ACTIVE = 0.65, GOAL_L = 0.33, GOAL_R = 0.67;
      let canPlay = false, nahCooldown = 0;
      const nah = new Audio(SND + "nah.wav"); nah.volume = 0.6;

      // серверное состояние + время получения (для экстраполяции)
      let srv = { ball: { x: .5, y: .5, vx: 0, vy: 0 }, pads: [], pw: .22,
                  score: { top: 0, bottom: 0 }, last: [], players: 0, cap: 8, gid: 0, hid: 0, goal: null };
      let srvT = performance.now();
      let lastGid = 0, lastHid = 0;
      const pstate = new Map();   // nick -> {rx, ry, prevX, angle, angVel}
      const myTarget = { x: .5, y: .9, active: false };

      function fitCanvas() {
        const r = cv.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w2 = Math.max(1, Math.round(r.width * dpr)), h2 = Math.max(1, Math.round(r.height * dpr));
        if (w2 !== W || h2 !== H) { W = cv.width = w2; H = cv.height = h2; }
      }

      /* ---------- WebSocket ---------- */
      let ws = null, closed = false;
      function connect() {
        if (closed) return;
        ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/air/ws");
        ws.onmessage = e => {
          let d; try { d = JSON.parse(e.data); } catch { return; }
          if (d.t === "state") {
            srv = d; srvT = performance.now();
            if (d.hid !== lastHid) { lastHid = d.hid; Snd.play("click", true); }
            if (d.gid !== lastGid) { lastGid = d.gid; onGoal(d.goal); }
          } else if (d.t === "hello") {
            canPlay = d.can_play;
            if (typeof d.top === "number") { TOP_ACTIVE = d.top; BOT_ACTIVE = d.bot; GOAL_L = d.goalL; GOAL_R = d.goalR; }
            hint.textContent = canPlay ? "Веди курсор в светлую зону у ворот" : "Войди в чат, чтобы играть (счёт по нику)";
          } else if (d.t === "full") { playNah(); hint.textContent = "Все места заняты — подожди, пока кто-то выйдет"; }
          else if (d.t === "need_login") { canPlay = false; hint.textContent = "Войди в чат, чтобы играть"; }
        };
        ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      }
      const sendMove = (x, y) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "move", x, y })); };
      const sendLeave = () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "leave" })); };
      function playNah() { const t = performance.now(); if (t < nahCooldown) return; nahCooldown = t + 1500;
        try { nah.currentTime = 0; nah.play().catch(() => {}); } catch {} }

      /* ---------- гол: звук + тряска ---------- */
      function onGoal(g) {
        if (!g) return;
        const s = g.score || 0;
        if (s % 100 === 0) Snd.play("goal100th");
        else if (s % 100 === 50) Snd.play("goal150th");
        else if (s % 10 === 0) Snd.play("goal10th");
        else Snd.play("goal", true);
        // эпицентр на экране: точка ворот
        const r = cv.getBoundingClientRect();
        const ex = r.left + g.x * r.width, ey = g.side === "top" ? r.top : r.bottom;
        shake(w.node, 16);
        if (g.own) {  // свой гол — трясёт все окна, слабее и с затуханием по расстоянию
          const diag = Math.hypot(innerWidth, innerHeight);
          for (const win of WM.wins.values()) {
            if (win.node === w.node || win.minimized) continue;
            const b = win.node.getBoundingClientRect();
            const dist = Math.hypot(b.left + b.width / 2 - ex, b.top + b.height / 2 - ey);
            shake(win.node, 11 * Math.max(0, 1 - dist / diag));
          }
        }
      }

      /* ---------- ввод мыши ---------- */
      let inActive = false;
      cv.onpointermove = e => {
        Snd.init();
        const r = cv.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const active = (y <= TOP_ACTIVE || y >= BOT_ACTIVE) && x >= 0 && x <= 1;
        cv.classList.toggle("playing", active && canPlay);
        if (active) {
          inActive = true;
          myTarget.x = Math.max(0, Math.min(1, x)); myTarget.y = Math.max(0, Math.min(1, y)); myTarget.active = canPlay;
          if (canPlay) sendMove(myTarget.x, myTarget.y); else playNah();
        } else if (inActive) { inActive = false; myTarget.active = false; cv.classList.remove("playing"); sendLeave(); }
      };
      cv.onpointerleave = () => { cv.classList.remove("playing"); if (inActive) { inActive = false; myTarget.active = false; sendLeave(); } };
      cv.onpointerdown = () => Snd.init();

      /* ---------- отрисовка ---------- */
      function drawPaddle(cx, cy, pw, ph, angle, bend, color) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
        const hw = pw / 2, hh = ph / 2, r = hh;
        ctx.fillStyle = color; ctx.beginPath();
        // гибкий брусок: верх/низ выгнуты на bend (пружинистая дуга)
        ctx.moveTo(-hw + r, -hh);
        ctx.quadraticCurveTo(0, -hh - bend, hw - r, -hh);
        ctx.arcTo(hw, -hh, hw, -hh + r, r); ctx.lineTo(hw, hh - r); ctx.arcTo(hw, hh, hw - r, hh, r);
        ctx.quadraticCurveTo(0, hh - bend, -hw + r, hh);
        ctx.arcTo(-hw, hh, -hw, hh - r, r); ctx.lineTo(-hw, -hh + r); ctx.arcTo(-hw, -hh, -hw + r, -hh, r);
        ctx.closePath(); ctx.fill(); ctx.restore();
      }

      let prevT = performance.now();
      function draw() {
        fitCanvas();
        const now = performance.now();
        const fdt = Math.min(0.05, (now - prevT) / 1000); prevT = now;
        if (!W || !H) { raf = requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, W, H);
        // поле
        ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(138,180,255,0.13)";
        ctx.fillRect(0, 0, W, TOP_ACTIVE * H);
        ctx.fillRect(0, BOT_ACTIVE * H, W, (1 - BOT_ACTIVE) * H);
        ctx.strokeStyle = "rgba(138,180,255,0.4)"; ctx.setLineDash([5, 5]);
        line(0, TOP_ACTIVE * H, W, TOP_ACTIVE * H); line(0, BOT_ACTIVE * H, W, BOT_ACTIVE * H);
        ctx.strokeStyle = "rgba(255,255,255,0.1)"; line(0, 0.5 * H, W, 0.5 * H); ctx.setLineDash([]);
        // ворота
        ctx.strokeStyle = "rgba(123,227,161,0.9)"; ctx.lineWidth = 4;
        line(GOAL_L * W, 2, GOAL_R * W, 2); line(GOAL_L * W, H - 2, GOAL_R * W, H - 2); ctx.lineWidth = 1;

        // платформы (с наклоном и гибкостью)
        const pw = srv.pw * W, ph = PAD_H * H;
        const seen = new Set();
        for (const p of srv.pads) {
          seen.add(p.nick);
          let st = pstate.get(p.nick);
          if (!st) { st = { rx: p.x, ry: p.y, prevX: p.x, angle: 0, angVel: 0 }; pstate.set(p.nick, st); }
          // цель позиции: своя платформа — локальный курсор (без задержки), чужие — к серверной
          const tx = (p.me && myTarget.active) ? myTarget.x : p.x;
          const ty = (p.me && myTarget.active) ? myTarget.y : p.y;
          const k = p.me ? 0.6 : 0.25;
          st.rx += (tx - st.rx) * k; st.ry += (ty - st.ry) * k;
          // скорость по X → целевой наклон; пружина с демпфером (дуга «отыгрывает»)
          const vx = (st.rx - st.prevX) / Math.max(fdt, 1e-3); st.prevX = st.rx;
          const target = Math.max(-0.5, Math.min(0.5, vx * 1.1));
          st.angVel += ((target - st.angle) * 55 - st.angVel * 9) * fdt;
          st.angle += st.angVel * fdt;
          const bend = Math.max(-ph, Math.min(ph, st.angVel * ph * 0.25));
          drawPaddle(st.rx * W, st.ry * H, pw, ph, st.angle, bend, p.me ? "#8ab4ff" : "rgba(255,255,255,0.7)");
          if (!p.me && p.nick) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = Math.round(ph * 0.9) + "px system-ui";
            ctx.textAlign = "center"; ctx.fillText(p.nick, st.rx * W, st.ry * H - ph); }
        }
        for (const nk of [...pstate.keys()]) if (!seen.has(nk)) pstate.delete(nk);

        // мяч: экстраполяция по вектору между серверными кадрами
        const dt = (now - srvT) / 1000;
        const bx = clamp01(srv.ball.x + srv.ball.vx * dt) * W;
        const by = clamp01(srv.ball.y + srv.ball.vy * dt) * H;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(bx, by, BALL_R * Math.min(W, H), 0, 7); ctx.fill();
        raf = requestAnimationFrame(draw);
      }
      const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
      const line = (a, b, cc, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(cc, d); ctx.stroke(); };

      /* ---------- табло ---------- */
      const goalCls = s => s % 100 === 0 ? " jub100" : s % 100 === 50 ? " jub100" : s % 10 === 0 ? " jub10" : "";
      function renderHud() {
        score.replaceChildren(
          el("span", { className: "air-goal" + goalCls(srv.score.top), textContent: "▲ " + srv.score.top }),
          el("span", { className: "air-mid", textContent: `${srv.players}/${srv.cap} игроков` }),
          el("span", { className: "air-goal" + goalCls(srv.score.bottom), textContent: srv.score.bottom + " ▼" }));
        feed.replaceChildren(el("span", { className: "air-last-l", textContent: "Забили:" }),
          ...srv.last.map(s => el("span", { className: "air-nick" + (s.own ? " own" : ""),
            textContent: s.nick + (s.own ? " (в свои)" : "") })));
        hudRaf = requestAnimationFrame(renderHud);
      }

      fitCanvas(); connect();
      let raf = requestAnimationFrame(draw);
      let hudRaf = requestAnimationFrame(renderHud);
      w.onClose = () => { closed = true; cancelAnimationFrame(raf); cancelAnimationFrame(hudRaf); try { ws?.close(); } catch {} };
    } });
}

export { openAirHockey };
