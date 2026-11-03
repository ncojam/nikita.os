/* ================= Clown Dungeon — 3D-модель врага =================
 * Файл public/dungeon/enemies/<вид>.glb. Его нет — view.js рисует прямоугольник, и three.js вообще не грузится.
 * Модель сама становится по центру и в нужный размер, поэтому масштаб в Blender не важен.
 *
 * Анимации — только в коде и только сдвиг + поворот: из Blender нужна лишь геометрия с текстурой.
 * Поза считается в pose() по состоянию idle / hit / attack / death; новая поза — новая ветка там.
 * Рисуем в отдельный WebGL-холст и копируем его в общий 2D-холст, чтобы полоса HP и нотка оставались поверх.
 */
const VIEW_FOV = 30, VIEW_DIST = 4.2, FIT_SIZE = 1.45;
export const MODEL_FILL = FIT_SIZE / (2 * VIEW_DIST * Math.tan(VIEW_FOV / 2 * Math.PI / 180));   // доля картинки, занятая моделью
const SMOOTH = 0.35;          // сглаживание: новый удар посреди старого не должен дёргать голову
const decay = (t, k) => Math.exp(-t * k);

/* покачивание: цикл на 4 доли, поворот на другой скорости, чтобы движение не повторялось один в один */
function idlePose(beat) {
  const a = beat / 4 * Math.PI * 2;
  return { x: 0, y: Math.sin(a) * 0.07, z: 0, rx: Math.sin(a * 0.5 + 1) * 0.05, ry: Math.sin(a * 0.75) * 0.14, rz: Math.sin(a * 0.5) * 0.07 };
}

export const CRY_SEC = 1.8;

/* cry — секунд с начала плача: он идёт поверх любого состояния, ведь удары в такт продолжаются */
export function pose(state, t, beat, cry = Infinity, wail = false) {
  const p = idlePose(beat);
  if (wail) {                     // завывает: лицо вверх, мелкая дрожь
    p.rx -= 0.28;
    p.rz += Math.sin(beat * 19) * 0.025;
  }
  if (cry < CRY_SEC) {            // плачет: мотает головой, опустив лицо, и мелко дрожит
    const k = Math.min(1, cry / 0.15, (CRY_SEC - cry) / 0.4);
    p.ry += Math.sin(cry * 13) * 0.42 * k;
    p.rx += 0.2 * k;
    p.rz += Math.sin(cry * 29) * 0.05 * k;
  }
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
    // сглаживание — рендер с запасом в view.js: WebGL не даёт выбрать число сэмплов своего antialias
    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: false });
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(VIEW_FOV, 1, 0.1, 50);
    this.camera.position.z = VIEW_DIST;
    this.scene.add(new T.HemisphereLight(0xffffff, 0x6a5a80, 2.2));
    const sun = new T.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 2);
    this.scene.add(sun);
    root.traverse(o => {         // текстура без фильтрации: крупные чёткие тексели, как на старых приставках
      for (const m of [o.material].flat()) for (const tex of Object.values(m || {})) if (tex?.isTexture) {
        tex.magFilter = tex.minFilter = T.NearestFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
      }
    });
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
