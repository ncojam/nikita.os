import { Cmd } from "../core/cmd.js";
import { baseName, el, fsUrl } from "../core/util.js";
import { VFS } from "../core/vfs.js";
import { notify } from "../ui/notify.js";
import { WM } from "../wm.js";

/* ================= Скрипты (.nos) =================
 * Редактор и запуск скриптов из команд ОС (core/cmd.js). Скрипт открывает окна, ставит педали, тянет провода —
 * чтобы не собирать одно и то же руками каждый раз. Команду для любого окна даёт кнопка ⌘ в его заголовке,
 * «📸 Снимок» — команды всех открытых окон и системной стойки разом.
 * Файлы — /home/nikita/Scripts/*.nos в личном слое посетителя (VFS). Двойной клик по .nos открывает его здесь
 * (не выполняет: выполнить — кнопкой ▶).
 */
const DIR = "/home/nikita/Scripts";
const SAMPLE = `# Пример: LFO качает все окна, педаль дилея на плеере
rig.src lfo1 lfo {"name":"Качалка","lfo":{"sync":6,"shape":"sine","phase":0}}
rig.wire lfo1 win.*.tilt 0.15
rig.pedal dly delay {"mix":0.25}
rig.open gen
place 40 80 560 420
`;

export function openScripts(path = null, append = "") {
  let w = [...WM.wins.values()].find(x => x.key === "scripts");
  if (w) {
    WM.restore(w); WM.focus(w);
    if (path) w._load(path);
    if (append) w._append(append);
    return w;
  }
  w = WM.open({ title: "Скрипты", icon: "📜", key: "scripts", width: 820, height: 560, render(c, win) {
    let cur = null;   // путь открытого файла
    const name = el("input", { className: "scr-name", value: "мой скрипт", spellcheck: false, title: "Имя файла (без .nos)" });
    const ed = el("textarea", { className: "scr-ed no-i18n", spellcheck: false, value: SAMPLE });
    const log = el("div", { className: "scr-log no-i18n" });
    const files = el("div", { className: "scr-files" });
    const help = el("div", { className: "scr-help" },
      el("b", { textContent: "Команды" }),
      ...[...Cmd.list.entries()].map(([, c]) => el("div", { className: "scr-cmd" }, el("code", { className: "no-i18n", textContent: c.usage }), el("span", { textContent: c.help }))),
      el("div", { className: "dw-dim", textContent: "Слова через пробел, \"строки в кавычках\", хвост с { — JSON. # — комментарий. ⌘ в заголовке любого окна — готовая команда." }));
    ed.onkeydown = e => {
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      if (e.key === "Tab") { e.preventDefault(); ed.setRangeText("  ", ed.selectionStart, ed.selectionEnd, "end"); }
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") { e.preventDefault(); save(); }
    };
    async function run() {
      log.replaceChildren();
      const r = await Cmd.run(ed.value, (n, ok, msg) => log.append(el("div", { className: ok ? "ok" : "bad", textContent: `${ok ? "✓" : "✗"} ${n}: ${msg}` })));
      notify(r.bad ? `📜 Выполнено: ${r.ok}, ошибок: ${r.bad}` : `📜 Выполнено команд: ${r.ok}`);
    }
    async function save() {
      const n = name.value.replace(/[/\\\x00]/g, "").trim() || "скрипт";
      const file = n.endsWith(".nos") ? n : n + ".nos";
      try {
        await VFS.upload("/home/nikita", [{ file: new File([ed.value], file, { type: "text/plain" }), path: "Scripts/" + file }]);
        cur = DIR + "/" + file;
        notify("💾 " + cur + " — у вас в браузере");
        listFiles();
      } catch (e) { notify("⚠ Не сохранилось: " + e.message); }
    }
    async function load(p) {
      try {
        const r = await fetch(fsUrl(p), { cache: "no-store" });
        if (!r.ok) throw new Error("файл не найден");
        ed.value = await r.text(); cur = p; name.value = baseName(p).replace(/\.nos$/, "");
        win.setTitle("Скрипты — " + baseName(p));
      } catch (e) { notify("Не открыть скрипт: " + e.message); }
    }
    async function listFiles() {
      let items = [];
      try { const r = await fetch("/api/ls?path=" + encodeURIComponent(DIR), { cache: "no-store" }); if (r.ok) items = ((await r.json()).entries || []).filter(x => /\.nos$/i.test(x.name)); } catch {}
      files.replaceChildren(el("div", { className: "dw-dim", textContent: items.length ? "Мои скрипты" : "Сохранённых скриптов пока нет" }),
        ...items.map(x => el("button", { className: "scr-file no-i18n", textContent: "📜 " + x.name, onclick: () => load(DIR + "/" + x.name) })));
    }
    c.append(el("div", { className: "scripts" },
      el("div", { className: "scr-bar" }, name,
        el("button", { className: "btn", textContent: "▶ Выполнить", title: "Ctrl+Enter", onclick: run }),
        el("button", { className: "btn", textContent: "💾 Сохранить", title: "Ctrl+S", onclick: save }),
        el("button", { className: "btn", textContent: "📸 Снимок", title: "Вставить команды всех открытых окон и системной стойки", onclick: () => { ed.value = Cmd.snapshot() + "\n"; } }),
        el("button", { className: "btn", textContent: "✚ Новый", onclick: () => { ed.value = ""; cur = null; name.value = "мой скрипт"; win.setTitle("Скрипты"); } })),
      el("div", { className: "scr-main" }, el("div", { className: "scr-left" }, ed, log), el("div", { className: "scr-side" }, files, help))));
    win._load = load;
    win._append = text => { ed.value = (ed.value.trim() ? ed.value.replace(/\s*$/, "\n\n") : "") + text + "\n"; ed.scrollTop = ed.scrollHeight; };
    win.cmd = () => "app scripts" + (cur ? " " + JSON.stringify(cur) : "");
    if (path) load(path);
    if (append) { ed.value = ""; win._append(append); }
    listFiles();
  } });
  return w;
}
