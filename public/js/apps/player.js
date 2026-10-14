import { ID3 } from "./id3.js";
import { kindOf } from "../core/types.js";
import { baseName, el, fmtCount, fmtTime, fsUrl, joinPath, parentOf, plural, store } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= mp3-плеер ================= */
const ICONS = {
  play: '<svg class="ic-fill" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  prev: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="5" y="5" width="2.5" height="14" rx="1"/><path d="M19 6v12a1 1 0 0 1-1.5.86L9 13.2a1.4 1.4 0 0 1 0-2.4l8.5-5.66A1 1 0 0 1 19 6z"/></svg>',
  next: '<svg class="ic-fill" viewBox="0 0 24 24"><rect x="16.5" y="5" width="2.5" height="14" rx="1"/><path d="M5 6v12a1 1 0 0 0 1.5.86L15 13.2a1.4 1.4 0 0 0 0-2.4L6.5 5.14A1 1 0 0 0 5 6z"/></svg>',
  shuffle: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M3 7h3c4 0 6 10 10 10h5M3 17h3c1.6 0 2.8-1.6 3.9-3.5M14.1 9.5C15.2 7.6 16.4 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  repeat: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 11V9a3 3 0 0 1 3-3h13M17 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H4M7 21l-3-3 3-3"/></svg>',
  vol: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg class="ic-stroke" viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>',
};

const Player = {
  audio: new Audio(),
  list: [], idx: -1,
  win: null, ui: null,
  shuffle: store.get("pl.shuffle", false),
  repeat: store.get("pl.repeat", "all"), // off | all | one
  ctx: null, analyser: null, raf: 0,
  seeking: false,
  plays: new Map(),   // путь -> число прослушиваний (с сервера)
  session: null,      // текущее прослушивание: { path, heard, last, sent }

  init() {
    const a = this.audio;
    a.preload = "metadata";
    a.volume = store.get("pl.volume", 0.8);
    a.addEventListener("play", () => this.syncPlay());
    a.addEventListener("pause", () => this.syncPlay());
    a.addEventListener("timeupdate", () => { this.syncTime(); this.trackListen(); });
    a.addEventListener("seeked", () => { if (this.session) this.session.last = a.currentTime; });
    a.addEventListener("loadedmetadata", () => this.syncTime());
    a.addEventListener("ended", () => this.next(true));
    a.addEventListener("volumechange", () => { this.syncVol(); store.set("pl.volume", a.volume); });

    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => a.play());
      ms.setActionHandler("pause", () => a.pause());
      ms.setActionHandler("previoustrack", () => this.prev());
      ms.setActionHandler("nexttrack", () => this.next());
      try { ms.setActionHandler("seekto", d => { a.currentTime = d.seekTime; }); } catch {}
    }

    document.addEventListener("keydown", e => {
      if (!this.win || WM.topmost() !== this.win || e.target.closest("textarea, input[type=text]")) return;
      if (e.code === "Space") { e.preventDefault(); this.toggle(); }
      else if (e.code === "ArrowRight" && !e.target.closest("input")) a.currentTime = Math.min(a.duration || 0, a.currentTime + 5);
      else if (e.code === "ArrowLeft" && !e.target.closest("input")) a.currentTime = Math.max(0, a.currentTime - 5);
    });
  },

  // открыть плеер на треке: плейлист = все аудиофайлы той же папки
  async open(path) {
    const dir = parentOf(path);
    let list = [path];
    try {
      const r = await fetch("/api/ls?path=" + encodeURIComponent(dir));
      const d = await r.json();
      const audio = d.entries.filter(e => e.type === "file" && kindOf(e.name) === "audio");
      for (const e of audio) if (e.plays !== undefined) this.plays.set(joinPath(dir, e.name), e.plays);
      const found = audio.map(e => joinPath(dir, e.name));
      if (found.length) list = found;
    } catch {}
    this.list = list;
    if (this.win) WM.restore(this.win);
    else this.win = WM.open({ title: "Плеер", icon: "🎧", width: 420, height: 640, key: "player", render: (c, w) => this.build(c, w) });
    this.renderList();
    this.play(Math.max(0, list.indexOf(path)));
  },

  build(c, w) {
    c.innerHTML = `
      <div class="player paused">
        <div class="pl-art"><div class="pl-bg"></div><canvas class="pl-viz"></canvas><div class="pl-cover">💿</div></div>
        <div class="pl-meta"><div class="pl-title">—</div><div class="pl-artist"></div></div>
        <div class="pl-seek"><span class="pl-cur">0:00</span><input type="range" class="pl-bar" min="0" max="1000" value="0" aria-label="Позиция"><span class="pl-dur">0:00</span></div>
        <div class="pl-ctrl">
          <button class="toggle pl-shuffle" title="Перемешать">${ICONS.shuffle}</button>
          <button class="pl-prev" title="Предыдущий">${ICONS.prev}</button>
          <button class="big pl-play" title="Играть / пауза (пробел)">${ICONS.play}</button>
          <button class="pl-next" title="Следующий">${ICONS.next}</button>
          <button class="toggle pl-repeat" title="Повтор">${ICONS.repeat}</button>
        </div>
        <div class="pl-vol"><button class="pl-mute" title="Звук">${ICONS.vol}</button><input type="range" class="pl-volbar" min="0" max="1" step="0.01" aria-label="Громкость"></div>
        <div class="pl-list"></div>
      </div>`;
    const q = s => c.querySelector(s);
    const ui = this.ui = {
      root: q(".player"), bg: q(".pl-bg"), viz: q(".pl-viz"), cover: q(".pl-cover"),
      title: q(".pl-title"), artist: q(".pl-artist"),
      cur: q(".pl-cur"), dur: q(".pl-dur"), bar: q(".pl-bar"),
      play: q(".pl-play"), shuffle: q(".pl-shuffle"), repeat: q(".pl-repeat"),
      mute: q(".pl-mute"), vol: q(".pl-volbar"), list: q(".pl-list"),
    };
    const a = this.audio;
    ui.play.onclick = () => this.toggle();
    q(".pl-prev").onclick = () => this.prev();
    q(".pl-next").onclick = () => this.next();
    ui.shuffle.onclick = () => { this.shuffle = !this.shuffle; store.set("pl.shuffle", this.shuffle); this.syncModes(); };
    ui.repeat.onclick = () => {
      this.repeat = { off: "all", all: "one", one: "off" }[this.repeat];
      store.set("pl.repeat", this.repeat); this.syncModes();
    };
    ui.bar.addEventListener("input", () => {
      this.seeking = true;
      ui.cur.textContent = fmtTime(ui.bar.value / 1000 * (a.duration || 0));
      ui.bar.style.setProperty("--p", ui.bar.value / 10 + "%");
    });
    ui.bar.addEventListener("change", () => {
      if (a.duration) a.currentTime = ui.bar.value / 1000 * a.duration;
      this.seeking = false;
    });
    ui.vol.addEventListener("input", () => { a.volume = +ui.vol.value; a.muted = false; });
    ui.mute.onclick = () => { a.muted = !a.muted; };

    new ResizeObserver(() => {
      const dpr = devicePixelRatio || 1;
      ui.viz.width = ui.viz.clientWidth * dpr;
      ui.viz.height = ui.viz.clientHeight * dpr;
    }).observe(ui.viz);

    w.onClose = () => { a.pause(); this.stopViz(); this.win = null; this.ui = null; };
    this.syncModes(); this.syncVol(); this.syncPlay();
  },

  async renderList() {
    const ui = this.ui; if (!ui) return;
    const list = this.list;
    ui.list.replaceChildren(...list.map((p, i) => {
      const item = el("div", { className: "pl-item" });
      item.innerHTML = `<span class="n"><span class="num">${i + 1}</span><span class="eq"><i></i><i></i><i></i></span></span>
        <span class="t"><b></b><small></small></span><span class="pc"></span>`;
      item.querySelector("b").textContent = baseName(p).replace(/\.[^.]+$/, "");
      item.dataset.path = p;
      item.onclick = () => this.play(i);
      return item;
    }));
    list.forEach(p => this.showPlays(p));
    this.highlight();
    // подтягиваем теги по очереди, чтобы не долбить сервер
    for (let i = 0; i < list.length; i++) {
      const m = await ID3.get(list[i]);
      if (this.list !== list || !this.ui) return;
      const it = ui.list.children[i];
      it.querySelector("b").textContent = m.title;
      it.querySelector("small").textContent = m.artist || "";
    }
  },

  /* ---------- прослушивания ----------
   * Засчитываем, когда трек реально прослушан 30 с (или половину, если он короче минуты).
   * Перемотка вперёд в счёт не идёт: копим только время, которое прошло при обычном воспроизведении.
   * Сервер дополнительно не даёт накрутить: один трек с одного адреса — раз в 30 минут.
   */
  showPlays(path) {
    const it = this.ui && [...this.ui.list.children].find(x => x.dataset.path === path);
    if (!it) return;
    const n = this.plays.get(path), pc = it.querySelector(".pc");
    pc.textContent = n === undefined ? "" : "▶ " + fmtCount(n);
    pc.title = n === undefined ? "" : `${n.toLocaleString("ru-RU")} ${plural(n, "прослушивание", "прослушивания", "прослушиваний")}`;
  },
  trackListen() {
    const s = this.session, a = this.audio;
    if (!s || s.sent || a.paused || this.seeking) return;
    const t = a.currentTime, dt = t - s.last;
    s.last = t;
    if (dt > 0 && dt < 1.5) s.heard += dt; // скачок больше 1.5 с — это перемотка, не считаем
    const need = a.duration ? Math.max(2, Math.min(30, a.duration / 2)) : 30;
    if (s.heard >= need) { s.sent = true; this.reportListen(s.path); }
  },
  async reportListen(path) {
    try {
      const r = await fetch("/api/listen?path=" + encodeURIComponent(path), { method: "POST", keepalive: true });
      if (!r.ok) return;
      const d = await r.json();
      this.plays.set(path, d.plays);
      this.showPlays(path);
    } catch (e) { console.warn("listen:", e); }
  },

  highlight() {
    if (!this.ui) return;
    [...this.ui.list.children].forEach((it, i) => it.classList.toggle("active", i === this.idx));
    this.ui.list.children[this.idx]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  },

  initGraph() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
      src.connect(this.analyser).connect(this.ctx.destination);
    } catch (e) { console.warn("WebAudio:", e); }
  },

  async play(i) {
    if (i < 0 || i >= this.list.length) return;
    this.idx = i;
    const path = this.list[i];
    this.session = { path, heard: 0, last: 0, sent: false };
    this.audio.src = fsUrl(path);
    this.initGraph();
    this.audio.play().catch(() => {});
    this.highlight();

    const m = await ID3.get(path);
    if (this.list[this.idx] !== path) return; // уже переключили
    if (this.ui) {
      this.ui.title.textContent = m.title;
      this.ui.artist.textContent = [m.artist, m.album].filter(Boolean).join(" · ");
      this.ui.cover.replaceChildren(m.cover ? el("img", { src: m.cover, alt: "" }) : "💿");
      this.ui.bg.style.backgroundImage = m.cover ? `url("${m.cover}")` : "";
    }
    this.win?.setTitle(m.title);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: m.title, artist: m.artist || "", album: m.album || "",
        artwork: m.cover ? [{ src: m.cover }] : [],
      });
    }
  },

  toggle() {
    if (this.idx < 0) return this.list.length && this.play(0);
    this.initGraph();
    this.audio.paused ? this.audio.play() : this.audio.pause();
  },

  next(auto = false) {
    const n = this.list.length; if (!n) return;
    if (auto && this.repeat === "one") {
      this.session = { path: this.list[this.idx], heard: 0, last: 0, sent: false }; // новый круг — новое прослушивание
      this.audio.currentTime = 0; this.audio.play(); return;
    }
    let i;
    if (this.shuffle && n > 1) { do i = Math.floor(Math.random() * n); while (i === this.idx); }
    else i = this.idx + 1;
    if (i >= n) {
      if (auto && this.repeat === "off") return;
      i = 0;
    }
    this.play(i);
  },

  prev() {
    const n = this.list.length; if (!n) return;
    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; }
    this.play((this.idx - 1 + n) % n);
  },

  syncPlay() {
    const playing = !this.audio.paused;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (!this.ui) return;
    this.ui.root.classList.toggle("paused", !playing);
    this.ui.play.innerHTML = playing ? ICONS.pause : ICONS.play;
    playing ? this.startViz() : this.stopViz();
  },
  syncTime() {
    const ui = this.ui; if (!ui || this.seeking) return;
    const a = this.audio, p = a.duration ? a.currentTime / a.duration : 0;
    ui.bar.value = p * 1000;
    ui.bar.style.setProperty("--p", p * 100 + "%");
    ui.cur.textContent = fmtTime(a.currentTime);
    ui.dur.textContent = fmtTime(a.duration);
  },
  syncVol() {
    const ui = this.ui; if (!ui) return;
    const v = this.audio.muted ? 0 : this.audio.volume;
    ui.vol.value = v;
    ui.vol.style.setProperty("--p", v * 100 + "%");
    ui.mute.innerHTML = v === 0 ? ICONS.mute : ICONS.vol;
  },
  syncModes() {
    const ui = this.ui; if (!ui) return;
    ui.shuffle.classList.toggle("on", this.shuffle);
    ui.repeat.classList.toggle("on", this.repeat !== "off");
    ui.repeat.classList.toggle("one", this.repeat === "one");
    ui.repeat.title = { off: "Повтор: выкл", all: "Повтор: весь плейлист", one: "Повтор: один трек" }[this.repeat];
  },

  /* визуализатор спектра */
  startViz() {
    if (this.raf || !this.analyser || !this.ui) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      if (!this.ui || this.win?.minimized) return;
      const cv = this.ui.viz, g = cv.getContext("2d"), W = cv.width, H = cv.height;
      this.analyser.getByteFrequencyData(data);
      g.clearRect(0, 0, W, H);
      const bars = 36, gap = W * 0.006, bw = (W - gap * (bars - 1)) / bars;
      const grad = g.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0, "rgba(138,180,255,0.9)");
      grad.addColorStop(1, "rgba(190,140,255,0.35)");
      g.fillStyle = grad;
      const usable = Math.floor(data.length * 0.72);
      for (let i = 0; i < bars; i++) {
        // логарифмическая шкала — басы не занимают пол-экрана
        const a = Math.floor(Math.pow(i / bars, 1.6) * usable), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * usable));
        let v = 0; for (let k = a; k < b; k++) v = Math.max(v, data[k]);
        const h = Math.max(H * 0.015, (v / 255) ** 1.4 * H * 0.85);
        const x = i * (bw + gap);
        g.beginPath();
        g.roundRect ? g.roundRect(x, H - h, bw, h, Math.min(bw / 2, 6)) : g.rect(x, H - h, bw, h);
        g.fill();
      }
    };
    draw();
  },
  stopViz() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const cv = this.ui?.viz;
    if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  },
};

/* запуск — вызывается из main.js */
export function init_apps_player() {
  Player.init();
}

export { Player };
