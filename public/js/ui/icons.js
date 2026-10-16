import { el, fsUrl, px } from "../core/util.js";
import { WM } from "../wm.js";

// иконка: эмодзи или путь к картинке в fs ("/home/nikita/icons/x.png")
function setGlyph(box, icon) {
  if (typeof icon === "string" && icon.startsWith("/")) {
    const img = el("img", { src: fsUrl(icon), alt: "", draggable: false });
    img.onerror = () => { box.textContent = "❔"; };
    box.replaceChildren(img);
  } else box.textContent = icon || "📦";
}

function makeIcon(glyph, label, onOpen, meta = null) {
  const g = el("div", { className: "glyph" });
  setGlyph(g, glyph);
  const ic = el("div", { className: "icon" }, g, el("div", { className: "label", textContent: label }));
  ic.meta = meta;
  // свои (не серверные) иконки можно таскать между папками — см. ui/fs-dnd.js
  if (meta?.path && !meta.remote && !meta.builtin) ic.draggable = true;
  if (meta?.local) { ic.classList.add("is-local"); ic.title = "Только у вас в браузере"; }
  if (meta?.ufs) { ic.classList.add("is-ufs"); ic.title = "Общая папка — видят все"; }
  ic.open = () => {
    WM.origin = { rect: ic.getBoundingClientRect(), t: performance.now() };
    onOpen();
  };
  ic.addEventListener("dblclick", ic.open);
  // на тач-устройствах одного тапа достаточно
  ic.addEventListener("pointerup", e => { if (e.pointerType === "touch") ic.open(); });
  return ic;
}

/*
 * Выделение иконок: клик, Ctrl+клик (добавить/убрать), Shift+клик (диапазон)
 * и рамка мышью по пустому месту (с Ctrl — добавляет к выделению).
 * surface — где начинается рамка, box — контейнер с иконками (может прокручиваться).
 */
function makeSelectable(surface, box, onChange = () => {}) {
  const items = () => [...box.querySelectorAll(":scope > .icon")];
  const selected = () => items().filter(i => i.classList.contains("selected"));
  const set = list => { for (const i of items()) i.classList.toggle("selected", list.includes(i)); onChange(); };
  let anchor = null;

  box.addEventListener("click", e => {
    const ic = e.target.closest(".icon");
    if (!ic || ic.parentElement !== box) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) { ic.classList.toggle("selected"); anchor = ic; onChange(); }
    else if (e.shiftKey && anchor) {
      const all = items(), a = all.indexOf(anchor), b = all.indexOf(ic);
      set(all.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else { set([ic]); anchor = ic; }
  });

  surface.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.pointerType === "touch" || e.target.closest(".icon, button, input")) return;
    const win = e.target.closest(".window");
    if (win && !win.contains(surface)) return; // клик в чужом окне поверх рабочего стола
    const additive = e.ctrlKey || e.metaKey;
    const base = additive ? new Set(selected()) : new Set();
    if (!additive) set([]);
    const r = box.getBoundingClientRect();
    const toContent = (cx, cy) => ({ x: cx - r.left + box.scrollLeft, y: cy - r.top + box.scrollTop });
    const start = toContent(e.clientX, e.clientY);
    let last = { x: e.clientX, y: e.clientY }, mq = null, raf = 0;

    const update = () => {
      const cur = toContent(last.x, last.y);
      const L = Math.min(start.x, cur.x), T = Math.min(start.y, cur.y);
      const R = Math.max(start.x, cur.x), B = Math.max(start.y, cur.y);
      if (!mq) {
        if (R - L < 4 && B - T < 4) return;
        mq = el("div", { className: "marquee" });
        document.body.append(mq);
      }
      // рисуем в экранных координатах, обрезая по видимой области контейнера
      const sl = Math.max(r.left, L - box.scrollLeft + r.left), st = Math.max(r.top, T - box.scrollTop + r.top);
      const sr = Math.min(r.right, R - box.scrollLeft + r.left), sb = Math.min(r.bottom, B - box.scrollTop + r.top);
      Object.assign(mq.style, px({ left: sl, top: st, width: Math.max(0, sr - sl), height: Math.max(0, sb - st) }));
      for (const it of items()) {
        const ir = it.getBoundingClientRect();
        const il = ir.left - r.left + box.scrollLeft, itp = ir.top - r.top + box.scrollTop;
        const hit = il < R && il + ir.width > L && itp < B && itp + ir.height > T;
        it.classList.toggle("selected", hit || base.has(it));
      }
      onChange();
    };
    // автопрокрутка, когда тянешь за край
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const edge = 28;
      let dy = 0;
      if (last.y > r.bottom - edge) dy = Math.min(24, (last.y - (r.bottom - edge)) / 2);
      else if (last.y < r.top + edge) dy = -Math.min(24, ((r.top + edge) - last.y) / 2);
      if (dy && box.scrollHeight > box.clientHeight) { box.scrollTop += dy; update(); }
    };
    const move = ev => { last = { x: ev.clientX, y: ev.clientY }; update(); };
    const up = () => {
      cancelAnimationFrame(raf);
      mq?.remove();
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    loop();
    e.preventDefault();
  });

  const api = { items, selected, select: list => { set(list); anchor = list[0] || null; }, selectAll: () => set(items()), clear: () => set([]) };
  box.sel = api; // нужно контекстному меню
  return api;
}

export { setGlyph, makeIcon, makeSelectable };
