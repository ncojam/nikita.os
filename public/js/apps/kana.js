import { el, store } from "../core/util.js";
import "../i18n/kana.js";
import { WM } from "../wm.js";
import { openKanaNumbers } from "./kana-num.js";
import {
  ALL, BUILDER, COLS, GRAMMAR, IRREG_NOTE, MNEMO, SAME_PAIRS, TEMPLATE, TIME_NI, VOWELS,
  KANJI_LIKE, cell, kanjiLikeOf, originOf, other, twinsOf, voicing, wordsFor,
} from "./kana-data.js";

/* ================= Кана: хирагана, катакана и строй фразы =================
 * Четыре окна, каждое открывается отдельно:
 *   • «Кана» — маленький менеджер: просто кнопки, открывающие остальные окна;
 *   • «Хирагана» и «Катакана» — таблица: столбцы — согласные, строки — гласные, под знаком — ромадзи.
 *     Клик по знаку — карточка справа: откуда знак, мнемоника, «близнецы», пара в другой азбуке, слова.
 *     Пока ничего не выбрано, справа — «Как запоминать». Режим «Основные / ゛ / ゜» меняет знаки прямо в клетках
 *     (K→G, S→Z, T→D, H→B / H→P) — таблица не растёт. «Прятать латиницу» — для самопроверки;
 *   • «Числа и время» — kana-num.js;
 *   • «Строй предложения» — шаблон фразы, конструктор и частицы с примерами (латиница под каждым словом).
 * Данные — kana-data.js. Состояние посетителя — store("kana.*").
 */
const NAME = { hira: "Хирагана", kata: "Катакана" };
const ICON = { hira: "あ", kata: "ア" };
const load = (k, d) => store.get("kana." + k, d);
const save = (k, v) => store.set("kana." + k, v);

const views = {};   // открытые таблицы: script → { show(ch) }

const MODES = {
  base: { label: "Основные", title: "46 базовых знаков", map: null },
  voiced: { label: "゛ Звонкие", title: "K→G, S→Z, T→D, H→B", map: { k: "g", s: "z", t: "d", h: "b" } },
  semi: { label: "゜ H→P", title: "Кружок превращает H в P", map: { h: "p" } },
};
const VOICES = { k: "dk", s: "dk", t: "dk", h: "dkp" };

/* ---------- менеджер ---------- */
export function openKana() {
  WM.open({ title: "Кана", icon: "🎌", width: 300, height: 360, key: "kana", render(c) {
    c.classList.add("kn", "kn-mgr");
    const b = (icon, text, sub, fn) => el("button", { className: "kn-mbtn", onclick: fn },
      el("span", { className: "kn-micon", textContent: icon }),
      el("span", {}, el("b", { textContent: text }), el("small", { textContent: sub })));
    c.append(
      b("あ", "Хирагана", "японские слова, частицы", () => openKanaTable("hira")),
      b("ア", "Катакана", "заимствования, имена", () => openKanaTable("kata")),
      b("文", "Строй предложения", "частицы и порядок слов", () => openKanaGrammar()),
      b("一", "Числа и время", "счёт, половины, часы и минуты", () => openKanaNumbers()),
    );
  } });
}

/* ---------- таблица ---------- */
export function openKanaTable(script, ch = null) {
  if (views[script]) {
    WM.open({ key: "kana:" + script });   // поднять уже открытое
    if (ch) views[script].show(ch);
    return;
  }
  WM.open({ title: NAME[script], icon: ICON[script], width: 900, height: 560, key: "kana:" + script, render(c, w) {
    c.classList.add("kn", "kn-table");
    // режим таблицы: те же клетки, но в столбцах K S T H знаки «переодеваются» в звонкие (゛) или в P (゜)
    const opt = { mode: load("mode", "base"), hide: load("hide", false) };
    if (!MODES[opt.mode]) opt.mode = "base";
    let sel = ch || load("sel." + script, null);
    let morph = false;   // анимировать смену знаков только при переключении режима

    const grid = el("div", { className: "kn-gridwrap" });
    const side = el("div", { className: "kn-side" });
    const seg = el("div", { className: "kn-seg", title: "Звонкие встают на место глухих — таблица не растёт" });
    const setMode = m => { if (opt.mode === m) return; opt.mode = m; save("mode", m); morph = true; paint(); };
    const hide = el("label", { className: "kn-check", title: "Ромадзи видно только при наведении — проверь себя" },
      el("input", { type: "checkbox", checked: opt.hide, onchange: e => { opt.hide = e.target.checked; save("hide", opt.hide); paint(); } }),
      "🙈 Прятать латиницу");
    const tipsBtn = el("button", { className: "kn-btn", textContent: "💡 Как запоминать", onclick: () => { sel = null; save("sel." + script, null); paint(); } });
    c.append(
      el("div", { className: "kn-head" }, seg, hide, tipsBtn),
      el("div", { className: "kn-main" }, grid, side));

    function paint() {
      c.classList.toggle("kn-hide", opt.hide);
      seg.replaceChildren(...Object.entries(MODES).map(([m, d]) => el("button", {
        className: "kn-segb" + (m === opt.mode ? " on" : ""), textContent: d.label, title: d.title, onclick: () => setMode(m) })));
      grid.replaceChildren(table());
      side.replaceChildren(sel && ALL[script].has(sel) ? detail(sel) : tips());
      side.scrollTop = 0;
      morph = false;
    }

    function table() {
      const map = MODES[opt.mode].map;
      const cols = COLS.filter(x => !x.dk);
      const t = el("table", { className: "kn-grid kn-m-" + opt.mode });
      const hr = el("tr", {}, el("th", { className: "kn-corner", textContent: "" }));
      for (const x of cols) {
        const to = map?.[x.c], up = s => s.toUpperCase();
        const th = el("th", { className: (to ? "kn-on" : "") + (map && !to ? " dim" : "") });
        th.append(to ? el("span", {}, el("s", { textContent: up(x.c) }), " " + up(to)) : (x.head || up(x.c)));
        th.dataset.c = x.c; hr.append(th);
      }
      t.append(el("thead", {}, hr));
      const tb = el("tbody");
      VOWELS.forEach((v, vi) => {
        const tr = el("tr", {}, el("th", { className: "kn-vow", textContent: v.toUpperCase() }));
        for (const x of cols) {
          const to = map?.[x.c];
          const k = cell(script, to || x.c, vi);
          const td = el("td", { className: map && !to ? "dim" : "" });
          td.dataset.c = x.c;
          if (k) {
            const cls = ["kn-cell"];
            if (k.ch === sel) cls.push("on");
            if (!map && VOICES[x.c]) cls.push("has-" + VOICES[x.c]);   // крошечная метка: у знака есть звонкая пара
            if (to && morph) cls.push("morph");
            const btn = el("button", { className: cls.join(" "), title: k.ro, onclick: () => show(k.ch) },
              el("span", { className: "kn-ch", textContent: k.ch }),
              el("span", { className: "kn-ro", textContent: k.ro }));
            td.append(btn);
          }
          tr.append(td);
        }
        tb.append(tr);
      });
      t.append(tb);
      // подсветка строки и столбца под курсором — так видна «координата» знака
      t.addEventListener("mouseover", e => {
        const td = e.target.closest("td"); if (!td) return;
        t.querySelectorAll(".hl").forEach(n => n.classList.remove("hl"));
        td.parentElement.firstChild.classList.add("hl");
        t.querySelector(`thead th[data-c="${td.dataset.c}"]`)?.classList.add("hl");
      });
      t.addEventListener("mouseleave", () => t.querySelectorAll(".hl").forEach(n => n.classList.remove("hl")));
      return t;
    }

    function show(ch) {
      const x = ALL[script].get(ch); if (!x) return;
      // знак не виден в текущем режиме — переключаемся туда, где он есть
      const need = x.c === "p" ? "semi" : ["g", "z", "d", "b"].includes(x.c) ? "voiced" : MODES[opt.mode].map?.[x.c] ? "base" : opt.mode;
      if (need !== opt.mode) { opt.mode = need; save("mode", need); morph = true; }
      sel = ch; save("sel." + script, ch); paint();
    }

    const chip = (s, g, title) => !ALL[s].has(g) ? el("span", { className: "kn-chip kanji", textContent: g, title: title || "иероглиф" }) : el("button", { className: "kn-chip", textContent: g, title: title || ALL[s].get(g)?.ro || "",
      onclick: () => s === script ? show(g) : openKanaTable(s, g) });

    function detail(ch) {
      const x = ALL[script].get(ch), oth = other(ch), os = script === "hira" ? "kata" : "hira";
      const org = originOf(script, ch), vc = voicing(script, x), note = IRREG_NOTE[ch];
      const box = el("div", { className: "kn-card" });
      box.append(el("div", { className: "kn-big" },
        el("span", { className: "kn-bigch", textContent: ch }),
        el("span", { className: "kn-bigro", textContent: x.ro }),
        org ? el("span", { className: "kn-org", title: "Иероглиф, из которого упростили знак", textContent: "← " + org }) : ""));
      if (note) box.append(el("div", { className: "kn-note", textContent: "⚠ " + note }));
      if (vc?.base) box.append(el("p", {}, `${vc.base} + ${vc.mark} — `, el("span", { className: "kn-muted",
        textContent: vc.mark === "゛" ? "два штриха делают звук звонким" : "кружок: h → p" })));
      else if (MNEMO[ch]) box.append(el("p", { className: "kn-mnemo", textContent: MNEMO[ch] }));
      if (vc?.voiced) box.append(el("div", { className: "kn-row" }, el("span", { className: "kn-label", textContent: "Звонкие:" }),
        ...vc.voiced.map(g => chip(script, g))));
      if (oth) box.append(el("div", { className: "kn-row" }, el("span", { className: "kn-label", textContent: NAME[os] + ":" }), chip(os, oth)));
      for (const [g, why] of twinsOf(script, ch)) box.append(el("div", { className: "kn-twin" },
        el("div", { className: "kn-row" }, el("span", { className: "kn-label", textContent: "Не путать:" }),
          ...[...g].map(t => chip(script, t))),
        el("div", { className: "kn-muted", textContent: why })));
      for (const k of kanjiLikeOf(ch)) box.append(kanjiLike(k));
      const words = wordsFor(script, ch);
      box.append(el("h4", { textContent: "Слова" }));
      if (!words.length) box.append(el("div", { className: "kn-muted", textContent: "Слов почти нет — знак редкий." }));
      for (const w of words) box.append(word(w, ch));
      return box;
    }

    function tips() {
      const box = el("div", { className: "kn-card kn-tips" });
      const h = t => el("h4", { textContent: t }), p = t => el("p", { textContent: t });
      box.append(h("💡 Как запоминать"));
      box.append(script === "hira"
        ? p("Честно: в одном ряду (な に ぬ ね の) нет общего «согласного» элемента. Каждый знак — скоропись целого иероглифа (な←奈, に←仁, ぬ←奴), поэтому учить ряд как «семью» не выйдет. Учим каждый знак своей картинкой — мнемоника в карточке.")
        : p("Катакана — кусочек иероглифа, отсюда углы (カ←加, イ←伊, ニ←二). Общего элемента у ряда тоже нет. Зато знаки проще и часто напоминают хирагану."));
      box.append(h("Единственное строгое правило — ゛ и ゜"));
      const pairs = [["k", "g"], ["s", "z"], ["t", "d"], ["h", "b"], ["h", "p"]].map(([a, b]) =>
        el("span", { className: "kn-pair" }, chip(script, cell(script, a, 0).ch), " → ", chip(script, cell(script, b, 0).ch)));
      box.append(el("div", { className: "kn-row wrap" }, ...pairs));
      box.append(p("Два штриха ゛ делают согласную звонкой (k→g, s→z, t→d, h→b), кружок ゜ превращает h в p. Это работает для всего столбца — 25 знаков бесплатно. Переключи сверху «゛ Звонкие» / «゜ H→P» — знаки сменятся прямо в своих клетках. Маленькая ゛ в углу клетки значит: у знака есть звонкая пара."));
      box.append(h("Учи «близнецов», а не ряды"));
      box.append(p("Путают обычно не соседей по ряду, а похожие по форме знаки из разных рядов. Держи их рядом и ищи одну отличительную деталь:"));
      const twins = script === "hira" ? ["はほけ", "ねれわ", "ぬめ", "るろ", "さちき", "いり"] : ["シツ", "ソン", "クタケ", "ウワフラ", "コユロ", "ナメ"];
      for (const g of twins) {
        const why = twinsOf(script, g[0]).find(([x]) => x === g)?.[1];
        box.append(el("div", { className: "kn-twin" }, el("div", { className: "kn-row" }, ...[...g].map(t => chip(script, t))),
          el("div", { className: "kn-muted", textContent: why })));
      }
      if (script === "kata") {
        box.append(h("Кана или иероглиф?"));
        box.append(p("Несколько знаков катаканы — это обрезки иероглифов, и в тексте их легко спутать с самими иероглифами. Главная подсказка — соседи: внутри слова из катаканы будет катакана."));
        for (const k of KANJI_LIKE) box.append(kanjiLike(k));
      }
      box.append(h("Исключения в чтении"));
      box.append(p(script === "hira"
        ? "し shi, ち chi, つ tsu, ふ fu, じ/ぢ ji, づ zu. Частицы: は читается wa, へ — e, を — o."
        : "シ shi, チ chi, ツ tsu, フ fu, ジ ji. Длинный гласный — чёрточка ー: コーヒー kōhī."));
      box.append(h("Почти одинаковые в обеих азбуках"));
      box.append(el("div", { className: "kn-row wrap" }, ...SAME_PAIRS.map(([a, b]) => el("span", { className: "kn-pair" },
        chip("hira", a), chip("kata", b)))));
      box.append(p("Совет: открой таблицу, включи «🙈 Прятать латиницу» и называй знаки по столбцу вслух — ромадзи проявляется при наведении."));
      return box;
    }

    // «катакана или иероглиф»: пара + чем отличаются
    function kanjiLike([k, j, read, why]) {
      return el("div", { className: "kn-twin" },
        el("div", { className: "kn-row" }, el("span", { className: "kn-label", textContent: "Не иероглиф:" }),
          chip("kata", k), " ≠ ", chip("kata", j, "иероглиф"), el("span", { className: "kn-muted", textContent: read })),
        el("div", { className: "kn-muted", textContent: why }));
    }

    views[script] = { show };
    w.onClose = () => { delete views[script]; };
    paint();
  } });
}

// слово: кана (искомый знак подсвечен), под ней ромадзи, рядом перевод
function word(w, ch) {
  const k = el("span", { className: "kn-wk" });
  for (const g of w.k) k.append(g === ch ? el("mark", { textContent: g }) : g);
  return el("div", { className: "kn-word" },
    el("span", { className: "kn-wstack" }, k, el("span", { className: "kn-wr", textContent: w.r })),
    el("span", { className: "kn-wm", textContent: w.m }));
}

/* ---------- строй предложения ---------- */
// слово фразы: кана, под ней латиница, ниже — перевод/роль
const tok = t => el("span", { className: "kn-tok" + (t.p ? " p" : "") },
  el("span", { className: "kn-tk", textContent: t.k }),
  el("span", { className: "kn-tr", textContent: t.r }),
  el("span", { className: "kn-tg", textContent: t.g }));
const sentence = (tokens, ru) => el("div", { className: "kn-ex" },
  el("div", { className: "kn-sent" }, ...tokens.map(tok)),
  el("div", { className: "kn-ru", textContent: ru }));

const ME = { ест: "ем", пьёт: "пью", читает: "читаю", смотрит: "смотрю" };

export function openKanaGrammar() {
  WM.open({ title: "Строй предложения", icon: "文", width: 760, height: 620, key: "kana:grammar", render(c) {
    c.classList.add("kn", "kn-gram");
    const body = el("div", { className: "kn-gbody" });
    const nav = el("div", { className: "kn-nav" });
    c.append(nav, body);

    // шаблон
    body.append(el("section", { className: "kn-sec" },
      el("h3", { textContent: "Скелет фразы" }),
      el("div", { className: "kn-tpl" }, ...TEMPLATE.map(([role, p]) => el("span", { className: "kn-slot" },
        el("span", { textContent: role }), p ? el("b", { textContent: p }) : ""))),
      el("p", { className: "kn-muted", textContent: "Любой кусок, кроме глагола, можно выкинуть. Частица всегда стоит сразу после своего слова — она и есть «падеж»." })));

    // конструктор
    const B = BUILDER;
    const pick = { topic: 0, time: 1, place: 0, act: 0 };
    const out = el("div");
    const sel = (key, label, fmt) => el("label", { className: "kn-bsel" }, el("span", { textContent: label }),
      el("select", { onchange: e => { pick[key] = +e.target.value; build(); } },
        ...B[key].map((o, i) => el("option", { value: i, selected: i === pick[key], textContent: fmt(o) }))));
    function build() {
      const tp = B.topic[pick.topic], tm = B.time[pick.time], pl = B.place[pick.place], a = B.act[pick.act];
      const t = [{ k: tp[0], r: tp[1], g: tp[2] }, { k: "は", r: "wa", g: "тема", p: true }];
      if (tm[0]) { t.push({ k: tm[0], r: tm[1], g: tm[2] }); if (TIME_NI.has(tm[0])) t.push({ k: "に", r: "ni", g: "когда", p: true }); }
      t.push({ k: pl[0], r: pl[1], g: pl[2] }, { k: "で", r: "de", g: "где", p: true },
        { k: a[0], r: a[1], g: a[2] }, { k: "を", r: "o", g: "объект", p: true }, { k: a[3], r: a[4], g: a[5] });
      const verb = tp[0] === "わたし" ? ME[a[5]] : a[5];
      const ru = [tp[2], tm[0] ? tm[2] : "", pl[2], verb, a[2]].filter(Boolean).join(" ");
      out.replaceChildren(sentence(t, ru[0].toUpperCase() + ru.slice(1) + "."));
    }
    body.append(el("section", { className: "kn-sec" },
      el("h3", { textContent: "Собери сам" }),
      el("div", { className: "kn-builder" },
        sel("topic", "Кто", o => `${o[0]} — ${o[2]}`),
        sel("time", "Когда", o => o[0] ? `${o[0]} — ${o[2]}` : o[2]),
        sel("place", "Где", o => `${o[0]} — ${o[2]}`),
        sel("act", "Что делает", o => `${o[0]}を ${o[3]} — ${o[5]} ${o[2]}`)),
      out));
    build();

    // частицы
    GRAMMAR.forEach(g => {
      const sec = el("section", { className: "kn-sec" },
        el("h3", { textContent: g.h }),
        el("p", { textContent: g.txt }),
        ...g.ex.map(e => sentence(e.t, e.ru)));
      body.append(sec);
      nav.append(el("button", { className: "kn-chip", textContent: g.p || "語順", title: g.h,
        onclick: () => sec.scrollIntoView({ behavior: "smooth", block: "start" }) }));
    });
  } });
}
