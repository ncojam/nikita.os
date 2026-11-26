import { el } from "../core/util.js";
import { progress as st, saveProgress as save, connectProgress, accountInfo, importGuest, bindProgressStatus } from "./kana-progress.js";
import { historyGraph } from "./kana-graph.js";
import { askAuth } from "../ui/auth.js";
import { Juice } from "../core/juice.js";
import { WM } from "../wm.js";
import { WORDS, WORD_CONTEXT, PARTICLE_CONTEXT } from "./kana-data.js";
import { KanaTTS } from "./kana-tts.js";
import { OBJ_FLAT, PLACE, SITUATIONS, SUBJ, TIME, VERBS, compose } from "./kana-phrases.js";

/* ================= Кана: тренажёр печати на японской раскладке (Mozc) =================
 * Урок: LESSON карточек → быстрая проверка из CHECK карточек → итог и переход уровня.
 * Карточка: перевод · знаки, разбитые на слоги и раскрашенные по роли в фразе · ромадзи · TTS.
 * Слоги проверяются прямо в строке набора Mozc (composition): каждый готовый знак сверяется с целью,
 * хвост латиницы (t, ky, n — недописанный слог) пропускается. Верно — зелёный прыжок, «динь», голос слога.
 * Ошибка — красная вспышка, дрожь, набор сбрасывается (blur → очистка → focus), этот слог пишем заново.
 * Проверка: без ромадзи и подсказок; правильные слоги озвучиваются, ответ принимается автоматически. Итог проверки двигает уровень: ≥90% — выше, <60% — ниже.
 * Подсказка клавиш (что жать в Mozc: は → ha, ー → -, っ → двойная согласная) — на уровнях 1–2 и после ошибки.
 * Катакана: на уровнях 1–2 засчитываем и хирагану, с 3-го — только настоящую (F7 перед Enter).
 * Статистика ошибок по знакам — store("kana.type").kana: слабые знаки чаще попадаются в уроках.
 */
const LESSON = 12, CHECK = 5, EXAM_AFTER = 20, EXAM_SIZE = 5;
const LEVELS = [
  { n: 1, h: "Короткие слова", sub: "2–3 знака хираганой" },
  { n: 2, h: "Длинные слова", sub: "хирагана и катакана" },
  { n: 3, h: "Слово + частица", sub: "すしを, カフェで, わたしは" },
  { n: 4, h: "Два слова", sub: "すしを たべます" },
  { n: 5, h: "Короткие фразы", sub: "конструктор: 3–4 куска" },
  { n: 6, h: "Полные фразы", sub: "конструктор и ситуации" },
];
const KEYMODES = [["auto", "Авто: уровни 1–2 и после ошибки"], ["always", "Всегда"], ["miss", "Только после ошибки"]];



/* ---------- кана: слоги, клавиши, сравнение ---------- */
const SMALL = "ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ";
const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KANA = /^[ぁ-ゖァ-ヺー]+$/;
const KANJI = /[㐀-鿿]/;
const LATIN_TAIL = /[A-Za-zＡ-Ｚａ-ｚ'’]+$/;

// слоги: маленькие ゃ ゅ ょ ぁ… прилипают к предыдущему знаку (きょ — один слог), っ и ー — отдельные
const slotsOf = k => {
  const out = [];
  for (const c of k.replace(/\s/g, "")) SMALL.includes(c) && out.length && out[out.length - 1] !== "っ" && out[out.length - 1] !== "ッ" ? out[out.length - 1] += c : out.push(c);
  return out;
};

// что нажимать в Mozc для слога
const KEYS = {};
[..."あいうえお"].forEach((c, i) => KEYS[c] = "aiueo"[i]);
Object.entries({ k: "かきくけこ", g: "がぎぐげご", s: "さしすせそ", z: "ざじずぜぞ", t: "たちつてと", d: "だぢづでど", n: "なにぬねの",
  h: "はひふへほ", b: "ばびぶべぼ", p: "ぱぴぷぺぽ", m: "まみむめも", r: "らりるれろ" })
  .forEach(([c, row]) => [...row].forEach((ch, i) => KEYS[ch] = c + "aiueo"[i]));
Object.assign(KEYS, { や: "ya", ゆ: "yu", よ: "yo", わ: "wa", を: "wo", ん: "nn", ー: "-", ゔ: "vu", し: "shi", ち: "chi", つ: "tsu", ふ: "fu",
  じ: "ji", ぢ: "di", づ: "du", ぁ: "xa", ぃ: "xi", ぅ: "xu", ぇ: "xe", ぉ: "xo", ゃ: "xya", ゅ: "xyu", ょ: "xyo", っ: "xtu", ゎ: "xwa" });
const SPECIAL = { ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo", てぃ: "thi", でぃ: "dhi", うぃ: "wi", うぇ: "we", うぉ: "who", しぇ: "she",
  ちぇ: "che", じぇ: "je", ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo", とぅ: "twu", どぅ: "dwu", いぇ: "ye" };
const YV = { ゃ: "a", ゅ: "u", ょ: "o" };
function keysOf(slot, next) {
  const h = toHira(slot);
  if (h === "っ") { const n = next && keysOf(next); return n && /^[bcdfghjkmprstvwz]/.test(n) ? n[0] : "xtu"; }
  if (h.length === 1) return KEYS[h] || h;
  if (SPECIAL[h]) return SPECIAL[h];
  const [b, s] = h, bk = KEYS[b] || b;
  if (YV[s]) return ({ し: "sh", ち: "ch", じ: "j" }[b] || bk.slice(0, -1) + "y") + YV[s];
  return bk + (KEYS[s] || "");
}
// частицы читаются не так, как пишутся
const SAY = { は: "わ", へ: "え", を: "お" };

/* ---------- голос: локальный Open JTalk / системный японский ---------- */
const TTS = {
  init: () => KanaTTS.init(),
  say(text, rate) { if (st.voice) KanaTTS.say(text, rate); },
  stop: () => KanaTTS.stop(),
};

// Context is shown in guided lessons and only after submission in tests.
function contextNotes(toks) {
  const notes = [...new Set(toks.map(t => t.p ? PARTICLE_CONTEXT[t.k] || WORD_CONTEXT[t.k] : WORD_CONTEXT[t.k]).filter(Boolean))];
  return notes.length ? el("div", { className: "kt-context" }, ...notes.map(textContent => el("div", { textContent }))) : "";
}

/* ---------- карточки по уровням ---------- */
const P = (k, r, g) => ({ k, r, g, p: true });
const rnd = a => a[Math.floor(Math.random() * a.length)];
const idx = (list, ok) => list.map((x, i) => ok(x) ? i : -1).filter(i => i >= 0);

function card(toks, ru) {
  const slots = [], owner = [], keys = [];
  toks.forEach((t, ti) => slotsOf(t.k).forEach(s => { slots.push(s); owner.push(ti); }));
  slots.forEach((s, i) => keys.push(keysOf(s, slots[i + 1])));
  const target = slots.join("");
  if (!target || !KANA.test(target)) return null;
  // сколько знаков до начала каждого слога — по нему сбрасываемся при ошибке
  const start = []; let n = 0;
  for (const s of slots) { start.push(n); n += s.length; }
  return { toks, ru, slots, owner, keys, start, target };
}

const words = (script, ok) => WORDS[script].filter(w => KANA.test(w.k) && ok(slotsOf(w.k).length)).map(w => card([{ k: w.k, r: w.r, g: "" }], w.m));

// какие объекты подходят к глаголу — чтобы не выходило «пью игры»
const FIT = { たべる: "すし ラーメン", のむ: "コーヒー おちゃ おさけ", みる: "アニメ えいが まんが しゃしん え", よむ: "まんが ほん",
  かく: "え コード ピクセルアート デジタルアート", つくる: "ゲーム キャラクター マップ アプリ おんがく", かいはつする: "ゲーム アプリ エーアイエージェント",
  する: "ゲーム", れんしゅうする: "トリック オーリー キックフリップ にほんご", のる: "スケボー じてんしゃ でんしゃ", きく: "おんがく",
  かう: "すし コーヒー おちゃ ほん まんが スケボー じてんしゃ", とる: "しゃしん", すう: "たばこ", べんきょうする: "にほんご" };
const TIMES = idx(TIME, x => x.k && !x.q && !x.never), PLACES = idx(PLACE, x => x.k && !x.q);
function phrase({ forms, sub = [1], time = 0, place = 0, q = 0 }) {
  const verb = Math.floor(Math.random() * VERBS.length), v = VERBS[verb];
  const fits = (FIT[v.d] || "").split(" ");
  const objs = v.intr ? [] : idx(OBJ_FLAT, x => fits.includes(x.k));
  const s = { sub: rnd(sub), verb, form: rnd(forms), name: 0, q: Math.random() < q,
    obj: objs.length ? rnd(objs) : 0,
    time: Math.random() < time ? rnd(TIMES) : 0,
    place: Math.random() < place || v.intr ? rnd(PLACES) : 0 };
  const { t, ru } = compose(s);
  return card(t, ru);
}
const many = (n, f) => Array.from({ length: n }, f);

const POOLS = {
  1: () => words("hira", n => n >= 2 && n <= 3),
  2: () => [...words("hira", n => n >= 4), ...words("kata", () => true)],
  3: () => [
    ...SUBJ.filter(x => x.k).map(x => card([{ k: x.k, r: x.r, g: x.g }, P("は", "wa", "тема")], `${x.ru[0].toUpperCase() + x.ru.slice(1)} — тема (は)`)),
    ...TIMES.map(i => TIME[i]).filter(x => x.ni).map(x => card([{ k: x.k, r: x.r, g: x.ru }, P("に", "ni", "когда")], `${x.ru} — когда (に)`)),
    ...PLACES.map(i => PLACE[i]).map(x => card([{ k: x.k, r: x.r, g: x.ru }, P("で", "de", "где")], `${x.ru} — где (で)`)),
    ...OBJ_FLAT.filter(x => x.k && !x.q).map(x => card([{ k: x.k, r: x.r, g: x.ru }, P("を", "o", "объект")], `${x.ru} — что (を)`)),
  ],
  4: () => many(40, () => phrase({ forms: ["pres", "neg", "past"] })),
  5: () => many(40, () => phrase({ forms: ["pres", "neg", "past", "pastneg", "want", "let"], sub: [0, 1, 2, 3], time: 0.5, place: 0.4 })),
  6: () => [
    ...many(30, () => phrase({ forms: ["pres", "neg", "past", "pastneg", "want", "let", "like", "dislike"], sub: [0, 1, 2, 3, 4, 5], time: 0.7, place: 0.6, q: 0.2 })),
    ...SITUATIONS.filter(s => s.ex).flatMap(s => s.ex).map(e => card(e.t, e.ru)),
  ],
};

// Словарные слова для экзамена: только отдельные слова, не случайные фразы.
const DICT = [...WORDS.hira, ...WORDS.kata].filter(w => KANA.test(w.k) && w.m && w.r && !/\s/.test(w.r.trim()));
const byWord = new Map(DICT.map(w => [w.k, w]));
const difficulty = x => x ? Math.min(5, (x.err || 0) / ((x.ok || 0) + 1) * 2 + Math.min(3, x.streak || 0)) : 0;
const weight = c => 1 + c.slots.reduce((a, s) => a + difficulty(st.kana[toHira(s)]), 0) / c.slots.length
  + 2 * c.toks.reduce((a,t) => a + (t.p ? 0 : difficulty(st.words[t.k])), 0) / c.toks.length;
function wordMark(k, ok, ru = "") {
  const x = st.words[k] ||= { ok: 0, err: 0, streak: 0, ru };
  if (ru && !x.ru) x.ru = ru;
  if (ok) { x.ok++; x.streak = Math.max(0, (x.streak || 0) - 1); }
  else { x.err++; x.streak = (x.streak || 0) + 1; }
  x.last = Date.now();
}
function recordCard(cd, missed, exact = true) {
  const tokens = new Map();
  cd.toks.forEach((t, i) => {
    if (t.p || !KANA.test(t.k)) return;
    const bad = cd.owner.some((owner, si) => owner === i && missed.has(si));
    const previous = tokens.get(t.k);
    tokens.set(t.k, { bad: bad || !!previous?.bad, ru: byWord.get(t.k)?.m || t.g || (cd.toks.length === 1 ? cd.ru : "") });
  });
  // An extra character is a card error even if every target syllable matched.
  if (!exact && !missed.size && tokens.size) for (const t of tokens.values()) t.bad = true;
  for (const [k,t] of tokens) wordMark(k,!t.bad,t.ru);
  if (exact && !missed.size) st.examCredit++;
  save();
}
function examPool() {
  const seen = new Set();
  return DICT.filter(w => st.words[w.k] && !seen.has(w.m) && seen.add(w.m))
    .map(w => ({ ...w, priority: difficulty(st.words[w.k]) + Math.random() }))
    .sort((a,b) => b.priority-a.priority);
}
const examReady = () => st.examCredit >= EXAM_AFTER && examPool().length >= EXAM_SIZE;
function weakWords() {
  return Object.entries(st.words).filter(([,x]) => x.err).sort((a,b) => difficulty(b[1])-difficulty(a[1]));
}
function pick(level, n) {
  const seen = new Set();
  let pool = POOLS[level]().filter(c => c && !seen.has(c.target) && seen.add(c.target));
  const out = [];
  // Up to three older, weak dictionary words in every lesson, not just the current level.
  const review = weakWords().filter(([k,x]) => byWord.has(k) && difficulty(x) > 0.35).slice(0,3);
  for (const [k] of review) {
    const w = byWord.get(k), c = card([{k:w.k,r:w.r,g:""}],w.m);
    if (!c || (level === 1 && /[ァ-ヺー]/.test(k))) continue;
    out.push(c);
    pool = pool.filter(x => x.target !== c.target);
  }
  while (out.length < n && pool.length) {
    const w = pool.map(weight), sum = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum, i = 0;
    while ((r -= w[i]) > 0 && i < pool.length - 1) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
const mark = (s, ok) => { const k = toHira(s), x = st.kana[k] ||= { ok: 0, err: 0 }; ok ? x.ok++ : x.err++; };

/* ---------- роли для подсветки строя фразы ---------- */
const PART = { は: "topic", も: "topic", を: "obj", で: "place", に: "ni", へ: "ni", から: "ni", が: "ga", と: "with", の: "no", という: "no", か: "q" };
const ROLE_NAME = { topic: "тема は/も", obj: "объект を", place: "где で", ni: "когда / куда に", ga: "подлежащее が", with: "с кем と", no: "связка の", q: "вопрос か", verb: "глагол / сказуемое" };
// слово красится цветом своей частицы (ближайшей справа); хвосты ます/です и всё без частицы — сказуемое
const roles = toks => toks.length === 1 ? ["word"] : toks.map((_, i) => {
  for (let j = i; j < toks.length; j++) if (toks[j].p) return PART[toks[j].k] || "verb";
  return "verb";
});

// LCS: какие знаки цели совпали с набранным (для проверки, где ошибки не штрафуют по ходу)
function lcsHits(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) d[i][j] = a[i] === b[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
  const hit = new Array(m).fill(false);
  for (let i = 0, j = 0; i < m && j < n;) {
    if (a[i] === b[j]) { hit[i] = true; i++; j++; } else if (d[i + 1][j] >= d[i][j + 1]) i++; else j++;
  }
  return hit;
}

const restart = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
const fmtPct = x => Math.round(x * 100) + "%";

/* ---------- окно ---------- */
export function openKanaType() {
  TTS.init();
  WM.open({ title: "Печать", icon: "⌨️", width: 860, height: 620, key: "kana:type", render(c, w) {
    c.classList.add("kn", "kt");
    w.onClose = () => { TTS.stop(); KanaTTS.bindStatus(null); bindProgressStatus(null); };
    const loading = el("p",{className:"kn-muted",textContent:"Загружаем прогресс…"});
    c.replaceChildren(loading);
    connectProgress().finally(()=>{if(loading.isConnected)menu();});

    function writing(preferred = [], level = st.level, back = menu) {
      TTS.stop();
      const loading = el("p", { className: "kn-muted", textContent: "Открываем тренажёр письма…" });
      c.replaceChildren(loading);
      import("./kana-write.js").then(m => {
        if (loading.isConnected) m.renderKanaWrite(c, { back, preferred, level, voice: () => st.voice });
      }).catch(e => { if (loading.isConnected) { loading.textContent = e.message; c.append(el("button", { className: "kn-btn", textContent: "Назад", onclick: back })); } });
    }

    /* --- меню: уровни, настройки, слабые знаки, история --- */
    function menu() {
      TTS.stop();
      const account = accountInfo();
      const syncStatus=el("p",{className:"kn-muted",role:"status"});
      bindProgressStatus(message=>{if(syncStatus.isConnected||!syncStatus.parentNode)syncStatus.textContent=message;});
      const login=el("button",{className:"kn-btn small",textContent:account.uid===null?"🔑 Войти / зарегистрироваться":"↻ Синхронизировать",onclick:async()=>{
        if(account.uid===null && !await askAuth({why:"чтобы хранить прогресс Каны в аккаунте"}))return;
        await connectProgress();if(c.isConnected)menu();
      }});
      const lv = el("div", { className: "kt-levels" }, ...LEVELS.map(L => el("button", {
        className: "kt-lv" + (L.n === st.level ? " on" : "") + (L.n > st.max ? " locked" : ""),
        title: L.n > st.max ? "Ещё не открыт проверкой, но можно попробовать" : "",
        onclick: () => { st.level = L.n; save(); menu(); } },
        el("b", { textContent: L.n }), el("span", {}, el("strong", { textContent: L.h }), el("small", { textContent: L.sub })))));
      const voice = el("label", { className: "kn-check" },
        el("input", { type: "checkbox", checked: st.voice, onchange: e => { st.voice = e.target.checked; if (!st.voice) TTS.stop(); save(); } }), "🔊 Голос");
      const keys = el("label", { className: "kn-bsel" }, el("span", { textContent: "⌨ Подсказка клавиш" }),
        el("select", { onchange: e => { st.keys = e.target.value; save(); } },
          ...KEYMODES.map(([v, t]) => el("option", { value: v, selected: v === st.keys, textContent: t }))));
      const weak = Object.entries(st.kana).filter(([, x]) => x.err).sort((a, b) => b[1].err / (b[1].ok + 1) - a[1].err / (a[1].ok + 1)).slice(0, 10);
      const weakW = weakWords().slice(0,10);
      const voiceStatus = el("p", { className: "kn-muted", role: "status" });
      KanaTTS.bindStatus(voiceStatus);
      const engine = el("label", { className: "kn-bsel" }, el("span", { textContent: "Движок озвучки" }),
        el("select", { onchange: e => { KanaTTS.mode = e.target.value; } },
          ...[["jtalk", "Open JTalk · Mei"], ["native", "Системный японский"]].map(([value, textContent]) =>
            el("option", { value, textContent, selected: value === KanaTTS.mode }))));
      const speed = el("label", { className: "kn-bsel" }, el("span", { textContent: "Скорость голоса" }),
        el("select", { onchange: e => { KanaTTS.speed = e.target.value; } },
          ...[0.7, 0.85, 1, 1.15, 1.3].map(value => el("option", { value, textContent: value + "×", selected: value === KanaTTS.speed }))));
      const preview = el("button", { className: "kn-btn small", textContent: "🔊 Проверить голос", onclick: () => TTS.say("こんにちは。わたしはにほんごをべんきょうします。") });
      c.replaceChildren(el("div", { className: "kt-menu" },
        el("h3", { textContent: "⌨️ Тренажёр печати" }),
        el("p", { className: "kn-muted", textContent: `Включи Mozc (хирагана). Печатай ромадзи — знаки проверяются сразу. В иероглифы не переводи. Ответ принимается автоматически; катакана в проверке с 3-го уровня — F7. Урок — ${LESSON} карточек и проверка из ${CHECK}.` }),
        el("div",{className:"kn-row"},syncStatus,login,account.uid!==null&&account.guestAvailable?el("button",{className:"kn-btn small",textContent:"Перенести гостевой прогресс",onclick:()=>{if(importGuest())menu();}}):""),
        lv,
        el("div", { className: "kn-builder" }, voice, keys),
        el("div", { className: "kn-builder" }, engine, speed, preview),
        voiceStatus,
        el("a", { className: "kn-muted", href: "/vendor/openjtalk-v1/NOTICE.txt", target: "_blank", rel: "noopener", textContent: "Open JTalk / Mei · лицензии" }),
        weak.length ? el("div", { className: "kt-weak" }, el("span", { className: "kn-label", textContent: "Слабые знаки:" }),
          ...weak.map(([k, x]) => el("span", { className: "kn-chip", title: `ошибок ${x.err}, верно ${x.ok}`, textContent: k }))) : "",
        weakW.length ? el("div", { className: "kt-weak" }, el("span", { className: "kn-label", textContent: "Слабые слова:" }),
          ...weakW.map(([k,x]) => el("span", { className: "kn-chip", title: `${x.ru || ""} · ошибок ${x.err}, верно ${x.ok}`, textContent: k + (x.ru ? " · " + x.ru : "") }))) : "",
        el("p", { className: "kn-muted", textContent: `До экзамена: ${Math.min(st.examCredit, EXAM_AFTER)} / ${EXAM_AFTER} безошибочных карточек · изучено слов: ${examPool().length}` }),
        st.examHist.length ? el("p", { className: "kn-muted", textContent: `Последний экзамен: ${st.examHist.at(-1).ok} / ${st.examHist.at(-1).total}` }) : "",
        examReady() ? el("button", { className: "kn-btn kt-go", textContent: "🎓 Начать экзамен", onclick: () => exam(menu) }) : "",
        st.hist.length ? el("div", { className: "kt-hist" }, el("span", { className: "kn-label", textContent: "Недавно:" }),
          ...st.hist.slice(-6).reverse().map(h => el("span", { className: "kt-hgrade g-" + h.grade, title: `уровень ${h.level} · точность ${h.acc} · проверка ${h.check}`, textContent: `${h.grade} · ур.${h.level}` }))) : "",
        el("button", { className: "kn-btn kt-go", textContent: `▶ Начать урок — уровень ${st.level}`, onclick: () => lesson(st.level) }),
        el("button", { className: "kn-btn", textContent: "✍ Тренажёр письма", onclick: () => writing(weak.map(([k]) => k)) }),
        el("button",{className:"kn-btn",textContent:"📈 История обучения",onclick:()=>{c.replaceChildren(el("div",{className:"kt-menu"},historyGraph(st.hist),el("button",{className:"kn-btn",textContent:"Назад",onclick:menu})));}})));
    }

    /* --- экзамен: только перевод, без длины ответа и TTS до сдачи --- */
    function exam(back = menu) {
      TTS.stop(); KanaTTS.bindStatus(null);
      const list = examPool().slice(0, EXAM_SIZE);
      if (list.length < EXAM_SIZE || st.examCredit < EXAM_AFTER) { back(); return; }
      let i = 0, score = 0;
      const errors = [];
      function next() {
        TTS.stop();
        if (i >= list.length) {
          st.examCredit = Math.max(0, st.examCredit - EXAM_AFTER);
          st.examHist.push({id:globalThis.crypto?.randomUUID?.() || Date.now()+"-"+Math.random(),ok:score,total:list.length,at:Date.now()});
          st.examHist = st.examHist.slice(-365); save();
          c.replaceChildren(el("div",{className:"kt-menu kt-result"},
            el("h3",{textContent:"🎓 Экзамен завершён"}),
            el("div",{className:"kt-grade "+(score===list.length?"g-S":score>=4?"g-A":"g-C"),textContent:score+" / "+list.length}),
            el("p",{textContent:errors.length?"Ошибочные слова попадутся чаще в следующих уроках.":"Все слова вспомнил самостоятельно!"}),
            ...errors.map(w=>el("div",{className:"kn-row"},el("span",{textContent:w.m+" → "+w.k+" ("+w.r+")"}),el("button",{className:"kn-btn small",textContent:"🔊",onclick:()=>TTS.say(w.k)}))),
            el("button",{className:"kn-btn kt-go",textContent:"Продолжить обучение",onclick:back})));
          return;
        }
        const w = list[i];
        const accepted = DICT.filter(x=>x.m===w.m).map(x=>x.k);
        let submitted = false;
        const input = el("input",{className:"kt-in",lang:"ja",autocomplete:"off",spellcheck:false,placeholder:"Напиши слово по-японски"});
        const feedback = el("div",{className:"kt-hint",role:"status"});
        const submitBtn = el("button",{className:"kn-btn kt-go",textContent:"Проверить",onclick:()=>submit()});
        const skip = el("button",{className:"kn-btn",textContent:"Не помню",onclick:()=>submit(true)});
        const panel = el("div",{className:"kt-menu kt-card"},el("h3",{textContent:"🎓 Экзамен "+(i+1)+" / "+list.length}),
          el("div",{className:"kt-ru",textContent:w.m}),input,feedback,
          el("div",{className:"kn-row"},submitBtn,skip),
          el("button",{className:"kn-btn",textContent:"В меню (экзамен позже)",onclick:menu}));
        c.replaceChildren(panel); setTimeout(()=>{if(panel.isConnected)input.focus();},30);
        input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.isComposing&&e.keyCode!==229){e.preventDefault();submit();}});
        function submit(skipped=false) {
          if(submitted||!panel.isConnected)return;
          const typed=input.value.trim().normalize("NFKC").replace(/\s/g,"");
          if(!typed&&!skipped){input.focus();return;}
          if(!skipped&&!KANA.test(typed)){feedback.textContent="Введи ответ каной (Mozc), без кандзи.";return;}
          submitted=true; input.disabled=true; skip.disabled=true;
          // Accept dictionary synonyms with the same Russian gloss; exact kana spelling required.
          const ok=!skipped&&accepted.includes(typed);
          if(ok)score++;else errors.push(w);
          wordMark(ok?typed:w.k,ok,w.m);
          const slots=slotsOf(w.k), hit=lcsHits([...w.k],[...typed]);
          let offset=0;
          for(const sl of slots){mark(sl,ok||[...sl].every((_,j)=>hit[offset+j]));offset+=sl.length;}
          save();
          feedback.replaceChildren(el("p",{className:ok?"kn-muted":"kt-warn",textContent:ok?"Верно!":"Правильно: "+w.k+" · "+w.r}),
            contextNotes([{k:ok?typed:w.k}]), el("button",{className:"kn-btn small",textContent:"🔊",onclick:()=>TTS.say(w.k)}));
          ok?Juice.ding(4):Juice.buzz();TTS.say(ok?typed:w.k);
          submitBtn.textContent="Далее →";submitBtn.onclick=()=>{i++;next();};
          submitBtn.focus();
        }
      }
      next();
    }

    /* --- урок --- */
    function lesson(level) {
      const cards = pick(level, LESSON + CHECK);
      const R = { level, ok: 0, err: 0, chars: 0, ms: 0, check: [], weak: {} };
      if (!cards.length) { menu(); return; }
      let i = 0;
      const live = cards.slice(0, Math.min(LESSON, Math.max(1, cards.length - CHECK)));
      const test = cards.slice(live.length);
      next();
      function next() {
        if (examReady()) { exam(next); return; }
        if (i < live.length) play(live[i], `Карточка ${i + 1} / ${live.length}`, false, () => { i++; next(); });
        else if (i - live.length < test.length) {
          const j = i - live.length;
          play(test[j], `⚡ Проверка ${j + 1} / ${test.length}`, true, () => { i++; next(); });
        } else result(R);
      }

      function play(cd, label, checking, done) {
        TTS.stop();
        const voiceStatus = checking ? null : el("div", { className: "kn-muted", role: "status" });
        KanaTTS.bindStatus(voiceStatus);
        const role = roles(cd.toks);
        const showKeys = st.keys === "always" || (st.keys === "auto" && level <= 2);
        const strictKata = level >= 3;
        const slotEls = [], keyEls = [];
        const sent = el("div", { className: "kt-sent" });
        cd.toks.forEach((t, ti) => {
          const g = el("div", { className: "kt-tok r-" + role[ti] });
          const row = el("div", { className: "kt-slots" });
          cd.slots.forEach((s, si) => {
            if (cd.owner[si] !== ti) return;
            const key = el("span", { className: "kt-key", textContent: cd.keys[si] });
            const sl = el("span", { className: "kt-slot" }, el("span", { className: "kt-ch", textContent: s }), key);
            slotEls[si] = sl; keyEls[si] = key; row.append(sl);
          });
          g.append(row);
          if (!checking) g.append(el("span", { className: "kn-tr", textContent: t.r }), t.g ? el("span", { className: "kn-tg", textContent: t.g }) : "");
          sent.append(g);
        });
        const used = [...new Set(role)].filter(r => ROLE_NAME[r]);
        const legend = used.length > 1 ? el("div", { className: "kt-legend" }, ...used.map(r => el("span", { className: "kt-lg r-" + r, textContent: ROLE_NAME[r] }))) : "";
        const input = el("input", { className: "kt-in", lang: "ja", autocomplete: "off", spellcheck: false,
          placeholder: checking ? "напечатай то, что видишь (автопроверка)" : "печатай здесь (Mozc)" });
        const hint = el("div", { className: "kt-hint" });
        const stat = el("span", { className: "kt-stat" });
        const say = el("button", { className: "kn-btn small", textContent: "🔊 ещё раз", hidden: checking, onclick: () => { TTS.say(spoken(cd)); input.focus(); } });
        const quit = el("button", { className: "kn-btn small", textContent: "✕ в меню", onclick: () => menu() });
        const box = el("div", { className: "kt-card" + (showKeys && !checking ? " keys" : "") + (checking ? " checking" : "") },
          el("div", { className: "kt-ru", textContent: cd.ru }), sent, legend, !checking ? contextNotes(cd.toks) : "", input, hint, voiceStatus || "",
          checking ? el("button", { className: "kn-btn kt-go", textContent: "Готово →", onclick: () => submit() }) : "");
        c.replaceChildren(el("div", { className: "kt-top" }, el("b", { textContent: label }), stat, el("span", { className: "kt-sp" }), say, quit), box);
        box.addEventListener("mousedown", e => { if (e.target !== input && !e.target.closest("button")) { e.preventDefault(); input.focus(); } });
        const paintStat = () => { const n = R.ok + R.err; stat.textContent = n ? `точность ${fmtPct(R.ok / n)}` : ""; };
        paintStat();
        Juice.spawn(box, { sound: false });
        setTimeout(() => input.focus(), 30);
        if (!checking) TTS.say(spoken(cd), 0.85);

        if (checking) {
          input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); } });
          let submitted = false, autoTimer, voicedTo = 0;
          const firstMisses = new Set();
          const norm = strictKata ? s => s : toHira;
          const slotAt = pos => cd.slots.findIndex((sl, si) => cd.start[si] + sl.length > pos);
          function reveal(si) {
            if (si < 0) return;
            slotEls[si].classList.add("reveal", "bad");
          }
          function observe() {
            if (submitted || !box.isConnected) return;
            clearTimeout(autoTimer);
            const raw = input.value.replace(/\s/g, ""), typed = raw.replace(LATIN_TAIL, "");
            let n = 0, spokenTo = 0;
            while (n < typed.length && n < cd.target.length && toHira(typed[n]) === toHira(cd.target[n])) n++;
            cd.slots.forEach((sl, si) => {
              const end = cd.start[si] + sl.length;
              if (end > n) return;
              spokenTo = end;
              if (end <= voicedTo || /^[ーっッ]$/.test(sl)) return;
              const tok = cd.toks[cd.owner[si]];
              TTS.say(tok.p && SAY[sl] && tok.k === sl ? SAY[sl] : sl, 1.1);
            });
            voicedTo = spokenTo;
            // No visual correction during the attempt. Remember actual kana typos for adaptive review.
            if (n < typed.length && n < cd.target.length) firstMisses.add(slotAt(n));
            if (LATIN_TAIL.test(raw)) return;
            const exact = norm(typed) === norm(cd.target);
            // Allow time for F7 instead of treating in-progress hiragana as a typo.
            if (!exact && strictKata && toHira(typed) === toHira(cd.target)) return;
            if (exact || typed.length >= cd.target.length)
              autoTimer = setTimeout(() => { if (box.isConnected && !submitted) submit(); }, exact ? 220 : 1600);
          }
          input.addEventListener("input", observe);
          input.addEventListener("compositionupdate", () => queueMicrotask(observe));
          input.addEventListener("compositionend", observe);
          function submit() {
            if (submitted || !box.isConnected) return; submitted = true;
            clearTimeout(autoTimer);
            const typed = input.value.replace(/\s|[A-Za-zＡ-Ｚａ-ｚ'’]/g, "");
            const hit = lcsHits([...norm(cd.target)], [...norm(typed)]);
            const exact = norm(typed) === norm(cd.target);
            const missed = new Set(firstMisses);
            let good = 0;
            cd.slots.forEach((s, si) => {
              const ok = [...s].every((_, k) => hit[cd.start[si] + k]);
              slotEls[si].classList.remove("bad");
              if (ok) good++; else missed.add(si);
              if (missed.has(si)) {
                R.weak[toHira(s)] = (R.weak[toHira(s)] || 0) + 1;
                reveal(si);
              }
              mark(s, !missed.has(si));
              slotEls[si].classList.add(ok ? "ok" : "bad");
            });
            R.check.push(exact ? 1 : Math.min(good / cd.slots.length, (cd.slots.length - 1) / cd.slots.length));
            recordCard(cd, missed, exact);
            input.disabled = true;
            hint.replaceChildren(el("span", { className: "kn-muted", textContent: typed ? "Ты набрал: " : "Пусто" }), typed ? el("span", { className: "kt-typed", textContent: typed }) : "");
            if (missed.size || !exact) {
              hint.append(el("div", {className:"kt-warn",textContent:"Правильно: " + cd.target + " · " + cd.keys.join(" ")}));
              if (strictKata && /[ァ-ヺ]/.test(cd.target)) hint.append(el("div",{className:"kn-muted",textContent:"Для катаканы используй F7."}));
            }
            hint.append(contextNotes(cd.toks));
            exact ? Juice.ding(4) : Juice.buzz();
            if (cd.toks.some(t => t.p ? PARTICLE_CONTEXT[t.k] || WORD_CONTEXT[t.k] : WORD_CONTEXT[t.k])) {
              const nextBtn = box.querySelector(".kt-go");
              nextBtn.textContent = "Далее →";
              nextBtn.onclick = () => { if (box.isConnected) done(); };
              nextBtn.focus();
            } else setTimeout(() => { if (box.isConnected) done(); }, exact && !missed.size ? 950 : 3200);
          }
          return;
        }

        // --- живой режим: проверяем строку набора Mozc ---
        let base = 0;      // сколько знаков цели принято (закреплено или зачтено в текущем наборе)
        let doneTo = 0;    // сколько знаков уже засчитано — дальше этого звучит «динь»
        let streak = 0, resetting = false, composing = false, t0 = 0;
        const missed = new Set();
        const slotAt = pos => { let s = 0; while (s + 1 < cd.slots.length && cd.start[s + 1] <= pos) s++; return s; };
        const same = (a, b, strict) => strict ? a === b : toHira(a) === toHira(b);

        input.addEventListener("compositionstart", () => { composing = true; });
        input.addEventListener("compositionend", () => { composing = false; if (!resetting) commit(); });
        input.addEventListener("input", e => {
          if (resetting || finished || !box.isConnected) return;
          if (!t0) t0 = performance.now();
          if (composing || e.isComposing) check(input.value, false, false);
          else commit();
        });

        // текст закреплён (Enter в Mozc, или набор без IME)
        function commit() {
          const v = input.value;
          if (finished || !box.isConnected || !v) return;
          if (!composing && LATIN_TAIL.test(v) && !/[ぁ-ヿ]/.test(v)) { warn(hint, "Это латиница — включи японскую раскладку (Mozc)."); clear(); return; }
          if (check(v, strictKata, true)) input.value = "";
        }

        // s — набранное; strict — сверять катакану строго; final — текст закреплён
        function check(raw, strict, final) {
          const s = raw.replace(LATIN_TAIL, "");
          if (KANJI.test(s)) {
            if (!final) { warn(hint, "Это иероглиф — пробел переводит в кандзи. Нажми Esc или Backspace и сразу Enter."); return false; }
          } else hint.replaceChildren();
          let L = 0;
          for (; L < s.length && base + L < cd.target.length; L++) {
            const tc = cd.target[base + L];
            // пока идёт набор, Mozc показывает хирагану: катакану сверяем «по звуку», строго — при закреплении
            if (!same(s[L], tc, strict && final)) {
              if (final && toHira(s[L]) === toHira(tc)) warn(hint, tc === toHira(tc)
                ? "Здесь хирагана — катаканой (F7) переводи только своё слово, не всю строку."
                : "Здесь нужна катакана — нажми F7 перед Enter.");
              fail(slotAt(base + L));
              return false;
            }
          }
          advance(base + L);
          if (final) base += L;
          return true;
        }

        function advance(pos) {
          for (let si = 0; si < cd.slots.length; si++) {
            const end = cd.start[si] + cd.slots[si].length;
            if (end <= pos && end > doneTo) {
              doneTo = end;
              const sl = slotEls[si];
              sl.classList.remove("bad", "cur");
              sl.classList.add("ok"); restart(sl, "pop");
              if (!missed.has(si)) { R.ok++; mark(cd.slots[si], true); }
              Juice.ding(streak++);
              const tok = cd.toks[cd.owner[si]];
              const sl0 = cd.slots[si];
              if (!/^[ーっッ]$/.test(sl0)) TTS.say(tok.p && SAY[sl0] && tok.k === sl0 ? SAY[sl0] : sl0, 1.1);   // ー и っ отдельно не звучат
            }
          }
          const cur = cd.slots.findIndex((s, si) => cd.start[si] + s.length > doneTo);
          slotEls.forEach((sl, si) => sl.classList.toggle("cur", si === cur));
          paintStat();
          if (doneTo >= cd.target.length) finish();
        }

        function fail(si) {
          const sl = slotEls[si];
          if (!missed.has(si)) { missed.add(si); R.err++; mark(cd.slots[si], false); R.weak[toHira(cd.slots[si])] = (R.weak[toHira(cd.slots[si])] || 0) + 1; }
          streak = 0;
          sl.classList.add("bad", "reveal");
          restart(sl, "shake");
          Juice.buzz();
          base = cd.start[si];
          doneTo = Math.min(doneTo, base);
          slotEls.forEach((x, k) => { if (cd.start[k] >= base) x.classList.remove("ok"); });
          paintStat();
          clear();
        }

        // сброс набора: blur закрывает строку Mozc, потом чистим и возвращаем фокус
        function clear() {
          resetting = true;
          input.blur();
          setTimeout(() => { input.value = ""; composing = false; resetting = false; if (box.isConnected && !input.disabled) input.focus(); }, 40);
        }

        let finished = false;
        function finish() {
          if (finished) return; finished = true;
          input.disabled = true;
          R.chars += cd.target.length;
          if (t0) R.ms += performance.now() - t0;
          recordCard(cd, missed);
          box.classList.add("done");
          setTimeout(() => { if (box.isConnected) done(); }, 950);
        }
      }
    }

    /* --- итог урока --- */
    function result(R) {
      TTS.stop();
      const acc = R.ok + R.err ? R.ok / (R.ok + R.err) : 0;
      const chk = R.check.length ? R.check.reduce((a, b) => a + b, 0) / R.check.length : acc;
      const score = (acc + chk) / 2;
      const grade = score >= 0.95 ? "S" : score >= 0.85 ? "A" : score >= 0.7 ? "B" : "C";
      const kpm = R.ms ? Math.round(R.chars / (R.ms / 60000)) : 0;
      const from = R.level;
      let to = from, verdict = "Остаёмся на этом уровне — закрепим.";
      if (chk >= 0.9 && from < LEVELS.length) { to = from + 1; verdict = `Проверка пройдена — уровень ${to}: ${LEVELS[to - 1].h}.`; }
      else if (chk >= 0.9) verdict = "Максимальный уровень — дальше только скорость.";
      else if (chk < 0.6 && from > 1) { to = from - 1; verdict = `Проверка тяжело далась — вернёмся на уровень ${to}. Ошибочные знаки будут попадаться чаще.`; }
      st.level = to; st.max = Math.max(st.max, to);
      st.hist.push({ id: globalThis.crypto?.randomUUID?.() || Date.now()+"-"+Math.random(), level: from, grade, acc: fmtPct(acc), check: fmtPct(chk), kpm, at: Date.now() });
      st.hist = st.hist.slice(-365);
      save();
      const weak = Object.entries(R.weak).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const g = el("div", { className: "kt-grade g-" + grade, textContent: grade });
      c.replaceChildren(el("div", { className: "kt-menu kt-result" },
        g,
        el("div", { className: "kt-nums" },
          el("span", {}, el("b", { textContent: fmtPct(acc) }), el("small", { textContent: "точность в уроке" })),
          el("span", {}, el("b", { textContent: fmtPct(chk) }), el("small", { textContent: "проверка" })),
          el("span", {}, el("b", { textContent: kpm || "—" }), el("small", { textContent: "знаков в минуту" }))),
        historyGraph(st.hist),
        el("p", { textContent: verdict }),
        weak.length ? el("div", { className: "kt-weak" }, el("span", { className: "kn-label", textContent: "Ошибался в:" }),
          ...weak.map(([k, n]) => el("span", { className: "kn-chip", title: `ошибок: ${n}`, textContent: k }))) : el("p", { className: "kn-muted", textContent: "Ни одной ошибки 🎉" }),
        el("div", { className: "kn-row" },
          el("button", { className: "kn-btn kt-go", textContent: `▶ Следующий урок — уровень ${to}`, onclick: () => lesson(to) }),
          el("button", { className: "kn-btn", textContent: "✍ Письмо между уроками", onclick: () => writing(weak.map(([k]) => k), from, () => lesson(to)) }),
          el("button", { className: "kn-btn", textContent: "Меню", onclick: () => menu() }))));
      Juice.spawn(g);
    }
  } });
}

// что читает голос: фраза без пробелов (кана, ромадзи не нужен — движок сам расставит ударения)
const spoken = cd => cd.toks.map(t => t.k).join("");
function warn(node, text) { node.replaceChildren(el("span", { className: "kt-warn", textContent: text })); }
