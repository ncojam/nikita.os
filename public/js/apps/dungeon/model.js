/* ================= Clown Dungeon — 3D-модель врага =================
 * Файл public/dungeon/enemies/<вид>.glb. Его нет — view.js рисует прямоугольник, и three.js вообще не грузится.
 * Модель сама становится по центру и в нужный размер, поэтому масштаб в Blender не важен.
 *
 * Анимации — только в коде и только сдвиг + поворот: из Blender нужна лишь геометрия с текстурой.
 * Поза считается в pose() по состоянию idle / hit / attack / death; новая поза — новая ветка там.
 * Рисуем в отдельный WebGL-холст и копируем его в общий 2D-холст, чтобы полоса HP и нотка оставались поверх.
 */
const VIEW_FOV = 30, VIEW_DIST = 4.2, FIT_SIZE = 1.45;
const SMOOTH = 0.35;          // сглаживание: новый удар посреди старого не должен дёргать голову
const decay = (t, k) => Math.exp(-t * k);

/* покачивание: цикл на 4 доли, поворот на другой скорости, чтобы движение не повторялось один в один */
function idlePose(beat) {
  const a = beat / 4 * Math.PI * 2;
  return { x: 0, y: Math.sin(a) * 0.07, z: 0, rx: Math.sin(a * 0.5 + 1) * 0.05, ry: Math.sin(a * 0.75) * 0.14, rz: Math.sin(a * 0.5) * 0.07 };
}

export function pose(state, t, beat) {
  const p = idlePose(beat);
  if (state === "hit") {          // удар: отлетает назад, запрокидывается, дрожит и возвращается
    const k = decay(t, 7);
    p.z -= 0.5 * k;
    p.y += 0.12 * k;
    p.rx -= 0.5 * k;
    p.rz += Math.sin(t * 32) * 0.3 * k;
    p.x += Math.sin(t * 41) * 0.09 * k;
  } else if (state === "attack") {   // бодает: кивок вперёд и вниз
    const k = Math.sin(Math.min(1, t / 0.45) * Math.PI);
    p.z += 1 * k;
    p.y -= 0.45 * k;
    p.rx += 0.7 * k;
  } else if (state === "death") {    // падает, заваливаясь набок
    const k = Math.min(1, t / 1.3);
    p.y -= k * k * 2.6;
    p.rz += k * 1.6;
    p.rx += k * 0.8;
  }
  return p;
}

export class EnemyModel {
  /* null — модели нет или WebGL недоступен: это не ошибка */
  static async load(kind) {
    try {
      const url = `/dungeon/enemies/${kind}.glb`;
      if (!(await fetch(url, { method: "HEAD" })).ok) return null;
      const T = await import("/vendor/three/three-gltf.min.js");
      const gltf = await new T.GLTFLoader().loadAsync(url);
      return new EnemyModel(T, gltf.scene);
    } catch (e) {
      console.warn("модель врага", e);
      return null;
    }
  }

  constructor(T, root) {
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(VIEW_FOV, 1, 0.1, 50);
    this.camera.position.z = VIEW_DIST;
    this.scene.add(new T.HemisphereLight(0xffffff, 0x6a5a80, 2.2));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 2);
    this.scene.add(sun);
    const box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
    const k = FIT_SIZE / Math.max(size.x, size.y, size.z);
    root.scale.multiplyScalar(k);
    root.position.sub(c.multiplyScalar(k));
    this.pivot = new T.Group();
    this.pivot.add(root);
    this.scene.add(this.pivot);
    this.px = 0;
    this.now = idlePose(0);
  }

  /* нарисовать позу и вернуть холст со стороной px */
  draw(target, px) {
    if (px !== this.px) { this.px = px; this.renderer.setSize(px, px, false); }
    const n = this.now;
    for (const k in n) n[k] += (target[k] - n[k]) * SMOOTH;
    this.pivot.position.set(n.x, n.y, n.z);
    this.pivot.rotation.set(n.rx, n.ry, n.rz);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }
}
