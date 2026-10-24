import { el, store } from "../../core/util.js";
import { VFS } from "../../core/vfs.js";
import { notify } from "../../ui/notify.js";
import { WM } from "../../wm.js";
import { Engine, newProject } from "./engine.js";
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
  dock() {
    if (this._dock?.node.isConnected) return this._dock;
    const list = el("div", { className: "dw-dock-list" });
    const play = el("button", { className: "dw-dock-btn", title: "Пуск / стоп", onclick: () => Engine.toggle() });
    const pos = el("span", { className: "dw-dock-pos", textContent: "1:1" });
    const allMin = el("button", { className: "dw-dock-btn", textContent: "▁", title: "Свернуть все окна DAWN", onclick: () => { for (const w of this.wins.values()) if (!w.minimized) WM.minimize(w); } });
    const allUp = el("button", { className: "dw-dock-btn", textContent: "▣", title: "Показать все окна DAWN", onclick: () => { for (const w of this.wins.values()) WM.restore(w); } });
    const node = el("div", { className: "dw-dock glass wm-reserve-top" },
      el("span", { className: "dw-dock-logo", textContent: "🌸 DAWN" }), play, pos, list, allUp, allMin);
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

  async save(as = false) {
    const p = Engine.project;
    p.layout = this.layoutNow();
    let path = Engine.path;
    if (!path || as) {
      const name = prompt("Сохранить проект как:", p.name || "Мой трек");
      if (!name) return;
      p.name = name.replace(/[/\\\x00]/g, "").trim() || "Мой трек";
      path = "/home/nikita/Desktop/" + p.name + ".dawn";
    }
    try {
      await VFS.remove([path]).catch(() => {});        // upload не перезаписывает файл с тем же именем
      await VFS.writeFile(path, Engine.serialize(), "application/json");
      Engine.path = path; Engine.dirty = false;
      try { localStorage.removeItem(AUTOSAVE); } catch {}
      this.retitle();
      notify("Сохранено: " + path.split("/").pop() + " — файл только у вас в браузере");
    } catch (e) { notify("⚠ Не сохранилось: " + e.message); }
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
  Dawn.start(newProject(), null);
}
