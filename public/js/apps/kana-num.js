import { el, store } from "../core/util.js";
import { WM } from "../wm.js";

/* ================= Кана: числа и время =================
 * Окно «Числа»: 0–10, десятки, сотни/тысячи/万 (неправильные чтения подсвечены), конвертер любого числа,
 * половины (半), часы и минуты (ふん/ぷん) и конструктор «который час». Под каждым знаком — латиница.
 * Чтения считаются функциями ниже — таблицы и конвертер используют одни и те же правила.
 */
const D = [["ゼロ", "zero", "〇"], ["いち", "ichi", "一"], ["に", "ni", "二"], ["さん", "san", "三"], ["よん", "yon", "四"],
  ["ご", "go", "五"], ["ろく", "roku", "六"], ["なな", "nana", "七"], ["はち", "hachi", "八"], ["きゅう", "kyū", "九"]];
const ALT = { 0: "れい rei", 4: "し shi", 7: "しち shichi", 9: "く ku" };
const NOTE = {
  2: "二 читается ni — как катакана ニ, и выглядит почти так же",
  3: "三 — иероглиф «три», не катакана ミ: у 三 линии горизонтальные, нижняя длиннее",
  4: "し звучит как «смерть» — поэтому обычно よん",
  9: "く звучит как «мучение» — поэтому обычно きゅう",
};
// неправильные слияния: сотни и тысячи
const HUND = { 1: ["ひゃく", "hyaku"], 3: ["さんびゃく", "sanbyaku"], 6: ["ろっぴゃく", "roppyaku"], 8: ["はっぴゃく", "happyaku"] };
const THOU = { 1: ["せん", "sen"], 3: ["さんぜん", "sanzen"], 8: ["はっせん", "hassen"] };
const isIrr = (unit, d) => (unit === 100 && [3, 6, 8].includes(d)) || (unit === 1000 && [3, 8].includes(d));

// число 1..9999 → куски [{k, r, v}] (кана, ромадзи, значение куска) и иероглифы
function under10k(n) {
  const parts = [];
  const th = Math.floor(n / 1000), h = Math.floor(n / 100) % 10, t = Math.floor(n / 10) % 10, u = n % 10;
  if (th) parts.push(THOU[th] ? { k: THOU[th][0], r: THOU[th][1], v: th * 1000 } : { k: D[th][0] + "せん", r: D[th][1] + "sen", v: th * 1000 });
  if (h) parts.push(HUND[h] ? { k: HUND[h][0], r: HUND[h][1], v: h * 100 } : { k: D[h][0] + "ひゃく", r: D[h][1] + "hyaku", v: h * 100 });
  if (t) parts.push(t === 1 ? { k: "じゅう", r: "jū", v: 10 } : { k: D[t][0] + "じゅう", r: D[t][1] + "jū", v: t * 10 });
  if (u) parts.push({ k: D[u][0], r: D[u][1], v: u });
  const kj = (d, s) => d ? (d === 1 && s ? "" : D[d][2]) + s : "";
  return { parts, kanji: kj(th, "千") + kj(h, "百") + kj(t, "十") + kj(u, "") };
}
export function readNum(n) {
  n = Math.floor(n);
  if (n === 0) return { parts: [{ k: "ゼロ", r: "zero", v: 0 }], kanji: "〇" };
  const man = Math.floor(n / 10000), rest = n % 10000, out = { parts: [], kanji: "" };
  if (man) {
    const m = under10k(man);
    out.parts.push({ k: (man === 1 ? "いち" : m.parts.map(p => p.k).join("")) + "まん", r: (man === 1 ? "ichi" : m.parts.map(p => p.r).join("")) + "man", v: man * 10000 });
    out.kanji = (man === 1 ? "一" : m.kanji) + "万";
  }
  if (rest) { const r = under10k(rest); out.parts.push(...r.parts); out.kanji += r.kanji; }
  return out;
}

// часы: 4, 7, 9 — особые
const HOUR = { 4: ["よじ", "yoji"], 7: ["しちじ", "shichiji"], 9: ["くじ", "kuji"] };
export const readHour = h => {
  if (HOUR[h]) return HOUR[h];
  const r = readNum(h).parts;
  return [r.map(x => x.k).join("") + "じ", r.map(x => x.r).join("") + "ji"];
};
// минуты: ふん после 2, 5, 7, 9; ぷん (с удвоением) после 1, 3, 4, 6, 8, 10
const MIN1 = { 1: ["いっぷん", "ippun"], 2: ["にふん", "nifun"], 3: ["さんぷん", "sanpun"], 4: ["よんぷん", "yonpun"], 5: ["ごふん", "gofun"],
  6: ["ろっぷん", "roppun"], 7: ["ななふん", "nanafun"], 8: ["はっぷん", "happun"], 9: ["きゅうふん", "kyūfun"] };
export function readMin(m) {
  const t = Math.floor(m / 10), u = m % 10;
  if (!u) return t === 1 ? ["じゅっぷん", "juppun"] : [D[t][0] + "じゅっぷん", D[t][1] + "juppun"];
  const pre = t === 0 ? ["", ""] : t === 1 ? ["じゅう", "jū"] : [D[t][0] + "じゅう", D[t][1] + "jū"];
  return [pre[0] + MIN1[u][0], pre[1] + MIN1[u][1]];
}

// ---------- отрисовка ----------
const tok = (k, r, g, p) => el("span", { className: "kn-tok" + (p ? " p" : "") },
  el("span", { className: "kn-tk", textContent: k }), el("span", { className: "kn-tr", textContent: r }),
  g != null ? el("span", { className: "kn-tg", textContent: g }) : "");
const sent = (toks, ru) => el("div", { className: "kn-ex" }, el("div", { className: "kn-sent" }, ...toks), ru ? el("div", { className: "kn-ru", textContent: ru }) : "");
const fmt = n => n.toLocaleString("ru-RU");

function numCard(n, opts = {}) {
  const r = readNum(n);
  return el("div", { className: "kn-ncard" + (opts.irr ? " irr" : ""), title: opts.irr ? "Неправильное чтение — звук сливается" : "" },
    el("span", { className: "kn-nv", textContent: fmt(n) }),
    el("span", { className: "kn-nk", textContent: r.kanji }),
    el("span", { className: "kn-nr", textContent: r.parts.map(p => p.k).join("") }),
    el("span", { className: "kn-nro", textContent: r.parts.map(p => p.r).join(" ") }),
    opts.alt ? el("span", { className: "kn-nalt", textContent: "или " + opts.alt }) : "",
    opts.note ? el("span", { className: "kn-nnote", textContent: opts.note }) : "");
}

export function openKanaNumbers() {
  WM.open({ title: "Числа и время", icon: "一", width: 800, height: 640, key: "kana:num", render(c) {
    c.classList.add("kn", "kn-gram");
    const nav = el("div", { className: "kn-nav" }), body = el("div", { className: "kn-gbody" });
    c.append(nav, body);
    const sec = (navLabel, title, ...kids) => {
      const s = el("section", { className: "kn-sec" }, el("h3", { textContent: title }), ...kids);
      body.append(s);
      nav.append(el("button", { className: "kn-btn small", textContent: navLabel, onclick: () => s.scrollIntoView({ behavior: "smooth", block: "start" }) }));
    };
    const grid = cards => el("div", { className: "kn-ngrid" }, ...cards);
    const p = (t, cls = "") => el("p", { className: cls, textContent: t });

    sec("0–10", "От нуля до десяти",
      grid([...Array(11).keys()].map(n => numCard(n, { alt: ALT[n], note: NOTE[n] }))),
      p("Дальше всё строится из этих кирпичиков: 11 = 10 + 1 (じゅういち), 20 = 2 × 10 (にじゅう), 23 = にじゅうさん.", "kn-muted"));

    sec("Десятки", "Десятки", grid([10, 20, 30, 40, 50, 60, 70, 80, 90].map(n => numCard(n))),
      p("Просто «цифра + じゅう». Для 4, 7, 9 берём よん, なな, きゅう.", "kn-muted"));

    sec("100 · 1000", "Сотни и тысячи",
      grid([100, 200, 300, 400, 500, 600, 700, 800, 900].map(n => numCard(n, { irr: isIrr(100, n / 100) }))),
      grid([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000].map(n => numCard(n, { irr: isIrr(1000, n / 1000) }))),
      p("Розовые — неправильные: звук сливается. 300 さんびゃく, 600 ろっぴゃく, 800 はっぴゃく, 3000 さんぜん, 8000 はっせん. 100 и 1000 — без «いち»: просто ひゃく и せん.", "kn-muted"));

    sec("万", "万 — десять тысяч",
      grid([10000, 100000, 1000000].map(n => numCard(n))),
      p("Японцы группируют нули по четыре, а не по три: 100 000 — это «10 万» (じゅうまん), миллион — «100 万» (ひゃくまん). Для 10 000 «いち» обязательно: いちまん.", "kn-muted"));

    // конвертер
    const inp = el("input", { type: "number", min: 0, max: 99999999, value: store.get("kana.num", 2026), className: "kn-ninput" });
    const out = el("div");
    const conv = () => {
      const n = Math.max(0, Math.min(99999999, Math.floor(+inp.value || 0)));
      store.set("kana.num", n);
      const r = readNum(n);
      out.replaceChildren(sent(r.parts.map(x => tok(x.k, x.r, fmt(x.v))), r.kanji));
    };
    inp.oninput = conv; conv();
    sec("Любое число", "Прочитай любое число", el("label", { className: "kn-bsel" }, el("span", { textContent: "Число (до 99 999 999)" }), inp), out);

    sec("半", "Половина — 半 (はん)",
      sent([tok("さんじ", "sanji", "3 часа"), tok("はん", "han", "половина", true)], "Половина четвёртого (3:30)"),
      sent([tok("いちじかん", "ichijikan", "1 час (длительность)"), tok("はん", "han", "половина", true)], "Полтора часа"),
      sent([tok("はんぶん", "hanbun", "половина")], "Половина (чего-то): はんぶん ください — половину, пожалуйста"),
      sent([tok("はんとし", "hantoshi", "полгода")], "Полгода"),
      p("半 после числа = «с половиной». Само по себе «половина чего-то» — はんぶん (半分).", "kn-muted"));

    // часы
    const hourCards = [...Array(12).keys()].map(i => i + 1).map(h => {
      const [k, r] = readHour(h);
      return el("div", { className: "kn-ncard" + (HOUR[h] ? " irr" : "") }, el("span", { className: "kn-nv", textContent: h + ":00" }),
        el("span", { className: "kn-nr", textContent: k }), el("span", { className: "kn-nro", textContent: r }));
    });
    const minCards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30].map(m => {
      const [k, r] = readMin(m);
      return el("div", { className: "kn-ncard" + ([1, 3, 4, 6, 8, 10, 20, 30].includes(m) ? " pun" : "") }, el("span", { className: "kn-nv", textContent: m + " мин" }),
        el("span", { className: "kn-nr", textContent: k }), el("span", { className: "kn-nro", textContent: r }));
    });
    sec("Часы", "Часы — 〜じ (時)", grid(hourCards),
      p("Число + じ. Розовые — особые: 4 よじ (не よんじ), 7 しちじ, 9 くじ. До полудня — ごぜん (午前), после — ごご (午後): ごご さんじ = 15:00.", "kn-muted"));
    sec("Минуты", "Минуты — 〜ふん / 〜ぷん (分)", grid(minCards),
      p("Голубые — ぷん: после 1, 3, 4, 6, 8, 10 звук «ф» становится «п», а 1, 6, 8, 10 ещё и удваивают согласную (いっぷん, ろっぷん, はっぷん, じゅっぷん). После 2, 5, 7, 9 — ふん. Для 11–59 смотрим на последнюю цифру: 23 → にじゅう + さんぷん.", "kn-muted"));

    // конструктор времени
    const tm = store.get("kana.time", { ap: 1, h: 3, m: 25 });
    const tout = el("div");
    const selT = (key, label, opts) => el("label", { className: "kn-bsel" }, el("span", { textContent: label }),
      el("select", { onchange: e => { tm[key] = +e.target.value; draw(); } },
        ...opts.map(([v, t]) => el("option", { value: v, selected: v === tm[key], textContent: t }))));
    function draw() {
      store.set("kana.time", tm);
      const [hk, hr] = readHour(tm.h);
      const t = [tok(tm.ap ? "ごご" : "ごぜん", tm.ap ? "gogo" : "gozen", tm.ap ? "после полудня" : "до полудня"), tok(hk, hr, tm.h + " ч")];
      if (tm.m === 30) t.push(tok("はん", "han", "половина", true));
      else if (tm.m === 0) t.push(tok("ちょうど", "chōdo", "ровно", true));
      else { const [mk, mr] = readMin(tm.m); t.push(tok(mk, mr, tm.m + " мин")); }
      t.push(tok("です", "desu", "есть"));
      const h24 = (tm.h % 12) + (tm.ap ? 12 : 0);
      tout.replaceChildren(
        sent([tok("いま", "ima", "сейчас"), tok("なんじ", "nanji", "который час"), tok("です", "desu", "есть"), tok("か", "ka", "вопрос", true)], "Сколько сейчас времени?"),
        sent(t, `${String(h24).padStart(2, "0")}:${String(tm.m).padStart(2, "0")}` + (tm.m === 30 ? " — можно и さんじゅっぷん, но はん короче" : "")));
    }
    sec("Который час", "Который час?",
      el("div", { className: "kn-builder" },
        selT("ap", "Половина дня", [[0, "ごぜん — до полудня"], [1, "ごご — после полудня"]]),
        selT("h", "Час", [...Array(12).keys()].map(i => [i + 1, String(i + 1)])),
        selT("m", "Минуты", [...Array(60).keys()].map(m => [m, String(m).padStart(2, "0")]))),
      tout,
      p("Длительность: 〜じかん — «столько-то часов» (にじかん — два часа), 〜ふん(かん) — минут. Сравни: にじ — «два часа» как время на часах, にじかん — «два часа» как срок.", "kn-muted"));
    draw();
  } });
}
