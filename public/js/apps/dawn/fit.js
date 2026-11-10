/* ================= DAWN — подгонка огибающих под длину ноты =================
 * Чистые функции без зависимостей: их использует граф (graph.js), а значит и игры, которым не нужен интерфейс DAWN.
 */

/* огибающая под длину ноты: атака не дольше ~45% ноты, спад — 35%, релиз — половины */
export function fitParams(p, type, dur) {
  const fit = o => {
    const a = o.att ?? 0, k = a > dur * 0.45 ? (dur * 0.45) / a : 1;
    const q = { ...o, att: a * k, dec: Math.min(o.dec ?? 0, Math.max(0.005, dur * 0.35)), rel: Math.min(o.rel ?? 0, Math.max(0.01, dur * 0.5)) };
    return q;
  };
  if (type === "grapefruit" || type === "bitterlemon") {
    return { ...p, ops: p.ops.map(o => {
      const q = fit(o);
      if (o.env) {   // нарисованные огибающие тоже сжимаем по времени, если они длиннее ноты
        q.env = {};
        for (const [k, e] of Object.entries(o.env)) {
          if (!e?.pts?.length) { q.env[k] = e; continue; }
          const end = e.sus >= 0 ? e.pts[e.sus]?.[0] ?? 0 : Math.max(...e.pts.map(x => x[0]));
          const s = end > dur * 0.9 && end > 0 ? (dur * 0.9) / end : 1;
          q.env[k] = s < 1 ? { ...e, pts: e.pts.map(([t, v]) => [t * s, v]) } : e;
        }
      }
      return q;
    }) };
  }
  return fit(p);
}

/* ⇔ у оператора: огибающая пропорциональна длине ноты — настроена под ноту в 1 долю,
 * на 1/16 играет в 4 раза быстрее, на ноте в 2 доли — в 2 раза медленнее (и ADSR, и нарисованные огибающие) */
export function fitOps(p, dur, beatSec) {
  if (!p.ops?.some(o => o.fit)) return p;
  const k = Math.max(0.05, Math.min(8, dur / beatSec));
  return { ...p, ops: p.ops.map(o => {
    if (!o.fit) return o;
    const q = { ...o, att: (o.att ?? 0) * k, dec: (o.dec ?? 0) * k, rel: (o.rel ?? 0) * k };
    if (o.env) { q.env = {}; for (const [kd, e] of Object.entries(o.env)) q.env[kd] = e?.pts ? { ...e, pts: e.pts.map(([t, v]) => [t * k, v]) } : e; }
    return q;
  }) };
}

/* растяжение огибающей у отдельной ноты (поле x): атака и спад × k — «вууууб» из двух вубов */
export function stretchParams(p, type, k) {
  const st = o => ({ ...o, att: (o.att ?? 0) * k, dec: (o.dec ?? 0) * k });
  if (type === "grapefruit" || type === "bitterlemon") return { ...p, ops: p.ops.map(o => {
    const q = st(o);
    if (o.env) { q.env = {}; for (const [kd, e] of Object.entries(o.env)) q.env[kd] = e?.pts ? { ...e, pts: e.pts.map(([t, v]) => [t * k, v]) } : e; }
    return q;
  }) };
  return st(p);
}
