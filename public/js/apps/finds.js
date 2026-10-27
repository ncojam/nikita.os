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
const embedUrl = id => src(id) === "yt"
  ? `https://www.youtube-nocookie.com/embed/${id.slice(3)}?autoplay=1&rel=0`
  : `https://w.soundcloud.com/player/?url=${encodeURIComponent("https://soundcloud.com/" + id.slice(3))}` +
    "&auto_play=true&visual=true&hide_related=true&show_comments=false&show_teaser=false";
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
    this.renderPlayer(null);
    this.load();
  }

  async load() {
    try {
      const m = await api("/mine");
      this.me = m.user; this.max = m.max; this.pls = m.playlists;
    } catch (e) { notify("⚠ " + e.message); }
    if (this.pubId && !this.pls.some(p => p.id === this.pubId)) return this.showPublic();
    if (this.pubId) { this.cur = this.pubId; this.tab = this.startTab || "list"; this.pubId = null; }
    if (!this.cur || !this.pls.some(p => p.id === this.cur)) this.cur = this.pls[0]?.id || null;
    this.render();
  }

  pl() { return this.pls.find(p => p.id === this.cur); }

  /* ---------- шапка: плейлисты ---------- */
  renderTop() {
    this.top.replaceChildren();
    for (const p of this.pls) {
      const chip = el("button", { className: "fd-chip" + (p.id === this.cur ? " on" : ""), title: p.descr || p.name },
        el("span", { textContent: p.name }));
      if (p.feed) chip.append(el("b", { className: "fd-badge", textContent: p.feed }));
      chip.onclick = () => { this.cur = p.id; this.render(); };
      chip.oncontextmenu = e => { e.preventDefault(); this.editForm(p); };
      this.top.append(chip);
    }
    if (this.me && this.pls.length < this.max)
      this.top.append(el("button", { className: "fd-chip add", textContent: "＋", title: "Новый плейлист", onclick: () => this.editForm(null) }));
    this.top.append(el("div", { className: "fd-me" },
      this.me ? el("span", { textContent: this.me }) : el("span", { className: "fd-dim", textContent: "не вошёл" })));
  }

  /* ---------- вкладки и действия ---------- */
  renderBar() {
    const p = this.pl();
    this.bar.replaceChildren();
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
    this.renderTop(); this.renderBar();
    const p = this.pl();
    if (!this.me) return this.empty("Войди в аккаунт, чтобы завести плейлисты (до 6). Аккаунт общий с чатом.",
      el("button", { className: "fd-btn primary", textContent: "💬 Войти через чат", onclick: () => openChat() }),
      el("button", { className: "fd-btn", textContent: "Я вошёл — обновить", onclick: () => this.load() }));
    if (!p) return this.empty("Плейлистов пока нет. Создай первый — например, «riddim dubstep» или «melancholic electro».",
      el("button", { className: "fd-btn primary", textContent: "＋ Новый плейлист", onclick: () => this.editForm(null) }));
    this.list.replaceChildren(el("div", { className: "fd-dim fd-pad", textContent: "Загрузка…" }));
    try {
      if (this.tab === "feed") {
        this.items = (await api("/feed/" + p.id)).tracks;
        if (!this.items.length) return this.empty("Лента пуста. Её наполняет воркер — после прогона тут появится до 20 свежих треков." +
          (p.examples.length ? "" : " Добавь пару ссылок-примеров (✎) — с ними первый прогон точнее."));
      } else {
        this.items = (await api("/pub/" + p.id)).tracks;
      }
    } catch (e) { return this.empty("⚠ " + e.message); }
    this.renderList(this.tab === "list" ? p.examples : []);
    this.playStart();
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
    return node;
  }

  /* ---------- плеер ---------- */
  play(t) {
    this.playing = t.id;
    for (const n of this.list.querySelectorAll(".fd-card")) n.classList.toggle("playing", n.dataset.id === t.id);
    this.renderPlayer(t);
  }

  renderPlayer(t) {
    this.player.replaceChildren();
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
    } else {
      // Firefox: страница ОС изолирована ради GBA — перезагружаемся в /finds/…, там изоляции нет
      const q = new URLSearchParams({ tab: this.tab, play: t.id });
      const go = "/finds/" + (this.pubView || this.cur || "") + "?" + q;
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
    if (inList) {
      this.items.splice(was, 1);
      const node = [...this.list.querySelectorAll(".fd-card")].find(n => n.dataset.id === t.id);
      node?.remove();
      // слушал и оценил — сразу следующий
      if (this.playing === t.id && this.tab === "feed") {
        const next = this.items[was] || this.items[was - 1];
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
        el("div", { className: "fd-row" },
          p ? el("button", { className: "fd-btn danger", textContent: "Удалить", onclick: del }) : "",
          el("div", { className: "fd-sp" }),
          el("button", { className: "fd-btn", textContent: "Отмена", onclick: close }),
          el("button", { className: "fd-btn primary", textContent: "Сохранить", onclick: save }))));
    ov.onclick = e => { if (e.target === ov) close(); };
    this.root.append(ov);
    name.focus();
  }

  /* ---------- чужой плейлист по ссылке ---------- */
  async showPublic() {
    let d;
    try { d = await api("/pub/" + this.pubId); }
    catch (e) { return this.empty("⚠ " + e.message); }
    this.w.setTitle("Находки — " + d.name);
    this.top.replaceChildren(el("div", { className: "fd-pubhead" },
      el("b", { textContent: d.name }),
      el("span", { className: "fd-dim", textContent: d.owner ? " — плейлист " + d.owner : "" })));
    this.bar.replaceChildren(
      el("span", { className: "fd-dim", textContent: d.descr || `${d.tracks.length} ${plural(d.tracks.length, "трек", "трека", "треков")}` }),
      el("div", { className: "fd-sp" }),
      el("button", { className: "fd-btn", textContent: "🔗 Ссылка", onclick: () => copyText(location.origin + "/finds/" + d.id, "Ссылка скопирована") }));
    this.pubView = d.id;
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
