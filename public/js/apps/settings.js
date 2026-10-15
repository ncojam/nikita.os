import { pickFolder } from "./explorer.js";
import { el, fmtSize, fsUrl, joinPath } from "../core/util.js";
import { VFS } from "../core/vfs.js";
import { IMAGE_EXT, Wallpaper } from "../ui/wallpaper.js";
import { WM } from "../wm.js";

/* ================= настройки ================= */
function openSettings() {
  WM.open({ title: "Настройки", icon: "⚙️", width: 660, height: 640, key: "settings", async render(c, w) {
    const tiles = el("div", { className: "wp-grid" });
    const dim = el("input", { type: "range", min: 0, max: 0.8, step: 0.05, value: Wallpaper.dim });
    const dimVal = el("span", { textContent: Math.round(Wallpaper.dim * 100) + "%" });
    const refresh = el("button", { className: "btn", textContent: "⟳ Обновить" });
    const dirBox = el("input", { type: "text", value: Wallpaper.dir, className: "path", spellcheck: false });
    const pick = el("button", { className: "btn", textContent: "📂 Выбрать…" });
    const hint = el("div", { className: "hint" });
    hint.innerHTML = "Показываются картинки (png, jpg, webp…) из выбранной папки. " +
      "Выбор сохраняется в этом браузере. Папку и фон по умолчанию для всех посетителей можно задать в <code>fs/etc/os.json</code> " +
      "(<code>wallpaperDir</code>, <code>wallpaper</code>).";
    // окна: прилипание, зазор, поля раскладки
    const snap = el("input", { type: "checkbox", checked: WM.cfg.snap });
    const num = (key, max) => {
      const range = el("input", { type: "range", min: 0, max, step: 1, value: WM.cfg[key] });
      const box = el("input", { type: "number", min: 0, max, value: WM.cfg[key], className: "num" });
      const set = v => {
        v = Math.max(0, Math.min(max, Math.round(+v || 0)));
        range.value = box.value = v; WM.setCfg(key, v);
      };
      range.oninput = () => set(range.value);
      box.onchange = () => set(box.value);
      return [range, box, el("span", { textContent: "px" })];
    };
    snap.onchange = () => WM.setCfg("snap", snap.checked);
    const vfsInfo = el("span", { className: "lbl", textContent: "…" });
    const vfsReset = el("button", { className: "btn", textContent: "↺ Сбросить пользовательский слой" });
    const tryArrange = el("button", { className: "btn", textContent: "▦ Разложить окна сейчас", onclick: () => WM.arrange() });

    c.append(el("div", { className: "settings" },
      el("section", {}, el("h3", { textContent: "Фон рабочего стола" }),
        el("div", { className: "row dirrow" }, el("span", { className: "lbl", textContent: "Папка с обоями" }), dirBox, pick, refresh),
        tiles, hint),
      el("section", {}, el("h3", { textContent: "Затемнение картинки" }),
        el("div", { className: "row" }, dim, dimVal)),
      el("section", {}, el("h3", { textContent: "Окна" }),
        el("label", { className: "row check" }, snap,
          el("span", { textContent: "Прилипать к краям экрана и друг к другу (на расстоянии 7 px; Alt — двигать свободно)" })),
        el("div", { className: "row" }, el("span", { className: "lbl", textContent: "Расстояние между окнами" }), ...num("gap", 64)),
        el("div", { className: "row" }, el("span", { className: "lbl", textContent: "Поля при раскладке" }), ...num("margin", 120)),
        el("div", { className: "row" }, tryArrange)),
      el("section", {}, el("h3", { textContent: "Мои файлы" }),
        el("div", { className: "row" }, vfsInfo, vfsReset),
        el("div", { className: "hint", textContent: "Загруженные вами файлы, созданные папки, перемещения, удаления и расположение значков " +
          "хранятся только в этом браузере, сервер не меняется. Сброс вернёт всё как на сервере." })),
    ));
    const showUsage = async () => {
      if (!VFS.ready) { vfsInfo.textContent = "Недоступно: нужен HTTPS и поддержка Service Worker"; return; }
      const u = await VFS.usage();
      vfsInfo.textContent = u.changes ? `Изменений: ${u.changes} · своих файлов: ${u.files} (${fmtSize(u.size)})` : "Изменений нет — всё как на сервере";
    };
    vfsReset.onclick = async () => {
      if (!confirm("Сбросить пользовательский слой полностью?\nВаши файлы и папки удалятся, перемещённые и удалённые вернутся на место, значки встанут по умолчанию.")) return;
      await VFS.reset();
      showUsage();
    };
    showUsage();

    const mark = () => [...tiles.children].forEach(t => t.classList.toggle("active", t.dataset.src === Wallpaper.src));
    const tile = (src, label, thumbClass, bg) => {
      const th = el("div", { className: "thumb " + (thumbClass || "") });
      if (bg) th.style.backgroundImage = `url("${bg}")`;
      const t = el("button", { className: "wp-tile", title: src === "glow" ? label : src },
        th, el("span", { className: "cap", textContent: label }));
      t.dataset.src = src;
      t.onclick = () => { Wallpaper.apply(src, +dim.value); mark(); };
      return t;
    };
    async function load() {
      const dir = Wallpaper.dir;
      dirBox.value = dir;
      tiles.replaceChildren(tile("glow", "Чёрный с подсветкой", "thumb-glow"));
      try {
        const r = await fetch("/api/ls?path=" + encodeURIComponent(dir), { cache: "no-store" });
        const d = await r.json();
        if (!r.ok) throw new Error(r.status === 404 ? "такой папки нет — создай её или выбери другую" : d.error || r.statusText);
        const imgs = d.entries.filter(e => e.type === "file" && IMAGE_EXT.includes(e.name.split(".").pop().toLowerCase()));
        for (const e of imgs) { const p = joinPath(dir, e.name); tiles.append(tile(p, e.name, "", fsUrl(p))); }
        if (!imgs.length) tiles.append(el("div", { className: "hint empty-wp", textContent: "В этой папке пока нет картинок" }));
      } catch (e) {
        tiles.append(el("div", { className: "hint empty-wp", textContent: `${dir}: ${e.message}` }));
      }
      mark();
    }
    const setDir = p => { if (!p) return; p = "/" + p.trim().replace(/^\/+|\/+$/g, ""); Wallpaper.dir = p; load(); };
    dirBox.onchange = () => setDir(dirBox.value);
    dirBox.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); setDir(dirBox.value); } };
    pick.onclick = async () => setDir(await pickFolder(Wallpaper.dir, "Папка с обоями"));
    dim.oninput = () => { dimVal.textContent = Math.round(dim.value * 100) + "%"; Wallpaper.apply(Wallpaper.src, +dim.value); };
    refresh.onclick = load;
    load();
  }});
}

export { openSettings };
