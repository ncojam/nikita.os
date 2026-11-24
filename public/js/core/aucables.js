import { AudioOS } from "./audio.js";
import { notify } from "../ui/notify.js";

/* ================= Аудиокабели между окнами =================
 * Гнездо — элемент в любом окне: auJack(id узла, "in" | "out", порт). Тянешь от выхода (жёлтое) на вход (голубое) —
 * кабель (AudioOS.connect). Клик по кабелю — вынуть. Потянул за вход, в который уже воткнут кабель, — кабель
 * снимается и остаётся в руке: перетыкай куда надо.
 * Кабель рисуется, когда оба его гнезда видны на экране. Если у узла видно несколько гнёзд (педаль в «Педалях»
 * и в «Звуке» одновременно), берётся пара из одного окна, иначе — из самых верхних окон.
 */
export function auJack(id, dir, port = "", title = "") {
  const j = document.createElement("span");
  j.className = `au-jack ${dir}`;
  j.dataset.node = id; j.dataset.dir = dir; j.dataset.port = port;
  j.title = title || (dir === "out" ? "Выход — тяни кабель на вход" : "Вход") + (port ? ` «${port}»` : "");
  if (port) j.dataset.label = port;
  j.addEventListener("pointerdown", e => AuCables.press(e, j));
  return j;
}

const NS = "http://www.w3.org/2000/svg";
export const AuCables = {
  svg: null, raf: 0, drag: null,
  start() {
    if (this.svg) return;
    this.svg = document.createElementNS(NS, "svg");
    this.svg.classList.add("au-cables");
    document.body.append(this.svg);
    const loop = () => { this.draw(); this.raf = requestAnimationFrame(loop); };
    loop();
  },
  visible(e) {
    if (!e?.isConnected || !e.getClientRects().length) return false;
    const w = e.closest(".window");
    return !w || !w.classList.contains("minimized");
  },
  zOf(e) { return +(e.closest(".window")?.style.zIndex || 0); },
  jacks(id, dir, port) {
    return [...document.querySelectorAll(`.au-jack.${dir}[data-node="${CSS.escape(id)}"][data-port="${CSS.escape(port)}"]`)].filter(j => this.visible(j));
  },
  pair(r) {
    const A = this.jacks(r.from, "out", r.fp || ""), B = this.jacks(r.to, "in", r.tp || "");
    if (!A.length || !B.length) return null;
    for (const a of A) { const w = a.closest(".window"); const b = B.find(x => x.closest(".window") === w); if (w && b) return [a, b]; }
    const top = L => L.reduce((m, x) => this.zOf(x) > this.zOf(m) ? x : m);
    return [top(A), top(B)];
  },
  center(e) { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; },
  curve([x1, y1], [x2, y2]) {
    const sag = Math.min(140, Math.hypot(x2 - x1, y2 - y1) * 0.3 + 30);
    return `M${x1} ${y1} C${x1 + 30} ${y1 + sag} ${x2 - 30} ${y2 + sag} ${x2} ${y2}`;
  },
  key: "",
  draw() {
    const parts = [];
    for (const r of AudioOS.routes) {
      const pr = this.pair(r);
      if (!pr) continue;
      const a = this.center(pr[0]), b = this.center(pr[1]), d = this.curve(a, b);
      parts.push({ d, r, live: AudioOS.nodes.has(r.from) && AudioOS.nodes.has(r.to) });
    }
    if (this.drag) parts.push({ d: this.curve(this.drag.a, this.drag.b), temp: true });
    const key = parts.map(p => p.d).join("|");
    if (key === this.key) return;   // ничего не сдвинулось — не перерисовываем
    this.key = key;
    this.svg.replaceChildren(...parts.flatMap(p => {
      const shadow = document.createElementNS(NS, "path"), path = document.createElementNS(NS, "path");
      shadow.setAttribute("d", p.d); shadow.setAttribute("class", "au-cable-shadow");
      path.setAttribute("d", p.d); path.setAttribute("class", "au-cable" + (p.temp ? " temp" : "") + (p.live === false ? " ghost" : ""));
      if (p.r) {
        path.onclick = () => { const { from, to, fp = "", tp = "" } = p.r; AudioOS.disconnect(from, to, fp, tp); notify(`🔌 Кабель вынут: ${AudioOS.title(from)} → ${AudioOS.title(to)}`); };
        const t = document.createElementNS(NS, "title");
        t.textContent = `${AudioOS.title(p.r.from)}${p.r.fp ? " «" + p.r.fp + "»" : ""} → ${AudioOS.title(p.r.to)}${p.r.tp ? " «" + p.r.tp + "»" : ""} (клик — вынуть)`;
        path.append(t);
      }
      return [shadow, path];
    }));
  },
  /* нажали на гнездо: с выхода — новый кабель; со входа, где уже есть кабель, — снять его и перетыкать */
  press(e, j) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    let from = j.dataset.node, fp = j.dataset.port, a;
    if (j.dataset.dir === "in") {
      const r = [...AudioOS.routes].reverse().find(x => x.to === j.dataset.node && (x.tp || "") === j.dataset.port);
      if (!r) return;
      AudioOS.disconnect(r.from, r.to, r.fp || "", r.tp || "");
      from = r.from; fp = r.fp || "";
      const src = this.jacks(from, "out", fp)[0];
      a = src ? this.center(src) : [e.clientX, e.clientY];
    } else a = this.center(j);
    this.drag = { a, b: [e.clientX, e.clientY] };
    document.documentElement.classList.add("au-patching");
    const move = ev => { this.drag.b = [ev.clientX, ev.clientY]; };
    const up = ev => {
      removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true);
      document.documentElement.classList.remove("au-patching");
      this.drag = null;
      const t = document.elementsFromPoint(ev.clientX, ev.clientY).find(e => e.closest?.(".au-jack.in"))?.closest(".au-jack.in");
      if (!t) return;
      try { if (AudioOS.connect(from, t.dataset.node, fp, t.dataset.port)) notify(`🔌 ${AudioOS.title(from)} → ${AudioOS.title(t.dataset.node)}`); }
      catch (err) { notify("⚠ " + err.message); }
    };
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true);
  },
};
