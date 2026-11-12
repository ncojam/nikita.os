import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { pickImage } from "./post.js";

/* ================= Markdown форумов (Kursk Artists, NETWORK) =================
 * md(src) — свой мини-рендер: СНАЧАЛА экранирует весь текст, потом размечает. Поэтому в innerHTML безопасно.
 * Картинки — только наши (/media/...). Ссылки на псевдо-сайты (kursk.artists/…, net.work/…, …/browser/…)
 * получают data-nav — браузер откроет их у себя.
 * Трек: [[track:/путь/к/файлу.mp3]] или .dawn — рисуется заглушкой <span class="md-trk" data-path>,
 * а оживляет её hydrateTracks() из trackcard.js (кнопки, плеер, DAWN).
 *
 * mdEditor(opts) — панель кнопок + textarea + превью. opts:
 *   value, placeholder, rows, max (потолок символов), imgApi (куда грузить картинку), imgDim/imgLimit,
 *   extra: [кнопки] — добавить в панель (напр. «трек»), onLimit() — упёрлись в потолок (звук, тряска),
 *   hint: true — подсказка, как открыть выбор эмодзи с клавиатуры;
 *   quota: адрес …/quota — полоска «склад картинок: занято / 10 МБ» (обновляется после загрузки картинки);
 *   onTool() — нажали кнопку панели (звук).
 */
export const SITE_HOSTS = /^(kursk\.artists|net\.work)(\/|$)/i;
const TRACK_RE = /\[\[track:(\/[^\]\n]{1,300}?\.(?:mp3|dawn|wav|ogg|flac|m4a|opus))\]\]/gi;

export const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function normAddr(a) {
  a = String(a || "").trim();
  a = a.replace(/^https?:\/\/[^/]+\/browser\/?/i, "");
  return a.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
}

function linkTag(u, text) {
  const inner = normAddr(u.replace(/&amp;/g, "&"));
  const ours = /^https?:\/\/[^/]+\/browser\//i.test(u) && u.startsWith(location.origin) || SITE_HOSTS.test(u);
  if (ours) return `<a href="#" data-nav="${esc(inner)}">${text}</a>`;
  if (/^https?:\/\//i.test(u)) return `<a href="${u}" target="_blank" rel="noopener nofollow">${text}</a>`;
  return text;
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => (codes.push(c), `\u0000${codes.length - 1}\u0000`));
  s = s.replace(TRACK_RE, (_, p) => (codes.push(`<span class="md-trk" data-path="${p}"></span>`), `\u0001${codes.length - 1}\u0001`));
  s = s.replace(/!\[([^\]\n]*)\]\((\/media\/[A-Za-z0-9/_-]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t, u) => linkTag(u, t));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, u) => pre + linkTag(u, u));
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
       .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>")
       .replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<i>$2</i>")
       .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
          .replace(/\u0001(\d+)\u0001/g, (_, i) => codes[i]);
}

export function md(src) {
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

/* ---------- подсказка: как открыть выбор эмодзи клавиатурой ---------- */
const EMOJI_KEYS = [
  ["Windows", "Win + .  (или Win + ;)"],
  ["macOS", "Ctrl + Cmd + Пробел  (или Fn / 🌐 + E)"],
  ["Linux · GNOME", "Ctrl + .  или  Ctrl + ;  (в полях GTK)"],
  ["Linux · KDE", "Meta + .  — Emoji Selector"],
  ["ChromeOS", "Поиск + Shift + Пробел"],
  ["Телефон", "кнопка 😀 на клавиатуре"],
];
function osName() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "").toLowerCase();
  if (/android|iphone|ipad/.test(navigator.userAgent.toLowerCase())) return "Телефон";
  if (p.includes("win")) return "Windows";
  if (p.includes("mac")) return "macOS";
  if (p.includes("cros")) return "ChromeOS";
  if (p.includes("linux")) return /kde|plasma/i.test(navigator.userAgent) ? "Linux · KDE" : "Linux · GNOME";
  return "Windows";
}
export function emojiHint() {
  const mine = osName(), row = EMOJI_KEYS.find(r => r[0] === mine) || EMOJI_KEYS[0];
  const tip = EMOJI_KEYS.map(([os, k]) => `${os}: ${k}`).join("\n");
  return el("span", { className: "md-emoji-hint", title: "Выбор эмодзи с клавиатуры:\n" + tip },
    "😀 эмодзи: ", el("kbd", { textContent: row[1] }));
}

/* ---------- редактор ---------- */
export function mdEditor({ value = "", placeholder = "Текст (поддерживается Markdown)", rows = 8, max = 8000,
  imgApi = "/api/forum/img", imgDim = 800, imgLimit = 110 * 1024, extra = [], onLimit = null, hint = false, cls = "",
  quota = null, onTool = null } = {}) {
  const ta = el("textarea", { className: "ka-ta", rows, maxLength: max, value, placeholder });
  const prev = el("div", { className: "ka-md ka-prev", hidden: true });
  const count = el("span", { className: "md-count" });
  const recount = () => {
    const n = ta.value.length;
    count.textContent = n > max * 0.8 ? `${n} / ${max}` : "";
    count.classList.toggle("full", n >= max);
  };
  // упёрлись в потолок: maxLength молча обрежет — а мы скажем об этом (звук, тряска окна)
  ta.addEventListener("beforeinput", e => {
    if (!e.inputType.startsWith("insert")) return;
    const add = e.data ?? e.dataTransfer?.getData("text") ?? (e.inputType === "insertLineBreak" ? "\n" : "");
    if (ta.value.length - (ta.selectionEnd - ta.selectionStart) + (add.length || 1) > max) onLimit?.();
  });
  ta.addEventListener("input", recount);
  const wrap = (a, b = a) => () => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    if (v.length + a.length + b.length > max) return onLimit?.();
    ta.value = v.slice(0, s) + a + v.slice(s, e) + b + v.slice(e);
    ta.focus(); ta.selectionStart = s + a.length; ta.selectionEnd = e + a.length; recount();
  };
  const insert = t => {
    if (ta.value.length + t.length > max) return onLimit?.();
    const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + t + ta.value.slice(ta.selectionEnd);
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + t.length; recount();
  };
  const btn = (t, title, fn) => el("button", { className: "ka-tool", type: "button", textContent: t, title, onclick: () => { onTool?.(); fn(); } });
  // склад картинок человека: полоска под редактором
  const qBar = el("i"), qText = el("span");
  const qBox = quota ? el("span", { className: "md-quota", title: "Склад твоих картинок на этом форуме" }, qText, el("b", {}, qBar)) : "";
  const fmtMB = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0);
  const loadQuota = async () => {
    if (!quota) return;
    try {
      const q = await (await fetch(quota, { cache: "no-store" })).json();
      const k = q.cap ? Math.min(1, q.used / q.cap) : 0;
      qText.textContent = `🖼 ${fmtMB(q.used)} / ${fmtMB(q.cap)} МБ`;
      qBar.style.width = (k * 100).toFixed(1) + "%";
      qBox.classList.toggle("warn", k > 0.75); qBox.classList.toggle("full", k >= 0.98);
    } catch {}
  };
  const imgBtn = btn("🖼", `Картинка (сожмём до ${imgDim}px)`, async () => {
    const blob = await pickImage(imgDim, imgLimit);
    if (!blob) return;
    imgBtn.disabled = true;
    try {
      const r = await fetch(imgApi, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Ошибка " + r.status);
      insert(`\n![картинка](${d.url})\n`);
    } catch (e) { notify(e.message); onLimit?.(); } finally { imgBtn.disabled = false; loadQuota(); }
  });
  const prevBtn = btn("👁 Превью", "Показать как будет", () => {
    const on = prev.hidden;
    prev.hidden = !on; ta.hidden = on;
    if (on) { prev.innerHTML = md(ta.value) || "<p class='ka-muted'>(пусто)</p>"; ed.onPreview?.(prev); }
    prevBtn.classList.toggle("on", on);
  });
  const bar = el("div", { className: "ka-toolbar" },
    btn("B", "Жирный", wrap("**")), btn("I", "Курсив", wrap("*")), btn("S", "Зачёркнутый", wrap("~~")),
    btn("</>", "Код", wrap("`")), btn("❝", "Цитата", wrap("> ", "")), btn("🔗", "Ссылка", wrap("[", "](https://)")),
    imgBtn, ...extra.map(x => btn(x.text, x.title, () => x.run(insert))), el("span", { className: "ka-sp" }), count, prevBtn);
  const foot = hint || quota ? el("div", { className: "md-foot" }, qBox, el("span", { className: "ka-sp" }), hint ? emojiHint() : "") : "";
  loadQuota();
  const ed = { node: el("div", { className: "ka-editor " + cls }, bar, ta, prev, foot), ta, insert, onPreview: null,
    get value() { return ta.value; }, set value(v) { ta.value = v; recount(); } };
  recount();
  return ed;
}
