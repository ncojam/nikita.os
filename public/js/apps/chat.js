import { el } from "../core/util.js";
import { mountComments } from "./comments.js";
import { openPostById } from "./post.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= чатилка =================
 * Общий чат — через сервер (WebSocket), хранится там же (до 1000 сообщений).
 * Личка — P2P через WebRTC DataChannel: сервер только сводит браузеры, текст на нём не бывает.
 * При P2P собеседники видят IP друг друга, поэтому переписка начинается с запроса через сервер:
 * отправитель соглашается раскрыть IP, получатель — принять. Согласия хранятся здесь, в localStorage.
 * История лички и список контактов живут в localStorage этого браузера.
 * Весь чужой текст выводится только через textContent — никакого innerHTML.
 */
const MSG_MAX = 500;
const PUBLIC = "#общий";
const POSTS = "#посты";   // глобальная лента комментариев всех постов
const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
const IP_OUT = n => `Личка идёт напрямую между браузерами (P2P), поэтому ${n} узнает ваш IP-адрес. Отправить запрос на переписку?`;
const IP_IN = n => `${n} хочет написать вам лично. Если согласитесь, переписка пойдёт напрямую (P2P) и ${n} узнает ваш IP-адрес (а вы — его). Принять?`;
const STATUS = { queued: "⏳ ждёт адресата", sent: "✓ отправлено", delivered: "✓✓ доставлено" };

const clean = s => typeof s !== "string" ? "" :
  s.normalize("NFC").replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, MSG_MAX);
const NICK_RE = /^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$/;

const fmtStamp = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

/* ---------- локальное хранилище лички ---------- */
const Store = {
  me: "",
  k(s) { return `nos.chat.${this.me.toLowerCase()}.${s}`; },
  get(s, def) { try { return JSON.parse(localStorage.getItem(this.k(s))) ?? def; } catch { return def; } },
  set(s, v) { try { localStorage.setItem(this.k(s), JSON.stringify(v)); } catch {} },
  contacts() { return this.get("contacts", []); },
  addContact(n) { const c = this.contacts(); if (!c.includes(n)) { c.unshift(n); this.set("contacts", c); } },
  consent(n) { return this.get("consent", {})[n.toLowerCase()] || ""; },   // out | in | ok | declined
  setConsent(n, v) {
    const c = this.get("consent", {});
    if (v) c[n.toLowerCase()] = v; else delete c[n.toLowerCase()];
    this.set("consent", c);
  },
  allowed() { return this.contacts().filter(n => ["ok", "out"].includes(this.consent(n))); },
  removeContact(n) {
    this.setConsent(n, "");
    this.set("contacts", this.contacts().filter(x => x !== n));
    try { localStorage.removeItem(this.k("dm." + n.toLowerCase())); } catch {}
  },
  dm(n) { return this.get("dm." + n.toLowerCase(), []); },
  saveDm(n, list) { this.set("dm." + n.toLowerCase(), list.slice(-500)); },
};

/* ---------- P2P-соединение с одним собеседником (perfect negotiation) ---------- */
class Peer {
  constructor(app, nick) {
    this.app = app; this.nick = nick;
    this.polite = app.me.toLowerCase() < nick.toLowerCase();
    this.makingOffer = false; this.ignoreOffer = false;
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.ch = null;
    this.pc.onicecandidate = e => e.candidate && app.signal(nick, { cand: e.candidate.toJSON() });
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        app.signal(nick, { sdp: this.pc.localDescription.toJSON() });
      } catch {} finally { this.makingOffer = false; }
    };
    this.pc.ondatachannel = e => this.bind(e.channel);
    this.pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(this.pc.connectionState)) this.app.dropPeer(this);
    };
  }
  open() { if (!this.ch) this.bind(this.pc.createDataChannel("dm", { ordered: true })); }
  bind(ch) {
    this.ch = ch;
    ch.onopen = () => this.app.flush(this.nick);
    ch.onmessage = e => this.app.onP2P(this.nick, e.data);
    ch.onclose = () => { if (this.ch === ch) this.ch = null; };
  }
  get ready() { return this.ch?.readyState === "open"; }
  send(obj) { if (this.ready) { this.ch.send(JSON.stringify(obj)); return true; } return false; }
  async onSignal({ sdp, cand }) {
    try {
      if (sdp) {
        const collision = sdp.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(sdp);
        if (sdp.type === "offer") {
          await this.pc.setLocalDescription();
          this.app.signal(this.nick, { sdp: this.pc.localDescription.toJSON() });
        }
      } else if (cand) {
        try { await this.pc.addIceCandidate(cand); } catch (e) { if (!this.ignoreOffer) throw e; }
      }
    } catch {}
  }
  close() { try { this.pc.close(); } catch {} }
}

/* ---------- приложение ---------- */
class ChatApp {
  constructor(c, w) {
    this.c = c; this.w = w;
    this.me = ""; this.ws = null; this.online = new Set();
    this.peers = new Map(); this.view = PUBLIC;
    this.oldest = 0; this.loadingOld = false; this.noMore = false;
    this.closed = false;
    w.onClose = () => this.shutdown();
    this.start();
  }

  async start() {
    try {
      const r = await fetch("/api/chat/me", { cache: "no-store" });
      if (r.ok) { this.me = (await r.json()).nick; return this.main(); }
    } catch {}
    this.login();
  }

  /* --- вход / регистрация --- */
  login() {
    const login = el("input", { type: "text", placeholder: "Ник", maxLength: 20, autocomplete: "username", spellcheck: false });
    const pass = el("input", { type: "password", placeholder: "Пароль", maxLength: 128, autocomplete: "current-password" });
    const err = el("div", { className: "chat-err" });
    const go = el("button", { className: "btn primary", textContent: "Войти" });
    const submit = async () => {
      err.textContent = "";
      const l = login.value.trim();
      if (!NICK_RE.test(l)) return err.textContent = "Ник: 3–20 символов — буквы, цифры, _ и -";
      if (pass.value.length < 6) return err.textContent = "Пароль — не короче 6 символов";
      go.disabled = true;
      try {
        const r = await fetch("/api/chat/auth", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login: l, password: pass.value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Ошибка");
        this.me = d.nick;
        if (d.created) notify("Аккаунт создан");
        this.main();
      } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
    };
    go.onclick = submit;
    pass.onkeydown = login.onkeydown = e => { if (e.key === "Enter") submit(); };
    this.c.replaceChildren(el("div", { className: "chat-login" },
      el("h3", { textContent: "💬 Чат" }),
      el("p", { className: "hint", textContent: "Нет такого ника — зарегистрируем, есть — войдём. Одна регистрация с адреса в месяц." }),
      login, pass, go, err));
    login.focus();
  }

  /* --- основной экран --- */
  main() {
    Store.me = this.me;
    this.list = el("div", { className: "chat-list" });
    this.side = el("aside", { className: "chat-side" },
      el("div", { className: "chat-me" }, el("span", { textContent: "👤 " + this.me }),
        el("button", { className: "btn small", textContent: "Выйти", onclick: () => this.logout() })),
      this.list);
    const toggle = el("button", { className: "btn small", textContent: "☰", title: "Панель" });
    toggle.onclick = () => this.side.classList.toggle("hidden");
    this.head = el("div", { className: "chat-title" });
    this.feed = el("div", { className: "chat-feed" });
    this.note = el("div", { className: "chat-note" });
    this.input = el("textarea", { rows: 2, maxLength: MSG_MAX, placeholder: "Сообщение… (Enter — отправить, Shift+Enter — перенос)" });
    const send = el("button", { className: "btn primary", textContent: "➤" });
    send.onclick = () => this.send();
    this.input.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); } };
    this.feed.onscroll = () => { if (this.view === PUBLIC && this.feed.scrollTop < 60) this.loadOlder(); };
    this.c.replaceChildren(el("div", { className: "chat" }, this.side,
      el("section", { className: "chat-main" },
        el("header", { className: "chat-head" }, toggle, this.head),
        this.note, this.feed,
        el("footer", { className: "chat-input" }, this.input, send))));
    this.connect();
    this.renderList();
    this.openView(PUBLIC);
  }

  renderList() {
    const item = (name, label, online, removable) => {
      const b = el("div", { className: "chat-item" + (this.view === name ? " active" : "") });
      if (online !== null) b.append(el("span", { className: "dot" + (online ? " on" : "") }));
      b.append(el("span", { className: "name", textContent: label }));
      if (removable && Store.consent(name) === "in") b.append(el("span", { className: "badge", textContent: "запрос" }));
      if (removable) b.append(el("button", { className: "del", title: "Удалить чат", textContent: "✕",
        onclick: e => {
          e.stopPropagation();
          if (!confirm(`Удалить переписку с ${name}? История в этом браузере сотрётся.`)) return;
          Store.removeContact(name);
          this.wsSend({ t: "allow_remove", nick: name });
          this.dropPeer(this.peers.get(name));
          if (this.view === name) this.openView(PUBLIC); else this.renderList();
        } }));
      b.onclick = () => this.openView(name);
      return b;
    };
    const contacts = Store.contacts();
    this.list.replaceChildren(item(PUBLIC, "🌐 Общий чат", null, false),
      item(POSTS, "📝 Посты", null, false),
      el("div", { className: "chat-sep", textContent: contacts.length ? "Контакты" : "Контактов пока нет" }),
      ...contacts.map(n => item(n, n, this.online.has(n), true)));
  }

  openView(name) {
    this.view = name;
    if (this.postsCmt) { this.postsCmt.destroy(); this.postsCmt = null; }
    this.feed.replaceChildren();
    this.renderList();
    const footer = this.input.closest(".chat-input");
    if (footer) footer.hidden = name === POSTS;   // у ленты постов свой ввод
    if (name === POSTS) {
      this.head.replaceChildren(el("b", { textContent: "📝 Посты" }),
        el("span", { className: "chat-status", textContent: "комментарии ко всем постам" }));
      this.note.hidden = true;
      this.postsCmt = mountComments(this.feed, { room: "posts", me: this.me, onJump: openPostById });
    } else if (name === PUBLIC) {
      this.head.replaceChildren(el("b", { textContent: "🌐 Общий чат" }));
      this.note.hidden = true;
      this.oldest = 0; this.noMore = false;
      this.loadOlder(true);
    } else {
      this.renderDmHead();
      this.note.hidden = false;
      this.renderNote();
      for (const m of Store.dm(name)) this.feed.append(this.bubble(m));
      this.scrollDown();
      this.wsSend({ t: "status", nick: name });
      if (Store.dm(name).some(m => m.out && m.st === "queued")) this.peerFor(name);
    }
    this.input.focus();
  }

  renderNote() {
    const n = this.view, st = Store.consent(n);
    const base = "🔒 Личка идёт напрямую между браузерами (P2P) и на сервере не хранится, но собеседники видят IP друг друга. " +
      "Если собеседник не в сети, держите окно чата открытым — сообщение уйдёт, когда он появится.";
    const line = { out: "⏳ Запрос отправлен, ждём, пока " + n + " согласится.",
      declined: "🚫 " + n + " отклонил запрос. Можно отправить новый, написав сообщение.",
      in: "📩 " + n + " хочет написать вам. Если примете, " + n + " узнает ваш IP-адрес (а вы — его)." }[st];
    this.note.replaceChildren(el("div", { textContent: base }));
    if (line) this.note.append(el("div", { className: "chat-consent", textContent: line }));
    if (st === "in") this.note.append(el("div", { className: "chat-consent-btns" },
      el("button", { className: "btn small primary", textContent: "Принять", onclick: () => this.answer(n, true) }),
      el("button", { className: "btn small", textContent: "Отклонить", onclick: () => this.answer(n, false) })));
  }

  answer(n, ok) {
    this.wsSend({ t: "dm_answer", to: n, ok });
    if (ok) Store.setConsent(n, "ok");
    else Store.removeContact(n);
    this.renderList();
    if (this.view === n) ok ? this.renderNote() : this.openView(PUBLIC);
  }

  incoming(n) {
    if (!NICK_RE.test(n) || Store.consent(n) === "ok") return;
    Store.setConsent(n, "in");
    Store.addContact(n);
    this.renderList();
    if (this.view === n) this.renderNote();
    else notify("📩 " + n + " хочет написать вам лично", 3500);
  }

  renderDmHead() {
    const on = this.online.has(this.view);
    this.head.replaceChildren(el("b", { textContent: "💬 " + this.view }),
      el("span", { className: "chat-status" + (on ? " on" : ""), textContent: on ? "● онлайн" : "○ оффлайн" }));
  }

  bubble(m) {
    const mine = m.nick === this.me;
    const nick = el("span", { className: "nick", textContent: m.nick });
    if (!mine && this.view === PUBLIC) { nick.classList.add("link"); nick.onclick = () => this.openView(m.nick); nick.title = "Написать лично"; }
    const meta = el("div", { className: "meta" }, nick, el("span", { className: "time", textContent: fmtStamp(m.ts) }));
    const b = el("div", { className: "bubble" + (mine ? " mine" : "") }, meta, el("div", { className: "text", textContent: m.text }));
    if (m.out) b.append(el("div", { className: "st", textContent: STATUS[m.st] || "" }));
    b.dataset.id = m.id;
    return b;
  }

  scrollDown() { this.feed.scrollTop = this.feed.scrollHeight; }

  /* --- общий чат: ленивая загрузка --- */
  async loadOlder(first = false) {
    if (this.loadingOld || this.noMore) return;
    this.loadingOld = true;
    try {
      const r = await fetch(`/api/chat/history?limit=50${this.oldest ? "&before=" + this.oldest : ""}`, { cache: "no-store" });
      if (r.status === 401) return this.login();
      const { messages } = await r.json();
      if (this.view !== PUBLIC) return;
      if (messages.length < 50) this.noMore = true;
      if (!messages.length) return;
      this.oldest = messages[0].id;
      const h = this.feed.scrollHeight;
      this.feed.prepend(...messages.map(m => this.bubble(m)));
      if (first) this.scrollDown(); else this.feed.scrollTop += this.feed.scrollHeight - h;
    } catch {} finally { this.loadingOld = false; }
  }

  /* --- вебсокет --- */
  connect() {
    if (this.closed) return;
    const ws = this.ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/chat/ws");
    ws.onmessage = e => { try { this.onWs(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { if (!this.closed && this.me) setTimeout(() => this.connect(), 3000); };
  }
  wsSend(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
  signal(to, data) { this.wsSend({ t: "signal", to, data }); }

  onWs(d) {
    if (d.t === "hello") {
      this.online = new Set(d.online);
      this.wsSend({ t: "allow", nicks: Store.allowed() });
      for (const n of d.requests || []) this.incoming(n);
      this.renderList();
      if (this.view !== PUBLIC) this.renderDmHead();
      for (const n of Store.contacts()) if (this.online.has(n) && this.hasQueued(n)) this.peerFor(n);
    } else if (d.t === "msg") {
      if (this.view !== PUBLIC) return;
      const near = this.feed.scrollHeight - this.feed.scrollTop - this.feed.clientHeight < 80;
      this.feed.append(this.bubble(d));
      if (near || d.nick === this.me) this.scrollDown();
    } else if (d.t === "presence") {
      if (d.online) this.online.add(d.nick); else this.online.delete(d.nick);
      this.renderList();
      if (this.view === d.nick) this.renderDmHead();
      if (d.online && this.hasQueued(d.nick)) this.peerFor(d.nick);
    } else if (d.t === "dm_request") {
      this.incoming(d.from);
    } else if (d.t === "dm_ok") {
      if (!Store.contacts().includes(d.nick)) return;
      Store.setConsent(d.nick, "ok");
      if (this.view === d.nick) this.renderNote();
      if (this.hasQueued(d.nick)) this.peerFor(d.nick);
    } else if (d.t === "dm_declined") {
      if (Store.consent(d.nick) !== "out") return;
      Store.setConsent(d.nick, "declined");
      if (this.view === d.nick) this.renderNote(); else notify(d.nick + " отклонил запрос на личку");
    } else if (d.t === "signal") {
      if (!NICK_RE.test(d.from) || Store.consent(d.from) !== "ok") return;
      const p = this.peers.get(d.from) || this.newPeer(d.from);
      p.onSignal(d.data || {});
    } else if (d.t === "error") notify(d.error);
  }

  /* --- личка --- */
  hasQueued(n) { return Store.dm(n).some(m => m.out && m.st === "queued"); }
  newPeer(n) { const p = new Peer(this, n); this.peers.set(n, p); return p; }
  peerFor(n) {
    if (Store.consent(n) !== "ok") return null;
    let p = this.peers.get(n);
    if (!p) p = this.newPeer(n);
    if (this.online.has(n)) p.open();
    return p;
  }
  dropPeer(p) { if (p && this.peers.get(p.nick) === p) { this.peers.delete(p.nick); p.close(); } }

  flush(n) {
    const p = this.peers.get(n);
    if (!p?.ready) return;
    const list = Store.dm(n);
    let changed = false;
    for (const m of list) if (m.out && m.st === "queued" && p.send({ t: "dm", id: m.id, text: m.text, ts: m.ts })) {
      m.st = "sent"; changed = true;
    }
    if (changed) { Store.saveDm(n, list); this.refreshDm(n); }
  }

  onP2P(n, raw) {
    let d; try { d = JSON.parse(raw); } catch { return; }
    const list = Store.dm(n);
    if (d.t === "dm") {
      const text = clean(d.text);
      if (!text || typeof d.id !== "string" || d.id.length > 40) return;
      if (!list.some(m => m.id === d.id)) {
        const ts = Number.isFinite(d.ts) ? Math.min(d.ts, Date.now()) : Date.now();
        list.push({ id: d.id, nick: n, text, ts, out: false });
        Store.saveDm(n, list);
        Store.addContact(n);
        this.renderList();
        if (this.view === n) { this.feed.append(this.bubble(list.at(-1))); this.scrollDown(); }
        else notify("💬 " + n + ": " + text.slice(0, 60));
      }
      this.peers.get(n)?.send({ t: "ack", id: d.id });
    } else if (d.t === "ack") {
      const m = list.find(m => m.id === d.id && m.out);
      if (m && m.st !== "delivered") { m.st = "delivered"; Store.saveDm(n, list); this.refreshDm(n); }
    }
  }

  refreshDm(n) {
    if (this.view !== n) return;
    for (const m of Store.dm(n)) {
      const node = this.feed.querySelector(`[data-id="${CSS.escape(m.id)}"] .st`);
      if (node) node.textContent = STATUS[m.st] || "";
    }
  }

  send() {
    const text = clean(this.input.value);
    if (!text) return;
    if (this.view === PUBLIC) {
      if (this.ws?.readyState !== 1) return notify("Нет связи с сервером");
      this.wsSend({ t: "say", text });
    } else {
      const n = this.view, st = Store.consent(n);
      if (st === "in") {
        if (!confirm(IP_IN(n))) return;
        this.answer(n, true);
      } else if (st !== "ok" && st !== "out") {
        if (!confirm(IP_OUT(n))) return;
        Store.setConsent(n, "out");
        this.wsSend({ t: "dm_request", to: n });
        this.renderNote();
      }
      const m = { id: crypto.randomUUID(), nick: this.me, text, ts: Date.now(), out: true, st: "queued" };
      const list = Store.dm(n); list.push(m); Store.saveDm(n, list);
      Store.addContact(n);
      this.renderList();
      this.feed.append(this.bubble(m)); this.scrollDown();
      this.peerFor(n);
      this.flush(n);
    }
    this.input.value = "";
  }

  async logout() {
    try { await fetch("/api/chat/logout", { method: "POST" }); } catch {}
    this.shutdown(); this.closed = false; this.me = "";
    this.login();
  }

  shutdown() {
    this.closed = true;
    if (this.postsCmt) { this.postsCmt.destroy(); this.postsCmt = null; }
    try { this.ws?.close(); } catch {}
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
  }
}

function openChat() {
  WM.open({ title: "Чат", icon: "💬", width: 820, height: 560, key: "chat", render(c, w) { new ChatApp(c, w); } });
}

export { openChat };
