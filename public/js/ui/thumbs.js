import { fsUrl } from "../core/util.js";

/* ================= Превью картинок в проводнике =================
 * thumb(box, path, stamp) — вместо значка 🖼️ ставит уменьшенную копию картинки.
 * Грузится, только когда значок виден (IntersectionObserver), по 3 за раз; уменьшается до 128 px на canvas
 * и кладётся в Cache Storage браузера («nos-thumbs») — второй раз папка открывается мгновенно и без трафика.
 * stamp (время изменения + размер) — поменял картинку, превью пересчитается. Не вышло — остаётся значок.
 */
const SIDE = 128, CACHE = "nos-thumbs";
let queue = [], busy = 0;
const io = "IntersectionObserver" in self ? new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); }
  pump();
}, { rootMargin: "200px" }) : null;

export function thumb(box, path, stamp = "") {
  box._thumb = { path, key: `/__thumb/${encodeURIComponent(path)}?v=${encodeURIComponent(stamp)}` };
  if (io) io.observe(box); else { queue.push(box); pump(); }
}

function pump() {
  while (busy < 3 && queue.length) {
    const box = queue.shift();
    if (!box.isConnected || !box._thumb) continue;
    busy++;
    make(box._thumb).then(url => {
      if (!url || !box.isConnected) return;
      const img = new Image();
      img.className = "thumb"; img.alt = ""; img.draggable = false; img.src = url;
      box.replaceChildren(img);
    }).catch(() => {}).finally(() => { busy--; pump(); });
  }
}

async function make({ path, key }) {
  const cache = await self.caches?.open(CACHE).catch(() => null);
  const hit = await cache?.match(key);
  if (hit) return URL.createObjectURL(await hit.blob());
  const r = await fetch(fsUrl(path));
  if (!r.ok) return null;
  const bmp = await createImageBitmap(await r.blob());
  const k = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  const g = cv.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const blob = await cv.convertToBlob({ type: "image/webp", quality: 0.8 });
  cache?.put(key, new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => {});
  return URL.createObjectURL(blob);
}
