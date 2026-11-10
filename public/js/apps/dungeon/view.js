/* ================= Clown Dungeon — картинка боя =================
 * Игроки пока прямоугольники внизу. Враги — 3D-модели (model.js), а если файла модели нет, прямоугольники.
 * Врагов может быть несколько: главный по центру, призванные (мини-клоуны) мельче по бокам.
 * Тап по врагу выбирает цель, она обведена золотыми уголками.
 * У каждого врага своё состояние: idle / windup / attack / hit / death.
 */
import { CRY_SEC, EnemyModel, MODEL_FILL, WINDUP_SEC, pose } from "./model.js";

const ENEMY_W = 0.42, ENEMY_H = 0.36, ENEMY_Y = 0.36;   // доли холста, когда модели нет
const STATE_SEC = { hit: 0.5, attack: 0.45, death: 1.3 };
const MODEL_TOP = 70, MODEL_BOTTOM = 70;   // сверху — нотка и полоса HP, снизу — игроки
const MODEL_WIDTH = 1.55;     // сторона картинки относительно ширины холста: голова уже картинки и занимает около 70% ширины
const CROWD_SHRINK = 0.8;     // главный враг чуть мельче, когда рядом призванные
const MINI_SIZE = 0.45;       // призванный относительно главного
const MINI_X = [0.17, 0.83, 0.5], MINI_DY = 0.3;   // где стоят призванные: доли ширины, сдвиг вниз в долях высоты главного
const MODEL_BOX_W = 0.5;      // рамка для нажатий и полосы HP, доля картинки
const MODEL_AA = 2;           // сглаживание: рендер вдвое крупнее и уменьшение
const MODEL_MAX_PX = 1600, MINI_MAX_PX = 700;   // потолок рендера, чтобы не перегрузить телефон
const TAP_MARGIN = 20;
const LANE_MIN_SEC = 1.4, LANE_MAX_SEC = 3.2;   // сколько секунд вперёд видно ноты на полосе
const LANE_NOTE = 11, LANE_BOX = 15;
const DMG_MIN = 22, DMG_MAX = 54;   // размер цифры урона, px: растёт с уроном по логарифму
const dmgSize = d => Math.max(DMG_MIN, Math.min(DMG_MAX, DMG_MIN + 9 * Math.log2(Math.max(1, d))));
const GHOST_SEC = 1.2;     // сколько тает призрак промаха
const STATUS_HOP_SEC = 0.22, STATUS_HOP_PX = 7;   // подскок надписи хода при смене
const CRY_NOTE = "#9fd3ff";         // нота, на которой враг заплачет
const templates = new Map();  // модель → Promise<{T, scene} | null>

export class BattleView {
  constructor(canvas, music) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.music = music;
    this.b = null; this.me = null; this.target = null;
    this.anim = new Map();        // id врага → { state, at }
    this.models = new Map();      // id врага → EnemyModel | null (null — модели нет)
    this.gone = new Map();        // id убитого врага → его последний вид, пока доигрывает смерть
    this.fx = null; this.sparks = []; this.hitStep = -1;
    this.floats = []; this.mark = null; this.trips = new Map(); this.hurt = new Map();
    this.live = false;
    this.status = ""; this.tears = 0;
  }
  start() { if (this.live) return; this.live = true; requestAnimationFrame(t => this.frame(t)); }
  stop() { this.live = false; this.hitStep = -1; this.anim.clear(); this.gone.clear(); this.models.clear(); this.floats = []; }

  set(b, me) {
    this.b = b; this.me = me;
    if (!b) return;
    // замах длится, пока на сервере идёт замах: удар придёт отдельным событием точно в долю
    const striker = b.turn.who === "enemy" && b.turn.phase === "windup" ? (b.turn.foe ?? b.enemy.id) : null;
    for (const f of this.alive()) {
      const a = this.animOf(f.id), windup = f.id === striker;
      if (windup && a.state !== "windup") {     // сервер ждёт долю, а голова откидывается только в самом конце
        this.play("windup", f.id);
        a.at += Math.max(0, b.turn.left - WINDUP_SEC);
      } else if (!windup && a.state === "windup") this.play("idle", f.id);
      this.loadModel(f);
    }
  }
  loadModel(f) {
    if (this.models.has(f.id)) return;
    this.models.set(f.id, null);
    if (!templates.has(f.model)) templates.set(f.model, EnemyModel.template(f.model));
    templates.get(f.model).then(t => { if (t && this.models.has(f.id)) this.models.set(f.id, EnemyModel.of(t)); });
  }

  alive() { return (this.b?.foes || []).filter(f => f.hp > 0); }
  mainId() { return this.b?.enemy.id; }
  animOf(id) { let a = this.anim.get(id); if (!a) this.anim.set(id, a = { state: "idle", at: 0 }); return a; }
  play(state, id = this.mainId()) { const a = this.animOf(id); a.state = state; a.at = performance.now() / 1000; }

  size() {
    const r = this.c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.scale = d; this.W = r.width; this.H = r.height;
  }

  /* где стоит враг: главный по центру, призванные по бокам */
  boxOf(f) {
    const crowd = (this.b?.foes || []).length > 1 ? CROWD_SHRINK : 1;
    const side = Math.min(this.W * MODEL_WIDTH, (this.H - MODEL_TOP - MODEL_BOTTOM) / MODEL_FILL) * crowd;
    const main = { x: this.W / 2 - side * MODEL_BOX_W / 2, y: MODEL_TOP, w: side * MODEL_BOX_W, h: side * MODEL_FILL, side };
    if (!this.models.get(f.id) && !f.mini) {
      const w = Math.min(this.W * ENEMY_W, this.H * 0.5) * crowd, h = this.H * ENEMY_H * crowd;
      return { x: this.W / 2 - w / 2, y: this.H * ENEMY_Y - h / 2, w, h, side: Math.max(w, h) };
    }
    if (!f.mini) return main;
    const i = this.b.foes.filter(x => x.mini).findIndex(x => x.id === f.id);
    const s = side * MINI_SIZE, cx = this.W * (MINI_X[i] ?? 0.5), cy = main.y + main.h * (0.5 + MINI_DY);
    const w = s * MODEL_BOX_W, h = s * MODEL_FILL;
    return { x: cx - w / 2, y: cy - h / 2, w, h, side: s, mini: true };
  }
  /* какого врага коснулись: призванные лежат поверх главного, их проверяем первыми */
  foeAt(x, y) {
    const list = this.alive().sort((a, b) => b.mini - a.mini);
    for (const f of list) {
      const e = this.boxOf(f), m = TAP_MARGIN;
      if (x >= e.x - m && x <= e.x + e.w + m && y >= e.y - m && y <= e.y + e.h + m) return f.id;
    }
    return null;
  }
  targetBox() {
    const f = this.alive().find(x => x.id === this.target) || this.b.enemy;
    return this.boxOf(f);
  }

  /* события сервера */
  hit(dmg, combo, id = this.mainId()) {
    this.play("hit", id);
    if (dmg == null) return;
    const f = this.b?.foes.find(x => x.id === id);
    if (!f) return;
    const e = this.boxOf(f);
    this.floats.push({ text: String(dmg), x: e.x + e.w * (0.3 + Math.random() * 0.4), y: e.y + e.h * 0.4, t: performance.now() / 1000,
      color: combo ? "#ffd76a" : "#fff", size: dmgSize(dmg) });
  }
  enemyHit(who, dmg, id = this.mainId()) {
    this.play("attack", id);
    this.hurt.set(who, performance.now() / 1000);
    const p = this.slots().find(s => s.id === who);
    if (p) this.floats.push({ text: "−" + dmg, x: p.x + p.w / 2, y: p.y - 8, t: performance.now() / 1000, color: "#ff6b6b", size: dmgSize(dmg) * 0.8 });
  }
  /* враг погиб, а бой идёт: доигрываем смерть на его месте */
  kill(id) {
    const f = this.b?.foes.find(x => x.id === id);
    if (!f) return;
    this.gone.set(id, { ...f, hp: 0, box: this.boxOf(f) });
    this.play("death", id);
  }
  dieAll() { for (const f of this.alive()) this.play("death", f.id); }
  cry() { this.cryAt = performance.now() / 1000; this.say("плачет!", "#9fd3ff"); }
  trip(who) { this.trips.set(who, performance.now() / 1000); }
  say(text, color) { this.mark = { text, color, t: performance.now() / 1000 }; }

  slots() {
    const party = this.b?.party || [], n = Math.max(1, party.length), w = Math.min(64, (this.W - 16) / n - 10), gap = (this.W - w * n) / (n + 1);
    return party.map((p, i) => ({ ...p, x: gap + i * (w + gap), y: this.H - 58, w, h: 30 }));
  }

  frame() {
    if (!this.live) return;
    requestAnimationFrame(t => this.frame(t));
    this.size();
    const { g, W, H } = this, now = performance.now() / 1000, d = this.scale;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!this.b) return;
    const heard = this.music.heardStep(), beat = heard >= 0 ? heard / 4 : now * 2;
    // главный первым, призванные поверх: они стоят ближе
    const foes = [...this.b.foes].sort((a, b) => a.mini - b.mini);
    foes.forEach((f, i) => {
      const dead = f.hp <= 0, ghost = this.gone.get(f.id);
      if (dead && !ghost) return;
      const a = this.animOf(f.id), t = now - a.at;
      if (dead && t > STATE_SEC.death) { this.gone.delete(f.id); return; }
      this.drawFoe(g, f, ghost?.box || this.boxOf(f), a, t, now, beat + i * 0.7);
    });
    this.drawTarget(g, now);
    this.drawFlash(g, now);
    this.drawLane(g, now);
    this.drawGhost(g, now);
    this.drawCount(g, now);
    this.drawStatus(g, now);
    this.drawTears(g, now);
    this.drawParty(g, now);
    this.floats = this.floats.filter(f => now - f.t < 0.9);
    g.textAlign = "center";
    for (const f of this.floats) {
      const k = (now - f.t) / 0.9;
      g.globalAlpha = 1 - k * k; g.fillStyle = f.color;
      const pop = 1 + Math.max(0, 0.35 - k * 3);        // цифра вылетает чуть крупнее и сразу оседает
      g.font = `800 ${Math.round(f.size * pop)}px system-ui`;
      g.lineWidth = 4; g.strokeStyle = "rgba(0,0,0,0.55)"; g.strokeText(f.text, f.x, f.y - k * 40);
      g.fillText(f.text, f.x, f.y - k * 40);
    }
    g.globalAlpha = 1;
    if (this.mark && now - this.mark.t < 0.6) {
      const e = this.boxOf(this.b.enemy);
      g.fillStyle = this.mark.color; g.font = "800 18px system-ui";
      g.globalAlpha = 1 - (now - this.mark.t) / 0.6;
      g.fillText(this.mark.text, W / 2, e.y + e.h + 22);
      g.globalAlpha = 1;
    }
    const hits = this.b.turn.hits;
    if (hits > 0 && this.b.turn.phase === "combo") {
      g.fillStyle = "#ffd76a"; g.font = "700 22px system-ui"; g.textAlign = "center";
      const { y, hx } = this.laneGeom();
      g.textAlign = "left";                            // справа от табло счёта, которое стоит над квадратом
      g.fillText("×" + (hits + 1), 8 + (this.countW || 118) + 12, y - 30);
    }
  }

  drawFoe(g, f, e, a, t, now, beat) {
    if (a.state !== "idle" && a.state !== "death" && a.state !== "windup" && t > STATE_SEC[a.state]) a.state = "idle";
    const model = this.models.get(f.id), main = f.id === this.mainId();
    const laugh = main && this.b.turn.phase === "laugh";
    if (model) {
      const max = f.mini ? MINI_MAX_PX : MODEL_MAX_PX, px = Math.min(max, Math.round(e.side * this.scale * MODEL_AA));
      const pic = model.draw(pose(a.state, t, beat, main ? now - (this.cryAt ?? -99) : Infinity, main && !!this.b.turn.wail, laugh),
        px, f.mini ? "mini" : "main");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      g.globalAlpha = a.state === "death" ? Math.max(0, 1 - t / STATE_SEC.death) : 1;
      g.drawImage(pic, e.x + e.w / 2 - e.side / 2, e.y + e.h / 2 - e.side / 2, e.side, e.side);
      g.globalAlpha = 1;
    } else this.drawBox(g, e, a, t, now, main, laugh);
    if (f.hp <= 0) return;
    const k = Math.max(0, f.hp / f.maxhp), bw = e.w, cx = e.x + e.w / 2;
    if (!f.mini) {
      g.fillStyle = "#ece6f5"; g.font = "13px system-ui"; g.textAlign = "center";
      g.fillText(`${f.name} · ур. ${f.level}`, cx, e.y - 28);
    }
    const by = f.mini ? e.y - 10 : e.y - 20, bh = f.mini ? 4 : 6;
    g.fillStyle = "#352c44"; g.fillRect(cx - bw / 2, by, bw, bh);
    g.fillStyle = k < 0.35 ? "#ff6b6b" : "#ff9ecf"; g.fillRect(cx - bw / 2, by, bw * k, bh);
    // число хп: у главного справа от полоски, у мелких — над ней
    const hpText = `${Math.ceil(f.hp)}/${f.maxhp}`;
    g.fillStyle = k < 0.35 ? "#ff9b9b" : "#ece6f5";
    if (f.mini) { g.font = "700 10px system-ui"; g.textAlign = "center"; g.fillText(hpText, cx, by - 3); }
    else {
      g.font = "700 11px system-ui"; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(hpText, cx + bw / 2 + 6, by + bh / 2 + 1); g.textBaseline = "alphabetic";
    }
  }

  drawBox(g, e, a, t, now, main, laugh) {
    let x = e.x, y = e.y + Math.sin(now * 2.2 + e.x) * 6, alpha = 1, fill = e.mini ? "#d0567e" : "#b84a6e";
    const cry = now - (this.cryAt ?? -99);
    if (main && cry < CRY_SEC) { x += Math.sin(cry * 14) * 14; fill = "#7fa8d8"; }
    if (laugh) y -= Math.abs(Math.sin(now * 12)) * 10;
    if (a.state === "hit") { x += Math.sin(t * 90) * 7 * (1 - t / STATE_SEC.hit); fill = "#fff"; }
    if (a.state === "windup") y -= Math.max(0, Math.min(1, t / WINDUP_SEC)) * 24;
    if (a.state === "attack") y += Math.sin(Math.min(1, t / STATE_SEC.attack) * Math.PI) * this.H * (e.mini ? 0.12 : 0.26);
    if (a.state === "death") { const k = Math.min(1, t / STATE_SEC.death); y += k * k * this.H * 0.3; alpha = 1 - k; }
    g.globalAlpha = alpha; g.fillStyle = fill;
    g.fillRect(x, y, e.w, e.h);
    g.globalAlpha = 1;
  }

  /* выбранная цель: золотые уголки. При одном враге выбирать не из кого — не рисуем */
  drawTarget(g, now) {
    if (this.alive().length < 2) return;
    const e = this.targetBox(), m = 6 + Math.sin(now * 6) * 2, L = Math.min(18, e.w / 4);
    g.strokeStyle = "#ffd76a"; g.lineWidth = 3;
    for (const [x, y, dx, dy] of [[e.x - m, e.y - m, 1, 1], [e.x + e.w + m, e.y - m, -1, 1], [e.x - m, e.y + e.h + m, 1, -1], [e.x + e.w + m, e.y + e.h + m, -1, -1]]) {
      g.beginPath(); g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L); g.stroke();
    }
  }

  /* ---------- полоса нот, как в Guitar Hero ----------
   * Сильные доли летят справа налево и попадают в квадрат ровно тогда, когда игрок их слышит:
   * положение считается по heardStep — тем же часам, по которым судится попадание.
   * Видна только в своё комбо: чужим она бы мешала. */
  laneGeom() {
    const y = this.H - 132, hx = 46, look = Math.min(LANE_MAX_SEC, Math.max(LANE_MIN_SEC, this.music.strongGap * this.music.stepSec * 1.3));
    return { y, hx, look, speed: (this.W - hx - 14) / look };
  }
  drawLane(g, now) {
    const t = this.b.turn, m = this.music;
    if (t.phase !== "combo" || t.who !== this.me || !m.running) return;
    const pos = m.heardStep();
    if (pos < 0) return;
    const { y, hx, look, speed } = this.laneGeom(), win = m.window;
    // дорожка
    g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(8, y - 16, this.W - 16, 32);
    // квадрат: светится, когда нота внутри окна
    let near = 0, ahead = 0;
    const cryEvery = this.b.cry || this.cryEvery || 20, hits = t.hits || 0;
    const last = Math.floor(pos + look / m.stepSec);
    for (let s = Math.floor(pos - win / m.stepSec) - 1; s <= last; s++) {
      if (!m.isStrong(s)) continue;
      const dt = (s - pos) * m.stepSec, x = hx + dt * speed;
      if (Math.abs(dt) <= win) near = Math.max(near, 1 - Math.abs(dt) / win);
      if (s <= this.hitStep) continue;                 // уже выбита
      const late = dt < -win;
      const cry = !late && (hits + ++ahead) % cryEvery === 0;   // если выбить все ноты до неё, на этой враг заплачет
      g.globalAlpha = late ? Math.max(0, 1 + (dt + win) * 4) : Math.min(1, (look - dt) * 3);
      g.fillStyle = late ? "#ff6b6b" : cry ? CRY_NOTE : "#ffd76a";
      g.beginPath(); g.arc(x, y, cry ? LANE_NOTE + 3 : LANE_NOTE, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#2b1d00"; g.font = "700 14px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("♪", x, y + 1);
    }
    g.globalAlpha = 1; g.textBaseline = "alphabetic";
    const pop = this.fx && this.fx.kind === "hit" ? Math.max(0, 1 - (now - this.fx.t) / 0.18) : 0;
    const r = LANE_BOX + near * 3 + pop * 6;
    g.lineWidth = 3; g.strokeStyle = near > 0 ? "#fff" : "#ffd76a";
    g.strokeRect(hx - r, y - r, r * 2, r * 2);
    if (pop) { g.fillStyle = `rgba(255,215,106,${pop * 0.6})`; g.fillRect(hx - r, y - r, r * 2, r * 2); }
    // искры выбитой ноты
    for (const p of this.sparks) {
      const k = (now - p.t) / 0.35;
      if (k > 1) continue;
      g.globalAlpha = 1 - k; g.fillStyle = "#ffd76a";
      g.fillRect(hx + p.dx * k * 34 - 2, y + p.dy * k * 34 - 2, 4, 4);
    }
    g.globalAlpha = 1;
    this.sparks = this.sparks.filter(p => now - p.t < 0.35);
  }

  /* надпись хода — крупно, сразу под полосой нот: туда игрок и смотрит */
  drawStatus(g, now) {
    if (!this.status) return;
    if (this.status !== this.statusShown) { this.statusShown = this.status; this.statusAt = now; }   // новая надпись подскакивает
    const k = (now - (this.statusAt ?? -9)) / STATUS_HOP_SEC;
    const hop = k < 1 ? Math.sin(k * Math.PI) * STATUS_HOP_PX : 0;
    const { y } = this.laneGeom(), ty = y + 16 + 24 - hop;
    let size = 20;
    g.font = `800 ${size}px system-ui`;
    const w = g.measureText(this.status).width;
    if (w > this.W - 16) { size = Math.max(12, Math.floor(size * (this.W - 16) / w)); g.font = `800 ${size}px system-ui`; }
    g.textAlign = "left"; g.textBaseline = "middle";
    g.lineWidth = 4; g.strokeStyle = "rgba(13,11,18,0.85)"; g.strokeText(this.status, 8, ty);
    g.fillStyle = "#ffd76a"; g.fillText(this.status, 8, ty);
    g.textBaseline = "alphabetic";
  }

  /* полоска слёз: каждый плач врага — деление, полная — следующий плач бьёт с множителем */
  drawTears(g, now) {
    const full = this.b.tearsFull || 3, n = Math.min(full, this.tears || 0);
    const segW = 22, gap = 4, w = full * segW + (full - 1) * gap, x = this.W - 8 - w, y = this.laneGeom().y - 16 - 8 - 12;
    const ready = n === full - 1, glow = ready ? 0.55 + 0.45 * Math.sin(now * 8) : 1;
    g.font = "11px system-ui"; g.textAlign = "right"; g.fillStyle = "#9a90ad";
    g.fillText(ready ? `слёзы · ещё плач = ×${this.b.tearsMult || 3}` : "слёзы", this.W - 8, y - 5);
    for (let i = 0; i < full; i++) {
      const sx = x + i * (segW + gap);
      g.fillStyle = "#352c44"; g.fillRect(sx, y, segW, 8);
      if (i < n) { g.globalAlpha = glow; g.fillStyle = CRY_NOTE; g.fillRect(sx, y, segW, 8); g.globalAlpha = 1; }
    }
  }

  /* ---------- табло счёта над полосой нот ----------
   * Деление периода (3•3•3•2) с текущей группой, счёт доли в периоде (1..13) и внутри группы (1..3).
   * Когда сильная каждая четверть, вместо единиц показываем номера долей. */
  drawCount(g, now) {
    const m = this.music, meter = m.meter, pos = m.heardStep();
    if (!meter || pos < 0 || !m.running) return;
    const { groups, period } = meter, q = ((Math.floor(pos / 4) % period) + period) % period;
    let gi = 0, start = 0;
    while (gi < groups.length - 1 && q >= start + groups[gi]) start += groups[gi++];
    const inGroup = q - start + 1, ones = groups.every(x => x === 1);
    const frac = pos / 4 - Math.floor(pos / 4), pulse = Math.max(0, 1 - frac * 3);   // вспыхивает на каждой доле
    g.font = "700 13px system-ui";
    const label = groups.map((n, i) => ones ? i + 1 : n).join(" • ");
    // над полосой нот, у квадрата: туда игрок и так смотрит
    const w = Math.max(118, g.measureText(label).width + 16), h = 56, x = 8, y = this.laneGeom().y - 16 - 8 - h;
    this.countW = w;
    g.fillStyle = "rgba(13,11,18,0.78)"; g.fillRect(x, y, w, h);
    g.strokeStyle = `rgba(255,215,106,${0.25 + pulse * (inGroup === 1 ? 0.75 : 0.3)})`; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
    // деление: текущая группа золотая
    g.textBaseline = "middle"; g.textAlign = "left"; g.font = "700 13px system-ui";
    let cx = x + 8;
    groups.forEach((n, i) => {
      const t = ones ? String(i + 1) : String(n), cur = i === gi;
      g.fillStyle = cur ? "#ffd76a" : "#9a90ad";
      g.fillText(t, cx, y + 13);
      cx += g.measureText(t).width + 2;
      if (i < groups.length - 1) { g.fillStyle = "#5a5070"; g.fillText("•", cx, y + 13); cx += g.measureText("•").width + 2; }
    });
    // счёт в периоде и в группе
    g.font = "11px system-ui"; g.fillStyle = "#9a90ad";
    g.fillText("счёт", x + 8, y + 38); g.fillText("доля", x + 66, y + 38);
    g.font = `800 ${16 + Math.round(pulse * 3)}px system-ui`; g.fillStyle = "#ece6f5";
    g.fillText(`${q + 1}`, x + 36, y + 38);
    g.fillStyle = inGroup === 1 ? "#ffd76a" : "#ece6f5";
    g.fillText(`${inGroup}`, x + 92, y + 38);
    g.font = "11px system-ui"; g.fillStyle = "#5a5070";
    g.fillText(`/${period}`, x + 36 + g.measureText(`${q + 1}`).width * 1.6, y + 40);
    g.fillText(`/${groups[gi]}`, x + 92 + 12, y + 40);
    g.textBaseline = "alphabetic";
  }

  /* отклик на нажатие: попал — вспышка и искры, промах — красная вспышка */
  feedback(kind, step) {
    const now = performance.now() / 1000;
    this.fx = { kind, t: now };
    if (kind === "hit") {
      this.hitStep = Math.max(this.hitStep, step);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.sparks.push({ dx: Math.cos(a), dy: Math.sin(a), t: now }); }
    } else if (step != null && this.music.running) {
      // снимок полосы на момент промаха: где был квадрат и где та нота, по которой промазал
      const { y, hx, speed } = this.laneGeom(), pos = this.music.heardStep();
      this.ghost = { t: now, y, hx, x: hx + (step - pos) * this.music.stepSec * speed };
    }
  }
  /* призрак промаха: квадрат и нота стоят на месте и тают — видно, насколько рано или поздно нажал */
  drawGhost(g, now) {
    const gh = this.ghost;
    if (!gh) return;
    const k = (now - gh.t) / GHOST_SEC;
    if (k >= 1) { this.ghost = null; return; }
    g.globalAlpha = 1 - k;
    g.lineWidth = 3; g.strokeStyle = "#ff6b6b";
    g.strokeRect(gh.hx - LANE_BOX, gh.y - LANE_BOX, LANE_BOX * 2, LANE_BOX * 2);
    g.fillStyle = "#ff6b6b";
    g.beginPath(); g.arc(gh.x, gh.y, LANE_NOTE, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#2b1d00"; g.font = "700 14px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("♪", gh.x, gh.y + 1);
    g.globalAlpha = 1; g.textBaseline = "alphabetic";
  }
  drawFlash(g, now) {
    if (!this.fx) return;
    const hit = this.fx.kind === "hit", len = hit ? 0.25 : 0.45, k = 1 - (now - this.fx.t) / len;
    if (k <= 0) return;
    g.fillStyle = hit ? `rgba(255,215,106,${0.16 * k})` : `rgba(255,60,60,${0.32 * k})`;
    g.fillRect(0, 0, this.W, this.H);
  }

  drawParty(g, now) {
    g.font = "11px system-ui"; g.textAlign = "center";
    const stunned = this.b.stunned || {};
    for (const s of this.slots()) {
      const turn = this.b.turn.who === s.id, hurt = now - (this.hurt.get(s.id) ?? -9) < 0.3, trip = now - (this.trips.get(s.id) ?? -9) < 0.4;
      g.fillStyle = hurt ? "#ff6b6b" : s.id === this.me ? "#8fe8cf" : "#9fd3ff";
      g.fillRect(s.x + (trip ? Math.sin(now * 60) * 4 : 0), s.y - (turn ? 8 : 0), s.w, s.h);
      if (turn) { g.strokeStyle = "#ffd76a"; g.lineWidth = 2; g.strokeRect(s.x - 3, s.y - 11, s.w + 6, s.h + 6); }
      if (stunned[s.id]) { g.fillStyle = "#2b0d1e"; g.font = "700 13px system-ui"; g.fillText("✶".repeat(stunned[s.id]), s.x + s.w / 2, s.y + 20); g.font = "11px system-ui"; }
      g.fillStyle = "#352c44"; g.fillRect(s.x, s.y + 34, s.w, 4);
      g.fillStyle = s.hp / s.maxhp < 0.3 ? "#ff6b6b" : "#8fe8cf"; g.fillRect(s.x, s.y + 34, s.w * s.hp / s.maxhp, 4);
      g.fillStyle = "#352c44"; g.fillRect(s.x, s.y + 39, s.w, 3);
      g.fillStyle = "#7fa8ff"; g.fillRect(s.x, s.y + 39, s.w * s.mp / s.maxmp, 3);
      g.fillStyle = "#ece6f5"; g.fillText(s.nick.slice(0, 10), s.x + s.w / 2, s.y + 53);
    }
  }
}
