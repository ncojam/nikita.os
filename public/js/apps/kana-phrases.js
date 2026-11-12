import { el, store } from "../core/util.js";
import { WM } from "../wm.js";
import { ex } from "./kana-data.js";

/* ================= Кана: конструктор фраз и ситуации =================
 * phraseBuilder() — собирает фразу из кусков: кто は · когда (に) · где で · что を · глагол + хвост ます/ません/…
 *   Любой объект с любым глаголом: すしを たべます / すしを みます — меняется только глагол.
 *   Вопросительные слова (いつ, どこ, なに) сами делают фразу вопросом; ぜんぜん («никогда») требует отрицания.
 *   Русский перевод собирается по лицу/роду темы — без словаря, по таблицам в VERBS.
 * openKanaPhrases() — отдельное окно: тот же конструктор + готовые фразы по ситуациям.
 * Встраивается и в «Строй предложения» (kana.js). Выбор посетителя — store("kana.pb").
 */

// слово фразы: кана, под ней латиница, ниже — перевод/роль
export const tok = t => el("span", { className: "kn-tok" + (t.p ? " p" : "") },
  el("span", { className: "kn-tk", textContent: t.k }),
  el("span", { className: "kn-tr", textContent: t.r }),
  el("span", { className: "kn-tg", textContent: t.g }));
export const sentence = (tokens, ru) => el("div", { className: "kn-ex" },
  el("div", { className: "kn-sent" }, ...tokens.map(tok)),
  ru ? el("div", { className: "kn-ru", textContent: ru }) : "");

/* ---------- словарь конструктора ---------- */
// p — лицо (1, 2, 3, 4 = они), gen — род для прошедшего времени
const SUBJ = [
  { k: "わたし", r: "watashi", g: "я", ru: "я", p: 1, gen: "m" },
  { k: "", r: "", g: "", ru: "я", p: 1, gen: "m", label: "(опустить «я» — так и говорят)" },
  { k: "かのじょ", r: "kanojo", g: "девушка", ru: "моя девушка", p: 3, gen: "f" },
  { k: "ともだち", r: "tomodachi", g: "друг", ru: "мой друг", p: 3, gen: "m" },
  { k: "あなた", r: "anata", g: "ты", ru: "ты", p: 2, gen: "m" },
  { k: "みんな", r: "minna", g: "все", ru: "все", p: 4, gen: "pl" },
];
const TIME = [
  { k: "", ru: "", label: "(не уточнять)" },
  { k: "あさ", r: "asa", ru: "утром" },
  { k: "よる", r: "yoru", ru: "вечером" },
  { k: "しちじ", r: "shichiji", ru: "в 7 часов", ni: true },
  { k: "きょう", r: "kyō", ru: "сегодня" },
  { k: "あした", r: "ashita", ru: "завтра" },
  { k: "きのう", r: "kinō", ru: "вчера" },
  { k: "まいにち", r: "mainichi", ru: "каждый день" },
  { k: "まいしゅう", r: "maishū", ru: "каждую неделю" },
  { k: "まいとし", r: "maitoshi", ru: "каждый год" },
  { k: "しゅうまつ", r: "shūmatsu", ru: "на выходных", ni: true },
  { k: "ぜんぜん", r: "zenzen", ru: "никогда", never: true, label: "ぜんぜん — никогда / совсем не (+ отрицание)" },
  { k: "いつ", r: "itsu", ru: "когда", q: true, label: "いつ — когда?" },
];
const PLACE = [
  { k: "", ru: "", label: "(не уточнять)" },
  { k: "いえ", r: "ie", ru: "дома" },
  { k: "カフェ", r: "kafe", ru: "в кафе" },
  { k: "かいしゃ", r: "kaisha", ru: "на работе" },
  { k: "スタジオ", r: "sutajio", ru: "в студии" },
  { k: "がっこう", r: "gakkō", ru: "в школе" },
  { k: "こうえん", r: "kōen", ru: "в парке" },
  { k: "でんしゃ", r: "densha", ru: "в электричке" },
  { k: "にほん", r: "nihon", ru: "в Японии" },
  { k: "どこ", r: "doko", ru: "где", q: true, label: "どこ — где?" },
];
const OBJ = [
  ["", [{ k: "", ru: "", label: "(без объекта)" }]],
  ["Еда", [{ k: "すし", r: "sushi", ru: "суши" }, { k: "ラーメン", r: "rāmen", ru: "рамен" }, { k: "コーヒー", r: "kōhī", ru: "кофе" }, { k: "おちゃ", r: "ocha", ru: "чай" }]],
  ["Игры и геймдев", [{ k: "ゲーム", r: "gēmu", ru: "игры" }, { k: "コード", r: "kōdo", ru: "код" }, { k: "ピクセルアート", r: "pikuseruāto", ru: "пиксель-арт" },
    { k: "キャラクター", r: "kyarakutā", ru: "персонажей" }, { k: "マップ", r: "mappu", ru: "карты уровней" }]],
  ["Творчество и досуг", [{ k: "え", r: "e", ru: "картины" }, { k: "おんがく", r: "ongaku", ru: "музыку" }, { k: "まんが", r: "manga", ru: "мангу" },
    { k: "アニメ", r: "anime", ru: "аниме" }, { k: "えいが", r: "eiga", ru: "фильмы" }, { k: "ほん", r: "hon", ru: "книги" },
    { k: "しゃしん", r: "shashin", ru: "фото" }, { k: "にほんご", r: "nihongo", ru: "японский" }]],
  ["Вопрос", [{ k: "なに", r: "nani", ru: "что", q: true, label: "なに — что?" }]],
];
const OBJ_FLAT = OBJ.flatMap(([, l]) => l);
// ru: [инфинитив, я, ты, он/она, они, он (прош.), она (прош.), они (прош.), «давай …» (мы)]
const VERBS = [
  { d: "たべる", s: "たべ", sr: "tabe", ru: ["есть", "ем", "ешь", "ест", "едят", "ел", "ела", "ели", "поедим"] },
  { d: "のむ", s: "のみ", sr: "nomi", ru: ["пить", "пью", "пьёшь", "пьёт", "пьют", "пил", "пила", "пили", "попьём"] },
  { d: "みる", s: "み", sr: "mi", ru: ["смотреть", "смотрю", "смотришь", "смотрит", "смотрят", "смотрел", "смотрела", "смотрели", "посмотрим"] },
  { d: "よむ", s: "よみ", sr: "yomi", ru: ["читать", "читаю", "читаешь", "читает", "читают", "читал", "читала", "читали", "почитаем"] },
  { d: "かく", s: "かき", sr: "kaki", ru: ["рисовать", "рисую", "рисуешь", "рисует", "рисуют", "рисовал", "рисовала", "рисовали", "порисуем"] },
  { d: "つくる", s: "つくり", sr: "tsukuri", ru: ["делать", "делаю", "делаешь", "делает", "делают", "делал", "делала", "делали", "сделаем"] },
  { d: "する", s: "し", sr: "shi", ru: ["играть в", "играю в", "играешь в", "играет в", "играют в", "играл в", "играла в", "играли в", "поиграем в"], label: "する — играть (ゲームを する) / делать" },
  { d: "きく", s: "きき", sr: "kiki", ru: ["слушать", "слушаю", "слушаешь", "слушает", "слушают", "слушал", "слушала", "слушали", "послушаем"] },
  { d: "かう", s: "かい", sr: "kai", ru: ["покупать", "покупаю", "покупаешь", "покупает", "покупают", "покупал", "покупала", "покупали", "купим"] },
  { d: "とる", s: "とり", sr: "tori", ru: ["снимать", "снимаю", "снимаешь", "снимает", "снимают", "снимал", "снимала", "снимали", "поснимаем"], label: "とる — снимать (しゃしんを とる)" },
  { d: "べんきょうする", s: "べんきょうし", sr: "benkyōshi", ru: ["учить", "учу", "учишь", "учит", "учат", "учил", "учила", "учили", "поучим"] },
];
// хвосты: один и тот же у всех глаголов — меняется только основа
const FORMS = [
  { id: "pres", k: "ます", r: "masu", g: "делаю / сделаю", label: "〜ます — делаю (и «сделаю»)" },
  { id: "neg", k: "ません", r: "masen", g: "не делаю", label: "〜ません — не делаю" },
  { id: "past", k: "ました", r: "mashita", g: "сделал", label: "〜ました — делал" },
  { id: "pastneg", k: "ませんでした", r: "masen deshita", g: "не сделал", label: "〜ませんでした — не делал" },
  { id: "let", k: "ましょう", r: "mashō", g: "давай", label: "〜ましょう — давай!" },
  { id: "want", k: "たいです", r: "tai desu", g: "хочу", label: "〜たいです — хочу" },
];
const WANT = { 1: "хочу", 2: "хочешь", 3: "хочет", 4: "хотят" };
const PAST = { m: 5, f: 6, pl: 7 };

const P = (k, r, g) => ({ k, r, g, p: true });

export function compose(s) {
  const sub = SUBJ[s.sub], tm = TIME[s.time], pl = PLACE[s.place], ob = OBJ_FLAT[s.obj], v = VERBS[s.verb], f = FORMS.find(x => x.id === s.form);
  const q = s.q || tm.q || pl.q || ob.q;
  const t = [];
  if (sub.k && f.id !== "let") t.push({ k: sub.k, r: sub.r, g: sub.g }, P("は", "wa", "тема"));
  if (tm.k) { t.push({ k: tm.k, r: tm.r, g: tm.ru }); if (tm.ni) t.push(P("に", "ni", "когда")); }
  if (pl.k) t.push({ k: pl.k, r: pl.r, g: pl.ru }, P("で", "de", "где"));
  if (ob.k) t.push({ k: ob.k, r: ob.r, g: ob.ru }, P("を", "o", "объект"));
  t.push({ k: v.s, r: v.sr, g: v.ru[0] }, P(f.k, f.r, f.g));
  if (q) t.push(P("か", "ka", "вопрос"));

  // русский: тема · время · место · глагол · объект, вопросительное слово — вперёд
  let vp;
  const verb = ob.k ? v.ru : v.ru.map(x => x.replace(/ в$/, ""));
  if (f.id === "pres") vp = verb[sub.p];
  if (f.id === "neg") vp = "не " + verb[sub.p];
  if (f.id === "past") vp = verb[PAST[sub.gen]];
  if (f.id === "pastneg") vp = "не " + verb[PAST[sub.gen]];
  if (f.id === "let") vp = (sub.p === 4 ? "давайте " : "давай ") + verb[8];
  if (f.id === "want") vp = WANT[sub.p] + " " + verb[0];
  if (tm.never) vp = vp.replace(/^не /, "никогда не ");
  const words = [f.id === "let" ? "" : sub.ru, tm.never ? "" : tm.ru, pl.ru, vp, ob.ru];
  const qw = [tm.q && 1, pl.q && 2, ob.q && 4].filter(Boolean);   // все вопросительные слова — в начало
  let ru = [...qw.map(i => words[i]), ...words.filter((_, i) => !qw.includes(i))].filter(Boolean).join(" ");
  ru = ru[0].toUpperCase() + ru.slice(1) + (q ? "?" : ".");
  return { t, ru, v };
}

const DEF = { sub: 0, time: 1, place: 1, obj: 1, verb: 0, form: "pres", q: false };

export function phraseBuilder() {
  const s = Object.assign({}, DEF, store.get("kana.pb", {}));
  const box = el("div", { className: "kn-pb" });
  const out = el("div"), forms = el("div", { className: "kn-forms" }), hint = el("p", { className: "kn-muted" });
  const selects = {};
  const opt = (v, text) => el("option", { value: v, textContent: text });
  const mk = (key, label, options) => {
    const sel = el("select", { onchange: e => { s[key] = key === "form" ? e.target.value : +e.target.value; draw(); } }, ...options);
    selects[key] = sel;
    return el("label", { className: "kn-bsel" }, el("span", { textContent: label }), sel);
  };
  const lbl = x => x.label || `${x.k} — ${x.ru}`;
  let oi = 0;
  const qchk = el("input", { type: "checkbox", onchange: e => { s.q = e.target.checked; draw(); } });
  box.append(
    el("div", { className: "kn-builder" },
      mk("sub", "Кто", SUBJ.map((x, i) => opt(i, x.label || `${x.k} — ${x.ru}`))),
      mk("time", "Когда", TIME.map((x, i) => opt(i, lbl(x)))),
      mk("place", "Где", PLACE.map((x, i) => opt(i, lbl(x)))),
      mk("obj", "Что (объект)", OBJ.map(([g, l]) => {
        const o = l.map(x => opt(oi++, lbl(x)));
        return g ? el("optgroup", { label: g }, ...o) : o[0];
      })),
      mk("verb", "Действие", VERBS.map((x, i) => opt(i, x.label || `${x.d} — ${x.ru[0]}`))),
      mk("form", "Хвост", FORMS.map(x => opt(x.id, x.label))),
      el("label", { className: "kn-check" }, qchk, "？ Вопрос (か)")),
    out, forms, hint);

  function draw() {
    if (TIME[s.time]?.never && !["neg", "pastneg"].includes(s.form)) s.form = "neg";   // «никогда» живёт только с отрицанием
    for (const k in selects) selects[k].value = s[k];
    qchk.checked = s.q;
    store.set("kana.pb", s);
    const { t, ru, v } = compose(s);
    out.replaceChildren(sentence(t, ru));
    // все хвосты выбранного глагола: видно, что основа одна, а меняется только конец
    forms.replaceChildren(el("span", { className: "kn-label", textContent: v.d + " →" }), ...FORMS.map(f =>
      el("button", { className: "kn-form" + (f.id === s.form ? " on" : ""), title: f.label, onclick: () => { s.form = f.id; draw(); } },
        el("span", { className: "kn-fk" }, v.s, el("b", { textContent: f.k })),
        el("span", { className: "kn-fr", textContent: v.sr + f.r.replace(" ", "") }))));
    hint.textContent = TIME[s.time]?.never
      ? "ぜんぜん дословно «совсем», и дружит только с отрицанием: ぜんぜん みません — «вообще не смотрю»."
      : "Поменяй «Действие» — объект останется тем же: すしを たべます → すしを みます. Меняется только глагол.";
  }
  draw();
  return box;
}

/* ---------- готовые фразы по ситуациям ---------- */
export const SITUATIONS = [
  { id: "dev", h: "🎮 Геймдев", tip: "〜て います — «делаю сейчас / занимаюсь этим»: つくって います — делаю (в процессе).", ex: [
    ex("わたし=watashi=я *は=wa=тема ゲーム=gēmu=игра *を=o=объект つくって=tsukutte=делая *います=imasu=(в_процессе)", "Я делаю игру."),
    ex("ひとり=hitori=один *で=de=как ゲーム=gēmu=игра *を=o=объект つくって=tsukutte=делая *います=imasu=(в_процессе)", "Делаю игру в одиночку."),
    ex("この=kono=этот ゲーム=gēmu=игра *は=wa=тема ゲームボーイアドバンス=gēmubōiadobansu=Game_Boy_Advance *で=de=на うごきます=ugokimasu=работает", "Эта игра работает на Game Boy Advance."),
    ex("しゅうまつ=shūmatsu=выходные *に=ni=когда コード=kōdo=код *を=o=объект かきます=kakimasu=пишу", "На выходных пишу код."),
    ex("おんがく=ongaku=музыка *も=mo=тоже じぶん=jibun=сам *で=de=как つくります=tsukurimasu=делаю", "Музыку тоже делаю сам."),
    ex("インディーゲーム=indīgēmu=инди-игры *の=no=какой イベント=ibento=ивент *に=ni=куда いきます=ikimasu=иду", "Еду на фестиваль инди-игр."),
    ex("あそんで=asonde=поиграв みて=mite=попробуй ください=kudasai=пожалуйста", "Попробуйте поиграть!"),
  ] },
  { id: "draw", h: "🎨 Рисую", tip: "〜のが すきです — «люблю делать»: かくのが すきです — люблю рисовать.", ex: [
    ex("え=e=картина *を=o=объект かく=kaku=рисовать *の=no=(это) *が=ga=подлеж. すき=suki=нравится です=desu=вежл.", "Люблю рисовать."),
    ex("まいにち=mainichi=каждый_день ピクセルアート=pikuseruāto=пиксель-арт *を=o=объект かきます=kakimasu=рисую", "Каждый день рисую пиксель-арт."),
    ex("キャラクター=kyarakutā=персонаж *を=o=объект デザイン=dezain=дизайн して=shite=делая *います=imasu=(в_процессе)", "Придумываю персонажей."),
    ex("この=kono=этот え=e=картина *は=wa=тема わたし=watashi=я *が=ga=подлеж. かきました=kakimashita=нарисовал", "Эту картинку нарисовал я."),
  ] },
  { id: "play", h: "🕹 Играю", tip: "どんな — «какой (по типу)». よく — «часто».", ex: [
    ex("どんな=donna=какие ゲーム=gēmu=игры *が=ga=подлеж. すき=suki=нравится です=desu=вежл. *か=ka=вопрос", "Какие игры тебе нравятся?"),
    ex("アクションゲーム=akushongēmu=экшены *が=ga=подлеж. すき=suki=нравится です=desu=вежл.", "Люблю экшены."),
    ex("スケボー=sukebō=скейт *の=no=какой ゲーム=gēmu=игра *を=o=объект よく=yoku=часто します=shimasu=играю", "Часто играю в игры про скейт."),
    ex("よる=yoru=вечером ゲーム=gēmu=игра *を=o=объект します=shimasu=играю", "По вечерам играю."),
    ex("いっしょ=issho=вместе *に=ni=как あそびましょう=asobimashō=давай_поиграем", "Давай поиграем вместе!"),
  ] },
  { id: "gf", h: "💕 Девушка", tip: "かのじょ — «она», а в разговоре о себе — «моя девушка». 〜と — «вместе с».", ex: [
    ex("かのじょ=kanojo=девушка *と=to=с_кем いっしょ=issho=вместе *に=ni=как すんで=sunde=живя *います=imasu=(в_процессе)", "Живу вместе с девушкой."),
    ex("かのじょ=kanojo=девушка *は=wa=тема アニメ=anime=аниме *が=ga=подлеж. すき=suki=нравится です=desu=вежл.", "Моя девушка любит аниме."),
    ex("かのじょ=kanojo=девушка *も=mo=тоже え=e=картина *を=o=объект かきます=kakimasu=рисует", "Моя девушка тоже рисует."),
    ex("かのじょ=kanojo=девушка *と=to=с_кем にほん=nihon=Япония *に=ni=куда いきたい=ikitai=хочу_поехать です=desu=вежл.", "Хочу поехать в Японию с девушкой."),
    ex("しゅうまつ=shūmatsu=выходные *に=ni=когда かのじょ=kanojo=девушка *と=to=с_кем カフェ=kafe=кафе *に=ni=куда いきます=ikimasu=иду", "На выходных иду с девушкой в кафе."),
  ] },
  { id: "ask", h: "❓ Вопросы людям", tip: "Вежливый вопрос — это обычная фраза + か в конце. お перед словом — вежливость: おなまえ.", ex: [
    ex("おなまえ=onamae=имя *は=wa=тема なん=nan=что です=desu=вежл. *か=ka=вопрос", "Как вас зовут?"),
    ex("どこ=doko=где *から=kara=откуда きました=kimashita=пришли *か=ka=вопрос", "Откуда вы?"),
    ex("しゅみ=shumi=хобби *は=wa=тема なん=nan=что です=desu=вежл. *か=ka=вопрос", "Какое у вас хобби?"),
    ex("どんな=donna=какую ゲーム=gēmu=игру *を=o=объект つくって=tsukutte=делая います=imasu=(в_процессе) *か=ka=вопрос", "Какую игру вы делаете?"),
    ex("しゃしん=shashin=фото *を=o=объект とって=totte=сняв *も=mo=даже いい=ii=хорошо です=desu=вежл. *か=ka=вопрос", "Можно сфотографировать?"),
    ex("おすすめ=osusume=совет *は=wa=тема なん=nan=что です=desu=вежл. *か=ka=вопрос", "Что посоветуете?"),
    ex("これ=kore=это *は=wa=тема いくら=ikura=сколько_стоит です=desu=вежл. *か=ka=вопрос", "Сколько это стоит?"),
  ] },
  { id: "where", h: "📍 Где что", tip: "あります — «есть/находится» для вещей и мест, います — для живых. 〜の ちかく — рядом с, 〜の うえ — на.", ex: [
    ex("えき=eki=станция *は=wa=тема どこ=doko=где です=desu=вежл. *か=ka=вопрос", "Где станция?"),
    ex("トイレ=toire=туалет *は=wa=тема あそこ=asoko=вон_там です=desu=вежл.", "Туалет вон там."),
    ex("スケートパーク=sukētopāku=скейтпарк *は=wa=тема えき=eki=станция *の=no=чей ちかく=chikaku=рядом *に=ni=где あります=arimasu=находится", "Скейтпарк рядом со станцией."),
    ex("コンビニ=konbini=комбини *は=wa=тема ホテル=hoteru=отель *の=no=чей となり=tonari=по_соседству です=desu=вежл.", "Комбини рядом с отелем."),
    ex("ねこ=neko=кошка *は=wa=тема つくえ=tsukue=стол *の=no=чей うえ=ue=верх *に=ni=где います=imasu=находится_(живое)", "Кошка на столе."),
  ] },
];

export function openKanaPhrases() {
  WM.open({ title: "Фразы", icon: "🧩", width: 820, height: 660, key: "kana:phrases", render(c) {
    c.classList.add("kn", "kn-gram");
    const body = el("div", { className: "kn-gbody" });
    const list = el("div");
    const chips = el("div", { className: "kn-nav inline" });
    let cur = store.get("kana.situation", "dev");
    function show() {
      store.set("kana.situation", cur);
      const s = SITUATIONS.find(x => x.id === cur) || SITUATIONS[0];
      chips.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.id === s.id));
      list.replaceChildren(el("p", { className: "kn-muted", textContent: "💡 " + s.tip }), ...s.ex.map(e => sentence(e.t, e.ru)));
    }
    for (const s of SITUATIONS) {
      const b = el("button", { className: "kn-btn small", textContent: s.h, onclick: () => { cur = s.id; show(); } });
      b.dataset.id = s.id; chips.append(b);
    }
    body.append(
      el("section", { className: "kn-sec" }, el("h3", { textContent: "Собери фразу" }), phraseBuilder()),
      el("section", { className: "kn-sec" }, el("h3", { textContent: "Ситуации" }), chips, list));
    c.append(body);
    show();
  } });
}
