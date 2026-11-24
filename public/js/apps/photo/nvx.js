/* ================= .nvx — воксельная сцена из фотографии =================
 * Формат (little-endian), его пишет тулчейн tools/photo3d/scene.py:
 *   "NVX1" · u32 длина заголовка H · H байт JSON (дополнено пробелами до кратного 4) ·
 *   count × (int16 x, int16 y, int16 z) · count × (u8 r, u8 g, u8 b)
 * Заголовок: { v: 1, kind: "photo" | "minecraft", count, size: длина ребра вокселя, origin: [x, y, z] — угол вокселя (0,0,0),
 *   cam: { pos: [x, y, z], quat: [x, y, z, w], fov: вертикальный угол °, aspect }, ground: y пола | null, filled: число дорисованных }
 * Мир: Y вверх, камера смотрит в −Z (как в three.js). Камера из заголовка — точка, откуда снято фото.
 *
 * Модуль без зависимостей от сайта: его же грузит веб-интерфейс тулчейна.
 */
export function parseNVX(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "NVX1") throw new Error("это не сцена .nvx");
  const H = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, H)));
  const n = head.count | 0, off = 8 + H;
  if (buf.byteLength < off + n * 9) throw new Error("файл сцены обрезан");
  const xyz = new Int16Array(buf.slice(off, off + n * 6));
  const rgb = new Uint8Array(buf, off + n * 6, n * 3);
  return { head, xyz, rgb, count: n };
}

const K = 4096, H2 = 2048;
export const vkey = (x, y, z) => (x + H2) + (y + H2) * K + (z + H2) * K * K;

/* занятость: Set ключей — для граней, хождения и столкновений */
export function occupancy(scene) {
  const s = new Set(), { xyz, count } = scene;
  for (let i = 0; i < count; i++) s.add(vkey(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]));
  return s;
}

/* сетка: только видимые грани (соседняя клетка пустая), цвет в вершинах с «майнкрафтовым» затенением граней */
const FACES = [
  // нормаль, 4 угла (в долях вокселя), яркость
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], 0.8],
  [[-1, 0, 0], [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], 0.8],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 1.0],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.5],
  [[0, 0, 1], [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], 0.65],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], 0.65],
];
export function buildGeometry(T, scene, occ = occupancy(scene), list = null) {
  const { xyz, rgb, head } = scene, s = head.size || 1, [ox, oy, oz] = head.origin || [0, 0, 0];
  const n = list ? list.length : scene.count, at = list ? j => list[j] : j => j;
  let faces = 0;
  for (let j = 0; j < n; j++) {
    const i = at(j);
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    for (const [n] of FACES) if (!occ.has(vkey(x + n[0], y + n[1], z + n[2]))) faces++;
  }
  const pos = new Float32Array(faces * 12), col = new Float32Array(faces * 12), idx = new Uint32Array(faces * 6);
  let f = 0;
  for (let j = 0; j < n; j++) {
    const i = at(j);
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    const r = rgb[i * 3] / 255, g = rgb[i * 3 + 1] / 255, b = rgb[i * 3 + 2] / 255;
    for (const [n, corners, shade] of FACES) {
      if (occ.has(vkey(x + n[0], y + n[1], z + n[2]))) continue;
      for (let c = 0; c < 4; c++) {
        const k = f * 12 + c * 3;
        pos[k] = ox + (x + corners[c][0]) * s; pos[k + 1] = oy + (y + corners[c][1]) * s; pos[k + 2] = oz + (z + corners[c][2]) * s;
        col[k] = r * shade; col[k + 1] = g * shade; col[k + 2] = b * shade;
      }
      const v = f * 4, j = f * 6;
      idx[j] = v; idx[j + 1] = v + 1; idx[j + 2] = v + 2; idx[j + 3] = v; idx[j + 4] = v + 2; idx[j + 5] = v + 3;
      f++;
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  geo.setIndex(new T.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/* точки: по одной в центре каждого вокселя, исходный цвет */
export function buildPoints(T, scene, list = null) {
  const { xyz, rgb, head } = scene, s = head.size || 1, [ox, oy, oz] = head.origin || [0, 0, 0];
  const n = list ? list.length : scene.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const i = list ? list[j] : j;
    for (let a = 0; a < 3; a++) {
      pos[j * 3 + a] = [ox, oy, oz][a] + (xyz[i * 3 + a] + 0.5) * s;
      col[j * 3 + a] = rgb[i * 3 + a] / 255;
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.BufferAttribute(pos, 3));
  geo.setAttribute("color", new T.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/* чанки по CH вокселей на сторону: каждый — свой объект, и three.js отбрасывает те, что вне поля зрения
 * (за камерой, сбоку) — на большой сцене рисуется только видимое */
export const CH = 32;
export function chunks(scene) {
  const m = new Map(), { xyz, count } = scene;
  for (let i = 0; i < count; i++) {
    const k = vkey(Math.floor(xyz[i * 3] / CH), Math.floor(xyz[i * 3 + 1] / CH), Math.floor(xyz[i * 3 + 2] / CH));
    let a = m.get(k);
    if (!a) m.set(k, a = []);
    a.push(i);
  }
  return [...m.values()];
}

/* камера из заголовка: на месте фотоаппарата, с его углом обзора */
export function placeCamera(T, cam, head) {
  const c = head.cam || {};
  cam.fov = c.fov || 60;
  cam.position.set(...(c.pos || [0, 0, 0]));
  if (c.quat) cam.quaternion.set(...c.quat); else cam.quaternion.identity();
  cam.updateProjectionMatrix();
}
