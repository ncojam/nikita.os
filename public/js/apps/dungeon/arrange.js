/* ================= Clown Dungeon — аранжировка боевой музыки =================
 * Чистая логика без звука: что играет в данном такте при данном состоянии боя. Звук ставит music.js.
 *
 * ДЕФОЛТ ниже — общий пресет для всех треков. У трека в его .json лежит только отличие:
 *   roles      — канал DAWN → роль (lead, bass, kick, snare, hat, tension или своя);
 *   layers     — заменяет порядок вступления целиком;
 *   addLayers  — дополняет его (новый инструмент: { "role": "choir", "at": 6 });
 *   rules      — дополнительные правила, идут после общих и поэтому перекрывают их;
 *   ownRules   — true: общих правил нет, только свои.
 * Канал, про который ничего не сказано, вступает следом за последним слоем.
 *
 * Правило: { when: {...условия...}, add, mute, shift, filter } или { when, pick: [вариант, вариант…] }.
 *   when:   from N (с N-го повтора), every N + at K (повтор № K из каждых N), bar K (такт внутри паттерна; -1 — последний),
 *           enemyHpBelow, myHpBelow, comboFrom (доли и удары), chance (вероятность на этот повтор).
 *   add / mute — списки ролей; shift — { роль: полутоны }; filter — { роль: частота среза, Гц }.
 *   Особые имена: "pitched" — всё мелодическое (ударные не трогаем), "all" — всё.
 *
 * Как устроены вариации (чтобы один паттерн не приедался и при этом не разваливался):
 *  • меняем на границе фразы, а не посреди неё: ухо ждёт перемен на 4-м и 8-м такте;
 *  • чередуем «своё — чужое — своё» (AABA): вариация держится один повтор и возвращается домой;
 *  • высоту меняем только на октаву и только у колокольчиков, в отдельных повторах: гармония остаётся той же,
 *    а действия игрока на высоту не влияют;
 *  • убрать бас на один такт перед новым кругом — дешёвый способ сделать «вдох».
 * Выбор вариации детерминирован зерном боя: у всех участников боя музыка одинаковая.
 */
export const DEFAULT = {
  layers: [
    { role: "lead", at: 0 },
    { role: "bass", at: 1 },
    { role: "kick", at: 2 },
    { role: "snare", at: 3 },
    { role: "hat", at: 4 },
  ],
  rules: [
    // развязка: у врага мало жизней
    { id: "tension", when: { enemyHpBelow: 0.35 }, add: ["tension"] },
    // вдох перед новым кругом
    { id: "breath", when: { from: 3, every: 4, at: 3, bar: -1 }, mute: ["bass"] },
    // вариации: после того как все вступили, каждый второй повтор
    { id: "variation", when: { from: 5, every: 2, at: 1 }, pick: [
      { shift: { lead: 12 } },
      { filter: { lead: 900 } },
      { mute: ["kick", "hat"], shift: { lead: 12 } },
    ] },
    // мало здоровья: мир глохнет, остаются низ и пульс
    { id: "hurt", when: { myHpBelow: 0.3 }, filter: { lead: 1100, tension: 1500, hat: 1800, snare: 2200 } },
    { id: "dying", when: { myHpBelow: 0.12 }, filter: { lead: 500, tension: 800, snare: 900 }, mute: ["hat"] },
  ],
};

const DRUMS = new Set(["sampler"]);

/* разобрать правила трека поверх пресета; channels — каналы проекта DAWN */
export function arrangement(track, channels) {
  const roleOf = id => track.roles?.[id] || id;
  const layers = [...(track.layers || DEFAULT.layers), ...(track.addLayers || [])];
  const rules = [...(track.ownRules ? [] : DEFAULT.rules), ...(track.rules || [])];
  const known = new Set(layers.map(l => l.role));
  for (const r of rules) for (const x of [...(r.add || []), ...(r.pick || []).flatMap(p => p.add || [])]) known.add(x);
  const late = layers.reduce((m, l) => Math.max(m, l.at), 0) + 1;
  for (const c of channels) if (!known.has(roleOf(c.id))) layers.push({ role: roleOf(c.id), at: late });
  const isPitched = c => !DRUMS.has(c.type) && !(c.type === "chip" && (c.params?.wave === "noise" || c.params?.drum));
  return { roleOf, layers, rules, pitched: new Set(channels.filter(isPitched).map(c => roleOf(c.id))),
    all: new Set(channels.map(c => roleOf(c.id))) };
}

/* простой воспроизводимый генератор: число в 0..1 по зерну и номеру */
function rand(seed, n) {
  let x = (Math.imul(seed | 0, 2654435761) ^ Math.imul(n + 1, 40503)) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13; x = Math.imul(x, 3266489917) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
/* k-я карта из перетасованной колоды размером n: варианты идут без близких повторов */
function deal(seed, n, k) {
  const round = Math.floor(k / n), deck = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand(seed + round * 97, i) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck[k % n];
}

function matches(w = {}, s, ruleNo) {
  if (w.from != null && s.loop < w.from) return false;
  if (w.every != null) {
    const base = s.loop - (w.from || 0);
    if (((base % w.every) + w.every) % w.every !== (w.at || 0)) return false;
  }
  if (w.bar != null && s.bar !== (w.bar < 0 ? s.bars + w.bar : w.bar)) return false;
  if (w.enemyHpBelow != null && !(s.enemyHp < w.enemyHpBelow)) return false;
  if (w.myHpBelow != null && !(s.myHp < w.myHpBelow)) return false;
  if (w.comboFrom != null && !(s.combo >= w.comboFrom)) return false;
  if (w.chance != null && rand(s.seed + ruleNo * 131, s.loop) >= w.chance) return false;
  return true;
}

function expand(A, name) {
  return name === "pitched" ? [...A.pitched] : name === "all" ? [...A.all] : [name];
}

/* s: { loop, bar, bars, enemyHp, myHp, combo, seed } → { active: Set, shift: {роль: полутоны}, filter: {роль: Гц} } */
export function planBar(A, s) {
  const active = new Set(A.layers.filter(l => s.loop >= l.at).map(l => l.role));
  const shift = {}, filter = {};
  const apply = d => {
    for (const r of d.add || []) expand(A, r).forEach(x => active.add(x));
    for (const r of d.mute || []) expand(A, r).forEach(x => active.delete(x));
    for (const [r, v] of Object.entries(d.shift || {})) for (const x of expand(A, r)) shift[x] = (shift[x] || 0) + v;
    for (const [r, v] of Object.entries(d.filter || {})) for (const x of expand(A, r)) filter[x] = Math.min(filter[x] ?? 22000, v);
  };
  A.rules.forEach((rule, no) => {
    if (!matches(rule.when, s, no)) return;
    if (!rule.pick) return apply(rule);
    const w = rule.when || {}, k = Math.floor((s.loop - (w.from || 0)) / (w.every || 1));
    apply(rule.pick[deal(s.seed + no, rule.pick.length, k)]);
  });
  return { active, shift, filter };
}
