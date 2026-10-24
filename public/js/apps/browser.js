import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";
import { pickImage } from "./post.js";

/* ================= Браузер =================
 * Ходит только по нашим псевдо-сайтам. Адрес вида «kursk.artists/general/<id>».
 * Прямая ссылка снаружи: https://<сайт>/browser/kursk.artists/general/<id> — ОС откроет браузер сразу там.
 */
const HOME = "about:home";
const FORUM = "kursk.artists";
const POST_IMG = { dim: 800, limit: 110 * 1024 };   // картинка в посте (сервер: ≤800px, ≤120 КБ)
const AVA_IMG = { dim: 256, limit: 60 * 1024 };

const fmtDate = ts => !ts ? "—" : new Date(ts * 1000).toLocaleString(globalThis.NOS_LOCALE,
  { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const api = async (url, opts = {}) => {
  const r = await fetch(url, { cache: "no-store", ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Ошибка " + r.status);
  return d;
};
const sendJSON = (url, method, body) => api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function whoami() {
  try { const r = await fetch("/api/chat/me", { cache: "no-store" }); if (r.ok) return (await r.json()).nick; } catch {}
  return null;
}

/* ---------- адреса ---------- */
function normAddr(a) {
  a = String(a || "").trim();
  if (!a) return HOME;
  a = a.replace(/^https?:\/\/[^/]+\/browser\/?/i, "");   // вставили полную ссылку
  a = a.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  return a || HOME;
}
const browserUrl = addr => location.origin + "/browser/" + (addr === HOME ? "" : encodeURI(addr));

/* ---------- markdown (безопасный: сначала экранируем всё, потом размечаем) ---------- */
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => (codes.push(c), `\u0000${codes.length - 1}\u0000`));
  // картинки — только наши (/media/...), чужие адреса не грузим
  s = s.replace(/!\[([^\]\n]*)\]\((\/media\/[A-Za-z0-9/_-]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t, u) => linkTag(u, t));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + linkTag(u, u));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
       .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>")
       .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<i>$2</i>")
       .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

function linkTag(u, text) {
  const inner = normAddr(u.replace(/&amp;/g, "&"));
  const ours = /^https?:\/\/[^/]+\/browser\//i.test(u) && u.startsWith(location.origin) || /^kursk\.artists(\/|$)/i.test(u);
  if (ours) return `<a href="#" data-nav="${esc(inner)}">${text}</a>`;
  if (/^https?:\/\//i.test(u)) return `<a href="${u}" target="_blank" rel="noopener nofollow">${text}</a>`;
  return text;
}

function md(src) {
  const lines = esc(src).split("\n");
  const out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush(); const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push("<pre><code>" + buf.join("\n") + "</code></pre>"); continue;
    }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push("<hr>"); i++; continue; }
    if (/^&gt;\s?/.test(l)) {
      flush(); const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ""));
      out.push("<blockquote>" + buf.map(inline).join("<br>") + "</blockquote>"); continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush(); const ordered = /^\s*\d+\./.test(l), buf = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>` + buf.map(x => "<li>" + inline(x) + "</li>").join("") + `</${tag}>`); continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return out.join("");
}

/* ---------- редактор markdown: панель, загрузка картинок, превью ---------- */
function mdEditor({ value = "", placeholder = "Текст (поддерживается Markdown)", rows = 8 } = {}) {
  const ta = el("textarea", { className: "ka-ta", rows, maxLength: 8000, value, placeholder });
  const prev = el("div", { className: "ka-md ka-prev", hidden: true });
  const wrap = (a, b = a) => () => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    ta.value = v.slice(0, s) + a + v.slice(s, e) + b + v.slice(e);
    ta.focus(); ta.selectionStart = s + a.length; ta.selectionEnd = e + a.length;
  };
  const insert = t => { const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd); ta.focus(); };
  const btn = (t, title, fn) => el("button", { className: "ka-tool", type: "button", textContent: t, title, onclick: fn });
  const imgBtn = btn("🖼", "Картинка (сожмём до 800px)", async () => {
    const blob = await pickImage(POST_IMG.dim, POST_IMG.limit);
    if (!blob) return;
    imgBtn.disabled = true;
    try {
      const d = await api("/api/forum/img", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob });
      insert(`\n![картинка](${d.url})\n`);
    } catch (e) { notify(e.message); } finally { imgBtn.disabled = false; }
  });
  const prevBtn = btn("👁 Превью", "Показать как будет", () => {
    const on = prev.hidden;
    prev.hidden = !on; ta.hidden = on;
    if (on) prev.innerHTML = md(ta.value) || "<p class='ka-muted'>(пусто)</p>";
    prevBtn.classList.toggle("on", on);
  });
  const bar = el("div", { className: "ka-toolbar" },
    btn("B", "Жирный", wrap("**")), btn("I", "Курсив", wrap("*")), btn("S", "Зачёркнутый", wrap("~~")),
    btn("</>", "Код", wrap("`")), btn("❝", "Цитата", wrap("> ", "")), btn("🔗", "Ссылка", wrap("[", "](https://)")),
    imgBtn, el("span", { className: "ka-sp" }), prevBtn);
  return { node: el("div", { className: "ka-editor" }, bar, ta, prev), ta, get value() { return ta.value; } };
}

/* ================= сайт: Kursk Artists ================= */
const KA = {
  title: "Kursk Artists",
  // маршрут -> страница. parts: ["general", "<tid>"] и т.п.
  async render(b, parts, q) {
    const me = await whoami();
    const page = el("div", { className: "ka" });
    const userBar = me
      ? el("div", { className: "ka-user" },
          el("a", { href: "#", textContent: "👤 " + me, onclick: e => (e.preventDefault(), b.go(`${FORUM}/user/${me}`)) }),
          el("a", { href: "#", textContent: "выйти", onclick: async e => {
            e.preventDefault(); await fetch("/api/chat/logout", { method: "POST" }).catch(() => {}); b.reload(); } }))
      : el("div", { className: "ka-user" }, el("a", { href: "#", textContent: "Вход / регистрация",
          onclick: e => (e.preventDefault(), b.go(`${FORUM}/login?back=${encodeURIComponent(b.addr)}`)) }));
    page.append(el("header", { className: "ka-head" },
      el("a", { className: "ka-logo", href: "#", onclick: e => (e.preventDefault(), b.go(FORUM)) },
        el("span", { className: "ka-mark", textContent: "✶" }),
        el("span", {}, el("b", { textContent: "KURSK" }), " ARTISTS")),
      el("div", { className: "ka-tag", textContent: "форум художников, музыкантов и прочих творцов" }), userBar));
    const main = el("main", { className: "ka-main" });
    page.append(main, el("footer", { className: "ka-foot", textContent: "kursk.artists · аккаунт общий с чатом nikita.os" }));
    b.paint(page);

    const [a, x, y] = parts;
    try {
      if (!a) return await this.index(b, main);
      if (a === "login") return this.login(b, main, q.get("back"));
      if (a === "user" && x) return await this.user(b, main, decodeURIComponent(x), me);
      if (x === "new") return this.newThread(b, main, a, me);
      if (x) return await this.thread(b, main, a, x, q.get("page") || "1", me);
      return await this.section(b, main, a, q.get("page") || "1", me);
    } catch (e) {
      main.replaceChildren(el("div", { className: "ka-box ka-err" }, el("h3", { textContent: "Не найдено" }),
        el("p", { textContent: e.message })));
    }
  },

  crumbs(b, list) {
    const c = el("nav", { className: "ka-crumbs" });
    list.forEach(([t, addr], i) => {
      if (i) c.append(" › ");
      c.append(addr ? el("a", { href: "#", textContent: t, onclick: e => (e.preventDefault(), b.go(addr)) }) : el("span", { textContent: t }));
    });
    return c;
  },

  pager(b, base, page, pages) {
    if (pages <= 1) return "";
    const nav = el("div", { className: "ka-pager" });
    for (let i = 1; i <= pages; i++)
      nav.append(i === page ? el("b", { textContent: i }) : el("a", { href: "#", textContent: i,
        onclick: e => (e.preventDefault(), b.go(`${base}?page=${i}`)) }));
    return nav;
  },

  async index(b, main) {
    const { sections } = await api("/api/forum/sections");
    const tbl = el("div", { className: "ka-box" }, el("div", { className: "ka-row ka-th" },
      el("span", { textContent: "Раздел" }), el("span", { textContent: "Веток" }), el("span", { textContent: "Постов" }), el("span", { textContent: "Последнее" })));
    for (const s of sections)
      tbl.append(el("div", { className: "ka-row" },
        el("a", { href: "#", className: "ka-strong", textContent: "📂 " + s.name, onclick: e => (e.preventDefault(), b.go(`${FORUM}/${s.id}`)) }),
        el("span", { textContent: s.threads }), el("span", { textContent: s.posts }), el("span", { className: "ka-muted", textContent: fmtDate(s.last) })));
    main.replaceChildren(el("h2", { textContent: "Разделы" }), tbl);
  },

  async section(b, main, sid, page, me) {
    const d = await api(`/api/forum/s/${encodeURIComponent(sid)}?page=${page}`);
    const tbl = el("div", { className: "ka-box" }, el("div", { className: "ka-row ka-th" },
      el("span", { textContent: "Ветка" }), el("span", { textContent: "Ответов" }), el("span", { textContent: "Автор" }), el("span", { textContent: "Последний пост" })));
    if (!d.threads.length) tbl.append(el("div", { className: "ka-empty", textContent: "Пока пусто — начните первую ветку." }));
    for (const t of d.threads)
      tbl.append(el("div", { className: "ka-row" },
        el("a", { href: "#", className: "ka-strong", textContent: t.title, onclick: e => (e.preventDefault(), b.go(`${FORUM}/${sid}/${t.id}`)) }),
        el("span", { textContent: t.replies }),
        this.nick(b, t.author),
        el("span", { className: "ka-muted" }, fmtDate(t.last) + " · ", this.nick(b, t.last_by))));
    const make = el("button", { className: "ka-btn", textContent: "✚ Новая ветка",
      onclick: () => me ? b.go(`${FORUM}/${sid}/new`) : b.go(`${FORUM}/login?back=${encodeURIComponent(`${FORUM}/${sid}/new`)}`) });
    main.replaceChildren(this.crumbs(b, [["Форум", FORUM], [d.section.name]]),
      el("div", { className: "ka-titlebar" }, el("h2", { textContent: d.section.name }), make),
      tbl, this.pager(b, `${FORUM}/${sid}`, d.page, d.pages));
  },

  nick(b, n) {
    return el("a", { href: "#", className: "ka-nick", textContent: n, onclick: e => (e.preventDefault(), b.go(`${FORUM}/user/${n}`)) });
  },

  ava(src, size = "") {
    return src ? el("img", { className: "ka-ava " + size, src, alt: "" }) : el("div", { className: "ka-ava ka-ava-none " + size, textContent: "✶" });
  },

  async thread(b, main, sid, tid, page, me) {
    const d = await api(`/api/forum/t/${encodeURIComponent(tid)}?page=${page}`);
    const self = `${FORUM}/${d.thread.section}/${tid}`;
    const list = el("div", { className: "ka-posts" });
    d.posts.forEach((p, i) => list.append(this.post(b, p, me, d.page === 1 && i === 0, self)));
    let reply = "";
    if (me) {
      const ed = mdEditor({ placeholder: "Ваш ответ (Markdown)…", rows: 5 });
      const send = el("button", { className: "ka-btn", textContent: "Ответить" });
      send.onclick = async () => {
        if (!ed.value.trim()) return;
        send.disabled = true;
        try { await sendJSON(`/api/forum/t/${tid}/posts`, "POST", { text: ed.value }); b.go(`${self}?page=last`, true); }
        catch (e) { notify(e.message); send.disabled = false; }
      };
      reply = el("div", { className: "ka-box ka-reply" }, el("h3", { textContent: "Ответить" }), ed.node, el("div", { className: "ka-actions" }, send));
    } else {
      reply = el("div", { className: "ka-box ka-empty" }, el("a", { href: "#", textContent: "Войдите", onclick: e => (e.preventDefault(),
        b.go(`${FORUM}/login?back=${encodeURIComponent(self)}`)) }), ", чтобы ответить.");
    }
    main.replaceChildren(this.crumbs(b, [["Форум", FORUM], [d.section_name, `${FORUM}/${d.thread.section}`], [d.thread.title]]),
      el("h2", { textContent: d.thread.title }), this.pager(b, self, d.page, d.pages), list, this.pager(b, self, d.page, d.pages), reply);
    if (page === "last") b.scrollEnd();
  },

  post(b, p, me, isFirst, self) {
    const body = el("div", { className: "ka-md" });
    body.innerHTML = md(p.text);
    const mine = me && me === p.author;
    const tools = el("div", { className: "ka-post-tools" },
      el("span", { className: "ka-muted", textContent: fmtDate(p.created) + (p.edited ? " · изм." : "") }));
    const box = el("article", { className: "ka-post" + (isFirst ? " first" : "") },
      el("aside", { className: "ka-post-side" }, this.ava(p.ava), this.nick(b, p.author)),
      el("div", { className: "ka-post-body" }, tools, body));
    if (mine) {
      tools.append(el("span", { className: "ka-sp" }),
        el("a", { href: "#", textContent: "изменить", onclick: e => {
          e.preventDefault();
          const ed = mdEditor({ value: p.text });
          const save = el("button", { className: "ka-btn", textContent: "Сохранить" });
          save.onclick = async () => {
            save.disabled = true;
            try { await sendJSON(`/api/forum/p/${p.id}`, "PATCH", { text: ed.value }); b.reload(); }
            catch (er) { notify(er.message); save.disabled = false; }
          };
          body.replaceWith(el("div", {}, ed.node, el("div", { className: "ka-actions" },
            el("button", { className: "ka-btn ghost", textContent: "Отмена", onclick: () => b.reload() }), save)));
        } }),
        el("a", { href: "#", className: "ka-danger", textContent: isFirst ? "удалить ветку" : "удалить", onclick: async e => {
          e.preventDefault();
          if (!confirm(isFirst ? "Удалить всю ветку со всеми ответами?" : "Удалить пост?")) return;
          try { const r = await api(`/api/forum/p/${p.id}`, { method: "DELETE" });
            r.thread_gone ? b.go(self.split("/").slice(0, 2).join("/")) : b.reload(); }
          catch (er) { notify(er.message); }
        } }));
    }
    return box;
  },

  newThread(b, main, sid, me) {
    if (!me) return b.go(`${FORUM}/login?back=${encodeURIComponent(`${FORUM}/${sid}/new`)}`, true);
    const title = el("input", { className: "ka-input", maxLength: 100, placeholder: "Заголовок ветки" });
    const ed = mdEditor({ placeholder: "Первый пост (Markdown: **жирный**, *курсив*, > цитата, - список, ```код```)…", rows: 10 });
    const go = el("button", { className: "ka-btn", textContent: "Создать ветку" });
    go.onclick = async () => {
      if (!title.value.trim() || !ed.value.trim()) return notify("Нужны заголовок и текст");
      go.disabled = true;
      try { const d = await sendJSON("/api/forum/threads", "POST", { section: sid, title: title.value, text: ed.value });
        b.go(`${FORUM}/${d.section}/${d.id}`, true); }
      catch (e) { notify(e.message); go.disabled = false; }
    };
    main.replaceChildren(this.crumbs(b, [["Форум", FORUM], ["Общий", `${FORUM}/${sid}`], ["Новая ветка"]]),
      el("div", { className: "ka-box ka-form" }, el("h2", { textContent: "Новая ветка" }), title, ed.node,
        el("div", { className: "ka-actions" }, go)));
    title.focus();
  },

  login(b, main, back) {
    const nick = el("input", { className: "ka-input", maxLength: 20, placeholder: "Ник", autocomplete: "username", spellcheck: false });
    const pass = el("input", { className: "ka-input", type: "password", maxLength: 128, placeholder: "Пароль", autocomplete: "current-password" });
    const err = el("div", { className: "ka-danger" });
    const go = el("button", { className: "ka-btn", textContent: "Войти / зарегистрироваться" });
    const submit = async () => {
      err.textContent = ""; go.disabled = true;
      try {
        const d = await sendJSON("/api/chat/auth", "POST", { login: nick.value.trim(), password: pass.value });
        if (d.created) notify("Аккаунт создан — он же работает в чате");
        b.go(back || FORUM, true);
      } catch (e) { err.textContent = e.message; go.disabled = false; }
    };
    go.onclick = submit;
    nick.onkeydown = pass.onkeydown = e => { if (e.key === "Enter") submit(); };
    main.replaceChildren(el("div", { className: "ka-box ka-form ka-narrow" }, el("h2", { textContent: "Вход" }),
      el("p", { className: "ka-muted", textContent: "Аккаунт общий с чатом nikita.os. Нет такого ника — зарегистрируем, есть — войдём." }),
      nick, pass, go, err));
    nick.focus();
  },

  async user(b, main, nick, me) {
    const d = await api(`/api/forum/u/${encodeURIComponent(nick)}`).catch(e => {
      if (me && me.toLowerCase() === nick.toLowerCase()) return { nick: me, about: "", site: "", city: "", posts: 0, threads: [], joined: 0 };
      throw e;
    });
    const mine = me && me.toLowerCase() === d.nick.toLowerCase();
    const about = el("div", { className: "ka-md" }); about.innerHTML = d.about ? md(d.about) : "<p class='ka-muted'>О себе пока ничего.</p>";
    const facts = el("dl", { className: "ka-facts" },
      el("dt", { textContent: "На форуме с" }), el("dd", { textContent: d.joined ? fmtDate(d.joined).split(",")[0] : "—" }),
      el("dt", { textContent: "Постов" }), el("dd", { textContent: d.posts }));
    if (d.city) facts.append(el("dt", { textContent: "Город" }), el("dd", { textContent: d.city }));
    if (d.site) facts.append(el("dt", { textContent: "Сайт" }), el("dd", {}, el("a", { href: d.site, target: "_blank", rel: "noopener nofollow", textContent: d.site })));
    const card = el("div", { className: "ka-box ka-profile" },
      el("div", { className: "ka-prof-side" }, this.ava(d.ava, "big"), el("h2", { textContent: d.nick })),
      el("div", { className: "ka-prof-main" }, facts, el("h3", { textContent: "О себе" }), about));
    const threads = el("div", { className: "ka-box" }, el("h3", { textContent: "Ветки" }));
    if (!d.threads.length) threads.append(el("div", { className: "ka-empty", textContent: "Веток нет" }));
    for (const t of d.threads)
      threads.append(el("div", { className: "ka-line" }, el("a", { href: "#", textContent: t.title,
        onclick: e => (e.preventDefault(), b.go(`${FORUM}/${t.section}/${t.id}`)) }), el("span", { className: "ka-muted", textContent: " · " + fmtDate(t.created) })));
    main.replaceChildren(this.crumbs(b, [["Форум", FORUM], ["Профиль " + d.nick]]), card, threads);
    if (mine) main.insertBefore(this.profileEditor(b, d), threads);
  },

  profileEditor(b, d) {
    const city = el("input", { className: "ka-input", maxLength: 60, placeholder: "Город", value: d.city || "" });
    const site = el("input", { className: "ka-input", maxLength: 200, placeholder: "https://ваш-сайт", value: d.site || "" });
    const about = el("textarea", { className: "ka-ta", rows: 4, maxLength: 600, placeholder: "Пара слов о себе (Markdown)", value: d.about || "" });
    const save = el("button", { className: "ka-btn", textContent: "Сохранить" });
    save.onclick = async () => {
      save.disabled = true;
      try { await sendJSON("/api/forum/me", "PATCH", { city: city.value, site: site.value, about: about.value }); notify("Сохранено"); b.reload(); }
      catch (e) { notify(e.message); save.disabled = false; }
    };
    const ava = el("button", { className: "ka-btn ghost", textContent: "🖼 Загрузить аватарку", onclick: async () => {
      const blob = await pickImage(AVA_IMG.dim, AVA_IMG.limit);
      if (!blob) return;
      try { await api("/api/forum/me/avatar", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob }); b.reload(); }
      catch (e) { notify(e.message); }
    } });
    const drop = d.ava && el("button", { className: "ka-btn ghost", textContent: "Убрать", onclick: async () => {
      await api("/api/forum/me/avatar", { method: "DELETE" }).catch(e => notify(e.message)); b.reload(); } });
    return el("details", { className: "ka-box ka-form" }, el("summary", { textContent: "✎ Редактировать профиль" }),
      el("div", { className: "ka-actions left" }, ava, drop || ""), city, site, about, el("div", { className: "ka-actions" }, save));
  },
};

const SITES = { [FORUM]: KA };

/* ================= стартовая страница ================= */
function homePage(b) {
  const marks = [{ addr: FORUM, name: "Kursk Artists", desc: "форум творцов", glyph: "✶" }];
  const grid = el("div", { className: "br-marks" });
  for (const m of marks)
    grid.append(el("button", { className: "br-mark", onclick: () => b.go(m.addr) },
      el("div", { className: "br-mark-ic", textContent: m.glyph }), el("b", { textContent: m.name }),
      el("span", { textContent: m.desc })));
  return el("div", { className: "br-home" }, el("h1", { textContent: "🌐 Закладки" }), grid,
    el("p", { className: "br-hint", textContent: "Этот браузер ходит только по сайтам nikita.os." }));
}

function notFound(b, addr) {
  return el("div", { className: "br-home" }, el("h1", { textContent: "🙈 Сайт недоступен" }),
    el("p", { className: "br-hint", textContent: `«${addr}» не найден. Этот браузер открывает только сайты из закладок.` }),
    el("button", { className: "ka-btn", textContent: "К закладкам", onclick: () => b.go(HOME) }));
}

/* ================= окно браузера ================= */
let lastActive = null;   // браузер, чей адрес отражается в адресной строке настоящего браузера

class Browser {
  constructor(c, w, start) {
    this.w = w; this.hist = []; this.pos = -1; this.addr = HOME;
    const nb = (t, title, fn) => el("button", { className: "br-nav", textContent: t, title, onclick: fn });
    this.backB = nb("←", "Назад", () => this.step(-1));
    this.fwdB = nb("→", "Вперёд", () => this.step(1));
    this.input = el("input", { className: "br-addr", spellcheck: false });
    this.input.onkeydown = e => { if (e.key === "Enter") this.go(this.input.value); };
    this.input.onfocus = () => this.input.select();
    this.view = el("div", { className: "br-view" });
    this.view.addEventListener("click", e => {   // внутренние ссылки из markdown
      const a = e.target.closest("a[data-nav]");
      if (a) { e.preventDefault(); this.go(a.dataset.nav); }
    });
    c.append(el("div", { className: "br" },
      el("div", { className: "br-bar" }, this.backB, this.fwdB, nb("⟳", "Обновить", () => this.reload()),
        nb("⌂", "Закладки", () => this.go(HOME)), this.input,
        nb("🔗", "Скопировать ссылку", () => this.copy())),
      this.view));
    w.onClose = () => { if (lastActive === this) { lastActive = null; history.replaceState(null, "", "/"); } };
    c.addEventListener("pointerdown", () => this.claimUrl());
    this.go(start || HOME);
  }

  claimUrl() {
    lastActive = this;
    const url = "/browser/" + (this.addr === HOME ? "" : encodeURI(this.addr));
    if (location.pathname + location.search !== url) history.replaceState(null, "", url);
  }

  go(addr, replace = false) {
    addr = normAddr(addr);
    if (replace && this.pos >= 0) this.hist[this.pos] = addr;
    else { this.hist = this.hist.slice(0, this.pos + 1); this.hist.push(addr); this.pos++; }
    this.load(addr);
  }

  step(d) {
    const p = this.pos + d;
    if (p < 0 || p >= this.hist.length) return;
    this.pos = p; this.load(this.hist[p]);
  }

  reload() { this.load(this.addr, true); }

  async load(addr, keepScroll = false) {
    const top = this.view.scrollTop;
    this.addr = addr;
    this.input.value = addr === HOME ? "" : addr;
    this.input.placeholder = "Адрес, например kursk.artists";
    this.backB.disabled = this.pos <= 0; this.fwdB.disabled = this.pos >= this.hist.length - 1;
    this.claimUrl();
    if (addr === HOME) { this.setTitle("Закладки"); return this.paint(homePage(this)); }
    const [path, qs = ""] = addr.split("?");
    const [host, ...parts] = path.split("/").filter(Boolean);
    const site = SITES[host.toLowerCase()];
    if (!site) { this.setTitle("Нет сайта"); return this.paint(notFound(this, addr)); }
    this.setTitle(site.title);
    await site.render(this, parts, new URLSearchParams(qs));
    if (keepScroll) this.view.scrollTop = top;
  }

  paint(node) { this.view.replaceChildren(node); this.view.scrollTop = 0; }
  scrollEnd() { requestAnimationFrame(() => { this.view.scrollTop = this.view.scrollHeight; }); }

  setTitle(t) {
    this.w.setTitle?.("Браузер — " + t);
  }

  async copy() {
    const url = browserUrl(this.addr);
    try { await navigator.clipboard.writeText(url); notify("Ссылка скопирована"); }
    catch { prompt("Ссылка:", url); }
  }
}

function openBrowser(addr) {
  let br;
  WM.open({ title: "Браузер", icon: "🌐", width: 900, height: 640, key: "browser:" + Date.now(),
    render(c, w) { br = new Browser(c, w, addr); } });
  return br;
}

export { openBrowser, md };
