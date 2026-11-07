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
const templates = new Map();  // модель → Promise<{T, scene} | null>

export class BattleView {
  constructor(canvas, music) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.music = music;
    this.b = null; this.me = null; this.target = null;
    this.anim = new Map();        // id врага → { state, at }
    this.models = new Map();      // id врага → EnemyModel | null (null — модели нет)
    this.gone = new Map();        // id убитого врага → его последний вид, пока доигрывает смерть
    this.floats = []; this.mark = null; this.trips = new Map(); this.hurt = new Map();
    this.live = false;
  }
  start() { if (this.live) return; this.live = true; requestAnimationFrame(t => this.frame(t)); }
  stop() { this.live = false; this.anim.clear(); this.gone.clear(); this.models.clear(); this.floats = []; }

  set(b, me) {
    this.b = b; this.me = me;
    if (!b) return;
    // замах длится, пока на сервере идёт замах: удар придёт отдельным событием точно в долю
    const windup = b.turn.who === "enemy" && b.turn.phase === "windup";
    for (const f of this.alive()) {
      const a = this.animOf(f.id);
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
    this.floats.push({ text: String(dmg), x: e.x + e.w * (0.3 + Math.random() * 0.4), y: e.y + e.h * 0.4, t: performance.now() / 1000, color: combo ? "#ffd76a" : "#fff" });
  }
  enemyHit(who, dmg, id = this.mainId()) {
    this.play("attack", id);
    this.hurt.set(who, performance.now() / 1000);
    const p = this.slots().find(s => s.id === who);
    if (p) this.floats.push({ text: "−" + dmg, x: p.x + p.w / 2, y: p.y - 8, t: performance.now() / 1000, color: "#ff6b6b" });
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
    this.drawNote(g, now);
    this.drawParty(g, now);
    this.floats = this.floats.filter(f => now - f.t < 0.9);
    g.textAlign = "center"; g.font = "700 20px system-ui";
    for (const f of this.floats) {
      const k = (now - f.t) / 0.9;
      g.globalAlpha = 1 - k * k; g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y - k * 40);
    }
    g.globalAlpha = 1;
    if (this.mark && now - this.mark.t < 0.6) {
      const e = this.boxOf(this.b.enemy);
      g.fillStyle = this.mark.color; g.font = "700 15px system-ui";
      g.globalAlpha = 1 - (now - this.mark.t) / 0.6;
      g.fillText(this.mark.text, W / 2, e.y + e.h + 22);
      g.globalAlpha = 1;
    }
    const hits = this.b.turn.hits;
    if (hits > 0 && this.b.turn.phase === "combo") {
      g.fillStyle = "#ffd76a"; g.font = "700 24px system-ui";
      g.fillText("×" + (hits + 1), W / 2, H - 76);
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

  /* нотка крутится над целью, пока идёт комбо: один оборот на две доли, на сильной ноте вспыхивает */
  drawNote(g, now) {
    const t = this.b.turn;
    if (t.phase !== "combo") return;
    const m = this.music, pos = m.heardStep();
    const beat = pos >= 0 ? pos / 4 : now * 2;
    const e = this.targetBox(), cx = e.x + e.w / 2, cy = e.y - (e.mini ? 30 : 52);
    const near = pos >= 0 && m.isStrong(Math.round(pos)) ? 1 - Math.min(1, Math.abs(pos - Math.round(pos)) * 2.2) : 0;
    const sx = Math.cos(beat * Math.PI);
    g.save();
    g.translate(cx, Math.max(16, cy));
    g.scale((Math.abs(sx) < 0.15 ? 0.15 * Math.sign(sx || 1) : sx) * (1 + near * 0.5), 1 + near * 0.5);
    g.fillStyle = t.who === this.me ? "#ffd76a" : "#9a90ad";
    g.font = "700 32px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("♪", 0, 0);
    g.restore();
    g.textBaseline = "alphabetic";
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
