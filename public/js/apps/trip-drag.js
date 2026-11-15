/* ================= поездки: перетаскивание за ручку ⠿ =================
 * Pointer-события, а не HTML5 drag'n'drop: так работает и мышью, и пальцем (телефон, Steam Deck).
 * sortable(box, item, grip, onDrop): тянем прямого потомка box (селектор item) за ручку (селектор grip).
 * Элементы с классом .trp-divider тоже участвуют в раскладке — через черту можно перетащить
 * (так вариант попадает в поездку и обратно). onDrop(order) получает прямых потомков item и черту по порядку
 * и вызывается, только если порядок изменился. Пока тянем, у box висит класс .dragging (CSS прячет
 * устаревшие подписи стыковок), у элемента — .drag. Список прокручивается сам, если тянуть к краю.
 */
const EDGE = 40;      // px от края прокрутки, где список едет сам
const SCROLL = 12;    // px за кадр

export function sortable(box, item, grip, onDrop) {
  box.addEventListener("pointerdown", e => {
    const h = e.target.closest(grip);
    const node = h?.closest(item);
    if (!h || !node || node.parentElement !== box || e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    const parts = () => [...box.children].filter(n => n.matches(item) || n.classList.contains("trp-divider"));
    const before = parts();
    const scroller = box.closest(".trp-list");
    let y = e.clientY, raf = 0;
    h.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
    node.classList.add("drag");
    const place = () => {
      const others = parts().filter(n => n !== node);
      const next = others.find(n => { const r = n.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (next) { if (node.nextElementSibling !== next) box.insertBefore(node, next); }
      else if (others.length && others.at(-1).nextElementSibling !== node) others.at(-1).after(node);
    };
    const tick = () => {
      raf = 0;
      if (!scroller) return;
      const r = scroller.getBoundingClientRect();
      const dy = y < r.top + EDGE ? -SCROLL : y > r.bottom - EDGE ? SCROLL : 0;
      if (dy) { scroller.scrollTop += dy; place(); raf = requestAnimationFrame(tick); }
    };
    const move = ev => {
      y = ev.clientY;
      place();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const up = () => {
      cancelAnimationFrame(raf);
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      h.removeEventListener("pointercancel", up);
      box.classList.remove("dragging");
      node.classList.remove("drag");
      const after = parts();
      if (after.some((n, i) => n !== before[i])) onDrop(after);
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
  });
}

/** Ручка ⠿: клик по ней не должен раскрывать карточку. */
export function grip(cls, title) {
  const g = document.createElement("span");
  g.className = "trp-grip " + cls;
  g.textContent = "⠿";
  g.title = title;
  g.addEventListener("click", e => e.stopPropagation());
  return g;
}
