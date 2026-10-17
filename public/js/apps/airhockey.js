import { el } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= аэро-арканоид (общая арена) =================
 * Поле нормировано 0..1. Активные зоны: верх [0,0.25], низ [0.75,1], середина — мёртвая.
 * Мышь в активной зоне = играешь (сервер даёт слот). Нет мест → звук nah.wav.
 * Вся физика и счёт — на сервере, клиент рисует состояние и шлёт позицию курсора.
 */
const TOP_ACTIVE = 0.25, BOT_ACTIVE = 0.75;
const GOAL_L = 0.33, GOAL_R = 0.67;
const PAD_H = 0.022, BALL_R = 0.02;
const NAH = "/apps/airhockey/nah.wav";

function openAirHockey() {
  WM.open({ title: "Аэро-арканоид", icon: "🏒", width: 560, height: 680, key: "airhockey",
    render(c, w) {
      const cv = el("canvas", { className: "air-cv" });
      const score = el("div", { className: "air-score" });
      const feed = el("div", { className: "air-last" });
      const hint = el("div", { className: "air-hint", textContent: "Наведи курсор в светлую зону у ворот — это твоя платформа" });
      c.append(el("div", { className: "air" }, score, cv, feed, hint));

      const ctx = cv.getContext("2d");
      let state = { ball: { x: .5, y: .5 }, pads: [], pw: .22, score: { top: 0, bottom: 0 }, last: [], players: 0, cap: 8 };
      let W = 0, H = 0;
      const nah = new Audio(NAH); nah.volume = 0.6;
      let nahCooldown = 0, canPlay = false;

      function resize() {
        const r = cv.getBoundingClientRect();
        W = cv.width = Math.round(r.width); H = cv.height = Math.round(r.height);
      }
      const ro = new ResizeObserver(resize); ro.observe(cv);

      /* ---------- WebSocket ---------- */
      let ws = null, closed = false;
      function connect() {
        if (closed) return;
        ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/air/ws");
        ws.onmessage = e => {
          let d; try { d = JSON.parse(e.data); } catch { return; }
          if (d.t === "state") state = d;
          else if (d.t === "hello") { canPlay = d.can_play; if (!canPlay) hint.textContent = "Войди в чат, чтобы играть (счёт по нику)"; }
          else if (d.t === "full") { playNah(); hint.textContent = "Все места заняты — подожди, пока кто-то выйдет"; }
          else if (d.t === "need_login") { canPlay = false; hint.textContent = "Войди в чат, чтобы играть"; }
        };
        ws.onclose = () => { if (!closed) setTimeout(connect, 2000); };
      }
      const sendMove = (x, y) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "move", x, y })); };
      const sendLeave = () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "leave" })); };

      function playNah() {
        const t = performance.now();
        if (t < nahCooldown) return;
        nahCooldown = t + 1500;
        try { nah.currentTime = 0; nah.play().catch(() => {}); } catch {}
      }

      /* ---------- ввод мыши ---------- */
      let inActive = false;
      cv.onpointermove = e => {
        const r = cv.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        const active = (y <= TOP_ACTIVE || y >= BOT_ACTIVE) && x >= 0 && x <= 1;
        cv.classList.toggle("playing", active && canPlay);   // курсор прячем только когда играешь
        if (active) {
          inActive = true;
          if (canPlay) sendMove(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
          else playNah();
        } else if (inActive) { inActive = false; cv.classList.remove("playing"); sendLeave(); }
      };
      cv.onpointerleave = () => { cv.classList.remove("playing"); if (inActive) { inActive = false; sendLeave(); } };

      /* ---------- отрисовка ---------- */
      function draw() {
        if (!W || !H) { raf = requestAnimationFrame(draw); return; }
        ctx.clearRect(0, 0, W, H);
        // поле
        ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fillRect(0, 0, W, H);
        // активные зоны (у ворот) — ярче, с подписью; середина — мёртвая
        ctx.fillStyle = "rgba(138,180,255,0.13)";
        ctx.fillRect(0, 0, W, TOP_ACTIVE * H);
        ctx.fillRect(0, BOT_ACTIVE * H, W, (1 - BOT_ACTIVE) * H);
        ctx.strokeStyle = "rgba(138,180,255,0.4)"; ctx.setLineDash([5, 5]);
        line(0, TOP_ACTIVE * H, W, TOP_ACTIVE * H);
        line(0, BOT_ACTIVE * H, W, BOT_ACTIVE * H);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        line(0, 0.5 * H, W, 0.5 * H); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(138,180,255,0.5)"; ctx.font = "11px system-ui"; ctx.textAlign = "center";
        ctx.fillText("игровая зона", W / 2, TOP_ACTIVE * H - 6);
        ctx.fillText("игровая зона", W / 2, BOT_ACTIVE * H + 16);
        // ворота
        ctx.strokeStyle = "rgba(123,227,161,0.9)"; ctx.lineWidth = 4;
        line(GOAL_L * W, 2, GOAL_R * W, 2);
        line(GOAL_L * W, H - 2, GOAL_R * W, H - 2); ctx.lineWidth = 1;
        // платформы
        for (const p of state.pads) {
          ctx.fillStyle = p.me ? "#8ab4ff" : "rgba(255,255,255,0.65)";
          const pw = state.pw * W, ph = PAD_H * H;
          roundRect(p.x * W - pw / 2, p.y * H - ph / 2, pw, ph, ph / 2);
          ctx.fill();
          if (!p.me && p.nick) { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "10px system-ui"; ctx.textAlign = "center";
            ctx.fillText(p.nick, p.x * W, p.y * H - ph); }
        }
        // мяч
        ctx.fillStyle = "#fff"; ctx.beginPath();
        ctx.arc(state.ball.x * W, state.ball.y * H, BALL_R * Math.min(W, H), 0, 7); ctx.fill();
        raf = requestAnimationFrame(draw);
      }
      const line = (a, b, cc, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(cc, d); ctx.stroke(); };
      function roundRect(x, y, w, h, r) {
        ctx.beginPath(); ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
      }

      /* ---------- табло ---------- */
      function renderHud() {
        score.replaceChildren(
          el("span", { className: "air-goal", textContent: "▲ " + state.score.top }),
          el("span", { className: "air-mid", textContent: `${state.players}/${state.cap} игроков` }),
          el("span", { className: "air-goal", textContent: state.score.bottom + " ▼" }));
        feed.replaceChildren(el("span", { className: "air-last-l", textContent: "Забили:" }),
          ...state.last.map(s => el("span", { className: "air-nick" + (s.own ? " own" : ""),
            textContent: s.nick + (s.own ? " (в свои)" : "") })));
        hudRaf = requestAnimationFrame(renderHud);
      }

      resize();
      connect();
      let raf = requestAnimationFrame(draw);
      let hudRaf = requestAnimationFrame(renderHud);
      w.onClose = () => { closed = true; cancelAnimationFrame(raf); cancelAnimationFrame(hudRaf);
        ro.disconnect(); try { ws?.close(); } catch {} };
    } });
}

export { openAirHockey };
