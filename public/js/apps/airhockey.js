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

function openAirHockey() {
  WM.open({ title: "Аэро-арканоид", icon: "🏒", width: 560, height: 680, key: "airhockey",
    render(c, w) {
      const cv = el("canvas", { className: "air-cv" });
      const score = el("div", { className: "air-score" });
      const lbBtn = el("button", { className: "btn small air-lb-btn", textContent: "🏆 Лидерборд", onclick: openLeaderboard });
      const feed = el("div", { className: "air-last" });
      const hint = el("div", { className: "air-hint", textContent: "Веди курсор в светлую зону у ворот" });
      c.append(el("div", { className: "air" }, score, cv,
        el("div", { className: "air-row" }, feed, lbBtn), hint));

      const ctx = cv.getContext("2d");
      let W = 0, H = 0;
      let TOP_ACTIVE = 0.35, BOT_ACTIVE = 0.65, GOAL_L = 0.33, GOAL_R = 0.67;
      let canPlay = false, nahCooldown = 0;
      const nah = new Audio(SND + "nah.wav"); nah.volume = 0.6;

      // серверное состояние + время получения (для экстраполяции)
      let srv = { balls: [{ x: .5, y: .5, vx: 0, vy: 0 }], pads: [], pw: .22, combo: 0,
                  score: { top: 0, bottom: 0 }, last: [], players: 0, cap: 8, gid: 0, hid: 0, goal: null };
      let srvT = performance.now();
      let lastGid = 0, lastHid = 0, lastWid = 0;
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
            if (typeof d.top === "number") { TOP_ACTIVE = d.top; BOT_ACTIVE = d.bot; }  // зона гуляет на событии
            if (d.hid !== lastHid) { lastHid = d.hid; Snd.play("click", true); }
            if (d.wid !== lastWid) { lastWid = d.wid; Snd.play("wall", true); }
            if (d.gid !== lastGid) { lastGid = d.gid; onGoal(d.goal); }
          } else if (d.t === "hello") {
            canPlay = d.can_play;
            if (typeof d.top === "number") { TOP_ACTIVE = d.top; BOT_ACTIVE = d.bot; GOAL_L = d.goalL; GOAL_R = d.goalR; }
            hint.textContent = d.anon ? "Играешь анонимно — в счёте будет случайный номер (войди в чат для ника)"
                                      : "Веди курсор в светлую зону у ворот";
          } else if (d.t === "full") { playNah(); hint.textContent = "Все места заняты — подожди, пока кто-то выйдет"; }
        };
        ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      }
      const sendMove = (x, y, slot) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "move", x, y, slot })); };
      const sendLeave = slot => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "leave", slot })); };
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

      /* ---------- ввод мыши/тача ---------- */
      let inActive = false, mouseSide = null;
      function applyPointer(e) {
        Snd.init();
        const r = cv.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const active = (y <= TOP_ACTIVE || y >= BOT_ACTIVE) && x >= 0 && x <= 1;
        cv.classList.toggle("playing", active && canPlay);
        if (active) {
          inActive = true;
          mouseSide = y <= TOP_ACTIVE ? "top" : "bottom";
          myTarget.x = Math.max(0, Math.min(1, x)); myTarget.y = Math.max(0, Math.min(1, y)); myTarget.active = canPlay;
          if (canPlay) sendMove(myTarget.x, myTarget.y, "m"); else playNah();
        } else if (inActive) { inActive = false; mouseSide = null; myTarget.active = false; cv.classList.remove("playing"); sendLeave("m"); }
      }
      cv.onpointermove = applyPointer;
      cv.onpointerdown = e => { focused = true; applyPointer(e); };   // тап на мобилке = поставить платформу
      cv.onpointerleave = () => { cv.classList.remove("playing"); if (inActive) { inActive = false; mouseSide = null; myTarget.active = false; sendLeave("m"); } };

      /* ---------- клавиатурная вторая платформа (A/D) ----------
       * Жёсткая, у ворот на стороне НАПРОТИВ мыши. Линейное ускорение, не выходит за край. */
      const KB_ACCEL = 2.4, KB_VMAX = 1.6, KB_FRICTION = 6;   // единиц поля в сек
      const kb = { x: 0.5, vx: 0, active: false, lastInput: 0, left: false, right: false };
      let focused = true, kbSendT = 0;
      const opp = s => s === "top" ? "bottom" : "top";

      function onKey(e, down) {
        if (closed || !focused) return;
        const ae = document.activeElement;
        if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;   // не мешаем печатать
        if (e.code === "KeyA") { kb.left = down; }
        else if (e.code === "KeyD") { kb.right = down; }
        else return;
        e.preventDefault();
        if (down && canPlay) { kb.active = true; kb.lastInput = performance.now(); Snd.init(); }
      }
      const kd = e => onKey(e, true), ku = e => onKey(e, false);
      document.addEventListener("keydown", kd); document.addEventListener("keyup", ku);
      // фокус игры: клик по окну игры включает клаву, клик вне — выключает
      const focusOn = e => { focused = w.node.contains(e.target); };
      document.addEventListener("pointerdown", focusOn, true);

      function stepKB(dt) {
        if (!canPlay) { kb.active = false; return; }
        const side = mouseSide ? opp(mouseSide) : "top";   // напротив мыши (или сверху по умолчанию)
        // ускорение от клавиш, трение когда ничего не нажато
        if (kb.left) kb.vx -= KB_ACCEL * dt;
        if (kb.right) kb.vx += KB_ACCEL * dt;
        if (!kb.left && !kb.right) {
          const f = KB_FRICTION * dt;
          kb.vx = Math.abs(kb.vx) <= f ? 0 : kb.vx - Math.sign(kb.vx) * f;
        }
        kb.vx = Math.max(-KB_VMAX, Math.min(KB_VMAX, kb.vx));
        const hw = srv.pw / 2;
        kb.x += kb.vx * dt;
        if (kb.x < hw) { kb.x = hw; kb.vx = 0; }             // не за край окна
        else if (kb.x > 1 - hw) { kb.x = 1 - hw; kb.vx = 0; }
        if (kb.left || kb.right) kb.lastInput = performance.now();
        // отпускаем слот после 3с бездействия и остановки
        if (!kb.active) return;
        if (!kb.left && !kb.right && Math.abs(kb.vx) < 1e-3 && performance.now() - kb.lastInput > 3000) {
          kb.active = false; sendLeave("k"); return;
        }
        const yEdge = side === "top" ? PAD_H / 2 + 0.001 : 1 - PAD_H / 2 - 0.001;
        const now = performance.now();
        if (now - kbSendT > 30) { kbSendT = now; sendMove(kb.x, yEdge, "k"); }   // ~30/сек серверу
      }

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
        stepKB(fdt);
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
          const id = p.nick + ":" + (p.kind || "m");
          seen.add(id);
          let st = pstate.get(id);
          if (!st) { st = { rx: p.x, ry: p.y, prevX: p.x, angle: 0, angVel: 0 }; pstate.set(id, st); }
          const rigid = p.kind === "k";   // клавиатурная — жёсткая, без наклона и гибкости
          // своя мышиная платформа — по локальному курсору; клавиатурная — по локальному kb; чужие — к серверной
          const mine = p.me && p.kind !== "k" && myTarget.active;
          const tx = p.me && p.kind === "k" ? kb.x : (mine ? myTarget.x : p.x);
          const ty = p.me && p.kind === "k" ? p.y : (mine ? myTarget.y : p.y);
          const k = p.me ? 0.6 : 0.25;
          st.rx += (tx - st.rx) * k; st.ry += (ty - st.ry) * k;
          if (rigid) { st.angle = 0; st.angVel = 0; st.prevX = st.rx; }
          else {
            const vx = (st.rx - st.prevX) / Math.max(fdt, 1e-3); st.prevX = st.rx;
            const target = Math.max(-0.5, Math.min(0.5, vx * 1.1));
            st.angVel += ((target - st.angle) * 55 - st.angVel * 9) * fdt;
            st.angle += st.angVel * fdt;
          }
          const bend = rigid ? 0 : Math.max(-ph, Math.min(ph, st.angVel * ph * 0.25));
          const color = p.me ? (rigid ? "#7be3a1" : "#8ab4ff") : "rgba(255,255,255,0.7)";
          drawPaddle(st.rx * W, st.ry * H, pw, ph, st.angle, bend, color);
          if (!p.me && p.nick) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = Math.round(ph * 0.9) + "px system-ui";
            ctx.textAlign = "center"; ctx.fillText(p.nick, st.rx * W, st.ry * H - ph); }
        }
        for (const nk of [...pstate.keys()]) if (!seen.has(nk)) pstate.delete(nk);

        // мячи: экстраполяция по вектору между серверными кадрами
        const dt = (now - srvT) / 1000;
        const R = BALL_R * Math.min(W, H);
        const balls = srv.balls || [];
        let lastHue = 90;
        for (const ball of balls) {
          const bx = clamp01(ball.x + ball.vx * dt) * W;
          const by = clamp01(ball.y + ball.vy * dt) * H;
          const sp = Math.hypot(ball.vx, ball.vy);
          const f = Math.max(0, Math.min(1, (sp - 0.6) / 1.8));
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
        if (srv.launch_in > 0 && srv.freeze > 0) {
          const t = srv.launch_in / srv.freeze;
          ctx.strokeStyle = `hsla(${lastHue} 100% 65% / ${0.4 + 0.5 * (1 - t)})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0.5 * W, 0.5 * H, R + t * R * 6, 0, 7); ctx.stroke();
        }
        raf = requestAnimationFrame(draw);
      }
      const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
      const line = (a, b, cc, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(cc, d); ctx.stroke(); };

      /* ---------- табло ---------- */
      const goalCls = s => s % 100 === 0 ? " jub100" : s % 100 === 50 ? " jub100" : s % 10 === 0 ? " jub10" : "";
      function renderHud() {
        score.replaceChildren(
          el("span", { className: "air-goal" + goalCls(srv.score.top), textContent: "▲ " + srv.score.top }),
          el("span", { className: "air-mid" },
            el("div", { textContent: `${srv.players}/${srv.cap} игроков` }),
            srv.combo > 1 ? el("div", { className: "air-combo", textContent: "комбо ×" + srv.combo }) : el("div")),
          el("span", { className: "air-goal" + goalCls(srv.score.bottom), textContent: srv.score.bottom + " ▼" }));
        feed.replaceChildren(el("span", { className: "air-last-l", textContent: "Забили:" }),
          ...srv.last.map(s => el("span", { className: "air-nick" + (s.own ? " own" : ""),
            textContent: s.nick + (s.own ? " (в свои)" : "") })));
        hudRaf = requestAnimationFrame(renderHud);
      }

      async function openLeaderboard() {
        if (c.querySelector(".air-lb")) return;
        const body = el("div", { className: "air-lb-body", textContent: "Загрузка…" });
        const panel = el("div", { className: "air-lb glass" },
          el("div", { className: "air-lb-h", textContent: "🏆 Лидерборд" }), body,
          el("button", { className: "btn small", textContent: "Закрыть", onclick: () => panel.remove() }));
        c.append(panel);
        const section = (title, rows, unit) => {
          const box = el("div", { className: "air-lb-sec" }, el("div", { className: "air-lb-sec-h", textContent: title }));
          if (!rows.length) box.append(el("div", { className: "air-lb-empty", textContent: "пока пусто" }));
          else rows.forEach((e, i) => box.append(el("div", { className: "air-lb-row" },
            el("span", { className: "air-lb-rank", textContent: (i + 1) + "." }),
            el("span", { className: "air-lb-nick", textContent: e.nick }),
            el("span", { className: "air-lb-pts" + (e.points < 0 ? " neg" : ""), textContent: e.points + (unit || "") }))));
          return box;
        };
        try {
          const r = await fetch("/api/air/leaderboard", { cache: "no-store" });
          const d = await r.json();
          body.replaceChildren(section("⚽ Очки (гол +1, в свои −1)", d.board || []),
            section("🔥 Лучшее комбо", d.combo || [], "×"));
        } catch { body.textContent = "Не удалось загрузить"; }
      }

      fitCanvas(); connect();
      let raf = requestAnimationFrame(draw);
      let hudRaf = requestAnimationFrame(renderHud);
      w.onClose = () => { closed = true; cancelAnimationFrame(raf); cancelAnimationFrame(hudRaf);
        document.removeEventListener("keydown", kd); document.removeEventListener("keyup", ku);
        document.removeEventListener("pointerdown", focusOn, true); try { ws?.close(); } catch {} };
    } });
}

export { openAirHockey };
