import { el, store } from "../../core/util.js";
import { BattleMusic } from "./music.js";
import { Sfx } from "./sfx.js";
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
const sfx = new Sfx(() => music.ctx);
let attackAt = 0;
const ATTACK_GUARD = 180;   // мс: второй тап сразу после атаки — дрожь пальца, а не удар в такт
const ATTACK_WAIT = 600;    // мс: столько после атаки ждём ответа сервера, тап за это время не пропадает
// с: чуть ранний тап придерживается до самой ноты. Люди и так жмут немного раньше звука
const EARLY_BUFFER = 0.025, EARLY_BUFFER_WEAK = 0.045;
let waitingTap = null;      // оценка тапа, сделанного до того, как сервер открыл комбо
let ws = null, S = null, me = null, clockOff = 0, bestRtt = 1e9;
let logLines = [], sheet = null, musicBattle = null, holdBattle = 0, lastBattle = null, lastStep = -1, retry = 500;

/* кнопка «Бродить» живёт отдельно от снимков мира: заполнение не должно сбрасываться при перерисовке.
 * Нажатие незадолго до готовности не теряется: оно запоминается и срабатывает само, как только кнопка заполнится. */
const WALK_BUFFER = 0.25;   // с до готовности, в которые нажатие запоминается
let walkCd = 1, walkUntil = 0, walkQueued = false;
const walkFill = el("i");
const walkBtn = el("button", { className: "main walk ready", onpointerdown: pressWalk }, walkFill, el("span", { textContent: "Бродить" }));

function pressWalk() {
  const left = walkUntil - performance.now() / 1000;
  if (left <= 0) return walk();
  if (left > WALK_BUFFER || walkQueued) return;
  walkQueued = true;
  walkBtn.classList.add("queued");
  setTimeout(() => { walkQueued = false; walkBtn.classList.remove("queued"); walk(); }, left * 1000);
}
function walk() {
  if (S?.battle) return;
  send({ t: "wander" });
  sfx.steps(walkCd);
  walkUntil = performance.now() / 1000 + walkCd;
  walkBtn.classList.remove("ready");
  requestAnimationFrame(walkFrame);
}
function walkFrame() {
  const left = walkUntil - performance.now() / 1000;
  walkFill.style.width = 100 * Math.min(1, 1 - left / walkCd) + "%";
  if (left > 0) requestAnimationFrame(walkFrame); else walkBtn.classList.add("ready");
}

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
  else if (d.t === "hello") { me = d.id; walkCd = d.wander || walkCd; if (d.owner) checkCache(); }
  else if (d.t === "log") { logLines.push(d.text); logLines = logLines.slice(-40); render(); }
  else if (d.t === "state") { S = d; onState(); }
  else if (d.t === "ev") onEvent(d);
  else if (d.t === "error") { logLines.push(d.error); render(); }
}

function onState() {
  const b = S.battle;
  if (b) {
    lastBattle = b; holdBattle = 0;
    if (b.turn.who === me && b.turn.phase === "combo") setTimeout(flushTap);
    music.setState({ enemyHp: b.enemy.hp / b.enemy.maxhp, myHp: S.me.hp / S.me.maxhp, combo: b.turn.phase === "combo" ? b.turn.hits : 0 });
    if (musicBattle !== b.id) { musicBattle = b.id; lastStep = -1; music.error = null; music.start(b, srvNow).catch(e => { console.warn("музыка", e); music.error = String(e.message || e); render(); }); }
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
    sfx.hurt(false);
    if (lastBattle) lastBattle.enemy.hp = lastBattle.enemy.maxhp * d.hp;
  }
  else if (d.e === "enemy_hit") { view.enemyHit(d.who, d.dmg); sfx.hurt(d.who === me); }
  else if (d.e === "trip") { view.trip(d.who); sfx.hurt(d.who === me); }
  else if (d.e === "level") { banner(`Уровень ${d.level}!`); sfx.item(); }
  else if (d.e === "pickup") d.kind === "coins" ? sfx.coin() : sfx.item();
  else if (d.e === "giggle") sfx.giggle();
  else if (d.e === "cry") { view.cry(); sfx.cry(); }
  else if (d.e === "win") { sfx.win(); view.play("death"); holdBattle = performance.now() + 1700; banner(`Победа! ${d.enemy} повержена`); setTimeout(render, 1750); }
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
  el("div", { textContent: `ур. ${S.me.level} · 🪙 ${S.me.coins}` }), hpBar(S.me.hp, S.me.maxhp));

function render() {
  if (!S) { app.replaceChildren(el("div", { textContent: "Спускаемся в пещеру…" })); return; }
  const inFight = S.battle || performance.now() < holdBattle;
  if (inFight) renderBattle(); else { view.stop(); renderWorld(); }
  renderSheet();
}

/* ---------- кеш музыки: только для владельца сайта, на ПК в окне сайта ---------- */
let cacheMissing = [], cacheBusy = false;
async function checkCache() {
  try {
    const r = await fetch("/api/dungeon/tracks");
    if (r.ok) { cacheMissing = (await r.json()).filter(t => !t.ready); render(); }
  } catch { /* не критично: сыграем синтезом */ }
}
async function buildCache() {
  if (cacheBusy) return;
  cacheBusy = true;
  const say = t => { logLines.push(t); logLines = logLines.slice(-40); render(); };
  try {
    const { buildTrack } = await import("./stems.js");
    for (const t of [...cacheMissing]) await buildTrack(t, say);
    say("Кеш музыки собран.");
  } catch (e) { say("Кеш не собран: " + e.message); }
  cacheBusy = false;
  checkCache();
}

function renderWorld() {
  const log = el("div", { className: "log" }, ...logLines.map(t => el("div", { textContent: t })));
  const rows = [];
  if (cacheMissing.length) rows.push(el("div", { className: "card" },
    el("span", { textContent: `Музыка без кеша: ${cacheMissing.map(t => t.id).join(", ")}` }),
    btn(cacheBusy ? "Собираю…" : "Собрать", buildCache, "small", cacheBusy)));
  for (const b of S.loc.battles) rows.push(el("div", { className: "card" },
    el("span", { textContent: `⚔ ${b.party.map(p => p.nick).join(", ")} против: ${b.enemy}, ур. ${b.level} (${Math.round(b.hp * 100)}%)` }),
    btn("В бой", () => send({ t: "join", id: b.id }), "small", b.party.length >= 4),
    btn("Помешать", () => askHinder(b.id, b.party), "small")));
  for (const g of S.loc.ground) rows.push(el("div", { className: "card" },
    el("span", { textContent: g.name }, ...(g.from ? [el("small", { textContent: `  от: ${g.from}` })] : [])),
    btn("Взять", () => send({ t: "pick", id: g.id }), "small")));
  const others = S.loc.players.filter(n => n !== S.me.nick);
  app.replaceChildren(top(), log, ...(rows.length ? [el("div", { className: "list" }, ...rows)] : []),
    ...(others.length ? [el("div", { className: "here", textContent: "Рядом: " + others.join(", ") })] : []),
    el("div", { className: "row" }, walkBtn, btn("Рюкзак", () => openSheet("bag"))));
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
    ...(music.error ? [el("div", { className: "sound", textContent: "Музыка не запустилась: " + music.error.slice(0, 80) })]
      : music.ctx && !music.audible ? [el("div", { className: "sound", textContent: `Нажми куда угодно, чтобы включить звук (${music.ctx.state})` })] : []),
    audioInfo,
    el("div", { className: "blog" }, ...b.log.map(l => el("div", { textContent: l }))),
    el("div", { className: "row" },
      el("button", { textContent: "Атака", className: "main", disabled: !(choose || (mine && t.phase === "combo")), onpointerdown: attackPress }),
      btn("Рюкзак", () => openSheet("bag")),
      ...(b.party.length > 1 ? [btn("Помешать", () => askHinder(b.id, b.party))] : []),
      btn("Бежать", () => send({ t: "act", a: "flee" }), "", !choose)),
  ];
  app.append(...tail);
  app.battleTail = tail;
}

/* ---------- рюкзак и помеха: всплывающий лист ---------- */
function openSheet(kind, data) { sheet = { kind, data }; sfx.bag(); renderSheet(); }
function closeSheet() { sheet = null; sfx.bag(false); renderSheet(); }

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
    box.append(el("h3", { textContent: `Рюкзак · урон +${S.me.atk} · защита +${S.me.def} · опыт ${S.me.xp}/${S.me.xpNext}` }));
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
          }, "small", !!b && !myTurn),
        btn("Выкинуть", () => send({ t: "throw", item: it.id }), "small")));
    }
    if (!S.me.inv.length) box.append(el("div", { className: "here", textContent: "Пусто." }));
  }
  box.append(close);
  const wrap = el("div", { className: "sheet", onclick: e => { if (e.target === wrap) closeSheet(); } }, box);
  document.body.append(wrap);
}

/* ---------- диагностика звука: временная, пока проверяем такт на телефоне ---------- */
const audioInfo = el("div", { className: "audio-info" });
setInterval(() => { if (S?.battle) audioInfo.textContent = music.stats(); }, 700);

/* ---------- атака и тапы в такт: по врагу и кнопкой — одно и то же ---------- */
function attackPress() {
  const b = S?.battle;
  if (!b || b.turn.who !== me) return;
  if (b.turn.phase === "choose") {
    const since = performance.now() - attackAt;
    if (since < ATTACK_WAIT) {      // атака ушла, ответа ещё нет: запоминаем тап и засчитаем его, когда комбо откроется
      if (since >= ATTACK_GUARD) waitingTap = { j: music.judge(), at: performance.now() };
      return;
    }
    lastStep = -1;
    waitingTap = null;
    attackAt = performance.now();
    send({ t: "act", a: "attack" });
  } else if (b.turn.phase === "combo") rhythmTap();
}
/* сервер открыл комбо: отдаём тап, сделанный, пока ответ был в пути */
function flushTap() {
  const w = waitingTap;
  if (!w) return;
  waitingTap = null;
  if (performance.now() - w.at < ATTACK_WAIT) rhythmTap(w.j);
}
canvas.addEventListener("pointerdown", e => {
  const r = canvas.getBoundingClientRect();
  if (view.overEnemy(e.clientX - r.left, e.clientY - r.top)) attackPress();
});

function landTap(j) {
  music.learn(j.err);
  music.hitTone(j.step);
  send({ t: "tap", step: j.step });
}
function rhythmTap(j = music.judge()) {
  if (arguments.length === 0 && performance.now() - attackAt < ATTACK_GUARD) return;
  if (!j) return;
  const inTime = Math.abs(j.err) <= music.window;
  if (j.step === lastStep && inTime) return;  // второй тап по той же ноте не считаем
  const held = j.err < 0 && j.err >= -(music.window + (music.weak ? EARLY_BUFFER_WEAK : EARLY_BUFFER));
  if (inTime) {
    lastStep = j.step;
    landTap(j);
  } else if (held && j.step !== lastStep) {     // рановато: зачтём ровно в момент ноты
    lastStep = j.step;
    setTimeout(() => landTap(j), -j.err * 1000);
  } else {
    music.learn(j.err);
    view.say("мимо такта", "#ff6b6b");
    send({ t: "miss" });
  }
}

/* Браузер не даёт звука до первого нажатия. На телефоне нажатием считается только отпускание пальца,
 * поэтому pointerdown мало: с ним звук работал бы только с мышью. */
for (const ev of ["pointerdown", "pointerup", "touchend", "click"]) addEventListener(ev, () => music.unlock(), true);
addEventListener("visibilitychange", () => { if (!document.hidden && music.ctx) music.ctx.resume(); });
music.onWake = () => {
  if (S?.battle) { music.resync(S.battle.t0, srvNow()); render(); }
};

render();
connect();
