/* ================= языки ОС =================
 * Исходный язык интерфейса — русский: строки в коде пишутся по-русски, а языковые пакеты (js/i18n/*.js)
 * сопоставляют русской строке перевод: addPack({ "Настройки": ["Settings", "設定"] }) — [английский, японский].
 * В строке можно оставить места {0}, {1}… — тогда она работает как шаблон: «Удалить {0}?» поймает «Удалить a.mp3?».
 *
 * Переводить каждое место в коде не нужно: init_i18n() следит за DOM (MutationObserver) и меняет текст
 * и подсказки (title, placeholder, aria-label), если для них есть перевод. Новые приложения получают перевод,
 * просто добавив свой пакет. В коде, где текст не попадает в DOM (canvas, confirm), используйте t("…").
 *
 * Язык: cookie nos_lang → иначе по часовому поясу (местоположению) → иначе английский.
 * Если у строки нет японского перевода, показывается английский.
 */
export const LANGS = [["ru", "Русский"], ["en", "English"], ["ja", "日本語"]];
const IDX = { en: 0, ja: 1 };
const exact = new Map();     // ключ → [en, ja]
const patterns = [];         // { re, out: [en, ja] }
const long = [];             // длинные ключи — ищутся и как подстроки (склеенный из кусков текст)

const RU_TZ = /^(Europe\/(Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Simferopol|Minsk)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Bishkek))$/;
function detect() {
  const c = document.cookie.match(/(?:^|;\s*)nos_lang=(ru|en|ja)/);
  if (c) return c[1];
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* старый браузер */ }
  if (tz === "Asia/Tokyo") return "ja";
  if (RU_TZ.test(tz)) return "ru";
  return "en";   // для страны нет своего языка — английский
}
export const lang = detect();
export const locale = { ru: "ru-RU", en: "en-US", ja: "ja-JP" }[lang];
globalThis.NOS_LOCALE = locale;   // для toLocaleString без импорта

export function setLang(l) {
  document.cookie = `nos_lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  location.reload();   // проще и надёжнее, чем перерисовывать каждое открытое окно
}

const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
export function addPack(dict) {
  for (const [k, v] of Object.entries(dict)) {
    if (/\{\d\}/.test(k)) {
      const re = new RegExp("^" + esc(k).replace(/\\?\{(\d)\\?\}/g, "(.+?)").replace(/\{(\d)\}/g, "(.+?)") + "$", "s");
      patterns.push({ re, out: v });
    } else {
      exact.set(k, v);
      if (k.length >= 24) long.push(k);
    }
  }
  long.sort((a, b) => b.length - a.length);
}

const fill = (s, args) => s.replace(/\{(\d)\}/g, (m, i) => args[+i] ?? m);
/* перевод строки целиком (или шаблона); null — перевода нет */
function tr(s) {
  const v = exact.get(s);
  if (v) return (v[IDX[lang]] ?? v[0]) ?? null;
  for (const p of patterns) {
    const m = s.match(p.re);
    if (!m) continue;
    // подставляемые части — числа, имена, пути или переводимые фразы; русский текст внутри значит, что шаблон поймал лишнее
    const args = m.slice(1).map(x => tr(x.trim()) ?? x);
    if (args.some(x => /[А-Яа-яЁё]{3}/.test(x) && x.split(/\s+/).length > 2)) continue;
    const out = p.out[IDX[lang]] ?? p.out[0];
    return out == null ? null : fill(out, args);
  }
  return null;
}
const CYR = /[А-Яа-яЁё]/;
/* для текста из DOM: сохраняем эмодзи/знаки по краям, пробуем целиком, потом длинные куски */
function translate(text) {
  if (!CYR.test(text)) return null;
  let whole = tr(text);
  if (whole == null) {
    // эмодзи/знаки/пробелы по краям оставляем как есть, переводим середину (с хвостовой пунктуацией и без)
    const pre = text.match(/^(?:[^\p{L}«"(]|ℹ)*/u)[0], rest = text.slice(pre.length);
    const ws = rest.match(/\s*$/)[0], core = rest.slice(0, rest.length - ws.length);
    const sym = core.match(/[^\p{L}\p{N}»")]*$/u)[0], bare = core.slice(0, core.length - sym.length);
    const a = tr(core), b = a == null && bare ? tr(bare) : null;
    if (a != null) whole = pre + a + ws; else if (b != null) whole = pre + b + sym + ws;
  }
  if (whole != null) return whole;
  // текст склеен из нескольких фраз — меняем известные длинные куски
  let out = text, hit = false;
  for (const k of long) if (out.includes(k)) { const v = exact.get(k)[IDX[lang]] ?? exact.get(k)[0]; if (v != null) { out = out.split(k).join(v); hit = true; } }
  return hit ? out : null;
}

/* для кода: t("Удалить {0}?", name) */
export function t(s, ...args) {
  const r = lang === "ru" ? s : (exact.get(s)?.[IDX[lang]] ?? exact.get(s)?.[0] ?? s);
  return args.length ? fill(r, args) : r;
}

const ATTRS = ["title", "placeholder", "aria-label"];
const SKIP = "script, style, textarea, input, [contenteditable], [data-no-i18n], .no-i18n";   // текст не трогаем
const NOATTR = "[data-no-i18n], .no-i18n";                                                     // подсказки — у всех, кроме этих
function walk(root) {
  if (root.nodeType === 3) return node(root);
  if (root.nodeType !== 1 || root.closest?.(NOATTR)) return;
  attrs(root);
  if (root.closest(SKIP)) return;
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => n.nodeType === 1 && n.matches(NOATTR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? node(n) : attrs(n);
}
function node(n) {
  if (n.parentElement?.closest(SKIP)) return;
  const r = translate(n.nodeValue);
  if (r != null && r !== n.nodeValue) n.nodeValue = r;
}
function attrs(e) {
  if (e.closest?.(NOATTR)) return;
  for (const a of ATTRS) {
    const v = e.getAttribute?.(a);
    if (!v) continue;
    const r = translate(v);
    if (r != null && r !== v) e.setAttribute(a, r);
  }
}

export function init_i18n() {
  document.documentElement.lang = lang;
  if (lang === "ru") return;
  // системные диалоги не в DOM — переводим их текст на входе
  for (const f of ["alert", "confirm", "prompt"]) {
    const orig = window[f].bind(window);
    window[f] = (msg, ...rest) => orig(msg == null ? msg : translate(String(msg)) ?? String(msg), ...rest);
  }
  walk(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "characterData") node(m.target);
      else if (m.type === "attributes") attrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
