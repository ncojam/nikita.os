import { $, el, fsUrl, store } from "../core/util.js";

/* ================= обои ================= */
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

const Wallpaper = {
  cfg: { wallpaper: "/home/nikita/Wallpapers/wallpaper.jpg", dim: 0.25, wallpaperDir: "/home/nikita/Wallpapers" }, // из fs/etc/os.json
  current: null,
  // папка, из которой берутся обои (выбор посетителя важнее значения из os.json)
  get dir() { return store.get("wp.dir", this.cfg.wallpaperDir || "/home/nikita/Wallpapers"); },
  set dir(p) { store.set("wp.dir", p); },

  async init() {
    try {
      const r = await fetch("/fs/etc/os.json", { cache: "no-store" });
      if (r.ok) Object.assign(this.cfg, await r.json());
    } catch {}
    this.apply(store.get("wp.src", this.cfg.wallpaper), store.get("wp.dim", this.cfg.dim), false);
  },
  get src() { return this.current?.src ?? "glow"; },
  get dim() { return this.current?.dim ?? 0.25; },

  // src: "glow" или путь к картинке в fs
  apply(src, dim = this.dim, save = true) {
    dim = Math.min(0.8, Math.max(0, +dim || 0));
    const same = this.current && this.current.src === src;
    this.current = { src, dim };
    if (save) { store.set("wp.src", src); store.set("wp.dim", dim); }
    const box = $("#wallpaper");
    if (same) { // поменялось только затемнение — без перерисовки
      const top = box.lastElementChild;
      if (top && src !== "glow") top.style.backgroundImage = this.css(src, dim);
      return;
    }
    const layer = el("div", { className: "wp-layer" + (src === "glow" ? " wp-glow" : "") });
    if (src !== "glow") layer.style.backgroundImage = this.css(src, dim);
    const show = () => {
      box.append(layer);
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("shown")));
      // старые слои убираем после проявления нового
      setTimeout(() => { while (box.firstElementChild !== layer) box.firstElementChild.remove(); }, 700);
    };
    if (src === "glow") return show();
    const img = new Image();
    img.onload = show;
    img.onerror = () => { console.warn("Обои не загрузились:", src); if (!box.children.length) this.apply("glow", dim, false); };
    img.src = fsUrl(src);
  },
  css: (src, dim) => `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${fsUrl(src)}")`,
};

/* запуск — вызывается из main.js */
export function init_ui_wallpaper() {
  Wallpaper.init();
}

export { IMAGE_EXT, Wallpaper };
