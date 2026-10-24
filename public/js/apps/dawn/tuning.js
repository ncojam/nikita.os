/* ================= DAWN — строи и лады =================
 * Строй канала — EDO (равномерное деление октавы на E ступеней). 12 — обычный, 24 — четвертитоновый
 * (макамы), 19/31 — мезотонные, 17/22 — «суперпифагорейские», 5/7 — экзотика (слендро/равноступенный).
 * Высота ноты — целое n: n = (октава + 1) * E + ступень. Для 12-EDO это ровно MIDI (C4 = 60).
 * Частота: f = C₋₁ · 2^(n / E), где C₋₁ = 8.1758 Гц — одна формула для любого строя.
 */
export const C_1 = 8.175798915643707;
export const hz = (n, edo = 12) => C_1 * 2 ** (n / edo);
export const c4 = (edo = 12) => 5 * edo;                     // «до» первой октавы в данном строе
export const EDOS = [12, 24, 19, 31, 17, 22, 5, 7];
export const EDO_NAME = { 12: "12-EDO (стандарт)", 24: "24-EDO (четвертитоны)", 19: "19-EDO", 31: "31-EDO",
  17: "17-EDO", 22: "22-EDO", 5: "5-EDO (слендро)", 7: "7-EDO (равноступенный)" };

/* имена ступеней в октаве (для 12/24/19 — буквами, для остальных — номера) */
const N12 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const N19 = ["C", "C#", "Db", "D", "D#", "Eb", "E", "E#", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "B#"];
export function degreeNames(edo) {
  if (edo === 12) return N12;
  if (edo === 24) return N12.flatMap(n => [n, n + "↑"]);   // ↑ — на четверть тона выше
  if (edo === 19) return N19;
  return Array.from({ length: edo }, (_, i) => String(i));
}
export const noteNameE = (n, edo = 12) => {
  const d = ((n % edo) + edo) % edo, oct = Math.floor(n / edo) - 1;
  return degreeNames(edo)[d] + oct;
};
/* "C4", "F#3", "C↑4" (24-EDO) или "4:7" (октава:ступень) → n; число — как есть */
export function parsePitch(p, edo = 12) {
  if (typeof p === "number" && isFinite(p)) return Math.round(p);
  const s = String(p ?? "").trim();
  let m = s.match(/^(-?\d+):(\d+)$/);
  if (m) return (+m[1] + 1) * edo + +m[2];
  m = s.match(/^([A-Ga-g])([#b♯♭]*)(↑?)(-?\d+)$/);
  if (m) {
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    const acc = [...m[2]].reduce((a, ch) => a + (ch === "#" || ch === "♯" ? 1 : -1), 0);
    const semis = base + acc, oct = +m[4];
    if (edo === 12) return (oct + 1) * 12 + semis;
    if (edo === 24) return (oct + 1) * 24 + semis * 2 + (m[3] ? 1 : 0);
    const i = degreeNames(edo).indexOf(m[1].toUpperCase() + m[2]);
    if (i >= 0) return (oct + 1) * edo + i;
    return Math.round((oct + 1) * edo + semis * edo / 12);   // ближайшая ступень по высоте
  }
  return c4(edo);
}
/* имя для файла: в 12/24/19 — буквами, в остальных — "октава:ступень" */
export function pitchToFile(n, edo = 12) {
  if (edo === 12 || edo === 24 || edo === 19) return noteNameE(n, edo);
  return `${Math.floor(n / edo) - 1}:${((n % edo) + edo) % edo}`;
}

/* ---------- лады: шаги в ступенях строя (сумма = E) ---------- */
export const SCALES = {
  12: {
    chromatic: ["Хроматика", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    major: ["Мажор", [2, 2, 1, 2, 2, 2, 1]], minor: ["Минор", [2, 1, 2, 2, 1, 2, 2]],
    dorian: ["Дорийский", [2, 1, 2, 2, 2, 1, 2]], phrygian: ["Фригийский", [1, 2, 2, 2, 1, 2, 2]],
    lydian: ["Лидийский", [2, 2, 2, 1, 2, 2, 1]], mixolydian: ["Миксолидийский", [2, 2, 1, 2, 2, 1, 2]],
    locrian: ["Локрийский", [1, 2, 2, 1, 2, 2, 2]], harmminor: ["Гарм. минор", [2, 1, 2, 2, 1, 3, 1]],
    melminor: ["Мелод. минор", [2, 1, 2, 2, 2, 2, 1]], pentmaj: ["Пентатоника маж.", [2, 2, 3, 2, 3]],
    pentmin: ["Пентатоника мин.", [3, 2, 2, 3, 2]], blues: ["Блюз", [3, 2, 1, 1, 3, 2]],
    hirajoshi: ["Хирадзёси", [2, 1, 4, 1, 4]], inscale: ["Ин", [1, 4, 2, 1, 4]],
  },
  24: {
    chromatic: ["Четвертитоны", Array(24).fill(1)],
    rast: ["Макам Раст", [4, 3, 3, 4, 4, 3, 3]], bayati: ["Макам Баяти", [3, 3, 4, 4, 2, 4, 4]],
    saba: ["Макам Саба", [3, 3, 2, 6, 2, 4, 4]], hijaz: ["Макам Хиджаз", [2, 6, 2, 4, 2, 4, 4]],
    sikah: ["Макам Сика", [3, 4, 4, 3, 3, 4, 3]], major: ["Мажор", [4, 4, 2, 4, 4, 4, 2]], minor: ["Минор", [4, 2, 4, 4, 2, 4, 4]],
  },
  19: {
    chromatic: ["Хроматика", Array(19).fill(1)],
    major: ["Мажор", [3, 3, 2, 3, 3, 3, 2]], minor: ["Минор", [3, 2, 3, 3, 2, 3, 3]],
    pent: ["Пентатоника", [3, 3, 5, 3, 5]], negri: ["Негри", [3, 2, 3, 2, 3, 2, 2, 2]],
  },
  31: {
    chromatic: ["Хроматика", Array(31).fill(1)],
    major: ["Мажор", [5, 5, 3, 5, 5, 5, 3]], minor: ["Минор", [5, 3, 5, 5, 3, 5, 5]],
    neutral: ["Нейтральный", [4, 5, 4, 5, 4, 5, 4]], orwell: ["Орвелл", [4, 3, 4, 3, 4, 3, 4, 3, 3]],
  },
  17: {
    chromatic: ["Хроматика", Array(17).fill(1)],
    major: ["Диатоника", [3, 3, 1, 3, 3, 3, 1]], neutral: ["Нейтральный", [2, 3, 2, 3, 2, 3, 2]],
  },
  22: {
    chromatic: ["Хроматика", Array(22).fill(1)],
    major: ["Суперпиф. мажор", [4, 4, 1, 4, 4, 4, 1]], porcupine: ["Поркьюпайн", [3, 3, 3, 4, 3, 3, 3]],
    pajara: ["Паджара", [2, 2, 3, 2, 2, 2, 3, 2, 2, 2]],
  },
  5: { chromatic: ["Слендро", [1, 1, 1, 1, 1]] },
  7: { chromatic: ["Равноступенный", [1, 1, 1, 1, 1, 1, 1]] },
};
export const scalesOf = edo => SCALES[edo] || { chromatic: ["Хроматика", Array(edo).fill(1)] };

/* набор ступеней лада от тоники: Set(0..E-1) */
export function scaleSet(edo, mode, root = 0) {
  const sc = scalesOf(edo)[mode] || scalesOf(edo).chromatic;
  const out = new Set();
  let d = 0;
  for (const st of sc[1]) { out.add((root + d) % edo); d += st; }
  return out;
}
export const inScale = (n, set, edo) => set.has(((n % edo) + edo) % edo);
/* ближайшая нота лада (для привязки к ладу) */
export function snapToScale(n, set, edo) {
  for (let k = 0; k <= edo; k++) {
    if (inScale(n - k, set, edo)) return n - k;
    if (inScale(n + k, set, edo)) return n + k;
  }
  return n;
}
/* «чёрная клавиша»: в 12 — как на пианино; в 24 — нечётные (четвертитоны) + чёрные; в остальных — по ступеням мажора */
export function isBlack(n, edo) {
  const d = ((n % edo) + edo) % edo;
  if (edo === 12) return [1, 3, 6, 8, 10].includes(d);
  if (edo === 24) return d % 2 === 1 || [2, 6, 12, 16, 20].includes(d);
  const maj = scalesOf(edo).major;
  return maj ? !scaleSet(edo, "major", 0).has(d) : false;
}
