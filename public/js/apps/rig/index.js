import { AudioOS } from "../../core/audio.js";
import { Bus } from "../../core/bus.js";
import { el } from "../../core/util.js";
import "../../i18n/dawn.js";
import { notify } from "../../ui/notify.js";
import { WM } from "../../wm.js";
import { pedalLine, rigScript } from "../../core/cmd.js";
import { MODS } from "../dawn/mod.js";
import { applyTheme, dwBtn, knob, led, select, shell } from "../dawn/ui.js";
import { FX, Pedalboard, RIG_FX, newPedal, portsOf } from "./pedalboard.js";
import { auJack } from "../../core/aucables.js";

/* ================= Системная стойка: окна «Автоматизация», «Генераторы», «Педали» =================
 * Открываются из Пуска (Приложения → под DAWN) без самой DAWN. Источники и педали живут в шине ОС (core/bus.js),
 * хранятся у посетителя и работают после перезагрузки страницы.
 *
 *   openRig("auto")        — ручки, огибающие, курсор, громкость плеера
 *   openRig("gen")         — генераторы: LFO и ветер
 *   openRig("pedals")      — педалборд: все педали ОС одним окном; куда каждая стоит — кабели в «Звуке» (apps/sound.js)
 *   openRig("pedal", id)   — одна педаль своим маленьким окном: можно поставить куда угодно на экране
 *
 * Педалборд — один экземпляр (окно одно, педалей в нём сколько угодно). Любую педаль можно ⧉ вынести
 * в отдельное окно — это просто второй вид той же педали, звук не дублируется.
 * У каждого окна ⌘ даёт команду, которая соберёт такую же стойку заново (см. core/cmd.js).
 */
const KINDS = { auto: ["knob", "env", "mouse", "level"], gen: ["lfo", "wind"] };
const TITLES = { auto: "Автоматизация", gen: "Генераторы", pedals: "Педали ОС" };
const ICONS = { auto: "🔌", gen: "∿", pedals: "🎛" };

export function openRig(kind = "auto", id = null) {
  applyTheme();   // тема DAWN (светлая/тёмная) — окна стойки в том же стиле, даже если DAWN не открыт
  if (kind === "pedal") return openPedal(id);
  if (!TITLES[kind]) kind = "auto";
  const w = WM.open({ title: TITLES[kind], icon: ICONS[kind], key: "rig:" + kind,
    width: kind === "pedals" ? 620 : 560, height: 540,
    render(c, win) {
      win.node.classList.add("dw-win");
      win.node.style.setProperty("--acc", kind === "pedals" ? "#ff9ecb" : "#b8f59e");
      if (kind === "pedals") {
        const off = pedalsWindow(c);
        win.onClose = off;
        win.cmd = () => rigScript({ mods: false }) + "\nrig.open pedals";
      } else {
        const off = MODS.render(c, win, { sys: true, kinds: KINDS[kind] }, null);
        win.onClose = off;
        win.cmd = () => rigScript({ kinds: KINDS[kind], pedals: false }) + "\nrig.open " + kind;
      }
    } });
  return w;
}

/* ---------- педалборд ---------- */
function pedalsWindow(c) {
  Pedalboard.boot();
  const root = shell(c, "dw-pedals rig-pedals", "#ff9ecb");
  const hint = el("div", { className: "dw-dim dw-hint" });
  const body = el("div", { className: "dw-pedal-list" }), foot = el("div", { className: "dw-fx-add" });
  root.append(hint, body, foot);
  function build() {
    const wired = id => AudioOS.routes.some(r => r.to === "pedal:" + id) && AudioOS.routes.some(r => r.from === "pedal:" + id);
    const loose = Bus.rig.pedals.filter(p => !wired(p.id)).length;
    hint.replaceChildren(
      el("span", { textContent: (loose ? `${loose} — без кабелей: подключи вход и выход. ` : "") + "Педали стоят там, куда их подключили кабелями. Ручки — цели проводков. ⧉ — педаль отдельным окном. " }),
      dwBtn("🔀 Кабели", () => import("../sound.js").then(m => m.openSound("patch")), { title: "Коммутация звука ОС: плеер → педаль → микшер" }));
    const list = Bus.rig.pedals;
    body.replaceChildren(...(list.length ? list.map(pd => pedalCard(pd, true))
      : [el("div", { className: "dw-dim dw-empty", textContent: "Педалей нет. Добавь снизу — сколько угодно." })]));
    foot.replaceChildren(el("span", { className: "dw-dim", textContent: "＋ педаль:" }),
      ...RIG_FX.map(t => dwBtn(FX[t].icon + " " + FX[t].name, () => { Bus.rig.pedals.push(newPedal(t)); Bus.changed({ pedals: true }); })));
  }
  build();
  const offs = [Bus.on(e => { if (e.rig && !e.tick) build(); }), AudioOS.on(() => build())];
  return () => offs.forEach(f => f());
}

function openPedal(id) {
  applyTheme();
  const pd = Pedalboard.find(id);
  if (!pd) { notify("Нет такой педали: " + id); return null; }
  Pedalboard.boot();
  return WM.open({ title: `${FX[pd.type].icon} ${FX[pd.type].name}`, icon: "🎛", key: "rig:pedal:" + id, width: 360, height: 300,
    render(c, win) {
      win.node.classList.add("dw-win");
      win.node.style.setProperty("--acc", FX[pd.type].color);
      const root = shell(c, "dw-pedals rig-pedals rig-one", FX[pd.type].color);
      const draw = () => {
        const cur = Pedalboard.find(id);
        if (!cur) return WM.close(win);
        root.replaceChildren(pedalCard(cur, false));
      };
      draw();
      win.onClose = Bus.on(e => { if (e.rig && !e.tick) draw(); });
      win.cmd = () => pedalLine(Pedalboard.find(id) || pd) + "\nrig.open pedal " + id;
    } });
}

/* карточка педали: вкл, тип, порядок, своё окно, удалить; ручки — с адресами для проводков */
function pedalCard(pd, full) {
  const spec = FX[pd.type], list = Bus.rig.pedals, i = list.indexOf(pd);
  const move = d => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; Bus.changed({ pedals: true }); };
  const knobs = Object.entries(spec.params).map(([key, ps]) => {
    if (ps.kind === "text") {
      const box = el(ps.multiline ? "textarea" : "input", { className: "dw-code" + (ps.multiline ? " multi" : ""), value: pd.p[key] ?? ps.def, spellcheck: false });
      const commit = () => { pd.p[key] = box.value; Pedalboard.set(pd.id); Bus.changed({ param: true }); };
      box.onchange = commit;
      box.onkeydown = e => { e.stopPropagation(); if (e.key === "Enter" && (e.ctrlKey || !ps.multiline)) { e.preventDefault(); commit(); } };
      return el("label", { className: "dw-fx-text" }, el("span", { className: "dw-dim", textContent: ps.label }), box);
    }
    if (ps.kind) return "";
    return knob({ spec: ps, color: spec.color, path: `rig.${pd.id}.${key}`, get: () => pd.p[key],
      set: v => { pd.p[key] = v; Pedalboard.set(pd.id); }, done: () => Bus.changed({ param: true }) }).node;
  });
  return el("div", { className: "dw-fx dw-pedal", style: `--fc:${spec.color}` },
    el("div", { className: "dw-fx-head" },
      led(pd.on, () => { pd.on = !pd.on; Bus.changed({ pedals: true }); }, "Вкл/выкл", spec.color),
      el("b", { textContent: spec.icon + " " + spec.name }),
      select(RIG_FX.map(t => [t, FX[t].name]), pd.type, v => { const fresh = newPedal(v); pd.type = v; pd.p = fresh.p; Bus.changed({ pedals: true }); }, "Тип эффекта"),
      full ? dwBtn("↑", () => move(-1), { title: "Выше в списке" }) : "",
      full ? dwBtn("↓", () => move(1), { title: "Ниже в списке" }) : "",
      full ? dwBtn("⧉", () => openPedal(pd.id), { title: "Эта педаль отдельным окном" }) : "",
      dwBtn("✕", () => { Bus.rig.pedals = Bus.rig.pedals.filter(x => x !== pd); Bus.changed({ pedals: true }); }, { title: "Убрать", className: "dw-btn dw-x" })),
    jacksRow(pd),
    pd.type === "meter" ? meterView(pd) : "",
    el("div", { className: "dw-fx-knobs" }, ...knobs));
}

/* гнёзда педали: входы слева, выходы справа — тяни кабели прямо отсюда (в плеер, пульт, микшер, другие педали) */
function jacksRow(pd) {
  const { ins, outs } = portsOf(pd.type), id = "pedal:" + pd.id;
  const lab = (p, d) => p ? `${d === "in" ? "вход" : "выход"} ${p}` : d === "in" ? "вход" : "выход";
  return el("div", { className: "rig-jacks" },
    el("div", { className: "rig-jk" }, ...ins.map(p => el("span", { className: "rig-jl" }, auJack(id, "in", p), el("span", { textContent: lab(p, "in") })))),
    el("div", { className: "rig-jk out" }, ...outs.map(p => el("span", { className: "rig-jl" }, el("span", { textContent: lab(p, "out") }), auJack(id, "out", p)))));
}

/* педаль «Уровень»: цифры по полосам, обновляются сами, пока карточка на экране */
function meterView(pd) {
  const bands = [["all", "Всё"], ["low", "Низ"], ["mid", "Середина"], ["high", "Верх"]];
  const cells = bands.map(([k, t]) => { const v = el("b", { className: "no-i18n", textContent: "—" }), bar = el("i"); return [k, v, bar, el("div", { className: "rig-mt" }, el("span", { textContent: t }), v, el("div", { className: "rig-mbar" }, bar))]; });
  const box = el("div", { className: "rig-meter" }, ...cells.map(c => c[3]));
  const t = setInterval(() => {
    if (!box.isConnected) return clearInterval(t);
    for (const [k, v, bar] of cells) {
      const x = AudioOS.nodeLevel("pedal:" + pd.id, k);
      v.textContent = x > 0.0001 ? (20 * Math.log10(x)).toFixed(1) + " дБ" : "−∞";
      bar.style.width = Math.min(100, x * 100).toFixed(1) + "%";
    }
  }, 66);
  return box;
}
