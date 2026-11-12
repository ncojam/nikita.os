import { el } from "../../core/util.js";
import { notify } from "../../ui/notify.js";
import { askAuth, whoami } from "../../ui/auth.js";
import { Juice } from "../../core/juice.js";
import { emojiHint, md, mdEditor } from "../mdkit.js";
import { pickImage } from "../post.js";
import { hydrateTracks, trackCard } from "../trackcard.js";
import { ACTIVITIES, STATUSES, linkKind } from "./data.js";
import { blip, ding, pop, riser, scratch, shake as rattleCan, spray, thud, tick, whoosh } from "./sfx.js";

/* ================= NETWORK (net.work) — нетворкинг криейтеров =================
 * Псевдо-сайт встроенного браузера (browser.js грузит этот модуль лениво). Сервер — network.py + второй экземпляр
 * forum.py (/api/net/forum). Аккаунт — общий для системы, вход — общим окошком askAuth (ui/auth.js).
 *
 * Маршруты:  net.work                      главная
 *            net.work/forum[/<раздел>[/<tid>|/new]]   форум (?page=N|last)
 *            net.work/people?q=&tags=&status=&seeks=&loc=&web=1   люди (фильтры — в адресе)
 *            net.work/match                «найди мне своих»
 *            net.work/wall                 общая стена граффити
 *            net.work/u/<ник>              профиль        net.work/me — свой профиль: редактор / первая анкета
 *            net.work/dm[/<ник>]           личные сообщения (хранятся на сервере)
 * «В сети» — зелёная точка у аватарки: сервер считает онлайн по пингу (pulse, раз в 25 с, пока открыта вкладка)
 * и по открытому чату. Пинг же приносит число непрочитанных — бейдж у «Сообщений».
 *
 * Оформление: розовый / чёрный / мятный, панк. Лого — над левой панелью и вылезает за край окна (крепится к самому
 * окну, а не к странице: страница обрезается окном); при заходе на сайт низ окна «подтекает». enter/leave ставят и
 * убирают это с окна браузера.
 * Звук: запрет — скретч + окно трясётся (deny), добавили пост — «динь», сохранили профиль — баллончик.
 * Переходы тоже звучат (navSound): страница — «шух», ветка — щелчок, профиль — бип, стена — баллончик гремит.
 * Если действие уже прозвучало своим звуком и потом перерисовывает страницу — hush(): переход промолчит.
 */
const HOST = "net.work";
const API = "/api/net", FAPI = "/api/net/forum";
const AVA = { dim: 400, limit: 170 * 1024, qs: [0.92, 0.86, 0.78, 0.68, 0.55] };   // кружок: крупнее и почти без «мыла»
const POST_MAX = 8000;
const fmtDate = ts => !ts ? "—" : new Date(ts * 1000).toLocaleString(globalThis.NOS_LOCALE,
  { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = ts => fmtDate(ts).split(",")[0];

async function api(url, opts = {}) {
  const r = await fetch(url, { cache: "no-store", ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Ошибка " + r.status); e.status = r.status; e.login = d.login; throw e; }
  return d;
}
const send = (url, method, body) => api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ---------- отклик ---------- */
let lastDeny = 0;
function shake(b) {
  const n = b.w.node;
  n.animate([{ translate: "0 0", rotate: "0deg" }, { translate: "-11px 0", rotate: "-0.6deg" }, { translate: "9px 0", rotate: "0.5deg" },
    { translate: "-6px 0", rotate: "-0.3deg" }, { translate: "3px 0" }, { translate: "0 0", rotate: "0deg" }], { duration: 380, easing: "ease-out" });
}
function deny(b, msg) {
  const now = performance.now();
  if (now - lastDeny > 350) { scratch(); shake(b); }
  lastDeny = now;
  if (msg) notify("✋ " + msg, 2600);
}

/* ---------- кусочки интерфейса ---------- */
/* текст сообщения: только текстовые узлы + ссылки http(s) (чужой текст — никогда не innerHTML) */
function linkify(text) {
  const out = [], re = /https?:\/\/[^\s<>"]+/g;
  let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) out.push(text.slice(i, m.index));
    out.push(el("a", { href: m[0], target: "_blank", rel: "noopener nofollow", textContent: m[0] }));
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

const link = (b, addr, text, cls = "") => el("a", { href: "#", className: cls, textContent: text, onclick: e => (e.preventDefault(), b.go(addr)) });

function ava(src, size = "", on = false) {
  const img = src ? el("img", { className: "nw-ava " + size, src, alt: "", loading: "lazy" })
    : el("div", { className: "nw-ava nw-ava-none " + size, textContent: "☠" });
  return el("span", { className: "nw-ava-w " + size }, img, on ? el("i", { className: "nw-on", title: "в сети" }) : "");
}

/* пинг «я в сети» + непрочитанные: пока страница открыта и видна */
let pulseT = 0, unread = 0;
async function pulse() {
  if (document.hidden) return;
  try {
    const d = await api(`${API}/ping`);
    const was = unread; unread = d.unread || 0;
    for (const n of document.querySelectorAll(".nw-badge")) { n.textContent = unread || ""; n.hidden = !unread; }
    if (unread > was && !location.pathname.includes("/net.work/dm/")) blip(true);
  } catch {}
}
function startPulse() { if (!pulseT) { pulseT = setInterval(pulse, 25000); } pulse(); }

function statusPill(st, { full = false } = {}) {
  const S = STATUSES[st?.k] || STATUSES.creating;
  const pill = el("span", { className: "nw-st st-" + (st?.k || "creating"), title: S.ru }, S.icon + " " + S.label);
  if (!full) return pill;
  const box = el("div", { className: "nw-st-full" }, pill);
  if (st?.roles?.length) box.append(el("span", { className: "nw-st-roles" }, ...st.roles.map(r => el("i", { textContent: r }))));
  if (st?.with) box.append(el("span", { className: "nw-st-with", textContent: st.with }));
  return box;
}

function locText(l) {
  if (!l) return "";
  const parts = [l.city, l.country].filter(Boolean);
  if (l.web) parts.push("🌐 web");
  return parts.join(", ");
}

function chips(tags, b, hl = new Set()) {
  return el("div", { className: "nw-chips" }, ...(tags || []).map(t =>
    link(b, `${HOST}/people?tags=${encodeURIComponent(t)}`, t, "nw-chip" + (hl.has(t) ? " hl" : ""))));
}

function personCard(b, p, { why = null, hl = new Set() } = {}) {
  const card = el("div", { className: "nw-card", onclick: e => { if (!e.target.closest("a")) b.go(`${HOST}/u/${p.nick}`); } },
    el("div", { className: "nw-card-top" }, ava(p.ava, "", p.on), el("div", { className: "nw-card-id" },
      el("b", { textContent: p.name || p.nick }), el("small", { textContent: "@" + p.nick }), statusPill(p.status))),
    p.loc && locText(p.loc) ? el("div", { className: "nw-card-loc", textContent: "📍 " + locText(p.loc) }) : "",
    chips((p.tags || []).slice(0, 8), b, hl),
    p.games?.length ? el("div", { className: "nw-card-games", textContent: "🎮 " + p.games.slice(0, 3).join(", ") + (p.games.length > 3 ? "…" : "") }) : "");
  if (p.status?.roles?.length) card.append(el("div", { className: "nw-card-seek" },
    (p.status.k === "collab" ? "🤝 коллаб с: " : "🔎 ищет: ") + p.status.roles.join(", ")));
  if (why?.length) card.append(el("ul", { className: "nw-why" }, ...why.map(w => el("li", { textContent: w }))));
  return card;
}

/* поле тегов с подсказками: заготовки + теги, которые уже указали другие (сервер считает) */
let usedTags = null;
async function tagPool() {
  if (!usedTags) usedTags = api(`${API}/tags`).then(d => d.tags.map(t => t[0])).catch(() => []);
  const used = await usedTags;
  return [...new Set([...ACTIVITIES, ...used])];
}
async function gamePool() {
  if (!usedGames) usedGames = api(`${API}/tags`).then(d => d.games || []).catch(() => []);
  return usedGames;
}
let usedGames = null;
/* games: true — названия игр: регистр сохраняем, длиннее, подсказки — игры, которые указали другие */
function tagInput({ value = [], max = 30, placeholder = "начни вводить…", onLimit, onChange, games = false } = {}) {
  let tags = [...value], pool = [], sel = 0, shown = [];
  (games ? gamePool() : tagPool()).then(p => { pool = p; });
  const box = el("div", { className: "nw-tags" });
  const inp = el("input", { className: "nw-tags-in", placeholder, maxLength: games ? 60 : 32, spellcheck: false });
  const list = el("div", { className: "nw-sug", hidden: true });
  const norm = s => games ? s.replace(/\s+/g, " ").trim().slice(0, 60) : s.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);
  const has = t => tags.some(x => x.toLowerCase() === t.toLowerCase());
  const draw = () => {
    box.replaceChildren(...tags.map(t => el("span", { className: "nw-chip on" }, t,
      el("button", { type: "button", textContent: "×", title: "убрать", onclick: () => { tick(); tags = tags.filter(x => x !== t); draw(); onChange?.(tags); } }))), inp, list);
  };
  const add = t => {
    t = norm(t);
    if (!t || has(t)) { inp.value = ""; return hide(); }
    if (tags.length >= max) return onLimit?.(`не больше ${max}`);
    tags.push(t); inp.value = ""; hide(); draw(); onChange?.(tags); inp.focus(); tick();
  };
  const hide = () => { list.hidden = true; };
  const suggest = () => {
    const q = norm(inp.value);
    if (!q) return hide();
    const ql = q.toLowerCase(), L = t => t.toLowerCase();
    const pre = pool.filter(t => L(t).startsWith(ql) && !has(t)), mid = pool.filter(t => !L(t).startsWith(ql) && L(t).includes(ql) && !has(t));
    shown = [...pre, ...mid].slice(0, 8);
    const exact = pool.some(t => L(t) === ql);
    sel = 0;
    list.replaceChildren(...shown.map((t, i) => {
      const at = t.toLowerCase().indexOf(ql);
      return el("button", { type: "button", className: "nw-sug-it" + (i === sel ? " on" : ""), onmousedown: e => (e.preventDefault(), add(t)) },
        t.slice(0, at), el("mark", { textContent: t.slice(at, at + q.length) }), t.slice(at + q.length));
    }), exact ? "" : el("button", { type: "button", className: "nw-sug-it new", onmousedown: e => (e.preventDefault(), add(q)) }, games ? "＋ игра: " : "＋ свой тег: ", el("b", { textContent: q })));
    list.hidden = false;
  };
  inp.oninput = suggest;
  inp.onblur = () => setTimeout(hide, 120);
  inp.onkeydown = e => {
    const items = [...list.querySelectorAll(".nw-sug-it")];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden || !items.length) return;
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((x, i) => x.classList.toggle("on", i === sel));
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (!list.hidden && items[sel]) items[sel].dispatchEvent(new MouseEvent("mousedown")); else add(inp.value);
    } else if (e.key === "Backspace" && !inp.value && tags.length) { tags.pop(); draw(); onChange?.(tags); }
    else if (e.key === "Escape") hide();
  };
  box.onclick = e => { if (e.target === box) inp.focus(); };
  draw();
  return { node: box, get value() { return [...tags]; }, set value(v) { tags = [...v]; draw(); } };
}

/* адрес в строке браузера без перерисовки страницы (фильтры людей) */
function setAddr(b, addr) {
  b.hist[b.pos] = addr; b.addr = addr; b.input.value = addr; b.claimUrl();
}

/* ================= сайт ================= */
export const NET = {
  title: "NETWORK",

  enter(b) {
    const n = b.w.node;
    if (n.querySelector(".nw-logo")) return;
    n.classList.add("nw-win");
    const word = "NETWORK";
    const logo = el("a", { className: "nw-logo", href: "#", title: "NETWORK — на главную", onclick: e => (e.preventDefault(), b.go(HOST)) },
      ...[...word].map((ch, i) => el("span", { textContent: ch, style: `--i:${i}` })));
    // подтёки по низу окна: размеры в пикселях (не тянутся вместе с окном), гуще к правому краю;
    // каждый «дышит» (тянется и подбирается) и с кончика срывается капля
    const drips = el("div", { className: "nw-drips" });
    const N = 22;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, x = Math.pow(u, 0.62) * 100;          // степень < 1 — плотнее справа
      const w = 6 + ((i * 7) % 5) * 2.2, len = 14 + ((i * 37) % 11) * 7 + (x > 70 ? 18 : 0);
      const black = i % 3 === 1, dur = 2.6 + ((i * 13) % 7) * 0.45, delay = ((i * 29) % 10) / 10;
      drips.append(el("i", { className: "nw-drip" + (black ? " k" : ""),
        style: `left:${x.toFixed(2)}%;--w:${w}px;--l:${len}px;--t:${dur}s;--d:${delay}s` }, el("b")));
    }
    n.append(logo, drips);
    this.placeLogo(b);
    b._netRO = new ResizeObserver(() => this.placeLogo(b));
    b._netRO.observe(n);
  },
  leave(b) {
    const n = b.w.node;
    n.classList.remove("nw-win");
    n.querySelector(".nw-logo")?.remove();
    n.querySelector(".nw-drips")?.remove();
    b._netRO?.disconnect(); b._netRO = null;
    b._wall?.destroy(); b._wall = null;
    delete b.scrollEnd;            // вернуть браузеру его прокрутку (у NETWORK она своя)
  },
  placeLogo(b) {
    const n = b.w.node, top = b.view.getBoundingClientRect().top - n.getBoundingClientRect().top;
    if (top > 0) n.style.setProperty("--nw-top", top + "px");
  },

  async render(b, parts, q) {
    this.enter(b);
    b._wall?.destroy(); b._wall = null;
    const me = await whoami();
    const [a, x, y] = parts.map(decodeURIComponent);
    if (this._quiet) this._quiet = false; else this.navSound(a, x, y);
    const nav = [["", "🏠", "Главная"], ["forum", "💬", "Форум"], ["people", "👥", "Люди"], ["match", "🎯", "Найти своих"],
      ["wall", "🎨", "Стена"], ...(me ? [["dm", "✉", "Сообщения"]] : []), [me ? "me" : "join", "👤", me ? "Мой профиль" : "Вступить"]];
    const side = el("aside", { className: "nw-side" }, el("div", { className: "nw-side-logo" }),
      el("nav", {}, ...nav.map(([r, ic, t]) => el("a", { href: "#", className: "nw-nav" + ((a || "") === r || (r === "me" && a === "u" && x === me) ? " on" : ""),
        onclick: e => (e.preventDefault(), b.go(r ? `${HOST}/${r}` : HOST)) }, el("i", { textContent: ic }), el("span", { textContent: t }),
        r === "dm" ? el("em", { className: "nw-badge", textContent: unread || "", hidden: !unread }) : ""))),
      el("div", { className: "nw-side-sp" }),
      me ? el("div", { className: "nw-side-me" }, el("span", { textContent: "@" + me }),
        el("a", { href: "#", textContent: "выйти", onclick: async e => { e.preventDefault(); await fetch("/api/chat/logout", { method: "POST" }).catch(() => {}); blip(false); this.hush(); b.reload(); } }))
        : el("button", { className: "nw-btn small", textContent: "🔑 Войти", onclick: () => this.login(b) }));
    const main = el("main", { className: "nw-main" });
    if (me) startPulse();
    b.paint(el("div", { className: "nw" }, side, main));
    b.scrollEnd = () => requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });   // у NETWORK своя прокрутка
    this.placeLogo(b);
    const ctx = { b, main, me, q };
    try {
      if (!a) return await this.home(ctx);
      if (a === "forum") return await this.forum(ctx, x, y);
      if (a === "people") return await this.people(ctx);
      if (a === "match") return await this.match(ctx);
      if (a === "wall") return await this.wall(ctx);
      if (a === "u" && x) return await this.profile(ctx, x);
      if (a === "me") return me ? await this.editor(ctx) : b.go(`${HOST}/join`, true);
      if (a === "join") return await this.join(ctx);
      if (a === "dm") return me ? await (x ? this.dialog(ctx, x) : this.talks(ctx)) : b.go(`${HOST}/join`, true);
      throw new Error("Такой страницы нет");
    } catch (e) {
      main.replaceChildren(el("div", { className: "nw-box nw-err" }, el("h2", { textContent: "404 / облом" }), el("p", { textContent: e.message }),
        link(b, HOST, "← на главную")));
    }
  },

  async login(b, why) {
    const nick = await askAuth({ why: why || "Вход в NETWORK — тот же аккаунт, что во всей nikita.os" });
    if (nick) { blip(true); this.hush(); b.reload(); }
    return nick;
  },

  hush() { this._quiet = true; },
  navSound(a, x, y) {
    if (!a || a === "forum" && !x || a === "people") return whoosh();
    if (a === "forum") return y ? pop() : whoosh();
    if (a === "wall") return rattleCan();
    if (a === "u" || a === "me" || a === "join") return blip(true);
    if (a === "dm") return x ? pop() : whoosh();
    if (a === "match") return;                       // там свой звук — свист подбора
    whoosh();
  },

  /* ---------- главная ---------- */
  async home({ b, main, me }) {
    const d = await api(`${API}/home`);
    const cta = me ? el("div", { className: "nw-cta" },
      el("button", { className: "nw-btn big", textContent: "🎯 Найди мне своих", onclick: () => b.go(`${HOST}/match`) }),
      el("button", { className: "nw-btn ghost", textContent: "👥 Все люди", onclick: () => b.go(`${HOST}/people`) }))
      : el("div", { className: "nw-cta" }, el("button", { className: "nw-btn big", textContent: "⚡ Вступить в NETWORK", onclick: () => b.go(`${HOST}/join`) }),
        el("button", { className: "nw-btn ghost", textContent: "👀 Посмотреть людей", onclick: () => b.go(`${HOST}/people`) }));
    const fresh = el("div", { className: "nw-grid" }, ...d.fresh.map(p => personCard(b, p)));
    const threads = el("div", { className: "nw-box" }, ...d.threads.map(t => el("div", { className: "nw-line" },
      link(b, `${HOST}/forum/${t.section}/${t.id}?page=last`, t.title, "nw-strong"),
      el("span", { className: "nw-dim", textContent: ` · ${t.replies} отв. · ${fmtDate(t.last)} · ${t.last_by}` }))));
    if (!d.threads.length) threads.append(el("p", { className: "nw-dim", textContent: "На форуме тишина — начни движ." }));
    main.replaceChildren(
      el("section", { className: "nw-hero" },
        el("h1", { className: "nw-h" }, "сеть ", el("em", { textContent: "криейтеров" }), " без алгоритмов"),
        el("p", { textContent: "Художники, битмейкеры, геймдевы, пиксельщики, скейтеры, вайбкодеры — найди тех, с кем делать штуки. Заполни профиль, поставь статус «wanna collab» — и тебя найдут." }),
        cta,
        el("div", { className: "nw-stats" },
          el("div", {}, el("b", { textContent: d.people }), el("span", { textContent: "криейтеров" })),
          el("div", {}, el("b", { textContent: d.collab }), el("span", { textContent: "ищут коллаб" })),
          el("div", {}, el("b", { textContent: d.strokes }), el("span", { textContent: "штрихов на стене" })))),
      el("h2", { className: "nw-h2", textContent: "Свежие лица" }),
      d.fresh.length ? fresh : el("p", { className: "nw-dim", textContent: "Пока никого. Будь первым ☠" }),
      el("h2", { className: "nw-h2" }, "На форуме ", link(b, `${HOST}/forum`, "→ все разделы", "nw-small")), threads);
  },

  /* ---------- вход и первая анкета ---------- */
  async join({ b, main, me }) {
    if (me) return b.go(`${HOST}/me`, true);
    main.replaceChildren(el("div", { className: "nw-box nw-join" },
      el("h2", { className: "nw-h2", textContent: "Вступить в NETWORK" }),
      el("ol", { className: "nw-steps" },
        el("li", { textContent: "Ник и пароль — один аккаунт на всю nikita.os (чат, форумы, DAWN)." }),
        el("li", { textContent: "Имя, аватарка, ссылки на твои соцсети." }),
        el("li", { textContent: "Чем занимаешься (до 30 тегов) и статус: хочешь коллаб, ищешь кого-то или занят." }),
        el("li", { textContent: "Можно прикрепить свои треки: mp3 или проект DAWN." })),
      el("button", { className: "nw-btn big", textContent: "🔑 Создать аккаунт / войти", onclick: async () => {
        if (await askAuth({ why: "Регистрация в NETWORK (аккаунт работает во всей системе)" })) { blip(true); this.hush(); b.go(`${HOST}/me`, true); }
      } })));
  },

  /* ---------- люди ---------- */
  async people({ b, main, q }) {
    const f = { q: q.get("q") || "", tags: (q.get("tags") || "").split(",").filter(Boolean), status: q.get("status") || "",
      seeks: q.get("seeks") || "", loc: q.get("loc") || "", game: q.get("game") || "", web: q.get("web") === "1", on: q.get("on") === "1",
      page: +(q.get("page") || 1) };
    const text = el("input", { className: "nw-in", placeholder: "🔍 ник, имя, о себе…", value: f.q });
    const tags = tagInput({ value: f.tags, max: 10, placeholder: "деятельность…", onChange: () => apply() });
    const status = el("select", { className: "nw-in" }, el("option", { value: "", textContent: "любой статус" }),
      ...Object.entries(STATUSES).map(([k, s]) => el("option", { value: k, textContent: `${s.icon} ${s.label}`, selected: k === f.status })));
    const seeks = el("input", { className: "nw-in", placeholder: "ищет роль (напр. animator)", value: f.seeks });
    const loc = el("input", { className: "nw-in", placeholder: "📍 город или страна", value: f.loc });
    const web = el("input", { type: "checkbox", checked: f.web });
    const game = el("input", { className: "nw-in", placeholder: "🎮 играет в…", value: f.game });
    const onl = el("input", { type: "checkbox", checked: f.on });
    const grid = el("div", { className: "nw-grid" }), info = el("div", { className: "nw-dim" }), pager = el("div", { className: "nw-pager" });
    let tm = 0;
    const apply = (page = 1) => {
      clearTimeout(tm);
      tm = setTimeout(async () => {
        f.q = text.value.trim(); f.tags = tags.value; f.status = status.value; f.seeks = seeks.value.trim().toLowerCase();
        f.loc = loc.value.trim(); f.game = game.value.trim(); f.web = web.checked; f.on = onl.checked; f.page = page;
        const qs = new URLSearchParams();
        for (const k of ["q", "status", "seeks", "loc", "game"]) if (f[k]) qs.set(k, f[k]);
        if (f.tags.length) qs.set("tags", f.tags.join(","));
        if (f.web) qs.set("web", "1");
        if (f.on) qs.set("on", "1");
        if (page > 1) qs.set("page", page);
        setAddr(b, `${HOST}/people` + (qs.toString() ? "?" + qs : ""));
        try {
          const d = await api(`${API}/people?${qs}`);
          const hl = new Set(f.tags);
          grid.replaceChildren(...d.people.map(p => personCard(b, p, { hl })));
          info.textContent = d.total ? `Нашлось: ${d.total}` : "Никого не нашли. Ослабь фильтры — или позови друзей.";
          pager.replaceChildren(...(d.pages > 1 ? Array.from({ length: d.pages }, (_, i) => i + 1).map(i =>
            i === d.page ? el("b", { textContent: i }) : el("a", { href: "#", textContent: i, onclick: e => (e.preventDefault(), tick(), apply(i)) })) : []));
        } catch (e) { info.textContent = e.message; }
      }, 220);
    };
    for (const i of [text, seeks, loc, game]) i.oninput = () => apply();
    status.onchange = web.onchange = onl.onchange = () => { tick(); apply(); };
    const quick = (t, set) => el("button", { className: "nw-btn ghost small", textContent: t, onclick: () => { tick(); set(); apply(); } });
    main.replaceChildren(
      el("h2", { className: "nw-h2", textContent: "Люди" }),
      el("div", { className: "nw-quick" },
        quick("🤝 кто хочет коллаб", () => { status.value = "collab"; }),
        quick("🔎 кто кого-то ищет", () => { status.value = "looking"; }),
        quick("🟢 кто в сети", () => { onl.checked = true; }),
        quick("🌐 web only", () => { web.checked = true; }),
        quick("✕ сбросить", () => { text.value = seeks.value = loc.value = game.value = status.value = ""; web.checked = onl.checked = false; tags.value = []; }),
        el("button", { className: "nw-btn small", textContent: "🎯 найди мне своих", onclick: () => b.go(`${HOST}/match`) })),
      el("div", { className: "nw-box nw-filters" }, text, tags.node, el("div", { className: "nw-row3" }, status, seeks, loc, game),
        el("div", { className: "nw-row" }, el("label", { className: "nw-check" }, web, " только web (без города)"),
          el("label", { className: "nw-check" }, onl, " только кто в сети"))),
      info, grid, pager);
    apply(f.page);
  },

  async match({ b, main, me }) {
    if (!me) {
      return main.replaceChildren(el("div", { className: "nw-box nw-join" }, el("h2", { className: "nw-h2", textContent: "🎯 Найди мне своих" }),
        el("p", { textContent: "Подбираем людей по твоим занятиям, статусу и городу. Сначала — вступи." }),
        el("button", { className: "nw-btn big", textContent: "⚡ Вступить", onclick: () => b.go(`${HOST}/join`) })));
    }
    const grid = el("div", { className: "nw-grid" }), info = el("p", { className: "nw-dim", textContent: "Ищем…" });
    const btn = el("button", { className: "nw-btn big nw-match-btn", textContent: "🎯 Найти ещё раз" });
    const run = async () => {
      riser();
      btn.disabled = true; grid.classList.add("nw-loading");
      try {
        const d = await api(`${API}/match`);
        grid.replaceChildren(...d.people.map(p => personCard(b, p, { why: p.why })));
        info.textContent = d.people.length ? "Сверху — те, кто ищет тебя и кого ищешь ты. Ниже — общие занятия, город, статус."
          : "Пока совпадений нет. Добавь занятий в профиль или поставь статус «wanna collab».";
        Juice.spawn([...grid.children].slice(0, 8), { sound: false });
      } catch (e) {
        if (e.status === 409) {
          info.replaceChildren("Без профиля не с чем сравнивать. ", link(b, `${HOST}/me`, "Заполни профиль →"));
        } else info.textContent = e.message;
      } finally { btn.disabled = false; grid.classList.remove("nw-loading"); }
    };
    btn.onclick = run;
    main.replaceChildren(el("h2", { className: "nw-h2", textContent: "Найди мне своих" }), btn, info, grid);
    run();
  },

  /* ---------- стена ---------- */
  async wall({ b, main, me }) {
    const { mountWall } = await import("./wall.js");
    let who = me;
    main.replaceChildren(el("h2", { className: "nw-h2", textContent: "Стена" }));
    b._wall = mountWall(main, {
      getMe: () => who,
      askLogin: async why => { who = await askAuth({ why }); return who; },
      deny: m => deny(b, m),
    });
  },

  /* ---------- профиль ---------- */
  async profile({ b, main, me }, nick) {
    let d;
    try { d = await api(`${API}/u/${encodeURIComponent(nick)}`); }
    catch (e) {
      if (me && me.toLowerCase() === nick.toLowerCase()) return b.go(`${HOST}/me`, true);
      throw e;
    }
    const mine = me && me.toLowerCase() === d.nick.toLowerCase();
    const about = el("div", { className: "nw-md" });
    about.innerHTML = d.about ? md(d.about) : "<p class='nw-dim'>О себе — тишина.</p>";
    hydrateTracks(about);
    const links = el("div", { className: "nw-links" }, ...(d.links || []).map(l => {
      const k = linkKind(l.u);
      return el("a", { className: "nw-link k-" + (k?.k || "web"), href: l.u, target: "_blank", rel: "noopener nofollow", title: l.u, onclick: () => pop() },
        el("i", { textContent: k?.icon || "🌐" }), el("span", { textContent: l.t || k?.name || l.u }));
    }));
    const tracks = el("div", { className: "nw-tracks" }, ...(d.tracks || []).map(p => trackCard(p)));
    const threads = el("div", { className: "nw-box" }, ...(d.threads || []).map(t => el("div", { className: "nw-line" },
      link(b, `${HOST}/forum/${t.section}/${t.id}`, t.title, "nw-strong"), el("span", { className: "nw-dim", textContent: " · " + fmtDate(t.created) }))));
    if (!d.threads?.length) threads.append(el("p", { className: "nw-dim", textContent: "Веток пока нет." }));
    main.replaceChildren(
      el("section", { className: "nw-prof" },
        el("div", { className: "nw-prof-ava" }, ava(d.ava, "big", d.on), d.on ? el("div", { className: "nw-on-txt", textContent: "● в сети" }) : ""),
        el("div", { className: "nw-prof-main" },
          el("h1", { className: "nw-prof-name", textContent: d.name || d.nick }),
          el("div", { className: "nw-dim" }, "@" + d.nick, " · с нами с " + fmtDay(d.joined), d.posts ? ` · ${d.posts} постов` : ""),
          statusPill(d.status, { full: true }),
          locText(d.loc) ? el("div", { className: "nw-prof-loc", textContent: "📍 " + locText(d.loc) }) : "",
          mine ? el("button", { className: "nw-btn small", textContent: "✎ Редактировать", onclick: () => b.go(`${HOST}/me`) })
            : el("button", { className: "nw-btn small", textContent: "✉ Написать", onclick: async () => {
              if (me || await this.login(b, "Чтобы писать криейтерам, нужен аккаунт")) b.go(`${HOST}/dm/${d.nick}`);
            } }))),
      d.links?.length ? links : "",
      el("h2", { className: "nw-h2", textContent: "Чем занимается" }), chips(d.tags, b),
      d.games?.length ? el("h2", { className: "nw-h2", textContent: "Сейчас играет" }) : "",
      d.games?.length ? el("div", { className: "nw-chips" }, ...d.games.map(g =>
        link(b, `${HOST}/people?game=${encodeURIComponent(g)}`, "🎮 " + g, "nw-chip nw-game"))) : "",
      d.tracks?.length ? el("h2", { className: "nw-h2", textContent: "Треки" }) : "", d.tracks?.length ? tracks : "",
      el("h2", { className: "nw-h2", textContent: "О себе" }), el("div", { className: "nw-box" }, about),
      el("h2", { className: "nw-h2", textContent: "Ветки на форуме" }), threads);
  },

  /* ---------- редактор профиля (и первая анкета) ---------- */
  async editor({ b, main, me }) {
    const d = await api(`${API}/me`);
    const P = d.profile || { name: "", links: [], tags: [], status: { k: "creating" }, loc: { city: "", country: "", web: false }, about: "", tracks: [] };
    const L = d.limits, first = !d.profile;
    const lim = msg => deny(b, msg);

    // аватарка: до первого сохранения держим у себя, грузим после
    let pendingAva = null, avaUrl = P.ava || null;
    const avaBox = el("div", { className: "nw-ed-ava" });
    const drawAva = () => avaBox.replaceChildren(ava(pendingAva ? URL.createObjectURL(pendingAva) : avaUrl, "big"));
    drawAva();
    const avaPick = el("button", { className: "nw-btn small", type: "button", textContent: "🖼 Загрузить", onclick: async () => {
      const blob = await pickImage(AVA.dim, AVA.limit, AVA.qs);
      if (!blob) return;
      if (blob.size > L.avaKB * 1024) return lim("картинка не ужалась — возьми попроще");
      if (first) { pendingAva = blob; drawAva(); return; }
      try { avaUrl = (await api(`${API}/me/avatar`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob })).url; drawAva(); spray(0.5); }
      catch (e) { lim(e.message); }
    } });
    const avaDel = el("button", { className: "nw-btn ghost small", type: "button", textContent: "убрать", onclick: async () => {
      thud(); pendingAva = null;
      if (avaUrl) { await api(`${API}/me/avatar`, { method: "DELETE" }).catch(e => lim(e.message)); avaUrl = null; }
      drawAva();
    } });

    const name = el("input", { className: "nw-in", maxLength: 40, placeholder: "Имя или псевдоним", value: P.name || "" });

    // ссылки
    const linkRows = el("div", { className: "nw-links-ed" });
    const linkRow = (l = { u: "", t: "" }) => {
      const u = el("input", { className: "nw-in", placeholder: "https://…", value: l.u, maxLength: 300, spellcheck: false });
      const t = el("input", { className: "nw-in nw-link-t", placeholder: "что это?", value: l.t, maxLength: 24 });
      const badge = el("span", { className: "nw-link-kind" });
      const upd = () => {
        const k = /^https?:\/\/\S+\.\S+/.test(u.value.trim()) ? linkKind(u.value.trim()) : null;
        badge.textContent = k ? `${k.icon} ${k.unknown ? "" : k.name}` : "🔗";
        t.placeholder = k && !k.unknown ? `подпись (по умолч. «${k.name}»)` : "что это за ссылка?";
        row.classList.toggle("known", !!k && !k.unknown);
      };
      u.oninput = upd;
      u.onblur = () => { if (u.value.trim() && !/^https?:\/\//i.test(u.value.trim())) { u.value = "https://" + u.value.trim(); upd(); } };
      const row = el("div", { className: "nw-link-row" }, badge, u, t,
        el("button", { className: "nw-x", type: "button", textContent: "×", title: "убрать", onclick: () => { tick(); row.remove(); } }));
      row._get = () => ({ u: u.value.trim(), t: t.value.trim() });
      upd();
      return row;
    };
    (P.links.length ? P.links : [{ u: "", t: "" }]).forEach(l => linkRows.append(linkRow(l)));
    const addLink = el("button", { className: "nw-btn ghost small", type: "button", textContent: "＋ ссылка", onclick: () => {
      if (linkRows.children.length >= L.links) return lim(`не больше ${L.links} ссылок`);
      const r = linkRow(); linkRows.append(r); r.querySelector("input").focus(); tick();
    } });

    const tags = tagInput({ value: P.tags, max: L.tags, placeholder: "digital art, beat maker, skater…", onLimit: lim });

    // статус
    let stK = P.status?.k || "creating";
    const roles = tagInput({ value: P.status?.roles || [], max: 10, placeholder: "роли: animator, vocalist…", onLimit: lim });
    const withIn = el("input", { className: "nw-in", maxLength: 120, placeholder: "с кем (ники или имена)", value: P.status?.with || "" });
    const stExtra = el("div", { className: "nw-st-extra" });
    const stBtns = Object.entries(STATUSES).map(([k, s]) => el("button", { type: "button", className: "nw-st-btn st-" + k,
      onclick: () => { stK = k; drawSt(); tick(); } }, s.icon + " " + s.label));
    const drawSt = () => {
      stBtns.forEach((x, i) => x.classList.toggle("on", Object.keys(STATUSES)[i] === stK));
      const S = STATUSES[stK];
      stExtra.replaceChildren(...(S.roles ? [el("small", { textContent: S.rolesHint }), roles.node] : S.with ? [withIn] : []));
    };
    drawSt();

    const games = tagInput({ value: P.games || [], max: L.games || 20, games: true, placeholder: "THAW, Celeste, Minecraft…", onLimit: lim });
    const city = el("input", { className: "nw-in", maxLength: 60, placeholder: "город", value: P.loc?.city || "" });
    const country = el("input", { className: "nw-in", maxLength: 60, placeholder: "страна", value: P.loc?.country || "" });
    const web = el("input", { type: "checkbox", checked: !!P.loc?.web });

    const about = mdEditor({ value: P.about || "", max: L.about, rows: 5, placeholder: "Пара слов о себе (Markdown)", hint: true,
      onLimit: () => lim(`«О себе» — до ${L.about} символов`), imgApi: `${FAPI}/img` });

    // треки: прикреплённые + свои mp3 + свои проекты DAWN + любой путь в ФС
    let attached = [...(P.tracks || [])], uploads = d.uploads;
    const attBox = el("div", { className: "nw-tracks" }), upBox = el("div", { className: "nw-up" });
    const attach = p => {
      if (attached.includes(p)) return;
      if (attached.length >= L.tracks) return lim(`не больше ${L.tracks} треков в профиле`);
      attached.push(p); drawAtt(); pop();
    };
    const drawAtt = () => attBox.replaceChildren(...(attached.length ? attached.map(p => trackCard(p, { onRemove: () => { tick(); attached = attached.filter(x => x !== p); drawAtt(); } }))
      : [el("p", { className: "nw-dim", textContent: "Пока ничего не прикреплено." })]));
    const dawnBox = el("div", { className: "nw-up" });
    api("/api/dawn/mine").then(m => dawnBox.replaceChildren(...(m.projects.length ? m.projects.map(p => el("div", { className: "nw-up-row" },
      el("span", { textContent: "🌸 " + p.path }), el("button", { className: "nw-btn ghost small", type: "button", textContent: "прикрепить", onclick: () => attach(p.path) })))
      : [el("p", { className: "nw-dim", textContent: "Своих проектов DAWN нет — сохрани проект в DAWN (☁ «Сохранить на сервер»), и он появится здесь." })]))).catch(() => {});
    const drawUp = () => upBox.replaceChildren(...uploads.map(u => el("div", { className: "nw-up-row" },
      el("span", { textContent: `🎵 ${u.name} · ${(u.size / 1048576).toFixed(1)} МБ` }),
      el("button", { className: "nw-btn ghost small", type: "button", textContent: "прикрепить", onclick: () => attach(u.path) }),
      el("button", { className: "nw-x", type: "button", textContent: "🗑", title: "удалить файл", onclick: async () => {
        if (!confirm(`Удалить ${u.name}?`)) return;
        try { uploads = (await api(`${API}/tracks?name=${encodeURIComponent(u.name)}`, { method: "DELETE" })).uploads;
          attached = attached.filter(x => x !== u.path); drawUp(); drawAtt(); thud(); }
        catch (e) { lim(e.message); }
      } }))), el("p", { className: "nw-dim", textContent: `Твоя папка: /home/network/${me} — до ${L.mp3} mp3, каждый до ${L.mp3MB} МБ.` }));
    const upBtn = el("button", { className: "nw-btn small", type: "button", textContent: "⬆ Загрузить mp3", onclick: () => {
      if (uploads.length >= L.mp3) return lim(`можно держать только ${L.mp3} mp3 — удали старый`);
      const inp = el("input", { type: "file", accept: ".mp3,audio/mpeg" });
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        if (!/\.mp3$/i.test(f.name)) return lim("только mp3");
        if (f.size > L.mp3MB * 1048576) return lim(`файл больше ${L.mp3MB} МБ`);
        upBtn.disabled = true; upBtn.textContent = "⏳ грузим…";
        try {
          const r = await api(`${API}/tracks?name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": "audio/mpeg" }, body: f });
          uploads = r.uploads; drawUp(); attach(r.path); ding();
        } catch (e) { lim(e.message); }
        finally { upBtn.disabled = false; upBtn.textContent = "⬆ Загрузить mp3"; }
      };
      inp.click();
    } });
    const pathIn = el("input", { className: "nw-in", placeholder: "/home/nikita/Music/трек.mp3 или …/проект.dawn", spellcheck: false });
    const pathAdd = el("button", { className: "nw-btn ghost small", type: "button", textContent: "＋", onclick: () => {
      const p = "/" + pathIn.value.trim().replace(/^\/+/, "");
      if (!/\.(mp3|dawn|wav|ogg|flac|m4a|opus)$/i.test(p)) return lim("нужен путь к аудиофайлу или .dawn");
      attach(p); pathIn.value = "";
    } });
    drawAtt(); drawUp();

    const save = el("button", { className: "nw-btn big", type: "button", textContent: first ? "⚡ Создать профиль" : "💾 Сохранить" });
    save.onclick = async () => {
      const body = {
        name: name.value, links: [...linkRows.children].map(r => r._get()).filter(l => l.u), tags: tags.value,
        status: { k: stK, roles: roles.value, with: withIn.value }, loc: { city: city.value, country: country.value, web: web.checked },
        about: about.value, tracks: attached, games: games.value,
      };
      if (!body.name.trim()) { name.focus(); return lim("укажи имя"); }
      save.disabled = true;
      try {
        await send(`${API}/me`, "PUT", body);
        if (pendingAva) {
          await api(`${API}/me/avatar`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: pendingAva })
            .catch(e => notify("Аватарка не загрузилась: " + e.message));
        }
        spray();
        notify(first ? "Профиль создан — добро пожаловать в NETWORK ⚡" : "Сохранено");
        usedTags = null;
        this.hush(); b.go(`${HOST}/u/${me}`);
      } catch (e) { lim(e.message); save.disabled = false; }
    };

    const sec = (t, ...kids) => el("section", { className: "nw-box nw-ed-sec" }, el("h3", { textContent: t }), ...kids);
    main.replaceChildren(
      el("h2", { className: "nw-h2", textContent: first ? "Анкета криейтера" : "Мой профиль" }),
      sec("Кто ты", el("div", { className: "nw-ed-who" }, el("div", {}, avaBox, el("div", { className: "nw-row" }, avaPick, avaDel)),
        el("div", { className: "nw-ed-fields" }, el("label", {}, "Ник (логин)", el("input", { className: "nw-in", value: me, disabled: true })),
          el("label", {}, "Имя", name)))),
      sec(`Ссылки (до ${L.links})`, el("p", { className: "nw-dim", textContent: "Twitter/X, Telegram, Instagram, YouTube, SoundCloud, itch.io… распознаем сами. Незнакомую — подпиши." }),
        linkRows, addLink),
      sec(`Чем занимаешься (до ${L.tags})`, el("p", { className: "nw-dim", textContent: "Начни вводить — подсветим знакомые теги. Нет нужного — Enter добавит свой." }), tags.node),
      sec("Статус", el("div", { className: "nw-st-btns" }, ...stBtns), stExtra),
      sec(`Сейчас играю (до ${L.games || 20})`, el("p", { className: "nw-dim", textContent: "Во что рубишься сейчас — найдёшь, с кем поиграть. Подсказываем игры, которые указали другие." }), games.node),
      sec("Где ты", el("div", { className: "nw-row3" }, city, country, el("label", { className: "nw-check" }, web, " 🌐 web only"))),
      sec("О себе", about.node),
      sec(`Треки в профиле (до ${L.tracks})`, attBox,
        el("h4", { textContent: "Мои mp3" }), upBox, upBtn,
        el("h4", { textContent: "Мои проекты DAWN" }), dawnBox,
        el("h4", { textContent: "Любой файл из ФС" }), el("div", { className: "nw-row" }, pathIn, pathAdd)),
      el("div", { className: "nw-save" }, save));
  },

  /* ================= личные сообщения ================= */
  async talks({ b, main }) {
    const d = await api(`${API}/dm`);
    const list = el("div", { className: "nw-box nw-talks" });
    if (!d.talks.length) list.append(el("p", { className: "nw-dim" }, "Пока тихо. ", link(b, `${HOST}/people`, "Найди людей"),
      " и напиши первым — кнопка «✉ Написать» в профиле."));
    for (const t of d.talks) {
      const prev = (t.last.mine ? "ты: " : "") + t.last.text.replace(/\s+/g, " ");
      list.append(el("a", { href: "#", className: "nw-talk" + (t.unread ? " new" : ""), onclick: e => (e.preventDefault(), b.go(`${HOST}/dm/${t.nick}`)) },
        ava(t.ava, "", t.on),
        el("div", { className: "nw-talk-mid" }, el("b", { textContent: t.name || t.nick }), el("small", { className: "nw-dim", textContent: "@" + t.nick + (t.blocked ? " · 🚫 заблокирован" : "") }),
          el("span", { className: "nw-talk-prev", textContent: prev.slice(0, 120) })),
        el("div", { className: "nw-talk-end" }, el("small", { className: "nw-dim", textContent: fmtDate(t.last.t) }),
          t.unread ? el("em", { className: "nw-badge", textContent: t.unread }) : "")));
    }
    main.replaceChildren(el("h2", { className: "nw-h2", textContent: "Сообщения" }), list);
  },

  async dialog({ b, main, me }, nick) {
    const d = await api(`${API}/dm/${encodeURIComponent(nick)}`);
    const P = d.peer, LIM = 2000;
    let first = d.msgs[0]?.id || 0, last = d.msgs.at(-1)?.id || 0, more = d.more, loading = false, blocked = P.blocked;
    main.classList.add("nw-main-dm");
    const feed = el("div", { className: "nw-dm-feed" });
    const bubble = m => {
      const n = el("div", { className: "nw-msg" + (m.mine ? " mine" : "") },
        el("div", { className: "nw-msg-text" }, ...linkify(m.text)),
        el("small", { textContent: fmtDate(m.t).split(", ")[1] + (m.mine ? (m.seen ? " ✓✓" : " ✓") : ""), title: fmtDate(m.t) }));
      n.dataset.id = m.id;
      return n;
    };
    const dayOf = t => new Date(t * 1000).toDateString();
    const put = (msgs, atTop = false) => {
      const nodes = [];
      let prevDay = atTop ? null : feed.lastElementChild?.dataset.day;
      for (const m of msgs) {
        const day = dayOf(m.t);
        if (day !== prevDay) { const dn = el("div", { className: "nw-day", textContent: fmtDay(m.t) }); dn.dataset.day = day; nodes.push(dn); }
        prevDay = day;
        const n = bubble(m); n.dataset.day = day; nodes.push(n);
      }
      if (atTop) {
        feed.prepend(...nodes);
        const nx = nodes.at(-1)?.nextElementSibling;   // тот же день уже подписан ниже — лишнюю подпись убираем
        if (nx?.classList.contains("nw-day") && nx.dataset.day === nodes.at(-1).dataset.day) nx.remove();
      } else feed.append(...nodes);
      return nodes;
    };
    put(d.msgs);
    if (!d.msgs.length) feed.append(el("p", { className: "nw-dim nw-dm-empty", textContent: `Это начало переписки с ${P.name || P.nick}. Напиши что-нибудь 👋` }));
    const scrollDown = () => requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
    scrollDown();
    feed.onscroll = async () => {
      if (feed.scrollTop > 40 || !more || loading || !first) return;
      loading = true;
      try {
        const o = await api(`${API}/dm/${encodeURIComponent(nick)}?before=${first}`);
        const h = feed.scrollHeight;
        put(o.msgs, true); more = o.more; first = o.msgs[0]?.id || first;
        feed.scrollTop = feed.scrollHeight - h;
      } catch {} finally { loading = false; }
    };

    const ta = el("textarea", { className: "nw-in nw-dm-in", rows: 2, maxLength: LIM, placeholder: "Сообщение… (Enter — отправить, Shift+Enter — перенос)" });
    ta.addEventListener("beforeinput", e => {
      if (!e.inputType.startsWith("insert")) return;
      const add = e.data ?? e.dataTransfer?.getData("text") ?? "";
      if (ta.value.length - (ta.selectionEnd - ta.selectionStart) + (add.length || 1) > LIM) deny(b, `Сообщение — до ${LIM} символов`);
    });
    const sendB = el("button", { className: "nw-btn", textContent: "➤" });
    const sendMsg = async () => {
      const text = ta.value.trim();
      if (!text) return deny(b, "Пустое сообщение");
      sendB.disabled = true;
      try {
        const r = await send(`${API}/dm/${encodeURIComponent(nick)}`, "POST", { text });
        feed.querySelector(".nw-dm-empty")?.remove();
        const [node] = put([r.msg]).slice(-1); last = Math.max(last, r.msg.id);
        ta.value = ""; pop(); scrollDown(); Juice.spawn(node, { sound: false });
      } catch (e) { deny(b, e.message); }
      finally { sendB.disabled = false; ta.focus(); }
    };
    sendB.onclick = sendMsg;
    ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

    const dot = el("span", { className: "nw-dm-on" });
    const setOn = on => { dot.textContent = on ? "● в сети" : "не в сети"; dot.classList.toggle("on", on); };
    setOn(P.on);
    const blockB = el("button", { className: "nw-btn ghost small" });
    const drawBlock = () => { blockB.textContent = blocked ? "🔓 разблокировать" : "🚫 блок"; blockB.title = blocked ? "Снова принимать сообщения" : "Не принимать сообщения от этого человека"; };
    drawBlock();
    blockB.onclick = async () => {
      if (!blocked && !confirm(`Не принимать сообщения от ${P.nick}?`)) return;
      try { blocked = (await send(`${API}/dm/${encodeURIComponent(nick)}/block`, "POST", { on: !blocked })).blocked; drawBlock(); blocked ? thud() : tick(); }
      catch (e) { deny(b, e.message); }
    };

    main.replaceChildren(el("div", { className: "nw-dm" },
      el("div", { className: "nw-dm-head" }, link(b, `${HOST}/dm`, "←", "nw-dm-back"), ava(P.ava, "", false),
        el("div", { className: "nw-dm-who" }, link(b, `${HOST}/u/${P.nick}`, P.name || P.nick, "nw-strong"), dot),
        el("span", { className: "nw-sp" }), blockB),
      feed,
      el("div", { className: "nw-dm-compose" }, ta, sendB),
      el("div", { className: "md-foot" }, emojiHint())));
    ta.focus();

    // новые сообщения и «в сети» — опросом, пока открыт этот диалог
    const poll = setInterval(async () => {
      if (!feed.isConnected) return clearInterval(poll);
      if (document.hidden) return;
      try {
        // одним запросом: новые сообщения + последние свои (для галочек «прочитано»)
        const o = await api(`${API}/dm/${encodeURIComponent(nick)}?after=${Math.max(0, last - 30)}`);
        setOn(o.peer.on);
        const fresh = o.msgs.filter(m => !feed.querySelector(`[data-id="${m.id}"]`));
        if (fresh.length) {
          const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
          feed.querySelector(".nw-dm-empty")?.remove();
          put(fresh); last = Math.max(last, ...fresh.map(m => m.id));
          if (fresh.some(m => !m.mine)) blip(true);
          if (near) scrollDown();
        }
        for (const m of o.msgs) if (m.mine && m.seen) {
          const sm = feed.querySelector(`.nw-msg.mine[data-id="${m.id}"] small`);
          if (sm && !sm.textContent.endsWith("✓✓")) sm.textContent = sm.textContent.replace(/ ✓$/, " ✓✓");
        }
      } catch {}
    }, 4000);
  },

  /* ================= форум ================= */
  async forum(ctx, sec, tid) {
    if (!sec) return this.sections(ctx);
    if (tid === "new") return this.newThread(ctx, sec);
    if (tid) return this.thread(ctx, sec, tid);
    return this.section(ctx, sec);
  },

  crumbs(b, list) {
    const c = el("nav", { className: "nw-crumbs" });
    list.forEach(([t, addr], i) => { if (i) c.append(" / "); c.append(addr ? link(b, addr, t) : el("span", { textContent: t })); });
    return c;
  },

  pager(b, base, page, pages) {
    if (pages <= 1) return "";
    return el("div", { className: "nw-pager" }, ...Array.from({ length: pages }, (_, i) => i + 1).map(i =>
      i === page ? el("b", { textContent: i }) : link(b, `${base}?page=${i}`, String(i))));
  },

  async sections({ b, main }) {
    const { sections } = await api(`${FAPI}/sections`);
    main.replaceChildren(el("h2", { className: "nw-h2", textContent: "Форум" }),
      el("div", { className: "nw-secs" }, ...sections.map(s => el("a", { href: "#", className: "nw-sec", onclick: e => (e.preventDefault(), b.go(`${HOST}/forum/${s.id}`)) },
        el("b", { textContent: s.name }), el("span", { className: "nw-dim", textContent: `${s.threads} веток · ${s.posts} постов` }),
        el("small", { className: "nw-dim", textContent: s.last ? "последнее: " + fmtDate(s.last) : "пусто" })))));
  },

  async section({ b, main, me, q }, sid) {
    const d = await api(`${FAPI}/s/${encodeURIComponent(sid)}?page=${q.get("page") || 1}`);
    const list = el("div", { className: "nw-box" });
    if (!d.threads.length) list.append(el("p", { className: "nw-dim", textContent: "Пусто — начни первую ветку." }));
    for (const t of d.threads)
      list.append(el("div", { className: "nw-thr" },
        link(b, `${HOST}/forum/${sid}/${t.id}`, t.title, "nw-strong"),
        el("span", { className: "nw-dim" }, `${t.replies} отв. · от `, link(b, `${HOST}/u/${t.author}`, t.author), ` · ${fmtDate(t.last)} · ${t.last_by}`)));
    main.replaceChildren(this.crumbs(b, [["Форум", `${HOST}/forum`], [d.section.name]]),
      el("div", { className: "nw-titlebar" }, el("h2", { className: "nw-h2", textContent: d.section.name }),
        el("button", { className: "nw-btn", textContent: "✚ Новая ветка", onclick: async () => {
          if (me || await this.login(b, "Чтобы начать ветку, нужен аккаунт")) b.go(`${HOST}/forum/${sid}/new`);
        } })),
      list, this.pager(b, `${HOST}/forum/${sid}`, d.page, d.pages));
  },

  /* редактор поста NETWORK: + трек, подсказка эмодзи, лимит со скретчем */
  editor2(b, opts = {}) {
    return mdEditor({ ...opts, max: POST_MAX, hint: true, imgApi: `${FAPI}/img`, cls: "nw-ed", quota: `${FAPI}/quota`, onTool: tick,
      onLimit: () => deny(b, `Пост — до ${POST_MAX} символов`),
      extra: [{ text: "🎵", title: "Прикрепить трек (mp3 или DAWN)", run: insert => this.pickTrack(b, insert) }] });
  },

  async pickTrack(b, insert) {
    const me = await whoami();
    if (!me) return deny(b, "Войди, чтобы прикреплять треки");
    const [mine, dawn] = await Promise.all([api(`${API}/me`).catch(() => ({})), api("/api/dawn/mine").catch(() => ({ projects: [] }))]);
    const items = [...(mine.profile?.tracks || []), ...(mine.uploads || []).map(u => u.path), ...dawn.projects.map(p => p.path)];
    const uniq = [...new Set(items)];
    const box = el("div", { className: "nw-pick" });
    const close = () => { tick(); box.remove(); };
    pop();
    const pathIn = el("input", { className: "nw-in", placeholder: "или путь: /home/…/трек.mp3", spellcheck: false });
    const put = p => { insert(`\n[[track:${p}]]\n`); close(); };
    box.append(el("div", { className: "nw-pick-in" },
      el("h3", { textContent: "🎵 Прикрепить трек" }),
      uniq.length ? el("div", { className: "nw-pick-list" }, ...uniq.map(p => el("button", { className: "nw-pick-it", onclick: () => put(p) },
        (/\.dawn$/i.test(p) ? "🌸 " : "🎵 ") + p)))
        : el("p", { className: "nw-dim", textContent: "Своих треков нет: загрузи mp3 в профиле или сохрани проект в DAWN." }),
      el("div", { className: "nw-row" }, pathIn, el("button", { className: "nw-btn small", textContent: "＋", onclick: () => {
        const p = "/" + pathIn.value.trim().replace(/^\/+/, "");
        if (!/\.(mp3|dawn|wav|ogg|flac|m4a|opus)$/i.test(p)) return deny(b, "нужен путь к аудиофайлу или .dawn");
        put(p);
      } })),
      el("button", { className: "nw-btn ghost small", textContent: "отмена", onclick: close })));
    box.onclick = e => { if (e.target === box) close(); };
    (b.view.querySelector(".nw") || b.view).append(box);
  },

  async thread({ b, main, me, q }, sid, tid) {
    const page = q.get("page") || "1";
    const d = await api(`${FAPI}/t/${encodeURIComponent(tid)}?page=${page}`);
    const self = `${HOST}/forum/${d.thread.section}/${tid}`;
    const list = el("div", { className: "nw-posts" });
    d.posts.forEach((p, i) => list.append(this.post(b, p, me, d.page === 1 && i === 0, self)));
    let reply;
    if (me) {
      const ed = this.editor2(b, { placeholder: "Твой ответ… (Markdown, 🎵 — трек)", rows: 5 });
      const go = el("button", { className: "nw-btn", textContent: "Ответить" });
      go.onclick = async () => {
        if (!ed.value.trim()) return deny(b, "Пустой пост");
        go.disabled = true;
        try { await send(`${FAPI}/t/${tid}/posts`, "POST", { text: ed.value }); ding(); this.hush(); b.go(`${self}?page=last`, true); }
        catch (e) { deny(b, e.message); go.disabled = false; }
      };
      reply = el("div", { className: "nw-box nw-reply" }, el("h3", { textContent: "Ответить" }), ed.node, el("div", { className: "nw-actions" }, go));
    } else {
      reply = el("div", { className: "nw-box" }, el("a", { href: "#", textContent: "Войди", onclick: e => (e.preventDefault(), this.login(b)) }), ", чтобы ответить.");
    }
    main.replaceChildren(this.crumbs(b, [["Форум", `${HOST}/forum`], [d.section_name, `${HOST}/forum/${d.thread.section}`], [d.thread.title]]),
      el("h2", { className: "nw-h2", textContent: d.thread.title }), this.pager(b, self, d.page, d.pages), list,
      this.pager(b, self, d.page, d.pages), reply);
    if (page === "last") {
      b.scrollEnd();
      const lastPost = list.lastElementChild;
      if (lastPost && sessionStorage.getItem("nw-new") === tid) { sessionStorage.removeItem("nw-new"); Juice.spawn(lastPost, { sound: false }); }
    }
  },

  post(b, p, me, isFirst, self) {
    const body = el("div", { className: "nw-md" });
    body.innerHTML = md(p.text);
    hydrateTracks(body);
    const tools = el("div", { className: "nw-post-tools" }, el("span", { className: "nw-dim", textContent: fmtDate(p.created) + (p.edited ? " · изм." : "") }));
    const box = el("article", { className: "nw-post" + (isFirst ? " first" : "") },
      el("aside", { className: "nw-post-side" }, ava(p.ava, "", p.on), link(b, `${HOST}/u/${p.author}`, p.name || p.author, "nw-strong"),
        p.name ? el("small", { className: "nw-dim", textContent: "@" + p.author }) : "", p.st ? statusPill({ k: p.st }) : ""),
      el("div", { className: "nw-post-body" }, tools, body));
    if (me && me === p.author) {
      tools.append(el("span", { className: "nw-sp" }),
        el("a", { href: "#", textContent: "изменить", onclick: e => {
          e.preventDefault(); pop();
          const ed = this.editor2(b, { value: p.text });
          const save = el("button", { className: "nw-btn", textContent: "Сохранить" });
          save.onclick = async () => {
            save.disabled = true;
            try { await send(`${FAPI}/p/${p.id}`, "PATCH", { text: ed.value }); ding(); this.hush(); b.reload(); }
            catch (er) { deny(b, er.message); save.disabled = false; }
          };
          body.replaceWith(el("div", {}, ed.node, el("div", { className: "nw-actions" },
            el("button", { className: "nw-btn ghost", textContent: "Отмена", onclick: () => { tick(); this.hush(); b.reload(); } }), save)));
        } }),
        el("a", { href: "#", className: "nw-danger", textContent: isFirst ? "удалить ветку" : "удалить", onclick: async e => {
          e.preventDefault();
          if (!confirm(isFirst ? "Удалить всю ветку со всеми ответами?" : "Удалить пост?")) return;
          try { const r = await api(`${FAPI}/p/${p.id}`, { method: "DELETE" });
            thud(); this.hush();
            r.thread_gone ? b.go(self.split("/").slice(0, 3).join("/")) : b.reload(); }
          catch (er) { deny(b, er.message); }
        } }));
    }
    return box;
  },

  newThread({ b, main, me }, sid) {
    if (!me) return b.go(`${HOST}/join`, true);
    const title = el("input", { className: "nw-in", maxLength: 100, placeholder: "Заголовок ветки" });
    title.addEventListener("beforeinput", e => { if (e.inputType.startsWith("insert") && title.value.length >= 100 && title.selectionStart === title.selectionEnd) deny(b, "Заголовок — до 100 символов"); });
    const ed = this.editor2(b, { placeholder: "Первый пост… (Markdown, 🎵 — прикрепить трек)", rows: 10 });
    const go = el("button", { className: "nw-btn", textContent: "Создать ветку" });
    go.onclick = async () => {
      if (!title.value.trim() || !ed.value.trim()) return deny(b, "Нужны заголовок и текст");
      go.disabled = true;
      try {
        const d = await send(`${FAPI}/threads`, "POST", { section: sid, title: title.value, text: ed.value });
        ding(); this.hush(); sessionStorage.setItem("nw-new", d.id);
        b.go(`${HOST}/forum/${d.section}/${d.id}?page=last`, true);
      } catch (e) { deny(b, e.message); go.disabled = false; }
    };
    main.replaceChildren(this.crumbs(b, [["Форум", `${HOST}/forum`], [sid, `${HOST}/forum/${sid}`], ["Новая ветка"]]),
      el("div", { className: "nw-box nw-form" }, el("h2", { className: "nw-h2", textContent: "Новая ветка" }), title, ed.node,
        el("div", { className: "nw-actions" }, go)));
    title.focus();
  },
};
