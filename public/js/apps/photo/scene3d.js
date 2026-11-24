import { store } from "../../core/util.js";
import { buildGeometry, occupancy, parseNVX, placeCamera, vkey } from "./nvx.js";

/* ================= 3D-режим просмотрщика: воксельная сцена, облёт, ходьба, пол =================
 * Сцена (.nvx) строится одной сеткой из видимых граней. Старт — ровно с точки, откуда снято фото
 * (поэтому сначала видно «ту же картинку», а потом она оживает).
 *
 *   Облёт: тянуть — вращать вокруг центра, правой/Shift — сдвиг, колесо — ближе/дальше.
 *   Ходьба: клик по сцене — захват мыши; WASD, пробел — прыжок, Shift — бегом, Esc — отпустить.
 *     Гравитация — на пол и на воксели (можно ходить по блокам), ступенька до роста/4 — шагом.
 *   📐 Пол по 3 точкам: три клика по сцене — плоскость становится полом, сцена поворачивается под неё.
 *     У сцен Minecraft пол уже найден тулчейном. Свой пол хранится у посетителя (store "photo.floor.<путь>").
 *   «Рост» — масштаб: высота глаз над полом (с ней — скорость шага).
 */
export async function createScene3D(box, buf, { key = "", onInfo = () => {} } = {}) {
  const T = await import("/vendor/three/three-gltf.min.js");
  const S = parseNVX(buf), head = S.head, size = head.size || 1, mc = head.kind === "minecraft";
  const occ = occupancy(S);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  box.append(renderer.domElement);
  const scene = new T.Scene();
  const root = new T.Group();   // поворот «под пол» — у корня, сама сетка не меняется
  scene.add(root);
  const mesh = new T.Mesh(buildGeometry(T, S, occ), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
  root.add(mesh);
  const R = mesh.geometry.boundingSphere.radius || 10, C = mesh.geometry.boundingSphere.center.clone();
  const cam = new T.PerspectiveCamera(60, 1, Math.max(size * 0.05, R / 2000), R * 20);
  placeCamera(T, cam, head);
  scene.fog = new T.Fog(0x0b0b10, R * 2, R * 8);

  /* ---------- пол ---------- */
  const FKEY = "photo.floor." + key;
  let floorY = head.ground ?? null;
  const saved = store.get(FKEY, null);
  if (saved?.quat) { root.quaternion.set(...saved.quat); floorY = saved.y; }
  const grid = new T.GridHelper(R * 4, Math.round(R * 4 / Math.max(size, R / 60)), 0x8ab4ff, 0x33334a);
  grid.material.transparent = true; grid.material.opacity = 0.35;
  scene.add(grid);
  const placeGrid = () => { grid.visible = floorY != null && showGrid; if (floorY != null) grid.position.set(cam.position.x, floorY + size * 0.01, cam.position.z); };
  let showGrid = true;
  // своя точка обзора на старте: камера фото, но после поворота «под пол» — тоже повернуть
  const startPos = cam.position.clone().applyQuaternion(root.quaternion), startQ = root.quaternion.clone().multiply(cam.quaternion);
  cam.position.copy(startPos); cam.quaternion.copy(startQ);

  /* ---------- состояние управления ---------- */
  let mode = "orbit", raf = 0, last = performance.now(), dead = false;
  const target = C.clone().applyQuaternion(root.quaternion);
  const eyeBase = () => floorY != null ? Math.max(size * 2, startPos.y - floorY) : (mc ? 1.62 : R * 0.08);
  let eyeMul = 1;
  const eye = () => (mc && floorY != null && head.ground != null ? 1.62 : eyeBase()) * eyeMul;
  const vel = new T.Vector3(), keys = new Set();
  let yaw = 0, pitch = 0, onGround = false;
  const euler = new T.Euler(0, 0, 0, "YXZ");
  const syncAngles = () => { euler.setFromQuaternion(cam.quaternion, "YXZ"); yaw = euler.y; pitch = euler.x; };
  syncAngles();

  /* ---------- столкновения: мир → индекс вокселя ---------- */
  const inv = new T.Matrix4(), tmp = new T.Vector3();
  const refreshInv = () => { root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert(); };
  refreshInv();
  const [ox, oy, oz] = head.origin || [0, 0, 0];
  const solid = p => {
    tmp.copy(p).applyMatrix4(inv);
    return occ.has(vkey(Math.floor((tmp.x - ox) / size), Math.floor((tmp.y - oy) / size), Math.floor((tmp.z - oz) / size)));
  };
  const probe = new T.Vector3();
  const bodyHits = (p, from, to) => { for (let h = from; h <= to; h += size * 0.9) { probe.set(p.x, p.y - eye() + h, p.z); if (solid(probe)) return true; } return false; };
  function groundBelow(p) {   // верх ближайшего вокселя под ногами или пол
    let g = floorY ?? -Infinity;
    for (let i = 0; i < 96; i++) {
      probe.set(p.x, p.y - eye() - i * size * 0.5, p.z);
      if (probe.y < g) break;
      if (solid(probe)) {   // верх этого вокселя: в координатах сетки → обратно в мир
        tmp.copy(probe).applyMatrix4(inv);
        tmp.y = oy + (Math.floor((tmp.y - oy) / size) + 1) * size;
        g = Math.max(g, tmp.applyMatrix4(root.matrixWorld).y);
        break;
      }
    }
    return g === -Infinity ? (floorY ?? p.y - eye() - R) : g;
  }

  /* ---------- облёт мышью ---------- */
  const el = renderer.domElement;
  let drag = null;
  el.addEventListener("contextmenu", e => e.preventDefault());
  el.addEventListener("pointerdown", e => {
    if (picking) return pick(e);
    if (mode === "walk") { el.requestPointerLock?.(); return; }
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", e => {
    if (mode === "walk" && document.pointerLockElement === el) {
      yaw -= e.movementX * 0.0025; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0025));
      cam.quaternion.setFromEuler(euler.set(pitch, yaw, 0, "YXZ"));
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      const d = cam.position.distanceTo(target) * 0.0015;
      const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const mv = right.multiplyScalar(-dx * d).add(up.multiplyScalar(dy * d));
      cam.position.add(mv); target.add(mv);
    } else {
      const off = cam.position.clone().sub(target);
      const sph = new T.Vector3().copy(off);
      const r = sph.length(); let th = Math.atan2(sph.x, sph.z), ph = Math.acos(Math.max(-1, Math.min(1, sph.y / r)));
      th -= dx * 0.005; ph = Math.max(0.05, Math.min(Math.PI - 0.05, ph - dy * 0.005));
      cam.position.set(target.x + r * Math.sin(ph) * Math.sin(th), target.y + r * Math.cos(ph), target.z + r * Math.sin(ph) * Math.cos(th));
      cam.lookAt(target);
    }
  });
  el.addEventListener("pointerup", () => { drag = null; });
  el.addEventListener("wheel", e => {
    if (mode === "walk") return;
    e.preventDefault();
    const off = cam.position.clone().sub(target), k = Math.exp(e.deltaY * 0.001);
    cam.position.copy(target).add(off.multiplyScalar(k));
  }, { passive: false });
  const onKey = (e, down) => {
    if (!down) keys.delete(e.code);
    if (mode !== "walk" || document.pointerLockElement !== el) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault(); e.stopPropagation();
      down ? keys.add(e.code) : keys.delete(e.code);
    }
  };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  addEventListener("keydown", kd, true); addEventListener("keyup", ku, true);

  /* ---------- 📐 пол по трём точкам ---------- */
  let picking = false, pts = [];
  const marks = new T.Group(); scene.add(marks);
  const ray = new T.Raycaster(), ndc = new T.Vector2();
  function pick(e) {
    const r = el.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) return;
    pts.push(hit.point.clone());
    const m = new T.Mesh(new T.SphereGeometry(R / 120, 8, 6), new T.MeshBasicMaterial({ color: 0xff9ecb }));
    m.position.copy(hit.point); marks.add(m);
    onInfo(`📐 Точка ${pts.length} из 3`);
    if (pts.length < 3) return;
    const [a, b, c] = pts, n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.lengthSq() < 0.5) { onInfo("Точки на одной линии — кликни ещё раз три точки"); resetPick(); picking = true; return; }
    if (n.y < 0) n.negate();
    const q = new T.Quaternion().setFromUnitVectors(n, new T.Vector3(0, 1, 0));
    root.quaternion.premultiply(q);
    cam.position.applyQuaternion(q); target.applyQuaternion(q); startPos.applyQuaternion(q);
    cam.quaternion.premultiply(q);
    floorY = a.clone().applyQuaternion(q).y;
    store.set(FKEY, { quat: root.quaternion.toArray(), y: floorY });
    refreshInv(); syncAngles();
    resetPick();
    onInfo("✓ Пол задан — можно ходить");
  }
  function resetPick() { picking = false; pts = []; marks.clear(); }

  /* ---------- кадр ---------- */
  const fwd = new T.Vector3(), side = new T.Vector3();
  function frame(now) {
    if (dead) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mode === "walk") {
      const sp = eye() * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 5 : 2.6);
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); side.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const w = new T.Vector3();
      if (keys.has("KeyW") || keys.has("ArrowUp")) w.add(fwd);
      if (keys.has("KeyS") || keys.has("ArrowDown")) w.sub(fwd);
      if (keys.has("KeyD") || keys.has("ArrowRight")) w.add(side);
      if (keys.has("KeyA") || keys.has("ArrowLeft")) w.sub(side);
      if (w.lengthSq()) w.normalize().multiplyScalar(sp);
      vel.x = w.x; vel.z = w.z;
      vel.y -= 9.8 * eye() / 1.62 * 2 * dt;
      if (keys.has("Space") && onGround) { vel.y = eye() * 3.4; onGround = false; }
      const next = cam.position.clone(); next.x += vel.x * dt; next.z += vel.z * dt;
      const step = eye() / 4;
      if (bodyHits(next, step, eye() * 1.05)) { next.x = cam.position.x; next.z = cam.position.z; }   // стена
      else if (bodyHits(next, 0, step)) next.y += step;                                                // ступенька
      next.y += vel.y * dt;
      const g = groundBelow(cam.position);
      if (next.y - eye() <= g) { next.y = g + eye(); vel.y = 0; onGround = true; } else onGround = false;
      cam.position.copy(next);
    }
    placeGrid();
    const W = box.clientWidth, H = box.clientHeight;
    if (W && H) {
      if (renderer.domElement.width !== Math.round(W * renderer.getPixelRatio())) { renderer.setSize(W, H, false); }
      cam.aspect = W / H; cam.updateProjectionMatrix();
      renderer.domElement.style.width = W + "px"; renderer.domElement.style.height = H + "px";
      renderer.render(scene, cam);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    head,
    get mode() { return mode; },
    setMode(m) {
      mode = m;
      if (m === "walk") {
        if (floorY == null && !mc) onInfo("Сначала задай пол (📐), иначе ходить не по чему — пока ходишь по вокселям");
        cam.position.y = Math.max(cam.position.y, groundBelow(cam.position) + eye());
        syncAngles();
        onInfo("🚶 Клик по сцене — захват мыши · WASD · пробел — прыжок · Shift — бегом · Esc — отпустить");
      } else { document.exitPointerLock?.(); keys.clear(); target.copy(cam.position).add(new T.Vector3(0, 0, -R * 0.5).applyQuaternion(cam.quaternion)); }
    },
    pickFloor() { resetPick(); picking = true; onInfo("📐 Кликни три точки на полу"); },
    resetFloor() {
      store.set(FKEY, null);
      root.quaternion.identity(); floorY = head.ground ?? null; refreshInv();
      cam.position.copy(new T.Vector3(...(head.cam?.pos || [0, 0, 0]))); placeCamera(T, cam, head); syncAngles();
      startPos.copy(cam.position);
      onInfo("Пол сброшен");
    },
    home() { placeCamera(T, cam, head); cam.position.applyQuaternion(root.quaternion); cam.quaternion.premultiply(root.quaternion); syncAngles(); target.copy(C).applyQuaternion(root.quaternion); },
    setEye(m) { eyeMul = m; },
    toggleGrid() { showGrid = !showGrid; },
    dispose() {
      dead = true; cancelAnimationFrame(raf);
      removeEventListener("keydown", kd, true); removeEventListener("keyup", ku, true);
      document.exitPointerLock?.();
      mesh.geometry.dispose(); mesh.material.dispose(); renderer.dispose(); renderer.domElement.remove();
    },
  };
}
