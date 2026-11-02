/* ================= Clown Dungeon — картинка боя =================
 * Пока всё абстрактно: враг — прямоугольник, игроки — маленькие прямоугольники внизу.
 * Вся отрисовка врага — в drawEnemy: состояния idle / hit / attack / death называются так же, как экшены модели
 * из Blender (docs/dungeon.md), поэтому модель встанет на её место, не трогая остальное.
 */
const ENEMY_W = 0.42, ENEMY_H = 0.36, ENEMY_Y = 0.36;   // доли холста
const STATE_SEC = { hit: 0.28, attack: 0.45, death: 1.3 };

export class BattleView {
  constructor(canvas, music) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.music = music;
    this.b = null; this.me = null;
    this.state = "idle"; this.stateAt = 0;
    this.floats = []; this.mark = null; this.pulse = 0; this.trips = new Map(); this.hurt = new Map();
    this.live = false;
  }
  start() { if (this.live) return; this.live = true; requestAnimationFrame(t => this.frame(t)); }
  stop() { this.live = false; this.state = "idle"; this.floats = []; }
  set(b, me) { this.b = b; this.me = me; }

  play(state) { this.state = state; this.stateAt = performance.now() / 1000; }

  size() {
    const r = this.c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.scale = d; this.W = r.width; this.H = r.height;
  }
  enemyBox() {
    const w = Math.min(this.W * ENEMY_W, this.H * 0.5), h = this.H * ENEMY_H;
    return { x: this.W / 2 - w / 2, y: this.H * ENEMY_Y - h / 2, w, h };
  }
  /* попал ли палец по врагу (с запасом: толстые пальцы) */
  overEnemy(x, y) {
    const e = this.enemyBox(), m = 26;
    return x >= e.x - m && x <= e.x + e.w + m && y >= e.y - m && y <= e.y + e.h + m;
  }

  /* события сервера */
  hit(dmg, combo) {
    this.play("hit");
    const e = this.enemyBox();
    this.floats.push({ text: String(dmg), x: e.x + e.w * (0.3 + Math.random() * 0.4), y: e.y + e.h * 0.4, t: performance.now() / 1000, color: combo ? "#ffd76a" : "#fff" });
  }
  enemyHit(who, dmg) {
    this.play("attack");
    this.hurt.set(who, performance.now() / 1000);
    const p = this.slots().find(s => s.id === who);
    if (p) this.floats.push({ text: "−" + dmg, x: p.x + p.w / 2, y: p.y - 8, t: performance.now() / 1000, color: "#ff6b6b" });
  }
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
    this.drawEnemy(g, now);
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
      g.fillStyle = this.mark.color; g.font = "700 15px system-ui";
      g.globalAlpha = 1 - (now - this.mark.t) / 0.6;
      g.fillText(this.mark.text, W / 2, this.enemyBox().y + this.enemyBox().h + 22);
      g.globalAlpha = 1;
    }
    const hits = this.b.turn.hits;
    if (hits > 0 && this.b.turn.phase === "combo") {
      g.fillStyle = "#ffd76a"; g.font = "700 24px system-ui";
      g.fillText("×" + (hits + 1), W / 2, H - 76);
    }
  }

  /* сюда встанет модель: состояние this.state, прошло t секунд */
  drawEnemy(g, now) {
    const e = this.enemyBox(), t = now - this.stateAt, b = this.b.enemy;
    if (this.state !== "idle" && this.state !== "death" && t > STATE_SEC[this.state]) this.state = "idle";
    let x = e.x, y = e.y + Math.sin(now * 2.2) * 6, a = 1, fill = "#b84a6e";
    if (this.state === "hit") { x += Math.sin(t * 90) * 7 * (1 - t / STATE_SEC.hit); fill = "#fff"; }
    if (this.state === "attack") y += Math.sin(Math.min(1, t / STATE_SEC.attack) * Math.PI) * this.H * 0.26;
    if (this.state === "death") { const k = Math.min(1, t / STATE_SEC.death); y += k * k * this.H * 0.3; a = 1 - k; }
    g.globalAlpha = a; g.fillStyle = fill;
    g.fillRect(x, y, e.w, e.h);
    g.globalAlpha = 1;
    g.fillStyle = "#ece6f5"; g.font = "13px system-ui"; g.textAlign = "center";
    g.fillText(b.name, this.W / 2, e.y - 28);
    const bw = e.w, k = Math.max(0, b.hp / b.maxhp);
    g.fillStyle = "#352c44"; g.fillRect(this.W / 2 - bw / 2, e.y - 20, bw, 6);
    g.fillStyle = k < 0.35 ? "#ff6b6b" : "#ff9ecf"; g.fillRect(this.W / 2 - bw / 2, e.y - 20, bw * k, 6);
  }

  /* нотка крутится над врагом, пока идёт комбо: один оборот на две доли, на сильной ноте вспыхивает */
  drawNote(g, now) {
    const t = this.b.turn;
    if (t.phase !== "combo") return;
    const m = this.music, pos = m.heardStep();
    const beat = pos >= 0 ? pos / 4 : now * 2;
    const e = this.enemyBox(), cx = this.W / 2, cy = e.y - 52;
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
    for (const s of this.slots()) {
      const turn = this.b.turn.who === s.id, hurt = now - (this.hurt.get(s.id) ?? -9) < 0.3, trip = now - (this.trips.get(s.id) ?? -9) < 0.4;
      g.fillStyle = hurt ? "#ff6b6b" : s.id === this.me ? "#8fe8cf" : "#9fd3ff";
      g.fillRect(s.x + (trip ? Math.sin(now * 60) * 4 : 0), s.y - (turn ? 8 : 0), s.w, s.h);
      if (turn) { g.strokeStyle = "#ffd76a"; g.lineWidth = 2; g.strokeRect(s.x - 3, s.y - 11, s.w + 6, s.h + 6); }
      g.fillStyle = "#352c44"; g.fillRect(s.x, s.y + 34, s.w, 4);
      g.fillStyle = s.hp / s.maxhp < 0.3 ? "#ff6b6b" : "#8fe8cf"; g.fillRect(s.x, s.y + 34, s.w * s.hp / s.maxhp, 4);
      g.fillStyle = "#ece6f5"; g.fillText(s.nick.slice(0, 10), s.x + s.w / 2, s.y + 50);
    }
  }
}
