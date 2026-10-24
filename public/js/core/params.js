/* ================= Параметры ОС — общий реестр для модуляции =================
 * Любой модуль может выставить «ручки», которые кто-то другой будет крутить (DAWN — проводками от
 * огибающих и LFO). Параметр адресуется строкой, провайдер отвечает за свой префикс:
 *
 *   Params.addProvider({
 *     prefix: "os.",                       // какие адреса обслуживает
 *     label: "ОС",
 *     list() -> [{ addr, label, group }],  // что предложить в списке целей
 *     resolve(addr) -> { label, spec: { min, max, def, unit? }, base(), apply(v), restore() } | null
 *   })
 *
 * apply(v) ставит ВРЕМЕННОЕ значение (модуляция), restore() возвращает «как было» — сохранённые
 * настройки модуляция никогда не переписывает.
 *
 * Параметры самой ОС не зашиты в код: они описаны в fs/etc/params.json (CSS-переменные на :root
 * с диапазонами). Хочешь новую — добавь строку в JSON и используй переменную в CSS.
 */
export const Params = {
  providers: [],
  addProvider(p) { this.providers = this.providers.filter(x => x.prefix !== p.prefix); this.providers.push(p); },
  resolve(addr) {
    for (const p of this.providers) if (addr.startsWith(p.prefix)) return p.resolve(addr);
    return null;
  },
  list() { return this.providers.flatMap(p => p.list().map(x => ({ ...x, provider: p.label }))); },
};

/* ---------- провайдер ОС: CSS-переменные из etc/params.json ---------- */
const FALLBACK = [
  { id: "hue", label: "Оттенок окон", var: "--os-hue", min: -180, max: 180, def: 0, unit: "deg", group: "Окна" },
  { id: "sat", label: "Насыщенность окон", var: "--os-sat", min: 0, max: 2.5, def: 1, group: "Окна" },
  { id: "radius", label: "Скругление окон", var: "--radius", min: 0, max: 40, def: 16, unit: "px", group: "Окна" },
  { id: "blur", label: "Размытие стекла", var: "--os-blur", min: 0, max: 60, def: 28, unit: "px", group: "Окна" },
  { id: "font", label: "Размер заголовков", var: "--os-font", min: 0.7, max: 2, def: 1, group: "Окна" },
  { id: "wall", label: "Яркость обоев", var: "--os-wall", min: 0.2, max: 1.8, def: 1, group: "Рабочий стол" },
  { id: "wallhue", label: "Оттенок обоев", var: "--os-wall-hue", min: -180, max: 180, def: 0, unit: "deg", group: "Рабочий стол" },
];
let OS = FALLBACK;
const root = () => document.documentElement.style;

Params.addProvider({
  prefix: "os.",
  label: "ОС",
  list: () => OS.map(p => ({ addr: "os." + p.id, label: p.label, group: p.group || "ОС" })),
  resolve(addr) {
    const p = OS.find(x => "os." + x.id === addr);
    if (!p) return null;
    return {
      label: p.label, spec: { min: p.min, max: p.max, def: p.def, unit: p.unit },
      base: () => p.def,
      apply: v => root().setProperty(p.var, (+v).toFixed(4).replace(/\.?0+$/, "") + (p.unit || "")),
      restore: () => root().removeProperty(p.var),
    };
  },
});

export async function init_params() {
  try {
    const r = await fetch("/fs/etc/params.json", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      const list = (Array.isArray(d) ? d : d.params || []).filter(p => p && p.id && p.var && isFinite(p.min) && isFinite(p.max));
      if (list.length) OS = list.map(p => ({ def: p.min, ...p }));
    }
  } catch { /* нет файла — работаем со встроенным списком */ }
}
