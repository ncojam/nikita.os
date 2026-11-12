import { el, store } from "../core/util.js";
import { WM } from "../wm.js";
import { ex } from "./kana-data.js";
import { sentence } from "./kana-phrases.js";

/* ================= Кана: словарики «Цвета» и «Предметы» =================
 * Слова сгруппированы по общему элементу — он подсвечен в каждом слове (いろ — «цвет», でん — «электро»,
 * 〜き — «аппарат», 〜や — «лавка»…). Узнал кусочек — угадываешь новые слова.
 * Карточка: эмодзи (у цветов — образец цвета), кана, ромадзи, перевод и разбор по частям.
 * «🙈 Прятать перевод» — самопроверка: перевод виден при наведении. Состояние — store("kana.words.hide").
 * Слово: [эмодзи или #цвет, кана, ромадзи, перевод, разбор]. mark — общий кусок, at — где искать (start / end / any).
 */
const W = (e, k, r, ru, parts = "") => ({ e, k, r, ru, parts });

const COLORS = [
  { h: "Старые цвета — сами прилагательные на い", mark: "い", at: "end",
    note: "Четыре самых древних цвета. Без い — существительное («красный цвет»), с い — прилагательное: あかい くるま — красная машина. Хвост меняется как у всех い-прилагательных: あかくない — не красный.",
    items: [W("#d9333f", "あか・あかい", "aka · akai", "красный"), W("#2f6fd6", "あお・あおい", "ao · aoi", "синий (и зелёный светофор!)"),
      W("#f5f5f5", "しろ・しろい", "shiro · shiroi", "белый"), W("#1b1b1f", "くろ・くろい", "kuro · kuroi", "чёрный")] },
  { h: "〜いろ — «цвета чего-то»", mark: "いろ", at: "any",
    note: "いろ (色) — «цвет». Берут предмет и добавляют いろ: «цвет воды», «цвет пепла». Только きいろ и ちゃいろ ещё и прилагательные с い (きいろい, ちゃいろい), остальные — через の: みずいろの シャツ.",
    items: [W("#f2c94c", "きいろ・きいろい", "kiiro · kiiroi", "жёлтый", "き (黄) жёлтый + いろ"), W("#8b5a2b", "ちゃいろ・ちゃいろい", "chairo · chairoi", "коричневый", "ちゃ (茶) чай + いろ"),
      W("#7cc8f0", "みずいろ", "mizuiro", "голубой", "みず (水) вода + いろ"), W("#9a9a9a", "はいいろ", "haiiro", "серый", "はい (灰) пепел + いろ"),
      W("#f4a3b8", "ももいろ", "momoiro", "розовый", "もも (桃) персик + いろ"), W("#d4af37", "きんいろ", "kin'iro", "золотой", "きん (金) золото + いろ"),
      W("#c0c0c0", "ぎんいろ", "gin'iro", "серебряный", "ぎん (銀) серебро + いろ")] },
  { h: "Цвета-существительные — через の", nav: "の-цвета", mark: "", at: "any",
    note: "У этих слов нет い: зелёная рубашка — みどりの シャツ. Можно добавить いろ: みどりいろ.",
    items: [W("#3aa65b", "みどり", "midori", "зелёный (и «зелень»)"), W("#8e44ad", "むらさき", "murasaki", "фиолетовый", "название растения")] },
  { h: "Заимствования — катаканой, тоже через の", nav: "Катакана", mark: "", at: "any",
    note: "Из английского. Очень частые в жизни — розовый чаще ピンク, чем ももいろ.",
    items: [W("#ff8fc7", "ピンク", "pinku", "розовый"), W("#f39c34", "オレンジ", "orenji", "оранжевый"),
      W("#8d8d8d", "グレー", "gurē", "серый"), W("#e2c044", "ゴールド", "gōrudo", "золотой")] },
];
const COLOR_EX = [
  ex("あか=aka=красн *い=i=-ый くるま=kuruma=машина", "Красная машина."),
  ex("くるま=kuruma=машина *は=wa=тема あか=aka=красн *い=i=-ая です=desu=есть", "Машина красная."),
  ex("みどり=midori=зелёный *の=no=связка シャツ=shatsu=рубашка", "Зелёная рубашка."),
  ex("なに=nani=какой いろ=iro=цвет *が=ga=подлеж. すき=suki=нравится です=desu=вежл. *か=ka=вопрос", "Какой цвет тебе нравится?"),
  ex("くろ=kuro=чёрн *くない=kunai=не です=desu=вежл.", "Не чёрный."),
];

const ITEMS = [
  { h: "でん (電) — «электро»", mark: "でん", at: "any",
    note: "Видишь でん — это что-то электрическое.",
    items: [W("🚃", "でんしゃ", "densha", "электричка, поезд", "でん + しゃ вагон"), W("📞", "でんわ", "denwa", "телефон", "でん + わ разговор"),
      W("💡", "でんき", "denki", "электричество, свет", "でん + き энергия"), W("🔋", "でんち", "denchi", "батарейка", "でん + ち пруд"),
      W("🔌", "じゅうでんき", "jūdenki", "зарядка", "じゅう заполнять + でん + き аппарат")] },
  { h: "〜しゃ (車) — «повозка»", mark: "しゃ", at: "end",
    note: "しゃ на конце — транспорт. Тот же иероглиф отдельно читается くるま.",
    items: [W("🚲", "じてんしゃ", "jitensha", "велосипед", "じ сам + てん крутить + しゃ"), W("🚗", "じどうしゃ", "jidōsha", "автомобиль", "じどう само-движ. + しゃ"),
      W("🚑", "きゅうきゅうしゃ", "kyūkyūsha", "скорая помощь", "きゅうきゅう спасение + しゃ"), W("🚙", "くるま", "kuruma", "машина", "тот же 車, но своим чтением")] },
  { h: "〜き (機) — «аппарат»", mark: "き", at: "end",
    note: "き на конце часто значит «машина, устройство». じゅうでんき выше — тоже отсюда.",
    items: [W("✈️", "ひこうき", "hikōki", "самолёт", "ひこう полёт + き"), W("🎮", "ゲームき", "gēmuki", "игровая консоль", "ゲーム + き"),
      W("🥤", "じどうはんばいき", "jidōhanbaiki", "торговый автомат", "じどう авто + はんばい продажа + き"), W("🧺", "せんたくき", "sentakuki", "стиральная машина", "せんたく стирка + き")] },
  { h: "〜や (屋) — «лавка»", mark: "や", at: "end",
    note: "Товар + や = магазин этого товара. Работает почти с чем угодно.",
    items: [W("📚", "ほんや", "hon'ya", "книжный", "ほん книга + や"), W("🥐", "パンや", "pan'ya", "пекарня", "パン хлеб + や"),
      W("💊", "くすりや", "kusuriya", "аптека", "くすり лекарство + や"), W("💐", "はなや", "hanaya", "цветочный", "はな цветок + や"),
      W("🍜", "ラーメンや", "rāmen'ya", "раменная", "ラーメン + や")] },
  { h: "Обрезки: катакана по 2 слога", nav: "Обрезки", mark: "", at: "any",
    note: "Японцы режут длинные заимствования: берут начало каждого слова. スマ(ート)ホ(ン), パソ(ナル)コン(ピュータ). Зная правило, угадываешь новые.",
    items: [W("📱", "スマホ", "sumaho", "смартфон", "スマ(ート) + ホ(ン)"), W("💻", "パソコン", "pasokon", "компьютер", "パソ(ナル) + コン(ピュータ)"),
      W("📺", "リモコン", "rimokon", "пульт", "リモ(ート) + コン(トロール)"), W("🏪", "コンビニ", "konbini", "магазин у дома", "コンビニ(エンス ストア)"),
      W("❄️", "エアコン", "eakon", "кондиционер", "エア + コン(ディショナー)"), W("🛹", "スケボー", "sukebō", "скейтборд", "スケ(ート) + ボ(ード)"),
      W("🖊️", "ペンタブ", "pentabu", "графический планшет", "ペン + タブ(レット)"), W("📷", "デジカメ", "dejikame", "цифровая камера", "デジ(タル) + カメ(ラ)")] },
  { h: "Самое важное в поездке", nav: "В поездке", mark: "", at: "any",
    note: "Без этих слов в дороге никуда. お перед おかね — вежливость, её говорят всегда.",
    items: [W("🛂", "パスポート", "pasupōto", "паспорт"), W("👛", "さいふ", "saifu", "кошелёк"), W("💴", "おかね", "okane", "деньги"),
      W("💵", "げんきん", "genkin", "наличные"), W("💳", "カード", "kādo", "карта"), W("🔑", "かぎ", "kagi", "ключ"),
      W("🧳", "にもつ", "nimotsu", "багаж"), W("🎫", "きっぷ", "kippu", "билет"), W("🗺️", "ちず", "chizu", "карта (местности)"),
      W("☂️", "かさ", "kasa", "зонт"), W("💊", "くすり", "kusuri", "лекарство"), W("🚻", "トイレ", "toire", "туалет")] },
  { h: "Для работы и творчества", nav: "Работа", mark: "", at: "any",
    note: "Почти всё — заимствования. ノート — и «тетрадь», и часть слова «ноутбук».",
    items: [W("💻", "ノートパソコン", "nōto pasokon", "ноутбук", "ノート + パソコン"), W("🎧", "ヘッドホン", "heddohon", "наушники"),
      W("🕹️", "コントローラー", "kontorōrā", "геймпад"), W("✏️", "ペン", "pen", "ручка"), W("📓", "ノート", "nōto", "тетрадь"),
      W("📷", "カメラ", "kamera", "камера"), W("🎒", "リュック", "ryukku", "рюкзак")] },
  { h: "Еда и посуда", nav: "Еда", mark: "", at: "any",
    note: "おはし — палочки (с вежливым お). おべんとう — коробка с обедом, есть в каждом комбини.",
    items: [W("🥢", "おはし", "ohashi", "палочки"), W("🥄", "スプーン", "supūn", "ложка"), W("🍴", "フォーク", "fōku", "вилка"),
      W("🥛", "コップ", "koppu", "стакан"), W("🍽️", "さら", "sara", "тарелка"), W("🍱", "おべんとう", "obentō", "бэнто, обед с собой"),
      W("🧴", "ペットボトル", "petto botoru", "пластиковая бутылка")] },
  { h: "Не перепутай!", nav: "Не перепутай", mark: "", at: "any",
    note: "Маленькая ょ решает всё: びょう (病) — болезнь, びよう (美容) — красота. Скажешь не так — поедешь в салон вместо больницы.",
    items: [W("🏥", "びょういん", "byōin", "больница", "びょう болезнь + いん учреждение"), W("💇", "びよういん", "biyōin", "салон красоты", "び·よう красота + いん")] },
];

// подсветка общего куска в слове (в «あか・あかい» ищем по каждой части через «・»)
function markWord(k, mark, at) {
  const box = el("span", { className: "kn-wk" });
  k.split("・").forEach((part, i) => {
    if (i) box.append("・");
    let pos = -1;
    if (mark) pos = at === "end" ? (part.endsWith(mark) ? part.length - mark.length : -1) : at === "start" ? (part.startsWith(mark) ? 0 : -1) : part.indexOf(mark);
    if (pos < 0) { box.append(part); return; }
    box.append(part.slice(0, pos), el("mark", { textContent: mark }), part.slice(pos + mark.length));
  });
  return box;
}

function card(w, g) {
  const color = w.e.startsWith("#");
  return el("div", { className: "kn-wcard" },
    color ? el("span", { className: "kn-swatch", style: `background:${w.e}` }) : el("span", { className: "kn-emoji", textContent: w.e }),
    markWord(w.k, g.mark, g.at),
    el("span", { className: "kn-wr", textContent: w.r }),
    el("span", { className: "kn-wm", textContent: w.ru }),
    w.parts ? el("span", { className: "kn-wparts", textContent: w.parts }) : "");
}

function openWords({ key, title, icon, groups, examples }) {
  WM.open({ title, icon, width: 820, height: 640, key, render(c) {
    c.classList.add("kn", "kn-gram", "kn-words");
    let hide = store.get("kana.words.hide", false);
    const nav = el("div", { className: "kn-nav" }), body = el("div", { className: "kn-gbody" });
    const chk = el("label", { className: "kn-check", title: "Перевод виден при наведении" },
      el("input", { type: "checkbox", checked: hide, onchange: e => { hide = e.target.checked; store.set("kana.words.hide", hide); c.classList.toggle("kn-hidetr", hide); } }),
      "🙈 Прятать перевод");
    nav.append(chk);
    c.classList.toggle("kn-hidetr", hide);
    for (const g of groups) {
      const sec = el("section", { className: "kn-sec" },
        el("h3", {}, g.h),
        el("p", { className: "kn-muted", textContent: g.note }),
        el("div", { className: "kn-wgrid" }, ...g.items.map(w => card(w, g))));
      body.append(sec);
      nav.append(el("button", { className: "kn-btn small", textContent: g.nav || g.mark,
        title: g.h, onclick: () => sec.scrollIntoView({ behavior: "smooth", block: "start" }) }));
    }
    if (examples) body.append(el("section", { className: "kn-sec" }, el("h3", { textContent: "Во фразах" }), ...examples.map(e => sentence(e.t, e.ru))));
    c.append(nav, body);
  } });
}

export const openKanaColors = () => openWords({ key: "kana:colors", title: "Цвета", icon: "🎨", groups: COLORS, examples: COLOR_EX });
export const openKanaItems = () => openWords({ key: "kana:items", title: "Предметы", icon: "🧳", groups: ITEMS });
