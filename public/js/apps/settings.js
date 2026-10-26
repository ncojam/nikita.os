import { pickFolder } from "./explorer.js";
import { el, fmtSize, fsUrl, joinPath, store } from "../core/util.js";
import { VFS } from "../core/vfs.js";
import { IMAGE_EXT, Wallpaper } from "../ui/wallpaper.js";
import { WM } from "../wm.js";
import { GLOW_SPEC, Glow } from "../ui/glow.js";
import { LANGS, lang, setLang } from "../core/i18n.js";

/* ================= настройки ================= */
/* живой фон: светяшки поверх обоев, вспышки от музыки DAWN */
/* качество: авто (само снижает, если тормозит) или вручную 1..4 */
function qualityRow() {
  const names = ["Высокое", "Среднее", "Низкое", "Очень низкое", "Экономное", "Минимальное"];
  const sel = el("select", { className: "btn", onchange: () => {
    if (sel.value === "auto") { Glow.auto = true; Glow.offered = false; Glow.setLevel(0); }
    else { Glow.auto = false; Glow.setLevel(+sel.value); }
  } }, el("option", { value: "auto", textContent: "Авто" }), ...names.map((n, i) => el("option", { value: i, textContent: n })));
  sel.value = Glow.auto ? "auto" : String(Glow.level);
  const now = el("span", { className: "lbl" });
  const upd = () => { now.textContent = Glow.auto ? "сейчас: " + names[Glow.level].toLowerCase() : ""; };
  upd(); const iv = setInterval(() => sel.isConnected ? upd() : clearInterval(iv), 1500);
  return el("div", { className: "row" }, el("span", { className: "lbl", textContent: "Качество" }), sel, now);
}
function glowSection() {
  const chk = (key, text) => { const c = el("input", { type: "checkbox", checked: Glow.cfg[key], onchange: () => Glow.set(key, c.checked) });
    return el("label", { className: "row check" }, c, el("span", { textContent: text })); };
  const slider = key => {
    const s = GLOW_SPEC[key], val = el("span", { textContent: (+Glow.cfg[key]).toFixed(s.step ? 0 : 2) });
    const r = el("input", { type: "range", min: s.min, max: s.max, step: s.step || (s.max - s.min) / 100, value: Glow.cfg[key],
      oninput: () => { Glow.set(key, +r.value); val.textContent = (+r.value).toFixed(s.step ? 0 : 2); } });
    return el("div", { className: "row" }, el("span", { className: "lbl", textContent: s.label.replace("Фон · ", "") }), r, val);
  };
  return el("section", {}, el("h3", { textContent: "Живой фон" }),
    chk("on", "Светяшки поверх обоев"),
    chk("react", "Вспыхивать от музыки в DAWN (цвет вспышки — ✦ у канала в стойке)"),
    slider("count"), slider("hue"), slider("speed"), slider("glow"), slider("size"), slider("flash"),
    qualityRow(),
    el("div", { className: "hint", textContent: "Всё это можно крутить и проводками из DAWN: цели «Живой фон» в окне Модуляция." }));
}
/* разделы: вкладки сверху, каждая показывает свои секции; последняя открытая запоминается */
function tabs(box, list) {
  const secs = [...box.children], bar = el("div", { className: "set-tabs" });
  let cur = Math.min(list.length - 1, +store.get("settings.tab", 0) || 0);
  const show = i => {
    cur = i; store.set("settings.tab", i);
    secs.forEach((s, k) => { s.hidden = !list[i].slice(1).includes(k); });
    [...bar.children].forEach((b, k) => b.classList.toggle("on", k === i));
  };
  list.forEach(([name], i) => bar.append(el("button", { className: "set-tab", textContent: name, onclick: () => show(i) })));
  show(cur);
  return el("div", { className: "set-wrap" }, bar, box);
}
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

    const box = el("div", { className: "settings" },
      el("section", {}, el("h3", { textContent: "Фон рабочего стола" }),
        el("div", { className: "row dirrow" }, el("span", { className: "lbl", textContent: "Папка с обоями" }), dirBox, pick, refresh),
        tiles, hint),
      el("section", {}, el("h3", { textContent: "Затемнение картинки" }),
        el("div", { className: "row" }, dim, dimVal)),
      glowSection(),
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
      el("section", {}, el("h3", { textContent: "Язык интерфейса" }),
        el("div", { className: "row lang-row no-i18n" }, ...LANGS.map(([code, name]) =>
          el("button", { className: "btn" + (code === lang ? " on" : ""), textContent: name, onclick: () => code !== lang && setLang(code) }))),
        el("div", { className: "hint", textContent: "Выбор сохраняется в cookie. Без него язык определяется по местоположению (часовому поясу)." })),
    );
    c.append(tabs(box, [["🖼 Обои", 0, 1], ["✨ Живой фон", 2], ["🪟 Окна", 3], ["💾 Файлы", 4], ["🌐 Язык", 5]]));
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
