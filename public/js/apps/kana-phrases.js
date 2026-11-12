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
  { k: "わたし", r: "watashi", g: "я", ru: "я", dat: "мне", p: 1, gen: "m", let: null },
  { k: "", r: "", g: "", ru: "я", dat: "мне", p: 1, gen: "m", label: "(опустить «я» — так и говорят)", let: null },
  { k: "かのじょ", r: "kanojo", g: "девушка", ru: "моя девушка", dat: "моей девушке", p: 3, gen: "f", let: ["と", "to", "с кем", "с моей девушкой"] },
  { k: "ともだち", r: "tomodachi", g: "друг", ru: "мой друг", dat: "моему другу", p: 3, gen: "m", let: ["と", "to", "с кем", "с моим другом"] },
  { k: "あなた", r: "anata", g: "ты", ru: "ты", dat: "тебе", p: 2, gen: "m", let: ["に", "ni", "как", "вместе", "いっしょ", "issho", "вместе"] },
  { k: "みんな", r: "minna", g: "все", ru: "все", dat: "всем", p: 4, gen: "pl", let: ["で", "de", "все вместе", "все вместе"] },
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
  { k: "スケートパーク", r: "sukētopāku", ru: "в скейтпарке" },
  { k: "こうえん", r: "kōen", ru: "в парке" },
  { k: "がっこう", r: "gakkō", ru: "в школе" },
  { k: "でんしゃ", r: "densha", ru: "в электричке" },
  { k: "にほん", r: "nihon", ru: "в Японии" },
  { k: "どこ", r: "doko", ru: "где", q: true, label: "どこ — где?" },
];
// ru — винительный падеж («делаю что?»), na — предложный («катаюсь на чём?»),
// alt — свой перевод глагола для этого объекта (ゲームを する — «играть», а не «делать»)
const PLAY = ["играть в", "играю в", "играешь в", "играет в", "играют в", "играл в", "играла в", "играли в", "поиграем в"];
const OBJ = [
  ["", [{ k: "", ru: "", label: "(без объекта)" }]],
  ["Еда и напитки", [{ k: "すし", r: "sushi", ru: "суши" }, { k: "ラーメン", r: "rāmen", ru: "рамен" }, { k: "コーヒー", r: "kōhī", ru: "кофе" },
    { k: "おちゃ", r: "ocha", ru: "чай" }, { k: "おさけ", r: "osake", ru: "алкоголь" }]],
  ["Игры и разработка", [{ k: "ゲーム", r: "gēmu", ru: "игры", one: "игру", alt: { する: PLAY } }, { k: "コード", r: "kōdo", ru: "код" },
    { k: "キャラクター", r: "kyarakutā", ru: "персонажей", one: "персонажа" }, { k: "マップ", r: "mappu", ru: "карты уровней", one: "карту уровня" }, { k: "アプリ", r: "apuri", ru: "приложения", one: "приложение" },
    { k: "エーアイエージェント", r: "ēai ējento", ru: "ИИ-агентов", one: "ИИ-агента" }]],
  ["Творчество и досуг", [{ k: "え", r: "e", ru: "картины", one: "картину" }, { k: "ピクセルアート", r: "pikuseru āto", ru: "пиксель-арт" },
    { k: "デジタルアート", r: "dejitaru āto", ru: "диджитал-арт" }, { k: "おんがく", r: "ongaku", ru: "музыку" }, { k: "まんが", r: "manga", ru: "мангу" },
    { k: "アニメ", r: "anime", ru: "аниме" }, { k: "えいが", r: "eiga", ru: "фильмы", one: "фильм" }, { k: "ほん", r: "hon", ru: "книги", one: "книгу" },
    { k: "しゃしん", r: "shashin", ru: "фото" }, { k: "にほんご", r: "nihongo", ru: "японский" }]],
  ["Скейт и транспорт", [{ k: "スケボー", r: "sukebō", ru: "скейт", na: "скейте" }, { k: "トリック", r: "torikku", ru: "трюки" },
    { k: "オーリー", r: "ōrī", ru: "олли" }, { k: "キックフリップ", r: "kikkufurippu", ru: "кикфлип" },
    { k: "じてんしゃ", r: "jitensha", ru: "велосипед", na: "велосипеде" }, { k: "でんしゃ", r: "densha", ru: "электричку", na: "электричке" }]],
  ["Привычки", [{ k: "たばこ", r: "tabako", ru: "сигареты" }, { k: "たいま", r: "taima", ru: "марихуану" }]],
  ["Вопрос", [{ k: "なに", r: "nani", ru: "что", q: true, label: "なに — что?" }]],
];
const OBJ_FLAT = OBJ.flatMap(([, l]) => l);
// ru: [инфинитив, я, ты, он/она, они, он (прош.), она (прош.), они (прош.), «давай …» (мы)]
// part — частица объекта (по умолчанию を; のる — «на что» — に), intr — объекта не бывает
const VERBS = [
  { d: "たべる", s: "たべ", sr: "tabe", ru: ["есть", "ем", "ешь", "ест", "едят", "ел", "ела", "ели", "поедим"] },
  { d: "のむ", s: "のみ", sr: "nomi", ru: ["пить", "пью", "пьёшь", "пьёт", "пьют", "пил", "пила", "пили", "попьём"] },
  { d: "みる", s: "み", sr: "mi", ru: ["смотреть", "смотрю", "смотришь", "смотрит", "смотрят", "смотрел", "смотрела", "смотрели", "посмотрим"] },
  { d: "よむ", s: "よみ", sr: "yomi", ru: ["читать", "читаю", "читаешь", "читает", "читают", "читал", "читала", "читали", "почитаем"] },
  { d: "かく", s: "かき", sr: "kaki", ru: ["рисовать", "рисую", "рисуешь", "рисует", "рисуют", "рисовал", "рисовала", "рисовали", "порисуем"], label: "かく — рисовать / писать (код)" },
  { d: "つくる", s: "つくり", sr: "tsukuri", ru: ["делать", "делаю", "делаешь", "делает", "делают", "делал", "делала", "делали", "сделаем"], label: "つくる — делать, создавать (руками)" },
  { d: "かいはつする", s: "かいはつし", sr: "kaihatsushi", ru: ["разрабатывать", "разрабатываю", "разрабатываешь", "разрабатывает", "разрабатывают", "разрабатывал", "разрабатывала", "разрабатывали", "разработаем"], label: "かいはつする — разрабатывать (開発)" },
  { d: "する", s: "し", sr: "shi", ru: ["делать", "делаю", "делаешь", "делает", "делают", "делал", "делала", "делали", "сделаем"], label: "する — делать (ゲームを する — играть)" },
  { d: "れんしゅうする", s: "れんしゅうし", sr: "renshūshi", ru: ["отрабатывать", "отрабатываю", "отрабатываешь", "отрабатывает", "отрабатывают", "отрабатывал", "отрабатывала", "отрабатывали", "потренируем"], label: "れんしゅうする — тренировать, отрабатывать" },
  { d: "のる", s: "のり", sr: "nori", part: ["に", "ni", "на чём"], na: true, ru: ["кататься на", "катаюсь на", "катаешься на", "катается на", "катаются на", "катался на", "каталась на", "катались на", "покатаемся на"], label: "のる — ездить / кататься на (〜に のる)" },
  { d: "すべる", s: "すべり", sr: "suberi", intr: true, ru: ["кататься", "катаюсь", "катаешься", "катается", "катаются", "катался", "каталась", "катались", "покатаемся"], label: "すべる — кататься (на скейте), без объекта" },
  { d: "きく", s: "きき", sr: "kiki", ru: ["слушать", "слушаю", "слушаешь", "слушает", "слушают", "слушал", "слушала", "слушали", "послушаем"] },
  { d: "かう", s: "かい", sr: "kai", ru: ["покупать", "покупаю", "покупаешь", "покупает", "покупают", "покупал", "покупала", "покупали", "купим"] },
  { d: "とる", s: "とり", sr: "tori", ru: ["снимать", "снимаю", "снимаешь", "снимает", "снимают", "снимал", "снимала", "снимали", "поснимаем"], label: "とる — снимать (しゃしんを とる)" },
  { d: "すう", s: "すい", sr: "sui", ru: ["курить", "курю", "куришь", "курит", "курят", "курил", "курила", "курили", "покурим"], label: "すう — курить" },
  { d: "はたらく", s: "はたらき", sr: "hataraki", intr: true, ru: ["работать", "работаю", "работаешь", "работает", "работают", "работал", "работала", "работали", "поработаем"], label: "はたらく — работать, без объекта" },
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
  // «нравится делать»: словарная форма + のが すき — действие превращается в «это» (の), и это «это» нравится
  { id: "like", dict: true, k: "のがすきです", r: "no ga suki desu", g: "нравится", label: "〜のが すきです — нравится делать" },
  { id: "dislike", dict: true, k: "のがすきじゃないです", r: "no ga suki janai desu", g: "не нравится", label: "〜のが すきじゃないです — не нравится" },
];
// ромадзи словарной формы (たべる — taberu): нужна для «нравится делать»
const DICT_R = { たべる: "taberu", のむ: "nomu", みる: "miru", よむ: "yomu", かく: "kaku", つくる: "tsukuru", かいはつする: "kaihatsu suru",
  する: "suru", れんしゅうする: "renshū suru", のる: "noru", すべる: "suberu", きく: "kiku", かう: "kau", とる: "toru", すう: "suu",
  はたらく: "hataraku", べんきょうする: "benkyō suru" };
const WANT = { 1: "хочу", 2: "хочешь", 3: "хочет", 4: "хотят" };
const PAST = { m: 5, f: 6, pl: 7 };
const QPREP = { в: "во что", на: "на чём" };   // «что» + предлог глагола: «во что играешь», «на чём катаешься»

const P = (k, r, g) => ({ k, r, g, p: true });

// названия для «X という Y» — «Y под названием X»; последняя строка — своё название (store "kana.custom")
export const NAMES = [
  { k: "", label: "(без названия)" },
  { k: "グレイブブラッド", r: "gureibuburaddo", ru: "Graveblood" },
  { k: "ドリームス", r: "dorīmusu", ru: "Dreams" },
  { k: "スパイロ", r: "supairo", ru: "Spyro" },
  { k: "ニキータオーエス", r: "nikīta ōesu", ru: "nikita.os" },
  { custom: true, label: "✏️ своё…" },
];
const nameOf = i => {
  const n = NAMES[i] || NAMES[0];
  if (!n.custom) return n;
  const c = store.get("kana.custom", { k: "", r: "", ru: "" });
  return c.k ? { k: c.k, r: c.r || c.ru, ru: c.ru || c.r } : NAMES[0];
};
const named = nm => nm.k ? [{ k: nm.k, r: nm.r, g: `«${nm.ru}»` }, P("という", "to iu", "под названием")] : [];

export function compose(s) {
  const nm = nameOf(s.name);
  const sub = SUBJ[s.sub] || SUBJ[0], tm = TIME[s.time] || TIME[0], pl = PLACE[s.place] || PLACE[0], v = VERBS[s.verb] || VERBS[0];
  const f = FORMS.find(x => x.id === s.form) || FORMS[0];
  const ob = v.intr ? OBJ_FLAT[0] : OBJ_FLAT[s.obj] || OBJ_FLAT[0];   // у すべる / はたらく объекта нет
  const q = s.q || tm.q || pl.q || ob.q;
  const t = [];
  // в «давай» тема — не «кто», а «с кем»: みんなで, かのじょと, いっしょに
  if (f.id === "let" && sub.let) {
    const [pk, pr, pg, , wk, wr, wg] = sub.let;
    t.push(wk ? { k: wk, r: wr, g: wg } : { k: sub.k, r: sub.r, g: sub.g }, P(pk, pr, pg));
  } else if (sub.k && f.id !== "let") t.push({ k: sub.k, r: sub.r, g: sub.g }, P("は", "wa", "тема"));
  // ぜんぜん с «не нравится» встаёт прямо перед すき: 〜のが ぜんぜん すきじゃないです
  const late = f.dict && tm.never;
  if (tm.k && !late) { t.push({ k: tm.k, r: tm.r, g: tm.ru }); if (tm.ni) t.push(P("に", "ni", "когда")); }
  // название цепляется к объекту, а если объекта нет — к месту
  const nmOb = nm.k && ob.k && !ob.q, nmPl = nm.k && !nmOb && pl.k && !pl.q;
  if (pl.k) t.push(...(nmPl ? named(nm) : []), { k: pl.k, r: pl.r, g: pl.ru }, P("で", "de", "где"));
  if (ob.k) t.push(...(nmOb ? named(nm) : []), { k: ob.k, r: ob.r, g: v.na ? ob.na || ob.ru : ob.ru }, P(...(v.part || ["を", "o", "объект"])));
  // 〜たいです — только про себя (или вопрос «ты хочешь?»); про других — 〜たがっています
  const fe = f.id === "want" && sub.p >= 3 ? { k: "たがっています", r: "tagatte imasu", g: "хочет" } : f;
  const vr = ob.alt?.[v.d] || v.ru;
  if (f.dict) t.push({ k: v.d, r: DICT_R[v.d], g: vr[0] }, P("の", "no", "(это)"), P("が", "ga", "подлеж."),
    ...(late ? [{ k: tm.k, r: tm.r, g: "совсем" }] : []), { k: "すき", r: "suki", g: "нравится" }, P(f.id === "like" ? "です" : "じゃないです", f.id === "like" ? "desu" : "janai desu", f.id === "like" ? "вежл." : "не"));
  else t.push({ k: v.s, r: v.sr, g: vr[0] }, P(fe.k, fe.r, fe.g));
  if (q) t.push(P("か", "ka", "вопрос"));

  // русский: тема · время · место · глагол · объект, вопросительное слово — вперёд
  let vp;
  const verb = ob.k ? vr : vr.map(x => x.replace(/ (в|на)$/, ""));
  if (f.id === "pres") vp = verb[sub.p];
  if (f.id === "neg") vp = "не " + verb[sub.p];
  if (f.id === "past") vp = verb[PAST[sub.gen]];
  if (f.id === "pastneg") vp = "не " + verb[PAST[sub.gen]];
  if (f.id === "let") vp = (sub.p === 4 ? "давайте " : "давай ") + (sub.let ? sub.let[3] + " " : "") + verb[8];
  if (f.id === "want") vp = WANT[sub.p] + " " + verb[0];
  if (f.id === "like") vp = "нравится " + verb[0];
  if (f.id === "dislike") vp = (tm.never ? "совсем не" : "не") + " нравится " + verb[0];
  if (tm.never) vp = vp.replace(/^не /, "никогда не ");
  let obRu = v.na ? ob.na || ob.ru : nmOb ? ob.one || ob.ru : ob.ru;
  if (nmOb) obRu += ` «${nm.ru}»`;
  if (ob.q) { const m = vp.match(/ (в|на)$/); if (m) { vp = vp.slice(0, -m[0].length); obRu = QPREP[m[1]]; } }
  const words = [f.id === "let" ? "" : f.dict ? sub.dat : sub.ru, tm.never ? "" : tm.ru, nmPl ? `${pl.ru} «${nm.ru}»` : pl.ru, vp, obRu];
  const qw = [tm.q && 1, pl.q && 2, ob.q && 4].filter(Boolean);   // все вопросительные слова — в начало
  let ru = [...qw.map(i => words[i]), ...words.filter((_, i) => !qw.includes(i))].filter(Boolean).join(" ");
  ru = ru[0].toUpperCase() + ru.slice(1) + (q ? "?" : ".");
  return { t, ru, v };
}

const DEF = { sub: 0, time: 1, place: 1, obj: 1, verb: 0, form: "pres", q: false, name: 0 };

// выбор названия + поля для своего (катакана и латиница)
function nameField(get, set, onchange) {
  const c = store.get("kana.custom", { k: "", r: "", ru: "" });
  const inp = (key, ph) => el("input", { className: "kn-ninput small", placeholder: ph, value: c[key] || "",
    oninput: e => { c[key] = e.target.value.trim(); store.set("kana.custom", c); onchange(); } });
  const own = el("span", { className: "kn-own" }, inp("k", "катаканой: ドリームス"), inp("ru", "латиницей: Dreams"));
  const sel = el("select", { onchange: e => { set(+e.target.value); paint(); onchange(); } },
    ...NAMES.map((n, i) => el("option", { value: i, textContent: n.label || `${n.k} — ${n.ru}` })));
  const paint = () => { sel.value = get(); own.hidden = !NAMES[get()]?.custom; };
  paint();
  return el("label", { className: "kn-bsel" }, el("span", { textContent: "Название (という)" }), sel, own);
}

function actionBuilder() {
  const s = Object.assign({}, DEF, store.get("kana.pb", {}));
  if (!NAMES[s.name]) s.name = 0;
  if (!OBJ_FLAT[s.obj]) s.obj = DEF.obj;
  if (!VERBS[s.verb]) s.verb = DEF.verb;
  const box = el("div");
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
      nameField(() => s.name, v => { s.name = v; }, () => draw()),
      el("label", { className: "kn-check" }, qchk, "？ Вопрос (か)")),
    out, forms, hint);

  function draw() {
    if (TIME[s.time]?.never && !["neg", "pastneg", "dislike"].includes(s.form)) s.form = "neg";   // «никогда» живёт только с отрицанием
    for (const k in selects) selects[k].value = s[k];
    qchk.checked = s.q;
    store.set("kana.pb", s);
    const { t, ru, v } = compose(s);
    out.replaceChildren(sentence(t, ru));
    // все хвосты выбранного глагола: видно, что основа одна, а меняется только конец
    forms.replaceChildren(el("span", { className: "kn-label", textContent: v.d + " →" }), ...FORMS.map(f =>
      el("button", { className: "kn-form" + (f.id === s.form ? " on" : ""), title: f.label, onclick: () => { s.form = f.id; draw(); } },
        el("span", { className: "kn-fk" }, f.dict ? v.d : v.s, el("b", { textContent: f.k })),
        el("span", { className: "kn-fr", textContent: f.dict ? DICT_R[v.d] + " " + f.r : v.sr + f.r.replace(" ", "") }))));
    const sub = SUBJ[s.sub];
    selects.obj.disabled = !!v.intr;
    hint.textContent = v.intr
      ? `${v.d} — глагол без объекта: делают «где», а не «что». スケートパークで すべります — катаюсь в скейтпарке.`
      : v.part
        ? `${v.d} берёт не を, а に: スケボーに のります — «катаюсь на скейте», でんしゃに のります — «еду на электричке».`
        : v.d === "する" || v.d.endsWith("する")
          ? `${v.d}: する в форме ます превращается в し — ${v.s}·ます. Поэтому в фразе «し», а не «する». То же у くる → き·ます.`
          : TIME[s.time]?.never
      ? "ぜんぜん дословно «совсем», и дружит только с отрицанием: ぜんぜん みません — «вообще не смотрю»."
      : FORMS.find(f => f.id === s.form)?.dict
        ? `«Нравится» — это すき, а не глагол. Действие сначала ставят в словарную форму (${v.d}, а не ${v.s}ます), добавляют の — «это», и уже это «это» すき: ${v.d}のが すきです. Тот же приём: 〜のが じょうずです — хорошо умею, 〜のが へたです — плохо получается.`
        : s.form === "let"
        ? "В «давай» тема — это «с кем»: みんなで — все вместе, かのじょと — с девушкой, いっしょに — вместе (с тобой). «Я» не говорят."
        : s.form === "want" && sub.p >= 3
          ? "〜たいです говорят только про себя. Про других — 〜たがっています: «он(а) хочет, по нему видно»."
          : s.name
            ? "X という Y — «Y под названием X». Название встаёт перед объектом (а если объекта нет — перед местом): グレイブブラッドという ゲームを つくります."
            : "Поменяй «Действие» — объект останется тем же: すしを たべます → すしを みます. Меняется только глагол.";
  }
  draw();
  return box;
}


/* ---------- 🧭 поездки: кто · когда · куда (に) · зачем · いく ---------- */
const DEST = [
  { k: "にしのみや", r: "nishinomiya", to: "в Нисиномию", in: "в Нисиномии" },
  { k: "おおさか", r: "ōsaka", to: "в Осаку", in: "в Осаке" },
  { k: "きょうと", r: "kyōto", to: "в Киото", in: "в Киото" },
  { k: "とうきょう", r: "tōkyō", to: "в Токио", in: "в Токио" },
  { k: "にほん", r: "nihon", to: "в Японию", in: "в Японии" },
  { k: "カフェ", r: "kafe", to: "в кафе", in: "в кафе" },
  { k: "スケートパーク", r: "sukētopāku", to: "в скейтпарк", in: "в скейтпарке" },
  { k: "イベント", r: "ibento", to: "на ивент", in: "на ивенте" },
  { k: "かいしゃ", r: "kaisha", to: "на работу", in: "на работе" },
  { k: "どこ", r: "doko", to: "куда", in: "где", q: true, label: "どこ — куда?" },
];
// зачем: «развлечься-に», «скейт-を кататься-に» — цель + に перед いく
const PURP = [
  { t: [], ru: "", label: "(просто)" },
  { t: [["あそび", "asobi", "развлечься"], ["に", "ni", "цель", 1]], ru: "погулять", label: "あそびに — погулять, развлечься" },
  { t: [["かんこう", "kankō", "осмотр"], ["に", "ni", "цель", 1]], ru: "посмотреть город", label: "かんこうに — посмотреть город" },
  { t: [["スケボー", "sukebō", "скейт"], ["を", "o", "объект", 1], ["し", "shi", "делать"], ["に", "ni", "цель", 1]], ru: "покататься на скейте", label: "スケボーを しに — покататься" },
  { t: [["ラーメン", "rāmen", "рамен"], ["を", "o", "объект", 1], ["たべ", "tabe", "есть"], ["に", "ni", "цель", 1]], ru: "поесть рамен", label: "ラーメンを たべに — поесть рамен" },
  { t: [["しごと", "shigoto", "работа"], ["で", "de", "по", 1]], ru: "по работе", label: "しごとで — по работе" },
];
// ru: я, ты, он/она, они (через лицо темы); past — по роду; dest: to — «куда», in — «где» (для «побывать»)
const TRIP = [
  { id: "pres", t: [["いき", "iki", "ехать"], ["ます", "masu", "делаю", 1]], ru: ["", "еду", "едешь", "едет", "едут"], label: "いきます — еду / поеду" },
  { id: "past", t: [["いき", "iki", "ехать"], ["ました", "mashita", "делал", 1]], past: { m: "ездил", f: "ездила", pl: "ездили" }, label: "いきました — ездил" },
  { id: "neg", t: [["いき", "iki", "ехать"], ["ません", "masen", "не", 1]], ru: ["", "не еду", "не едешь", "не едет", "не едут"], label: "いきません — не еду" },
  { id: "let", t: [["いき", "iki", "ехать"], ["ましょう", "mashō", "давай", 1]], let: true, label: "いきましょう — давай поедем" },
  { id: "want", t: [["いき", "iki", "ехать"], ["たいです", "tai desu", "хочу", 1]], t3: [["いき", "iki", "ехать"], ["たがっています", "tagatte imasu", "хочет", 1]], ru: ["", "хочу поехать", "хочешь поехать", "хочет поехать", "хотят поехать"], label: "いきたいです — хочу поехать" },
  { id: "visit", t: [["いって", "itte", "съездив"], ["みたいです", "mitai desu", "хочу_попробовать", 1]], t3: [["いって", "itte", "съездив"], ["みたがっています", "mitagatte imasu", "хочет_попробовать", 1]], ru: ["", "хочу побывать", "хочешь побывать", "хочет побывать", "хотят побывать"], inPlace: true, label: "いって みたいです — хочу побывать" },
  { id: "plan", t: [["いく", "iku", "ехать"], ["よていです", "yotei desu", "по_плану", 1]], ru: ["", "собираюсь поехать", "собираешься поехать", "собирается поехать", "собираются поехать"], label: "いく よていです — собираюсь поехать" },
];
const T = ([k, r, g, p]) => ({ k, r, g: g.replace(/_/g, " "), p: !!p });

function tripCompose(s) {
  const sub = SUBJ[s.sub] || SUBJ[0], tm = TIME[s.time] || TIME[0], d = DEST[s.dest] || DEST[0], pu = PURP[s.purp] || PURP[0];
  const f = TRIP.find(x => x.id === s.form) || TRIP[0], nm = d.q ? NAMES[0] : nameOf(s.name), q = s.q || tm.q || d.q;
  const t = [];
  if (f.let && sub.let) { const [pk, pr, pg, , wk, wr, wg] = sub.let; t.push(wk ? { k: wk, r: wr, g: wg } : { k: sub.k, r: sub.r, g: sub.g }, P(pk, pr, pg)); }
  else if (sub.k && !f.let) t.push({ k: sub.k, r: sub.r, g: sub.g }, P("は", "wa", "тема"));
  if (tm.k) { t.push({ k: tm.k, r: tm.r, g: tm.ru }); if (tm.ni) t.push(P("に", "ni", "когда")); }
  t.push(...named(nm), { k: d.k, r: d.r, g: d.q ? "куда" : d.to }, P("に", "ni", "куда"), ...pu.t.map(T));
  t.push(...((sub.p >= 3 && f.t3) || f.t).map(T));
  if (q) t.push(P("か", "ka", "вопрос"));
  let vp = f.let ? (sub.p === 4 ? "давайте " : "давай ") + (sub.let ? sub.let[3] + " " : "") + "поедем" : f.past ? f.past[sub.gen] : f.ru[sub.p];
  if (tm.never) vp = vp.replace(/^не /, "никогда не ");
  const where = (f.inPlace ? d.in : d.to) + (nm.k ? ` «${nm.ru}»` : "");
  const words = d.q ? [where, f.let ? "" : sub.ru, tm.never ? "" : tm.ru, vp, pu.ru] : [f.let ? "" : sub.ru, tm.never ? "" : tm.ru, vp, where, pu.ru];
  let ru = words.filter(Boolean).join(" ");
  ru = ru[0].toUpperCase() + ru.slice(1) + (q ? "?" : ".");
  return { t, ru, f };
}

function tripBuilder() {
  const s = Object.assign({ sub: 0, time: 10, dest: 0, purp: 1, form: "plan", q: false, name: 0 }, store.get("kana.trip", {}));
  const out = el("div"), hint = el("p", { className: "kn-muted" });
  const sels = {};
  const sel = (key, label, list, text) => el("label", { className: "kn-bsel" }, el("span", { textContent: label }),
    sels[key] = el("select", { onchange: e => { s[key] = key === "form" ? e.target.value : +e.target.value; draw(); } },
      ...list.map((x, i) => el("option", { value: key === "form" ? x.id : i, selected: (key === "form" ? x.id : i) === s[key], textContent: text(x) }))));
  const qchk = el("input", { type: "checkbox", checked: s.q, onchange: e => { s.q = e.target.checked; draw(); } });
  const box = el("div", {}, el("div", { className: "kn-builder" },
    sel("sub", "Кто", SUBJ, x => x.label || `${x.k} — ${x.ru}`),
    sel("time", "Когда", TIME, x => x.label || `${x.k} — ${x.ru}`),
    sel("dest", "Куда", DEST, x => x.label || `${x.k} — ${x.to}`),
    sel("purp", "Зачем", PURP, x => x.label),
    sel("form", "Как", TRIP, x => x.label),
    nameField(() => s.name, v => { s.name = v; }, () => draw()),
    el("label", { className: "kn-check" }, qchk, "？ Вопрос (か)")), out, hint);
  function draw() {
    if (TIME[s.time]?.never && s.form !== "neg") { s.form = "neg"; sels.form.value = "neg"; }   // ぜんぜん — только с отрицанием
    store.set("kana.trip", s);
    const { t, ru, f } = tripCompose(s);
    out.replaceChildren(sentence(t, ru));
    hint.textContent = {
      plan: "よてい — «план»: いく よていです — «по плану еду», то есть собираюсь. Перед よてい глагол в словарной форме (いく), не いきます.",
      visit: "〜て みたい — «хочу попробовать сделать»: いって みたい — «хочу съездить, побывать». Это и есть «посетить», а не «переехать» (переехать — ひっこす).",
      want: "いきたい — просто «хочу поехать». Про других — いきたがっています.",
    }[f.id] || "Куда — всегда に (или へ). Цель поездки — основа глагола + に: あそびに いく — поехать развлечься, たべに いく — поехать поесть.";
  }
  draw();
  return box;
}

/* ---------- 🪪 обо мне: «я — …», работа, хобби, смысл жизни, любимое ---------- */
const ROLES = [
  { k: "ゲームかいはつしゃ", r: "gēmu kaihatsusha", ru: "разработчик игр" },
  { k: "インディーゲームクリエイター", r: "indī gēmu kurieitā", ru: "инди-разработчик игр" },
  { k: "プログラマー", r: "puroguramā", ru: "программист" },
  { k: "エーアイエンジニア", r: "ēai enjinia", ru: "ИИ-инженер" },
  { k: "イラストレーター", r: "irasutorētā", ru: "иллюстратор" },
  { k: "スケーター", r: "sukētā", ru: "скейтер" },
  { k: "ディージェー", r: "dījē", ru: "диджей" },
];
const ACTS = [
  { k: "ゲームかいはつ", r: "gēmu kaihatsu", ru: "разработка игр" },
  { k: "エーアイの ハーネスの かいはつ", r: "ēai no hānesu no kaihatsu", ru: "разработка харнесса для ИИ" },
  { k: "プログラミング", r: "puroguramingu", ru: "программирование" },
  { k: "スケボー", r: "sukebō", ru: "скейт" },
  { k: "おえかき", r: "oekaki", ru: "рисование" },
  { k: "ピクセルアート", r: "pikuseru āto", ru: "пиксель-арт" },
  { k: "おんがくづくり", r: "ongakuzukuri", ru: "создание музыки" },
  { k: "ゲーム", r: "gēmu", ru: "видеоигры" },
];
const CATS = [
  { k: "ゲーム", r: "gēmu", g: "игра", ru: "Моя самая любимая игра" },
  { k: "シリーズ", r: "shirīzu", g: "серия", ru: "Моя самая любимая серия" },
  { k: "アニメ", r: "anime", g: "аниме", ru: "Моё самое любимое аниме" },
  { k: "キャラクター", r: "kyarakutā", g: "персонаж", ru: "Мой самый любимый персонаж" },
  { k: "バンド", r: "bando", g: "группа", ru: "Моя самая любимая группа" },
];
const ABOUT = [
  { id: "role", label: "Я — … (профессия, кто я)", list: ROLES, build: x => [[["わたし", "watashi", "я"], ["は", "wa", "тема", 1], [x.k, x.r, x.ru], ["です", "desu", "есть", 1]], `Я — ${x.ru}.`],
    hint: "〜しゃ (者) — «человек, который…»: かいはつしゃ — разработчик. Слова-профессии на катакане (プログラマー, スケーター) — заимствования из английского." },
  { id: "job", label: "Моя работа — …", list: ACTS, build: x => [[["しごと", "shigoto", "работа"], ["は", "wa", "тема", 1], [x.k, x.r, x.ru], ["です", "desu", "есть", 1]], `Моя работа — ${x.ru}.`],
    hint: "しごと — работа. «Моя» не нужно: о ком речь, и так понятно. X の Y — «Y для/от X»: エーアイの ハーネス — харнесс для ИИ." },
  { id: "hobby", label: "Моё хобби — …", list: ACTS, build: x => [[["しゅみ", "shumi", "хобби"], ["は", "wa", "тема", 1], [x.k, x.r, x.ru], ["です", "desu", "есть", 1]], `Моё хобби — ${x.ru}.`],
    hint: "しゅみ — хобби. Спросить у собеседника: しゅみは なんですか — «какое у вас хобби?»." },
  { id: "ikigai", label: "… — смысл моей жизни", list: ACTS, build: x => [[[x.k, x.r, x.ru], ["は", "wa", "тема", 1], ["わたし", "watashi", "я"], ["の", "no", "чей", 1], ["いきがい", "ikigai", "смысл_жизни"], ["です", "desu", "есть", 1]], `${x.ru[0].toUpperCase() + x.ru.slice(1)} — смысл моей жизни.`],
    hint: "いきがい (生きがい) — «то, ради чего живёшь». Так можно развести: しごとは エーアイの ハーネスの かいはつです — это работа, а ゲームかいはつは わたしの いきがいです — это страсть." },
  { id: "fav", label: "Самое любимое … — …", list: CATS, named: true, build: (x, nm) => [[["いちばん", "ichiban", "самый"], ["すき", "suki", "любимый"], ["な", "na", "связка", 1], [x.k, x.r, x.g], ["は", "wa", "тема", 1], [nm.k || "なん", nm.r || "nan", nm.k ? `«${nm.ru}»` : "что"], ["です", "desu", "есть", 1]].concat(nm.k ? [] : [["か", "ka", "вопрос", 1]]), nm.k ? `${x.ru} — ${nm.ru}.` : `${x.ru.replace("Моя", "Твоя").replace("Моё", "Твоё").replace("Мой", "Твой")} — какая?`],
    hint: "すきな — «любимый» (な-прилагательное перед существительным). いちばん — «номер один, самый». Без названия получается вопрос: いちばん すきな ゲームは なんですか." },
];

function aboutBuilder() {
  const s = Object.assign({ pat: 0, val: 0, name: 3 }, store.get("kana.about", {}));
  const out = el("div"), hint = el("p", { className: "kn-muted" }), vals = el("span"), nmBox = el("span");
  const patSel = el("select", { onchange: e => { s.pat = +e.target.value; s.val = 0; draw(); } },
    ...ABOUT.map((a, i) => el("option", { value: i, selected: i === s.pat, textContent: a.label })));
  const box = el("div", {}, el("div", { className: "kn-builder" },
    el("label", { className: "kn-bsel" }, el("span", { textContent: "Шаблон" }), patSel), vals, nmBox), out, hint);
  function draw() {
    const a = ABOUT[s.pat] || ABOUT[0];
    if (!a.list[s.val]) s.val = 0;
    store.set("kana.about", s);
    vals.replaceChildren(el("label", { className: "kn-bsel" }, el("span", { textContent: a.named ? "Что" : "Кто / что" }),
      el("select", { onchange: e => { s.val = +e.target.value; draw(); } },
        ...a.list.map((x, i) => el("option", { value: i, selected: i === s.val, textContent: `${x.k} — ${x.g || x.ru}` })))));
    nmBox.replaceChildren(a.named ? nameField(() => s.name, v => { s.name = v; }, () => draw()) : "");
    const [toks, ru] = a.build(a.list[s.val], nameOf(s.name));
    out.replaceChildren(sentence(toks.map(T), ru));
    hint.textContent = a.hint;
  }
  draw();
  return box;
}

// конструктор целиком: вкладки «Действие / Поездки / Обо мне» — каждая со своим набором полей
const KINDS = [["act", "🔨 Действие", actionBuilder], ["trip", "🧭 Поездки", tripBuilder], ["about", "🪪 Обо мне", aboutBuilder]];
export function phraseBuilder() {
  let cur = store.get("kana.pbtab", "act");
  const seg = el("div", { className: "kn-seg kn-pbtabs" }), body = el("div");
  function show() {
    store.set("kana.pbtab", cur);
    const k = KINDS.find(x => x[0] === cur) || KINDS[0];
    seg.replaceChildren(...KINDS.map(([id, label]) => el("button", { className: "kn-segb" + (id === k[0] ? " on" : ""), textContent: label,
      onclick: () => { cur = id; show(); } })));
    body.replaceChildren(k[2]());
  }
  show();
  return el("div", { className: "kn-pb" }, seg, body);
}

/* ---------- готовые фразы по ситуациям ---------- */
export const SITUATIONS = [
  { id: "dev", h: "🎮 Геймдев", tip: "〜て います — «делаю сейчас / занимаюсь этим»: つくって います — делаю (в процессе).", ex: [
    ex("わたし=watashi=я *は=wa=тема ゲーム=gēmu=игра *を=o=объект つくって=tsukutte=делая *います=imasu=(в_процессе)", "Я делаю игру."),
    ex("グレイブブラッド=gureibuburaddo=«Graveblood» *という=toiu=под_названием ゲーム=gēmu=игра *を=o=объект つくって=tsukutte=делая *います=imasu=(в_процессе)", "Делаю игру под названием Graveblood."),
    ex("わたし=watashi=я *は=wa=тема ゲームかいはつしゃ=gēmukaihatsusha=разработчик_игр です=desu=есть", "Я — разработчик игр."),
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
    ex("いちばん=ichiban=самый すき=suki=любимый *な=na=связка シリーズ=shirīzu=серия *は=wa=тема スパイロ=supairo=«Spyro» です=desu=есть", "Моя самая любимая серия — Spyro."),
    ex("いちばん=ichiban=самый すき=suki=любимый *な=na=связка ゲーム=gēmu=игра *は=wa=тема なん=nan=что です=desu=есть *か=ka=вопрос", "Какая твоя самая любимая игра?"),
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
  { id: "hi", h: "👋 Знакомство", tip: "はじめまして — только при первой встрече. よろしく おねがいします — «рад знакомству / прошу любить и жаловать», говорят в конце. 〜て ください — «пожалуйста, сделайте».", ex: [
    ex("はじめまして=hajimemashite=впервые_встречаемся", "Приятно познакомиться."),
    ex("ニキータ=nikīta=Никита です=desu=есть", "Я Никита."),
    ex("よろしく=yoroshiku=благосклонно おねがいします=onegaishimasu=прошу", "Рад знакомству!"),
    ex("にほんご=nihongo=японский *は=wa=тема すこし=sukoshi=немного *だけ=dake=только はなせます=hanasemasu=могу_говорить", "По-японски говорю совсем чуть-чуть."),
    ex("ゆっくり=yukkuri=медленно はなして=hanashite=говоря ください=kudasai=пожалуйста", "Говорите помедленнее, пожалуйста."),
    ex("もう=mō=ещё いちど=ichido=раз おねがいします=onegaishimasu=прошу", "Ещё раз, пожалуйста."),
    ex("えいご=eigo=английский *は=wa=тема はなせます=hanasemasu=можете_говорить *か=ka=вопрос", "Вы говорите по-английски?"),
  ] },
  { id: "home", h: "🏠 Где живу", vars: ["country", "city"],
    tip: "から — «откуда», に — «где живу / куда еду», で — «где что-то делаю». すむ — жить (すんで います — живу), ひっこす — переезжать, 〜たい — хочу.", tpl: [
    ["わたし=watashi=я *は=wa=тема {country} *から=kara=откуда きました=kimashita=приехал", "Я приехал {country.from}."],
    ["いま=ima=сейчас {country} *に=ni=где すんで=sunde=живя *います=imasu=(в_процессе)", "Сейчас живу {country.in}."],
    ["{city} *に=ni=куда ひっこしたい=hikkoshitai=хочу_переехать です=desu=вежл.", "Хочу переехать {city.to}."],
    ["{city} *に=ni=где すみたい=sumitai=хочу_жить です=desu=вежл.", "Хочу жить {city.in}."],
    ["{city} *で=de=где はたらきたい=hatarakitai=хочу_работать です=desu=вежл.", "Хочу работать {city.in}."],
    ["にほん=nihon=Япония *の=no=какой ゲームがいしゃ=gēmugaisha=игровая_компания *で=de=где はたらきたい=hatarakitai=хочу_работать です=desu=вежл.", "Хочу работать в японской игровой компании."],
    ["{city} *は=wa=тема はじめて=hajimete=впервые です=desu=вежл.", "Я {city.in} впервые."],
  ] },
  { id: "work", h: "💼 Работа и ИИ", tip: "かいはつ (開発) — «разработка», かいはつする — разрабатывать. しくみ — «устройство, механизм». が между фразами — «но». しゅみで — «как хобби».", ex: [
    ex("わたし=watashi=я *は=wa=тема プログラマー=puroguramā=программист です=desu=есть", "Я программист."),
    ex("しごと=shigoto=работа *は=wa=тема エーアイ=ēai=ИИ *の=no=для ハーネス=hānesu=харнесс *の=no=чей かいはつ=kaihatsu=разработка です=desu=есть", "Моя работа — разработка харнесса для ИИ."),
    ex("でも=demo=но ゲームかいはつ=gēmukaihatsu=разработка_игр *は=wa=тема わたし=watashi=я *の=no=чей いきがい=ikigai=смысл_жизни です=desu=есть", "А разработка игр — смысл моей жизни."),
    ex("しごと=shigoto=работа *で=de=где エーアイ=ēai=ИИ *の=no=для ハーネス=hānesu=харнесс *を=o=объект かいはつして=kaihatsushite=разрабатывая *います=imasu=(в_процессе)", "На работе разрабатываю харнесс для ИИ."),
    ex("ハーネス=hānesu=харнесс *は=wa=тема エーアイエージェント=ēaiējento=ИИ-агент *を=o=объект うごかす=ugokasu=запускать しくみ=shikumi=механизм です=desu=есть", "Харнесс — это механизм, который запускает ИИ-агентов."),
    ex("エーアイ=ēai=ИИ *が=ga=подлеж. コード=kōdo=код *を=o=объект かいて=kaite=напишет テスト=tesuto=тест *も=mo=тоже します=shimasu=делает", "ИИ пишет код и сам его тестирует."),
    ex("しごと=shigoto=работа *は=wa=тема たのしい=tanoshii=интересная です=desu=есть *が=ga=но ちょっと=chotto=немного いそがしい=isogashii=загруженная です=desu=есть", "Работа интересная, но немного загруженная."),
    ex("しゅみ=shumi=хобби *で=de=как ゲーム=gēmu=игры *を=o=объект かいはつして=kaihatsushite=разрабатывая *います=imasu=(в_процессе)", "Игры разрабатываю как хобби."),
  ] },
  { id: "skate", h: "🛹 Скейт", tip: "スケボーに のる — «кататься на скейте» (частица に!), すべる — просто «кататься». できます — «умею». 〜ませんか — вежливое приглашение: «не хотите ли…?».", ex: [
    ex("スケボー=sukebō=скейт *が=ga=подлеж. すき=suki=нравится です=desu=вежл.", "Люблю скейт."),
    ex("まいにち=mainichi=каждый_день スケボー=sukebō=скейт *に=ni=на_чём のります=norimasu=катаюсь", "Каждый день катаюсь на скейте."),
    ex("スケートパーク=sukētopāku=скейтпарк *は=wa=тема どこ=doko=где です=desu=вежл. *か=ka=вопрос", "Где тут скейтпарк?"),
    ex("オーリー=ōrī=олли *が=ga=подлеж. できます=dekimasu=умею", "Умею делать олли."),
    ex("キックフリップ=kikkufurippu=кикфлип *を=o=объект れんしゅうして=renshūshite=отрабатывая *います=imasu=(в_процессе)", "Отрабатываю кикфлип."),
    ex("いっしょ=issho=вместе *に=ni=как すべりません=suberimasen=не_покатаемся *か=ka=вопрос", "Покатаемся вместе?"),
    ex("ここ=koko=здесь *で=de=где すべって=subette=катаясь *も=mo=даже いい=ii=хорошо です=desu=вежл. *か=ka=вопрос", "Здесь можно кататься?"),
    ex("ころびました=korobimashita=упал", "Упал!"),
  ] },
  { id: "music", h: "🎵 Музыка", tip: "どんな — «какой по типу». 〜の れんしゅう — «тренировка в чём-то».", ex: [
    ex("おんがく=ongaku=музыка *を=o=объект つくって=tsukutte=делая *います=imasu=(в_процессе)", "Пишу музыку."),
    ex("ダブステップ=dabusuteppu=дабстеп *が=ga=подлеж. すき=suki=нравится です=desu=вежл.", "Люблю дабстеп."),
    ex("ディージェー=dījē=диджей *の=no=какой れんしゅう=renshū=практика *を=o=объект して=shite=делая *います=imasu=(в_процессе)", "Учусь диджеить."),
    ex("どんな=donna=какую おんがく=ongaku=музыку *を=o=объект ききます=kikimasu=слушаете *か=ka=вопрос", "Какую музыку слушаете?"),
  ] },
  { id: "cafe", h: "🍜 Кафе и магазин", tip: "〜を ください — «дайте, пожалуйста», самая полезная фраза. おねがいします — «прошу», подходит почти везде.", ex: [
    ex("これ=kore=это *を=o=объект ください=kudasai=дайте", "Это, пожалуйста."),
    ex("みず=mizu=вода *を=o=объект ください=kudasai=дайте", "Воды, пожалуйста."),
    ex("カード=kādo=карта *で=de=чем はらえます=haraemasu=можно_заплатить *か=ka=вопрос", "Можно картой?"),
    ex("おかいけい=okaikei=счёт おねがいします=onegaishimasu=прошу", "Счёт, пожалуйста."),
    ex("おいしかった=oishikatta=было_вкусно です=desu=вежл.", "Было очень вкусно."),
    ex("ごちそうさまでした=gochisōsamadeshita=спасибо_за_еду", "Спасибо за угощение (говорят после еды)."),
  ] },
  { id: "road", h: "🚃 Дорога", tip: "へ и に — «куда». 〜えます / 〜せます — «можно, получается»: かえます — можно купить.", ex: [
    ex("おおさか=ōsaka=Осака *へ=e=куда いきたい=ikitai=хочу_поехать です=desu=вежл.", "Хочу поехать в Осаку."),
    ex("にしのみや=nishinomiya=Нисиномия *に=ni=куда いく=iku=ехать *よてい=yotei=план です=desu=есть", "Собираюсь поехать в Нисиномию."),
    ex("にしのみや=nishinomiya=Нисиномия *に=ni=куда いって=itte=съездив *みたい=mitai=хочу_попробовать です=desu=вежл.", "Хочу побывать в Нисиномии."),
    ex("ドリームス=dorīmusu=«Dreams» *という=toiu=под_названием カフェ=kafe=кафе *に=ni=куда いきたい=ikitai=хочу_пойти です=desu=вежл.", "Хочу сходить в кафе «Dreams»."),
    ex("この=kono=этот でんしゃ=densha=поезд *は=wa=тема おおさか=ōsaka=Осака *に=ni=куда いきます=ikimasu=идёт *か=ka=вопрос", "Этот поезд идёт в Осаку?"),
    ex("きっぷ=kippu=билет *は=wa=тема どこ=doko=где *で=de=где かえます=kaemasu=можно_купить *か=ka=вопрос", "Где можно купить билет?"),
    ex("みち=michi=дорога *に=ni=в まよいました=mayoimashita=заблудился", "Я заблудился."),
  ] },
  { id: "nope", h: "🚫 Нет, спасибо", tip: "Отрицание в японском — не частица, а хвост глагола: すいます → すいません. Шутка: すいません «не курю» звучит точь-в-точь как すいません «извините» (разговорное すみません). В Японии с декабря 2024 наказуемо и само употребление марихуаны — до 7 лет.", ex: [
    ex("わたし=watashi=я *は=wa=тема たいま=taima=марихуана *を=o=объект すいません=suimasen=не_курю", "Я не курю марихуану."),
    ex("にほん=nihon=Япония *で=de=где たいま=taima=марихуана *は=wa=тема いほう=ihō=незаконно です=desu=есть", "В Японии марихуана незаконна."),
    ex("たばこ=tabako=сигареты *も=mo=тоже すいません=suimasen=не_курю", "Сигареты тоже не курю."),
    ex("おさけ=osake=алкоголь *は=wa=тема すこし=sukoshi=немного のみます=nomimasu=пью", "Алкоголь — немного пью."),
    ex("いいえ=iie=нет けっこう=kekkō=достаточно です=desu=вежл.", "Нет, спасибо."),
    ex("ぜったい=zettai=абсолютно *に=ni=как だめ=dame=нельзя です=desu=есть", "Ни в коем случае!"),
  ] },
];

// подстановки для ситуаций с шаблонами: k, r, g — слово; from/in/to — русские падежи
const VARS = {
  country: { label: "Откуда", list: [
    { k: "ロシア", r: "roshia", g: "Россия", from: "из России", in: "в России" },
    { k: "ベラルーシ", r: "berarūshi", g: "Беларусь", from: "из Беларуси", in: "в Беларуси" },
    { k: "カザフスタン", r: "kazafusutan", g: "Казахстан", from: "из Казахстана", in: "в Казахстане" },
    { k: "ウクライナ", r: "ukuraina", g: "Украина", from: "из Украины", in: "в Украине" },
    { k: "ジョージア", r: "jōjia", g: "Грузия", from: "из Грузии", in: "в Грузии" },
    { k: "アルメニア", r: "arumenia", g: "Армения", from: "из Армении", in: "в Армении" },
    { k: "セルビア", r: "serubia", g: "Сербия", from: "из Сербии", in: "в Сербии" },
  ] },
  city: { label: "Куда хочу", list: [
    { k: "にほん", r: "nihon", g: "Япония", to: "в Японию", in: "в Японии" },
    { k: "とうきょう", r: "tōkyō", g: "Токио", to: "в Токио", in: "в Токио" },
    { k: "おおさか", r: "ōsaka", g: "Осака", to: "в Осаку", in: "в Осаке" },
    { k: "きょうと", r: "kyōto", g: "Киото", to: "в Киото", in: "в Киото" },
    { k: "にしのみや", r: "nishinomiya", g: "Нисиномия", to: "в Нисиномию", in: "в Нисиномии" },
    { k: "ふくおか", r: "fukuoka", g: "Фукуока", to: "в Фукуоку", in: "в Фукуоке" },
    { k: "さっぽろ", r: "sapporo", g: "Саппоро", to: "в Саппоро", in: "в Саппоро" },
  ] },
};
const fill = (s, pick) => s.replace(/\{(\w+)(?:\.(\w+))?\}/g, (_, v, f) => {
  const x = VARS[v].list[pick[v] || 0];
  return f ? x[f] : `${x.k}=${x.r}=${x.g.replace(/ /g, "_")}`;
});

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
      const pick = store.get("kana.vars", {});
      const exs = s.tpl ? s.tpl.map(([jp, ru]) => ex(fill(jp, pick), fill(ru, pick))) : s.ex;
      // ситуация с подстановками: выбери страну/город — фразы перестроятся
      const vars = (s.vars || []).map(v => el("label", { className: "kn-bsel" }, el("span", { textContent: VARS[v].label }),
        el("select", { onchange: e => { pick[v] = +e.target.value; store.set("kana.vars", pick); show(); } },
          ...VARS[v].list.map((x, i) => el("option", { value: i, selected: i === (pick[v] || 0), textContent: `${x.k} — ${x.g}` })))));
      list.replaceChildren(el("p", { className: "kn-muted", textContent: "💡 " + s.tip }),
        vars.length ? el("div", { className: "kn-builder" }, ...vars) : "", ...exs.map(e => sentence(e.t, e.ru)));
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
