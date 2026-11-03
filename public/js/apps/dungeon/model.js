/* ================= Clown Dungeon — 3D-модель врага =================
 * Файл public/dungeon/enemies/<вид>.glb. Его нет — view.js рисует прямоугольник, и three.js вообще не грузится.
 * Модель сама становится по центру и в нужный размер, поэтому масштаб в Blender не важен.
 *
 * Движение головы — в коде, сдвиг и поворот. Форма лица — Shape Keys из Blender: это ключевые позы, а силу каждой
 * (0..1) задаёт код. Имена без учёта регистра: idle, attack, hit, cry, wail, death, blink. Ключа нет в файле — не беда.
 * Поза считается в pose() по состоянию idle / windup / attack / hit / death; новая поза — новая ветка там.
 * Рисуем в отдельный WebGL-холст и копируем его в общий 2D-холст, чтобы полоса HP и нотка оставались поверх.
 */
const VIEW_FOV = 30, VIEW_DIST = 4.2, FIT_SIZE = 1.45;
export const MODEL_FILL = FIT_SIZE / (2 * VIEW_DIST * Math.tan(VIEW_FOV / 2 * Math.PI / 180));   // доля картинки, занятая моделью
export const WINDUP_SEC = 0.22;   // замах короткий: голова откидывается прямо перед броском
const BLINK_BEATS = 13, BLINK_LEN = 0.5;   // моргает раз в столько долей, закрыв глаза на столько
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
  const p = idlePose(beat), m = { idle: 0, attack: 0, hit: 0, cry: 0, wail: wail ? 1 : 0, death: 0, blink: 0 };
  p.m = m;
  m.idle = (Math.sin(beat / 4 * Math.PI * 2) + 1) / 2;
  const b = beat % BLINK_BEATS;
  m.blink = b < BLINK_LEN ? 1 - Math.abs(b / BLINK_LEN * 2 - 1) : 0;
  if (cry < CRY_SEC) m.cry = Math.min(1, cry / 0.15, (CRY_SEC - cry) / 0.4);
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
    m.hit = k;
  } else if (state === "windup") {   // замах: закидывает голову назад и скалится
    const k = Math.max(0, Math.min(1, t / WINDUP_SEC));
    p.z -= 0.45 * k;
    p.y += 0.22 * k;
    p.rx -= 0.65 * k;
    m.attack = k;
  } else if (state === "attack") {   // бросок: резкий кивок вперёд и вниз
    const k = Math.sin(Math.min(1, t / 0.45) * Math.PI);
    p.z += 1 * k;
    p.y -= 0.45 * k;
    p.rx += 0.7 * k;
    m.attack = Math.max(0, 1 - t / 0.45);
  } else if (state === "death") {    // падает, заваливаясь набок
    const k = Math.min(1, t / 1.3);
    p.y -= k * k * 2.6;
    p.rz += k * 1.6;
    p.rx += k * 0.8;
    m.death = Math.min(1, t / 0.6);
  }
  m.idle *= 1 - Math.max(m.attack, m.hit, m.cry, m.wail, m.death);   // поза важнее покачивания лица
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
    this.weights = {};
    this.morphs = [];       // [{ influences, keys: { имя: индекс } }]: у каждого меша свои, одноимённые ключи работают вместе
    root.traverse(o => {
      if (!o.morphTargetDictionary) return;
      const keys = Object.fromEntries(Object.entries(o.morphTargetDictionary).map(([k, i]) => [k.toLowerCase(), i]));
      this.morphs.push({ influences: o.morphTargetInfluences, keys });
    });
  }

  /* нарисовать позу и вернуть холст со стороной px */
  draw(target, px) {
    if (px !== this.px) { this.px = px; this.renderer.setSize(px, px, false); }
    const n = this.now;
    for (const k in n) n[k] += (target[k] - n[k]) * SMOOTH;
    for (const [k, v] of Object.entries(target.m)) {
      const w = this.weights[k] = (this.weights[k] || 0) + (v - (this.weights[k] || 0)) * SMOOTH;
      for (const m of this.morphs) if (k in m.keys) m.influences[m.keys[k]] = w;
    }
    this.pivot.position.set(n.x, n.y, n.z);
    this.pivot.rotation.set(n.rx, n.ry, n.rz);
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }
}
