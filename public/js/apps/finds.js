import { el, fmtTime, plural } from "../core/util.js";
import { copyText, notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { openChat } from "./lazy.js";

/* ================= Находки =================
 * Плейлисты по настроениям. Ленту кандидатов готовит домашний воркер (worker/), здесь — только
 * слушать и голосовать: bump — трек в плейлист и пример «нравится», dump — антипример.
 * Плейлист публичный: /finds/<id> открывает его на чтение для всех (голосует только владелец).
 *
 * Плееры YouTube/SoundCloud — iframe с атрибутом credentialless: страница ОС живёт с
 * COEP require-corp (ради mGBA), без него чужие плееры не встраиваются. Firefox его не умеет —
 * там вместо плеера кнопка «открыть на сайте».
 * Весь текст треков пришёл с чужих сайтов — только textContent.
 */

const API = "/api/finds";
// встроить чужой плеер можно, если страница без изоляции (/finds… сервер так и отдаёт)
// или браузер умеет iframe credentialless (Chrome/Edge)
const canEmbed = () => !self.crossOriginIsolated || "credentialless" in HTMLIFrameElement.prototype;

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts, headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Ошибка " + r.status);
  return j;
}

const src = id => id.startsWith("yt:") ? "yt" : "sc";
// enablejsapi / виджет SoundCloud — чтобы плеер присылал postMessage о конце трека (автопереход)
const YT_ORIGIN = "https://www.youtube-nocookie.com", SC_ORIGIN = "https://w.soundcloud.com";
const embedUrl = id => src(id) === "yt"
  ? `${YT_ORIGIN}/embed/${id.slice(3)}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
  : `${SC_ORIGIN}/player/?url=${encodeURIComponent("https://soundcloud.com/" + id.slice(3))}` +
    "&auto_play=true&visual=true&hide_related=true&show_comments=false&show_teaser=false";
const DRAG_TYPE = "application/x-nos-finds-track";
const FILL_NOTE = "Ленты пополняет скрипт, который админ запускает вручную время от времени, — новые треки появляются не сразу.";
const thumbOf = t => t.thumb || (src(t.id) === "yt" ? `https://i.ytimg.com/vi/${t.id.slice(3)}/mqdefault.jpg` : "");
// у трека без метаданных (пример по ссылке) — хоть что-то читаемое из id
const titleOf = t => t.title || (src(t.id) === "yt" ? "YouTube · " + t.id.slice(3) : t.id.slice(3).split("/").pop().replace(/-/g, " "));
const artistOf = t => t.artist || (src(t.id) === "sc" ? t.id.slice(3).split("/")[0] : "");

function ago(sec) {
  if (!sec) return "";
  const d = Math.floor((Date.now() / 1000 - sec) / 86400);
  if (d < 1) return "сегодня";
  if (d < 31) return d + " " + plural(d, "день", "дня", "дней") + " назад";
  const m = Math.floor(d / 30);
  if (m < 12) return m + " " + plural(m, "месяц", "месяца", "месяцев") + " назад";
  const y = Math.floor(d / 365);
  return y + " " + plural(y, "год", "года", "лет") + " назад";
}

class FindsApp {
  constructor(c, w, { pub, tab, play } = {}) {
    this.w = w;
    this.pubId = pub || null;     // открыт по публичной ссылке
    this.startTab = tab === "feed" || tab === "list" ? tab : null;
    this.autoplay = play || null; // после перезагрузки в режим плеера — сразу включить этот трек
    this.me = null; this.max = 6; this.pls = [];
    this.cur = null; this.tab = this.startTab || "feed";
    this.items = [];              // что сейчас в списке (лента или плейлист)
    this.playing = null;          // id трека в плеере
    this.root = el("div", { className: "fd" });
    this.top = el("div", { className: "fd-top" });
    this.bar = el("div", { className: "fd-bar" });
    this.list = el("div", { className: "fd-list" });
    this.player = el("div", { className: "fd-player" });
    this.root.append(this.top, this.bar, el("div", { className: "fd-main" }, this.list, this.player));
    c.append(this.root);
    this.frame = null;            // iframe плеера — от него ждём сообщение «трек закончился»
    this.onMsg = e => this.playerMessage(e);
    addEventListener("message", this.onMsg);
    w.onClose = () => { removeEventListener("message", this.onMsg); clearInterval(this.ytPing); };
    this.renderPlayer(null);
    this.load();
  }

  async load() {
    try {
      const m = await api("/mine");
      this.me = m.user; this.max = m.max; this.pls = m.playlists;
    } catch (e) { notify("⚠ " + e.message); }
    // вид: mine — свои плейлисты, all — каталог всех, pub — чужой плейлист (смотреть и слушать)
    if (this.pubId) {
      const id = this.pubId; this.pubId = null;
      if (this.pls.some(p => p.id === id)) { this.view = "mine"; this.cur = id; this.tab = this.startTab || "list"; }
      else { this.view = "pub"; this.pubView = id; }
    } else if (!this.view) this.view = this.me ? "mine" : "all";
    if (this.view === "mine" && !this.me) this.view = "all";
    if (!this.cur || !this.pls.some(p => p.id === this.cur)) this.cur = this.pls[0]?.id || null;
    this.render();
  }

  pl() { return this.pls.find(p => p.id === this.cur); }

  openPl(id) {
    if (this.pls.some(p => p.id === id)) { this.view = "mine"; this.cur = id; this.tab = "list"; }
    else { this.view = "pub"; this.pubView = id; }
    this.render();
  }

  /* ---------- шапка: свои плейлисты + каталог ---------- */
  renderTop() {
    this.top.replaceChildren();
    for (const p of this.pls) {
      const chip = el("button", { className: "fd-chip" + (this.view === "mine" && p.id === this.cur ? " on" : ""), title: p.descr || p.name },
        el("span", { textContent: p.name }));
      if (p.feed) chip.append(el("b", { className: "fd-badge", textContent: p.feed }));
      chip.onclick = () => { this.view = "mine"; this.cur = p.id; this.render(); };
      chip.oncontextmenu = e => { e.preventDefault(); this.editForm(p); };
      // цель перетаскивания: другой свой плейлист
      const ours = e => this.view === "mine" && p.id !== this.cur && e.dataTransfer.types.includes(DRAG_TYPE);
      chip.ondragover = e => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; chip.classList.add("drop"); };
      chip.ondragleave = () => chip.classList.remove("drop");
      chip.ondrop = e => {
        chip.classList.remove("drop");
        if (!ours(e)) return;
        e.preventDefault();
        this.root.classList.remove("fd-dragging");
        this.moveTo(p, e.dataTransfer.getData(DRAG_TYPE));
      };
      if (this.view === "mine" && p.id !== this.cur) chip.classList.add("target");
      this.top.append(chip);
    }
    if (this.me && this.pls.length < this.max)
      this.top.append(el("button", { className: "fd-chip add", textContent: "＋", title: "Новый плейлист", onclick: () => this.editForm(null) }));
    this.top.append(el("button", { className: "fd-chip" + (this.view !== "mine" ? " on" : ""), textContent: "🌐 Все плейлисты",
      title: "Плейлисты всех пользователей", onclick: () => { this.view = "all"; this.render(); } }));
    this.top.append(el("div", { className: "fd-me" }, this.me ? el("span", { textContent: this.me }) :
      el("span", {},
        el("button", { className: "fd-btn", textContent: "💬 Войти", title: "Аккаунт общий с чатом — нужен, чтобы завести свои плейлисты", onclick: () => openChat() }),
        el("button", { className: "fd-btn", textContent: "↻", title: "Я вошёл — обновить", onclick: () => this.load() }))));
  }

  /* ---------- вкладки и действия ---------- */
  renderBar() {
    const p = this.pl();
    this.bar.replaceChildren();
    this.bar.title = "";
    if (!p) return;
    const tab = (k, text) => el("button", { className: "fd-tab" + (this.tab === k ? " on" : ""), textContent: text,
      onclick: () => { this.tab = k; this.render(); } });
    this.bar.append(
      tab("feed", "Лента" + (p.feed ? ` · ${p.feed}` : "")),
      tab("list", "Плейлист" + (p.bumps ? ` · ${p.bumps}` : "")),
      el("div", { className: "fd-sp" }),
      el("button", { className: "fd-btn", textContent: "🔗 Ссылка", title: "Скопировать публичную ссылку",
        onclick: () => copyText(location.origin + "/finds/" + p.id, "Ссылка на плейлист скопирована") }),
      el("button", { className: "fd-btn", textContent: "✎", title: "Название, описание, примеры", onclick: () => this.editForm(p) }),
    );
  }

  async render() {
    this.renderTop();
    if (this.view === "all") return this.showAll();
    if (this.view === "pub") return this.showPublic();
    this.w.setTitle("Находки");
    this.renderBar();
    const p = this.pl();
    if (!p) return this.empty("У тебя пока нет плейлистов. Создай первый — например, «riddim dubstep» или «melancholic electro». " + FILL_NOTE,
      el("button", { className: "fd-btn primary", textContent: "＋ Новый плейлист", onclick: () => this.editForm(null) }));
    this.list.replaceChildren(el("div", { className: "fd-dim fd-pad", textContent: "Загрузка…" }));
    this.updated = 0;
    try {
      if (this.tab === "feed") {
        const r = await api("/feed/" + p.id);
        this.items = r.tracks; this.updated = r.updated || 0;
        if (!this.items.length) return this.empty("Лента пуста. Её пополняет скрипт, который админ запускает вручную время от времени, — " +
          "свежие треки появятся после следующего запуска." +
          (p.examples.length ? "" : " Добавь пару ссылок-примеров (✎) — с ними подборка точнее."));
      } else {
        this.items = (await api("/pub/" + p.id)).tracks;
      }
    } catch (e) { return this.empty("⚠ " + e.message); }
    this.renderList(this.tab === "list" ? p.examples : []);
    this.playStart();
  }

  /* ---------- каталог: плейлисты всех пользователей, без входа ---------- */
  async showAll() {
    this.w.setTitle("Находки");
    this.bar.replaceChildren(el("span", { className: "fd-dim", textContent: "Плейлисты всех пользователей — открой и слушай" }));
    this.list.replaceChildren(el("div", { className: "fd-dim fd-pad", textContent: "Загрузка…" }));
    let pls;
    try { pls = (await api("/all")).playlists; }
    catch (e) { return this.empty("⚠ " + e.message); }
    if (!pls.length) return this.empty("Пока никто не завёл плейлист." + (this.me ? "" : " Войди, чтобы завести свой."));
    this.items = [];
    this.list.replaceChildren();
    for (const p of pls) {
      const row = el("button", { className: "fd-plrow" },
        el("div", { className: "fd-title", textContent: p.name }),
        el("div", { className: "fd-artist-name", textContent: [p.owner, `${p.tracks} ${plural(p.tracks, "трек", "трека", "треков")}`].filter(Boolean).join(" · ") }));
      if (p.descr) row.append(el("div", { className: "fd-meta", textContent: p.descr }));
      row.onclick = () => this.openPl(p.id);
      this.list.append(row);
    }
    this.list.append(el("p", { className: "fd-dim fd-note", textContent: FILL_NOTE }));
  }

  // трек из ?play= после перезагрузки в режим плеера
  playStart() {
    const id = this.autoplay; this.autoplay = null;
    if (id && /^(yt:[A-Za-z0-9_-]{11}|sc:[a-z0-9_-]{1,64}\/[a-z0-9_-]{1,160})$/.test(id))
      this.play(this.items.find(x => x.id === id) || { id });
  }

  empty(text, ...btns) {
    this.items = [];
    this.list.replaceChildren(el("div", { className: "fd-empty" }, el("p", { textContent: text }), ...btns));
  }

  renderList(examples = []) {
    this.list.replaceChildren();
    if (this.tab === "feed" && this.items.length)
      this.list.append(el("div", { className: "fd-hint", textContent:
        (this.updated ? "Лента обновлена " + ago(this.updated) + " · " : "") + "пополняет админ вручную, время от времени" }));
    if (this.tab === "list" && !this.items.length)
      this.list.append(el("p", { className: "fd-dim fd-pad", textContent: "Здесь будут треки, которым ты поставил bump." }));
    for (const t of this.items) this.list.append(this.card(t));
    if (examples.length) {
      this.list.append(el("div", { className: "fd-sep", textContent: "Примеры (подсказки для воркера)" }));
      for (const x of examples) if (!x.id.startsWith("scu:")) this.list.append(this.card({ id: x.id }, { example: true }));
      for (const x of examples) if (x.id.startsWith("scu:"))
        this.list.append(el("div", { className: "fd-artist-row" },
          el("a", { className: "fd-artist", href: x.url, target: "_blank", rel: "noopener noreferrer", textContent: "☁ артист: " + x.id.slice(4) }),
          el("button", { className: "fd-vote", textContent: "✕", title: "Убрать из примеров", onclick: () => this.dropExample(x.id) })));
    }
  }

  async dropExample(id) {
    const p = this.pl(); if (!p) return;
    const examples = p.examples.filter(x => x.id !== id).map(x => x.url);
    try {
      const r = await api("/pl/" + p.id, { method: "PATCH", body: { examples } });
      Object.assign(p, r.playlist);
      notify("Пример убран");
    } catch (e) { return notify("⚠ " + e.message); }
    this.render();
  }

  /* ---------- карточка трека ---------- */
  card(t, { example = false, readonly = false } = {}) {
    const node = el("div", { className: "fd-card" + (t.id === this.playing ? " playing" : "") });
    node.dataset.id = t.id;
    const th = el("div", { className: "fd-thumb " + src(t.id) });
    const u = thumbOf(t);
    if (u) {
      const img = el("img", { crossOrigin: "anonymous", loading: "lazy", alt: "", src: u });
      img.onerror = () => img.remove();   // чужая картинка не пролезла (COEP) — остаётся значок
      th.append(img);
    }
    th.append(el("span", { className: "fd-play", textContent: "▶" }));
    const meta = [src(t.id) === "yt" ? "YouTube" : "SoundCloud"];
    if (t.duration) meta.push(fmtTime(t.duration));
    if (t.published) meta.push(ago(t.published));
    const info = el("div", { className: "fd-info" },
      el("div", { className: "fd-title", textContent: titleOf(t) }),
      el("div", { className: "fd-artist-name", textContent: artistOf(t) }),
      el("div", { className: "fd-meta", textContent: meta.join(" · ") }));
    if (t.why) info.append(el("div", { className: "fd-why", textContent: t.why }));
    node.append(th, info);
    if (!readonly) {
      const acts = el("div", { className: "fd-acts" });
      if (this.tab === "feed" || example) {
        acts.append(
          el("button", { className: "fd-vote bump", textContent: "▲ bump", title: "В плейлист и как пример «нравится»", onclick: e => { e.stopPropagation(); this.vote(t, 1); } }),
          el("button", { className: "fd-vote dump", textContent: "▼ dump", title: "Не то — антипример", onclick: e => { e.stopPropagation(); this.vote(t, -1); } }));
        if (example) acts.append(el("button", { className: "fd-vote", textContent: "✕", title: "Убрать из примеров",
          onclick: e => { e.stopPropagation(); this.dropExample(t.id); } }));
      } else {
        acts.append(
          el("button", { className: "fd-vote dump", textContent: "▼", title: "Перенести в dump (антипример)", onclick: e => { e.stopPropagation(); this.vote(t, -1); } }),
          el("button", { className: "fd-vote", textContent: "✕", title: "Убрать из плейлиста без оценки", onclick: e => { e.stopPropagation(); this.vote(t, 0); } }));
      }
      node.append(acts);
    }
    node.onclick = () => this.play(t);
    // свой трек из ленты или плейлиста можно утащить на чип другого своего плейлиста
    if (!readonly && !example && this.view === "mine" && this.pls.length > 1) {
      node.setAttribute("draggable", "true");   // main.js пускает «родное» перетаскивание только с draggable="true"
      node.title = "Перетащи на другой плейлист сверху, чтобы перенести";
      node.ondragstart = e => {
        e.dataTransfer.setData(DRAG_TYPE, t.id);
        e.dataTransfer.setData("text/plain", t.url || "");
        e.dataTransfer.effectAllowed = "move";
        this.root.classList.add("fd-dragging");
      };
      node.ondragend = () => this.root.classList.remove("fd-dragging");
    }
    return node;
  }

  async moveTo(dst, tid) {
    const p = this.pl();
    if (!p || p.id === dst.id) return;
    try { await api("/move", { method: "POST", body: { from: p.id, to: dst.id, track: tid } }); }
    catch (e) { return notify("⚠ " + e.message); }
    const i = this.items.findIndex(x => x.id === tid);
    const t = this.items[i];
    dst.bumps++;
    if (i >= 0) {
      if (this.tab === "feed" && !t.voted) p.feed = Math.max(0, p.feed - 1);
      if (this.tab === "list" || t.voted) p.bumps = Math.max(0, p.bumps - 1);
      this.items.splice(i, 1);
      [...this.list.querySelectorAll(".fd-card")].find(n => n.dataset.id === tid)?.remove();
    }
    notify(`→ перенесено в «${dst.name}»`);    // плеер не трогаем: перенесённый трек доигрывает
    this.renderTop(); this.renderBar();
  }

  /* ---------- плеер ---------- */
  play(t) {
    this.playing = t.id;
    this.playPos = Math.max(0, this.items.findIndex(x => x.id === t.id));
    for (const n of this.list.querySelectorAll(".fd-card")) n.classList.toggle("playing", n.dataset.id === t.id);
    this.renderPlayer(t);
  }

  /* сообщения от плеера: конец трека -> следующий. YouTube шлёт onStateChange/infoDelivery (0 = ended),
   * виджет SoundCloud — ready, затем finish (подписываемся после ready). Чужие окна игнорируем. */
  playerMessage(e) {
    const f = this.frame;
    if (!f || e.source !== f.contentWindow) return;
    let d = e.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
    if (!d || typeof d !== "object") return;
    if (e.origin === YT_ORIGIN) {
      clearInterval(this.ytPing);                       // плеер ответил — можно не стучаться
      const st = d.event === "onStateChange" ? d.info : d.event === "infoDelivery" ? d.info?.playerState : undefined;
      if (st === 0) this.ended(f);
    } else if (e.origin === SC_ORIGIN) {
      if (d.method === "ready") f.contentWindow.postMessage(JSON.stringify({ method: "addEventListener", value: "finish" }), SC_ORIGIN);
      else if (d.method === "finish") this.ended(f);
    }
  }

  ended(f) {
    if (f.dataset.done) return;                         // YouTube может сообщить дважды
    f.dataset.done = "1";
    const i = this.items.findIndex(x => x.id === this.playing);
    // трек могли перенести в другой плейлист, пока играл, — тогда следующий стоит на его бывшем месте
    const from = i >= 0 ? i + 1 : this.playPos ?? this.items.length;
    const skip = x => this.tab === "feed" && this.view === "mine" && x.voted;   // в ленте оценённые уже слышали
    const next = this.items.slice(from).find(x => !skip(x));
    if (next) this.play(next);
  }

  renderPlayer(t) {
    this.player.replaceChildren();
    clearInterval(this.ytPing);
    this.frame = null;
    if (!t) {
      this.player.append(el("div", { className: "fd-dim fd-pad", textContent: "Нажми на трек, чтобы послушать." }));
      return;
    }
    const url = t.url || (src(t.id) === "yt" ? "https://www.youtube.com/watch?v=" + t.id.slice(3) : "https://soundcloud.com/" + t.id.slice(3));
    const box = el("div", { className: "fd-embed " + src(t.id) });
    if (canEmbed()) {
      const f = el("iframe", { src: embedUrl(t.id), allow: "autoplay; encrypted-media; picture-in-picture", referrerPolicy: "strict-origin-when-cross-origin" });
      f.setAttribute("credentialless", "");
      f.setAttribute("allowfullscreen", "");
      box.append(f);
      this.frame = f;
      if (src(t.id) === "yt") {
        // YouTube начинает слать события, когда страница «подписалась»; стучимся, пока не ответит (до 15 с)
        const hello = () => {
          try {
            f.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN);
            f.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "addEventListener", args: ["onStateChange"], id: 1, channel: "widget" }), YT_ORIGIN);
          } catch {}
        };
        let n = 0;
        f.onload = () => { hello(); this.ytPing = setInterval(() => { if (++n > 15) clearInterval(this.ytPing); else hello(); }, 1000); };
      }
    } else {
      // Firefox: страница ОС изолирована ради GBA — перезагружаемся в /finds/…, там изоляции нет
      const q = new URLSearchParams({ tab: this.tab, play: t.id });
      const go = "/finds/" + ((this.view === "pub" ? this.pubView : this.view === "mine" ? this.cur : "") || "") + "?" + q;
      box.append(el("div", { className: "fd-noembed" },
        el("p", { textContent: "Плеер в этой вкладке не встроится: главная страница ОС защищена ради эмулятора GBA. " +
          "Режим плеера перезагрузит вкладку и откроет «Находки» на этом треке (GBA в нём не запустится)." }),
        el("button", { className: "fd-btn primary", textContent: "▶ Включить плеер", onclick: () => { location.href = go; } })));
    }
    this.player.append(box,
      el("div", { className: "fd-title", textContent: titleOf(t) }),
      el("div", { className: "fd-artist-name", textContent: artistOf(t) }),
      el("a", { className: "fd-btn", href: url, target: "_blank", rel: "noopener noreferrer",
        textContent: src(t.id) === "yt" ? "Открыть на YouTube ↗" : "Открыть на SoundCloud ↗" }));
  }

  /* ---------- голос ---------- */
  async vote(t, v) {
    const p = this.pl(); if (!p) return;
    try { await api("/vote", { method: "POST", body: { pl: p.id, track: t.id, v } }); }
    catch (e) { return notify("⚠ " + e.message); }
    const was = this.items.findIndex(x => x.id === t.id);
    const inList = was >= 0;
    if (this.tab === "feed" && inList) p.feed = Math.max(0, p.feed - 1);
    if (v === 1 && (this.tab === "feed" || !inList)) p.bumps++;
    if (v !== 1 && this.tab === "list" && inList) p.bumps = Math.max(0, p.bumps - 1);
    notify(v === 1 ? "▲ bump — в плейлисте" : v === -1 ? "▼ dump — учту" : "Убрано");
    const node = [...this.list.querySelectorAll(".fd-card")].find(n => n.dataset.id === t.id);
    if (inList && this.tab === "feed" && v === 1) {
      // bump в ленте: карточка остаётся отмеченной, плеер не трогаем — трек играет дальше
      t.voted = true;
      node?.classList.add("voted");
      node?.querySelector(".fd-acts")?.replaceChildren(el("span", { className: "fd-done", textContent: "✓ в плейлисте" }));
    } else if (inList) {
      this.items.splice(was, 1);
      node?.remove();
      // dump того, что играет, — сразу следующий неоценённый
      if (this.playing === t.id && this.tab === "feed") {
        const next = this.items.slice(was).find(x => !x.voted) || this.items.slice(0, was).reverse().find(x => !x.voted);
        next ? this.play(next) : (this.playing = null, this.renderPlayer(null));
      }
      if (!this.items.length && this.tab === "feed") this.render();
    } else if (this.tab === "list") return this.render();   // оценили пример — перерисовать плейлист
    this.renderTop(); this.renderBar();
  }

  /* ---------- создание/правка плейлиста ---------- */
  editForm(p) {
    if (!this.me) return;
    const name = el("input", { className: "fd-in", maxLength: 40, value: p?.name || "", placeholder: "Название (например, riddim dubstep)" });
    const descr = el("textarea", { className: "fd-in", maxLength: 200, rows: 2, value: p?.descr || "",
      placeholder: "Описание звука своими словами — по нему воркер ищет похожее (необязательно)" });
    const ex = el("textarea", { className: "fd-in mono", rows: 6, value: (p?.examples || []).map(x => x.url).join("\n"),
      placeholder: "Ссылки-примеры YouTube / SoundCloud, по одной в строке (до 20). Можно ссылку на артиста SoundCloud." });
    const close = () => ov.remove();
    const save = async () => {
      const body = { name: name.value, descr: descr.value, examples: ex.value.split(/\s+/).filter(Boolean) };
      try {
        const r = p ? await api("/pl/" + p.id, { method: "PATCH", body }) : await api("/pl", { method: "POST", body });
        if (r.skipped) notify(`Пропущено ссылок не с YouTube/SoundCloud: ${r.skipped}`, 2600);
        this.cur = r.playlist.id; close(); this.load();
      } catch (e) { notify("⚠ " + e.message); }
    };
    const del = async () => {
      if (!confirm(`Удалить плейлист «${p.name}» со всеми оценками?`)) return;
      try { await api("/pl/" + p.id, { method: "DELETE" }); this.cur = null; close(); this.load(); }
      catch (e) { notify("⚠ " + e.message); }
    };
    const ov = el("div", { className: "fd-overlay" },
      el("div", { className: "fd-form glass" },
        el("h3", { textContent: p ? "Плейлист" : "Новый плейлист" }),
        name, descr, ex,
        el("p", { className: "fd-dim fd-note", textContent: "Плейлист виден всем по ссылке и в каталоге. " + FILL_NOTE }),
        el("div", { className: "fd-row" },
          p ? el("button", { className: "fd-btn danger", textContent: "Удалить", onclick: del }) : "",
          el("div", { className: "fd-sp" }),
          el("button", { className: "fd-btn", textContent: "Отмена", onclick: close }),
          el("button", { className: "fd-btn primary", textContent: "Сохранить", onclick: save }))));
    ov.onclick = e => { if (e.target === ov) close(); };
    this.root.append(ov);
    name.focus();
  }

  /* ---------- чужой плейлист: смотреть и слушать ---------- */
  async showPublic() {
    this.bar.replaceChildren();
    this.list.replaceChildren(el("div", { className: "fd-dim fd-pad", textContent: "Загрузка…" }));
    let d;
    try { d = await api("/pub/" + this.pubView); }
    catch (e) { return this.empty("⚠ " + e.message); }
    if (d.mine && this.pls.some(p => p.id === d.id)) return this.openPl(d.id);   // свой — с кнопками
    this.w.setTitle("Находки — " + d.name);
    this.bar.replaceChildren(
      el("button", { className: "fd-btn", textContent: "← Все", onclick: () => { this.view = "all"; this.render(); } }),
      el("div", { className: "fd-pubhead" },
        el("b", { textContent: d.name }),
        el("span", { className: "fd-dim", textContent: (d.owner ? " — " + d.owner : "") +
          ` · ${d.tracks.length} ${plural(d.tracks.length, "трек", "трека", "треков")}` })),
      el("div", { className: "fd-sp" }),
      el("button", { className: "fd-btn", textContent: "🔗 Ссылка", onclick: () => copyText(location.origin + "/finds/" + d.id, "Ссылка скопирована") }));
    this.bar.title = d.descr || "";
    this.items = d.tracks;
    this.list.replaceChildren();
    if (!d.tracks.length) this.list.append(el("p", { className: "fd-dim fd-pad", textContent: "Тут пока пусто." }));
    for (const t of d.tracks) this.list.append(this.card(t, { readonly: true }));
    this.playStart();
  }
}

// pub — id публичного плейлиста; tab, play — из адреса /finds/<id>?tab=&play= (возврат в режим плеера)
export function openFinds({ pub, tab, play } = {}) {
  return WM.open({ title: "Находки", icon: "🎧", width: 940, height: 620, key: pub ? "finds:" + pub : "finds",
    render(c, w) { new FindsApp(c, w, { pub, tab, play }); } });
}
