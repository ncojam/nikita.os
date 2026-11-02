import { el, store } from "../../core/util.js";
import { BattleMusic } from "./music.js";
import { BattleView } from "./view.js";

/* ================= Clown Dungeon — клиент Mini App =================
 * Сервер (dungeon.py) считает игру и присылает снимки мира («state»), здесь только экраны, музыка и тапы.
 * Экраны перестраиваются из снимка целиком; холст боя живёт отдельно, чтобы анимации не сбрасывались.
 * Открыть можно и в обычном браузере — тогда войдёшь гостем, это удобно для проверки.
 */
const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch { /* вне Телеграма */ }

const app = document.getElementById("app");
const music = new BattleMusic();
let ws = null, S = null, me = null, clockOff = 0, bestRtt = 1e9;
let logLines = [], sheet = null, musicBattle = null, holdBattle = 0, lastBattle = null, lastStep = -1, retry = 500;

const canvas = el("canvas");
const view = new BattleView(canvas, music);
const srvNow = () => Date.now() + clockOff;
const send = o => { if (ws?.readyState === 1) ws.send(JSON.stringify(o)); };

function guestId() {
  let g = store.get("dungeon.guest");
  if (!g) {
    g = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
    store.set("dungeon.guest", g);
  }
  return g;
}

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/dungeon/ws`);
  ws.onopen = () => {
    retry = 500; bestRtt = 1e9;
    send({ t: "auth", init: tg?.initData || "", guest: guestId() });
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
  };
  ws.onclose = () => { setTimeout(connect, retry); retry = Math.min(retry * 2, 8000); };
  ws.onmessage = e => onMsg(JSON.parse(e.data));
}
function ping() { send({ t: "ping", c: Date.now() }); }
setInterval(() => {
  ping();
  if (S?.battle && musicBattle === S.battle.id) music.resync(S.battle.t0, srvNow());
}, 3000);

function onMsg(d) {
  if (d.t === "pong") {
    const t = Date.now(), rtt = t - d.c;
    if (rtt <= bestRtt * 1.2) { bestRtt = Math.min(bestRtt, rtt); clockOff = d.s + rtt / 2 - t; }   // доверяем быстрым ответам
  }
  else if (d.t === "hello") me = d.id;
  else if (d.t === "log") { logLines.push(d.text); logLines = logLines.slice(-40); render(); }
  else if (d.t === "state") { S = d; onState(); }
  else if (d.t === "ev") onEvent(d);
  else if (d.t === "error") { logLines.push(d.error); render(); }
}

function onState() {
  const b = S.battle;
  if (b) {
    lastBattle = b; holdBattle = 0;
    music.setState({ enemyHp: b.enemy.hp / b.enemy.maxhp, myHp: S.me.hp / S.me.maxhp, combo: b.turn.phase === "combo" ? b.turn.hits : 0 });
    if (musicBattle !== b.id) { musicBattle = b.id; lastStep = -1; music.start(b, srvNow()).catch(e => console.warn("музыка", e)); }
    view.set(b, me);
  } else if (musicBattle !== null) {
    musicBattle = null;
    music.stop();
  }
  render();
}

function onEvent(d) {
  if (d.e === "hit") {
    view.hit(d.dmg, d.combo);
    if (lastBattle) lastBattle.enemy.hp = lastBattle.enemy.maxhp * d.hp;
  }
  else if (d.e === "enemy_hit") view.enemyHit(d.who, d.dmg);
  else if (d.e === "trip") view.trip(d.who);
  else if (d.e === "win") { view.play("death"); holdBattle = performance.now() + 1700; banner(`Победа! ${d.enemy} повержена`); setTimeout(render, 1750); }
  else if (d.e === "dead") { holdBattle = performance.now() + 1200; banner("Ты повержен"); setTimeout(render, 1250); }
}

function banner(text) {
  const b = el("div", { className: "banner", textContent: text });
  document.body.append(b);
  setTimeout(() => b.remove(), 1700);
}

/* ---------- экраны ---------- */
const hpBar = (hp, max) => {
  const bar = el("div", { className: "bar" + (hp / max < 0.3 ? " low" : "") }, el("i"));
  bar.firstChild.style.width = 100 * hp / max + "%";
  return el("div", { className: "hp", textContent: `HP ${hp}/${max}` }, bar);
};
const btn = (text, fn, cls = "", off = false) => el("button", { textContent: text, className: cls, disabled: off, onclick: fn });
const top = () => el("div", { className: "top" }, el("div", { className: "place", textContent: S.loc.name }),
  el("div", { textContent: `🪙 ${S.me.coins}` }), hpBar(S.me.hp, S.me.maxhp));

function render() {
  if (!S) { app.replaceChildren(el("div", { textContent: "Спускаемся в пещеру…" })); return; }
  const inFight = S.battle || performance.now() < holdBattle;
  if (inFight) renderBattle(); else { view.stop(); renderWorld(); }
  renderSheet();
}

function renderWorld() {
  const log = el("div", { className: "log" }, ...logLines.map(t => el("div", { textContent: t })));
  const rows = [];
  for (const b of S.loc.battles) rows.push(el("div", { className: "card" },
    el("span", { textContent: `⚔ ${b.party.map(p => p.nick).join(", ")} против: ${b.enemy} (${Math.round(b.hp * 100)}%)` }),
    btn("В бой", () => send({ t: "join", id: b.id }), "small", b.party.length >= 4),
    btn("Помешать", () => askHinder(b.id, b.party), "small")));
  for (const g of S.loc.ground) rows.push(el("div", { className: "card" },
    el("span", { textContent: g.name }, ...(g.from ? [el("small", { textContent: `  от: ${g.from}` })] : [])),
    btn("Взять", () => send({ t: "pick", id: g.id }), "small")));
  const others = S.loc.players.filter(n => n !== S.me.nick);
  app.replaceChildren(top(), log, ...(rows.length ? [el("div", { className: "list" }, ...rows)] : []),
    ...(others.length ? [el("div", { className: "here", textContent: "Рядом: " + others.join(", ") })] : []),
    el("div", { className: "row" }, btn("Бродить", () => send({ t: "wander" }), "main"), btn("Рюкзак", () => openSheet("bag"))));
  log.scrollTop = log.scrollHeight;
}

function renderBattle() {
  const b = S.battle || lastBattle;
  if (!b) return;
  view.set(b, me);
  if (canvas.parentNode !== app) {
    app.replaceChildren(canvas);
    view.start();
    app.battleTail = [];
  }
  for (const n of app.battleTail || []) n.remove();
  const t = b.turn, mine = S.battle && t.who === me, choose = mine && t.phase === "choose";
  const who = b.party.find(p => p.id === t.who)?.nick;
  const text = !S.battle ? "" : t.who === "enemy" ? "Ход врага…"
    : mine && t.phase === "combo" ? "Жми по врагу в такт!"
    : mine ? "Твой ход" : t.phase === "combo" ? `${who} бьёт в такт…` : `Ходит ${who}…`;
  const tail = [
    el("div", { className: "turn", textContent: text }),
    ...(music.running && !music.audible ? [el("div", { className: "sound", textContent: "Нажми куда угодно, чтобы включить звук" })] : []),
    el("div", { className: "blog" }, ...b.log.map(l => el("div", { textContent: l }))),
    el("div", { className: "row" },
      btn("Атака", () => { lastStep = -1; send({ t: "act", a: "attack" }); }, "main", !choose),
      btn("Рюкзак", () => openSheet("bag")),
      ...(b.party.length > 1 ? [btn("Помешать", () => askHinder(b.id, b.party))] : []),
      btn("Бежать", () => send({ t: "act", a: "flee" }), "", !choose)),
  ];
  app.append(...tail);
  app.battleTail = tail;
}

/* ---------- рюкзак и помеха: всплывающий лист ---------- */
function openSheet(kind, data) { sheet = { kind, data }; renderSheet(); }
function closeSheet() { sheet = null; renderSheet(); }

function askHinder(id, party) {
  const targets = party.filter(p => p.id !== me);
  if (targets.length === 1) send({ t: "hinder", id, target: targets[0].id });
  else if (targets.length) openSheet("hinder", { id, targets });
}

function renderSheet() {
  document.querySelector(".sheet")?.remove();
  if (!sheet || !S) return;
  const box = el("div");
  const close = btn("Закрыть", closeSheet);
  if (sheet.kind === "hinder") {
    box.append(el("h3", { textContent: "Кому поставить подножку?" }));
    for (const p of sheet.data.targets) box.append(btn(p.nick, () => { send({ t: "hinder", id: sheet.data.id, target: p.id }); closeSheet(); }));
  } else {
    const b = S.battle, myTurn = b && b.turn.who === me && b.turn.phase === "choose";
    box.append(el("h3", { textContent: `Рюкзак · урон +${S.me.atk} · защита +${S.me.def}` }));
    for (const slot of ["weapon", "armor"]) {
      const it = S.me.eq[slot];
      if (it) box.append(el("div", { className: "card" }, el("span", { textContent: `Надето: ${it.name}` }),
        btn("Снять", () => send({ t: "unequip", slot }), "small")));
    }
    for (const it of S.me.inv) {
      const gear = it.kind !== "heal";
      const note = gear ? (it.kind === "weapon" ? `урон +${it.atk}` : `защита +${it.def}`) : `+${it.heal} HP`;
      box.append(el("div", { className: "card" },
        el("span", { textContent: `${it.name}${it.qty > 1 ? " ×" + it.qty : ""}  ` }, el("small", { textContent: note })),
        gear ? btn("Надеть", () => send({ t: "equip", item: it.id }), "small")
          : btn(b ? "Применить (ход)" : "Применить", () => {
            if (b) { send({ t: "act", a: "item", item: it.id }); closeSheet(); } else send({ t: "use", item: it.id });
          }, "small", !!b && !myTurn)));
    }
    if (!S.me.inv.length) box.append(el("div", { className: "here", textContent: "Пусто." }));
  }
  box.append(close);
  const wrap = el("div", { className: "sheet", onclick: e => { if (e.target === wrap) closeSheet(); } }, box);
  document.body.append(wrap);
}

/* ---------- тапы в такт ---------- */
canvas.addEventListener("pointerdown", e => {
  const b = S?.battle;
  if (!b || b.turn.who !== me || b.turn.phase !== "combo") return;
  const r = canvas.getBoundingClientRect();
  if (!view.overEnemy(e.clientX - r.left, e.clientY - r.top)) return;
  const j = music.judge();
  if (!j) return;
  const inTime = Math.abs(j.err) <= music.window;
  if (inTime && j.step === lastStep) return;  // второй тап по той же ноте не считаем
  if (inTime) {
    lastStep = j.step;
    music.learn(j.err);
    music.hitTone(j.step);
    send({ t: "tap", step: j.step });
  } else {
    view.say("мимо такта", "#ff6b6b");
    send({ t: "miss" });
  }
});

/* браузер не даёт звука до первого нажатия */
addEventListener("pointerdown", () => {
  const was = music.audible;
  music.unlock();
  if (!was && S?.battle) { music.resync(S.battle.t0, srvNow()); setTimeout(render, 150); }
}, true);

render();
connect();
