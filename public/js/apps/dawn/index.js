import { el, store } from "../../core/util.js";
import { t } from "../../core/i18n.js";
import "../../i18n/dawn.js";   // языковой пакет DAWN
import { VFS } from "../../core/vfs.js";
import { notify } from "../../ui/notify.js";
import { WM } from "../../wm.js";
import { Engine, demoProject } from "./engine.js";
import { fromFile } from "./format.js";
import { applyTheme } from "./ui.js";
import { MODULES } from "./windows.js";
import { Mod } from "./mod.js";

/* ================= DAWN — хаб =================
 * У приложения нет «главного окна» с вкладками: каждый модуль — отдельное окно ОС.
 * Транспорт — хаб: из него открываются остальные модули; закрыли транспорт — закрылся проект.
 * Dawn.open(имя, арг) открывает (или поднимает) окно модуля. Раскладка окон сохраняется в проекте.
 */
const AUTOSAVE = "dawn.autosave";

export const Dawn = {
  wins: new Map(),          // ключ модуля -> окно WM
  pianoCh: null,            // какой канал показывает пиано ролл
  mixSel: 0,                // какой инсерт выбран в микшере
  unsub: [],

  /* ключ окна: "rack", "piano", "browser", "inst:<id>" */
  open(name, arg) {
    const key = arg ? `${name}:${arg}` : name;
    const have = this.wins.get(key);
    if (have) { WM.restore(have); WM.focus(have); return have; }
    const m = MODULES[name];
    if (!m) return null;
    const def = m.size(arg);
    const w = WM.open({ title: m.title(arg), icon: m.icon, width: def[0], height: def[1], key: "dawn:" + key, taskList: this.dock().list,
      render: (c, win) => {
        const cleanup = m.render(c, win, arg, this) || (() => {});
        win.onKey = e => this.key(e);
        win.onClose = () => {
          cleanup();
          this.wins.delete(key);
          if (name === "transport") this.shutdown();
        };
      } });
    this.wins.set(key, w);
    // окно целиком в цвете модуля (в светлой теме — заливка, в тёмной — акцент)
    const col = typeof m.color === "function" ? m.color(arg) : m.color;
    w.node.classList.add("dw-win");
    if (col) w.node.style.setProperty("--acc", col);
    const lay = Engine.project.layout?.[key];
    const top0 = WM.reservedTop();   // под доком DAWN
    if (lay) Object.assign(w.node.style, { left: lay[0] + "px", top: Math.max(top0 + 6, lay[1]) + "px", width: lay[2] + "px", height: lay[3] + "px" });
    else if (def[2] != null) Object.assign(w.node.style, { left: def[2] + "px", top: (def[3] + top0) + "px" });
    return w;
  },
  close(name, arg) {
    const w = this.wins.get(arg ? `${name}:${arg}` : name);
    if (w) WM.close(w);
  },

  /* ---------- своя панель задач: окна DAWN живут не на панели ОС, а в доке сверху ---------- */
  _dock: null,
  /* неприметный счётчик: уникальные посетители · все открытия (засчитывается раз на запуск DAWN) */
  visits() {
    const s = el("span", { className: "dw-visits no-i18n", title: "" });
    let id = store.get("visitor", null);
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("visitor", id); }
    const hit = !this._counted; this._counted = true;
    fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "dawn", id, hit }) })
      .then(r => r.json()).then(d => { if (d.total == null) return; s.textContent = `👁 ${d.unique} · ${d.total}`; s.title = t("Уникальных посетителей: {0} · открытий DAWN: {1}", d.unique, d.total); })
      .catch(() => {});
    return s;
  },
  dock() {
    if (this._dock?.node.isConnected) return this._dock;
    const list = el("div", { className: "dw-dock-list" });
    const play = el("button", { className: "dw-dock-btn", title: "Пуск / стоп", onclick: () => Engine.toggle() });
    const pos = el("span", { className: "dw-dock-pos", textContent: "1:1" });
    const allMin = el("button", { className: "dw-dock-btn", textContent: "▁", title: "Свернуть все окна DAWN", onclick: () => { for (const w of this.wins.values()) if (!w.minimized) WM.minimize(w); } });
    const allUp = el("button", { className: "dw-dock-btn", textContent: "▣", title: "Показать все окна DAWN", onclick: () => { for (const w of this.wins.values()) WM.restore(w); } });
    const node = el("div", { className: "dw-dock glass wm-reserve-top" },
      el("span", { className: "dw-dock-logo", textContent: "🌸 DAWN" }), play, pos, list, allUp, allMin, this.visits());
    document.body.append(node);
    let raf = 0;
    const tick = () => {
      if (!node.isConnected) return;
      play.textContent = Engine.playing ? "■" : "▶";
      play.classList.toggle("on", Engine.playing);
      const st = Engine.project ? Engine.position() : -1;
      pos.textContent = st >= 0 ? `${Math.floor(st / 4) + 1}:${Math.floor(st % 4) + 1}` : "—";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    this._dock = { node, list, stop: () => cancelAnimationFrame(raf) };
    return this._dock;
  },

  /* общие клавиши во всех окнах DAWN */
  key(e) {
    if (e.code === "Space" && !e.repeat) { e.preventDefault(); Engine.toggle(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); this.save(e.shiftKey); }
  },

  /* ---------- проект ---------- */
  start(project, path) {
    applyTheme();
    Engine.init();
    Engine.load(project, path);
    Mod.start();
    this.pianoCh = Engine.project.channels.find(c => c.type === "osc3")?.id || Engine.project.channels[0]?.id || null;
    this.unsub.push(Engine.on("change", () => this.autosave()));
    const open = Object.keys(Engine.project.layout || {}).filter(k => Engine.project.layout[k][4]);
    this.open("transport");
    // по умолчанию — транспорт, стойка и пиано ролл; если в проекте сохранена раскладка — она
    for (const k of open.length ? open : ["rack", "piano", "playlist"]) {
      if (k === "transport") continue;
      const [n, a] = k.split(":");
      if (n === "inst" && !Engine.chan(a)) continue;
      this.open(n, a);
    }
  },

  layoutNow() {
    const lay = {};
    for (const [k, w] of this.wins) {
      const s = w.node.style;
      lay[k] = [parseFloat(s.left) || 0, parseFloat(s.top) || 0, parseFloat(s.width) || 400, parseFloat(s.height) || 300, 1];
    }
    return lay;
  },

  /* Сохранение. Вошёл через чат — проект ложится на сервер в выбранную папку (виден всем, до 10 штук, ≤ 2 МБ).
   * Не вошёл — файл только в браузере (пользовательский слой) и плашка-памятка про регистрацию. */
  async me() {
    try { const r = await fetch("/api/dawn/mine", { cache: "no-store" }); return await r.json(); } catch { return { user: null }; }
  },
  async save(as = false) {
    const p = Engine.project;
    p.layout = this.layoutNow();
    const me = await this.me();
    let path = Engine.path;
    const dirOf = x => x.slice(0, x.lastIndexOf("/")) || "/";
    if (!path || as || (me.user && !me.projects.some(x => x.path === path))) {   // свой серверный проект — пересохраняем молча
      const name = prompt("Сохранить проект как:", p.name || "Мой трек");
      if (!name) return;
      p.name = name.replace(/[/\\\x00]/g, "").trim() || "Мой трек";
      let dir = path ? dirOf(path) : "/home/nikita/Projects";
      if (me.user) {
        const { pickFolder } = await import("../explorer.js");
        dir = await pickFolder(dir, "Куда сохранить проект (его увидят все)");
        if (!dir) return;
      } else dir = "/home/nikita/Desktop";
      path = dir.replace(/\/$/, "") + "/" + p.name + ".dawn";
    }
    const data = Engine.serialize();
    if (me.user) {
      try {
        const r = await fetch("/api/dawn/save", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dir: dirOf(path), name: path.split("/").pop(), data }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || r.statusText);
        Engine.path = d.path; Engine.shared = true; Engine.dirty = false;
        try { localStorage.removeItem(AUTOSAVE); } catch {}
        this.retitle();
        return notify(`☁ Сохранено на сервере: ${d.path} (${me.projects.length + (me.projects.some(x => x.path === d.path) ? 0 : 1)}/${me.max})`, 3200);
      } catch (e) { notify("⚠ На сервер не сохранилось: " + e.message + " — сохраняю у вас в браузере", 4000); }
    }
    try {
      await VFS.remove([path]).catch(() => {});        // upload не перезаписывает файл с тем же именем
      await VFS.writeFile(path, data, "application/json");
      Engine.path = path; Engine.shared = false; Engine.dirty = false;
      try { localStorage.removeItem(AUTOSAVE); } catch {}
      this.retitle();
      notify("Сохранено: " + path.split("/").pop() + " — файл только у вас в браузере");
      if (!me.user) this.promo();
    } catch (e) { notify("⚠ Не сохранилось: " + e.message); }
  },
  /* памятка: с аккаунтом чата проекты сохраняются на сервере */
  promo() {
    document.querySelector(".dw-promo")?.remove();
    const n = el("div", { className: "dw-promo glass" },
      el("div", { className: "dw-promo-t", textContent: "☁ Сохраняй проекты на сервере" }),
      el("div", { textContent: "Войди в чат nikita.os (ник + пароль, регистрация в одно действие) — и до 10 проектов будут храниться на сервере в любой папке: их можно открыть с любого устройства и показать друзьям." }),
      el("div", { className: "dw-promo-b" },
        el("button", { className: "btn", textContent: "💬 Войти / зарегистрироваться", onclick: async () => { n.remove(); (await import("../chat.js")).openChat(); } }),
        el("button", { className: "btn", textContent: "Позже", onclick: () => n.remove() })));
    document.body.append(n);
    setTimeout(() => n.isConnected && n.classList.add("dw-promo-fade"), 14000);
    setTimeout(() => n.remove(), 15000);
  },

  /* автосохранение в браузер (окна закрыли без сохранения — проект не пропадёт) */
  autosaveT: 0,
  autosave() {
    this.retitle();
    clearTimeout(this.autosaveT);
    this.autosaveT = setTimeout(() => {
      if (!Engine.project || !Engine.dirty) return;
      Engine.project.layout = this.layoutNow();
      store.set(AUTOSAVE, { path: Engine.path, project: Engine.project, t: Date.now() });
    }, 800);
  },

  retitle() {
    const w = this.wins.get("transport");
    if (w) w.setTitle("DAWN — " + (Engine.project?.name || "") + (Engine.dirty ? " •" : ""));
  },

  shutdown() {
    Engine.stop();
    Mod.stop();
    if (Engine.dirty) {   // окна закрыли без сохранения — черновик уже в браузере
      Engine.project.layout = this.layoutNow();
      store.set(AUTOSAVE, { path: Engine.path, project: Engine.project, t: Date.now() });
    }
    for (const [k, w] of [...this.wins]) if (k !== "transport") WM.close(w);
    this.wins.clear();
    setTimeout(() => { if (!this.wins.size && this._dock) { this._dock.stop(); this._dock.node.remove(); this._dock = null; } }, 300);
    this.unsub.forEach(f => f()); this.unsub = [];
    Engine.project = null;
  },
};

/* открыть DAWN: без пути — новый проект (или несохранённый черновик), с путём — файл .dawn */
export async function openDawn(path) {
  if (Engine.project) {
    if (!path) return Dawn.open("transport");
    if (Engine.dirty && !confirm("В DAWN открыт несохранённый проект. Открыть другой? (черновик останется в браузере)")) return;
    store.set(AUTOSAVE, { path: Engine.path, project: Engine.project, t: Date.now() });
    for (const w of [...Dawn.wins.values()]) WM.close(w);
    await new Promise(r => setTimeout(r, 50));
  }
  if (path) {
    try {
      const r = await fetch("/fs" + path.split("/").map(encodeURIComponent).join("/"), { cache: "no-store" });
      if (!r.ok) throw new Error("файл не найден");
      return Dawn.start(fromFile(await r.text()), path);
    } catch (e) { return notify("Не открыть проект: " + e.message); }
  }
  const draft = store.get(AUTOSAVE, null);
  if (draft?.project && confirm(`Есть несохранённый проект «${draft.project.name}». Восстановить?`)) {
    try { Dawn.start(draft.project, draft.path); Engine.dirty = true; Dawn.retitle(); return; }
    catch { /* битый черновик — начнём с нуля */ }
  }
  Dawn.start(demoProject(), null);   // при открытии DAWN — демо; «✚ Новый» — пустой трек
}
