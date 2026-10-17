import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";

/* ================= комментарии (комнаты постов) =================
 * Общий модуль: лента комнаты + ввод + ответы + оверлей «на что ответ».
 * room = "post:<id>" (комната конкретного поста) или "posts" (глобальная лента всех постов).
 * В глобальной ленте писать «с нуля» нельзя — только отвечать (ответ уходит в оригинальный пост).
 */
const CMT_MAX = 500;
const fmtStamp = ts => {
  const d = new Date(ts);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }) + " " +
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};

/*
 * mountComments(host, opts) → { destroy() }
 *   opts.room    — "post:<id>" | "posts"
 *   opts.me      — ник (для своих сообщений/удаления)
 *   opts.onJump  — (pid) => {}  показывать кнопку «к посту» (для глобальной ленты)
 *   opts.postAuthor — ник автора поста (может удалять любые комменты в своём посте)
 */
export function mountComments(host, opts) {
  const global = opts.room === "posts";
  const me = opts.me || null;
  const feed = el("div", { className: "cmt-feed" });
  const quote = el("div", { className: "cmt-quote", hidden: true });   // плашка «отвечаю на…»
  const ta = el("textarea", { className: "cmt-input", rows: 1, maxLength: CMT_MAX,
    placeholder: global ? "Ответьте на сообщение (кнопка «Ответить»)…" : "Написать комментарий…" });
  const send = el("button", { className: "btn small primary", textContent: "➤" });
  const foot = el("div", { className: "cmt-foot" }, ta, send);
  host.replaceChildren(el("div", { className: "cmt" }, feed, quote, foot));

  let reply = null;         // {id, pid, nick, text} — на что отвечаем
  const byId = new Map();   // id -> node
  let ws = null, closed = false, hello = false;

  const setReply = m => {
    reply = m;
    if (!m) { quote.hidden = true; return; }
    quote.hidden = false;
    quote.replaceChildren(
      el("span", { className: "cmt-quote-t", textContent: `↳ ${m.nick}: ${m.text.slice(0, 80)}` }),
      el("button", { className: "cmt-x", textContent: "✕", title: "Отменить", onclick: () => setReply(null) }));
  };

  const canDelete = m => me && (m.nick === me || (opts.postAuthor && opts.postAuthor === me));

  function overlay(parent, child) {
    const box = el("div", { className: "cmt-overlay" },
      el("div", { className: "cmt-ov-card glass" },
        el("div", { className: "cmt-ov-h", textContent: "Ответ на сообщение" }),
        el("div", { className: "cmt-ov-parent" }, el("b", { textContent: parent.nick + ": " }),
          el("span", { textContent: parent.text })),
        el("div", { className: "cmt-ov-arrow", textContent: "↓" }),
        el("div", { className: "cmt-ov-child" }, el("b", { textContent: child.nick + ": " }),
          el("span", { textContent: child.text })),
        el("button", { className: "btn small", textContent: "Закрыть", onclick: () => box.remove() })));
    box.onclick = e => { if (e.target === box) box.remove(); };
    host.append(box);
  }

  function bubble(m) {
    const mine = me && m.nick === me;
    const b = el("div", { className: "cmt-msg" + (mine ? " mine" : "") });
    if (m.reply_preview) {
      b.append(el("button", { className: "cmt-replied",
        textContent: `↳ ${m.reply_preview.nick}: ${m.reply_preview.text.slice(0, 60)}`,
        title: "Показать, на что это ответ",
        onclick: () => overlay(m.reply_preview, m) }));
    }
    const meta = el("div", { className: "cmt-meta" },
      el("span", { className: "cmt-nick", textContent: m.nick }),
      el("span", { className: "cmt-time", textContent: fmtStamp(m.ts) }));
    if (global && m.title && opts.onJump) {
      const j = el("button", { className: "cmt-jump", textContent: "→ " + m.title, title: "Открыть пост" });
      j.onclick = () => opts.onJump(m.pid);
      meta.append(j);
    }
    b.append(meta, el("div", { className: "cmt-text", textContent: m.text }));
    const acts = el("div", { className: "cmt-acts" },
      el("button", { className: "cmt-act", textContent: "Ответить",
        onclick: () => { setReply({ id: m.id, pid: m.pid, nick: m.nick, text: m.text }); ta.focus(); } }));
    if (canDelete(m)) acts.append(el("button", { className: "cmt-act del", textContent: "Удалить",
      onclick: () => { if (confirm("Удалить комментарий?")) ws?.send(JSON.stringify({ t: "cdel", id: m.id })); } }));
    b.append(acts);
    b.dataset.id = m.id;
    byId.set(m.id, b);
    return b;
  }

  const atBottom = () => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  function add(m) {
    if (byId.has(m.id)) return;
    const near = atBottom();
    feed.append(bubble(m));
    if (near) feed.scrollTop = feed.scrollHeight;
  }

  async function loadHistory() {
    try {
      const r = await fetch(`/api/chat/comments?room=${encodeURIComponent(opts.room)}&limit=50`, { cache: "no-store" });
      if (!r.ok) return;
      const { comments } = await r.json();
      for (const m of comments) add(m);
      feed.scrollTop = feed.scrollHeight;
    } catch {}
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/chat/ws");
    ws.onmessage = e => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (d.t === "hello") { hello = true; ws.send(JSON.stringify({ t: "sub", room: opts.room })); }
      else if (d.t === "cmsg") { if (global || d.room === opts.room) add(d); }
      else if (d.t === "cdel") { const n = byId.get(d.id); if (n) { n.remove(); byId.delete(d.id); } }
      else if (d.t === "error" && d.error) notify(d.error);
    };
    ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
  }

  function doSend() {
    const text = ta.value.trim();
    if (!text) return;
    if (global && !reply) return notify("В ленте постов можно только отвечать — нажмите «Ответить» у сообщения");
    const room = global ? ("post:" + reply.pid) : opts.room;
    const payload = { t: "csay", room, text };
    if (reply) payload.reply_to = reply.id;
    if (ws?.readyState === 1) ws.send(JSON.stringify(payload));
    else return notify("Нет связи, попробуйте ещё раз");
    ta.value = ""; setReply(null);
  }
  send.onclick = doSend;
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } };

  loadHistory();
  connect();

  return { destroy() { closed = true; try { ws?.close(); } catch {} } };
}
