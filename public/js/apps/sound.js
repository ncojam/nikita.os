import { AudioOS } from "../core/audio.js";
import { Bus } from "../core/bus.js";
import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { pickGrid } from "../ui/grid.js";
import { WM } from "../wm.js";
import { auJack } from "../core/aucables.js";

/* ================= Звук: коммутация и микшер ОС =================
 * Сверху — коммутация: слева источники (плеер, деки пульта…), в середине обработка (педали), справа микшер ОС.
 * Гнёзда те же, что в окнах самих приложений (core/aucables.js): кабель можно тянуть и здесь, и прямо
 * из плеера в педаль, из педали в микшер. Тяни от ● выхода к ● входу; клик по кабелю — вынуть. Узел, которого сейчас нет (окно закрыто),
 * показан бледным — его кабели сохранены и оживут, когда он появится.
 * Снизу — микшер ОС: полоса на каждый кабель в микшер (громкость, выкл, индикатор) и мастер.
 * Все ползунки — цели проводков (LFO на громкость деки — и т. п.).
 */
/* кабель → команда: порты через #, например audio.route pedal:p1#2 mixer */
export const routeCmd = r => `audio.route ${r.from}${r.fp ? "#" + r.fp : ""} ${r.to}${r.tp ? "#" + r.tp : ""}`;

export async function openSound(focus = "patch") {
  const { Player } = await import("./player.js");
  Player.initGraph();   // плеер — всегда в коммутации, даже если ещё не играл
  if (Bus.rig.pedals.length) (await import("./rig/pedalboard.js")).Pedalboard.boot();
  return WM.open({ title: "Звук", icon: "🔊", key: "sound", width: 860, height: 600, render(c, w) {
    const patch = el("div", { className: "snd-patch" });
    const cols = el("div", { className: "snd-cols" });
    patch.append(cols);
    const mixer = el("div", { className: "snd-mixer" });
    const bar = el("div", { className: "snd-bar" },
      el("button", { className: "btn small", textContent: "＋ Педаль", onclick: e => addPedal(e.currentTarget) }),
      el("button", { className: "btn small", textContent: "🎛 Педали", onclick: () => import("./rig/index.js").then(m => m.openRig("pedals")) }),
      el("button", { className: "btn small", textContent: "🎧 Пульт", onclick: () => import("./dj.js").then(m => m.openDJ()) }),
      el("span", { className: "snd-hint", textContent: "Тяни от ● выхода к ● входу — здесь или прямо в окнах приложений. Клик по кабелю — вынуть." }));
    c.append(el("div", { className: "sound" }, bar, patch,
      el("div", { className: "snd-mix-title" }, auJack("mixer", "in", "", "Вход микшера ОС"), el("span", { textContent: " 🎚 Микшер ОС" })), mixer));

    /* ---------- коммутация ---------- */
    function nodesView() {
      const live = [...AudioOS.nodes.values()];
      const ghosts = new Set();
      for (const r of AudioOS.routes) for (const id of [r.from, r.to]) if (!AudioOS.nodes.has(id)) ghosts.add(id);
      const all = [...live, ...[...ghosts].map(id => ({ id, ghost: true, kind: id.startsWith("pedal:") ? "fx" : id === "mixer" ? "sink" : "source",
        title: id.startsWith("pedal:") ? "Педаль (нет)" : id.startsWith("dj.") ? `Дека ${id.slice(3).toUpperCase()} (пульт закрыт)` : id, icon: "◌" }))];
      return { source: all.filter(n => n.kind === "source"), fx: all.filter(n => n.kind === "fx"), sink: all.filter(n => n.kind === "sink") };
    }
    function drawNodes() {
      const v = nodesView();
      const box = n => {
        const ins = n.ghost ? (n.kind === "source" ? [] : [""]) : AudioOS.ports(n, "in");
        const outs = n.ghost ? (n.kind === "sink" ? [] : [""]) : AudioOS.ports(n, "out");
        const col = (list, dir) => el("div", { className: "snd-jacks" }, ...list.map(p => el("span", { className: "snd-jp" }, auJack(n.id, dir, p), p ? el("small", { textContent: p }) : "")));
        return el("div", { className: "snd-node" + (n.ghost ? " ghost" : ""), title: n.id }, col(ins, "in"),
          el("span", { className: "snd-name", textContent: `${n.icon || ""} ${n.title}` }), col(outs, "out"));
      };
      cols.replaceChildren(
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Источники" }), ...v.source.map(box)),
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Обработка" }),
          ...(v.fx.length ? v.fx.map(box) : [el("div", { className: "snd-empty", textContent: "Педалей нет — «＋ Педаль»" })])),
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Выход" }), ...v.sink.map(box)));
    }
    async function addPedal(anchor) {
      const { RIG_FX, newPedal, Pedalboard, FX } = await import("./rig/pedalboard.js");
      const it = await pickGrid({ anchor, title: "Новая педаль", columns: [{ title: "Эффекты", items: RIG_FX.map(t => ({ value: t, label: FX[t].name, icon: FX[t].icon, color: FX[t].color })) }] });
      if (!it) return;
      Bus.rig.pedals.push(newPedal(it.value));
      Pedalboard.boot();
      Bus.changed({ pedals: true });
      notify("🎛 Педаль добавлена — проведи к ней кабель");
    }

    /* ---------- микшер ---------- */
    const meters = [];
    function drawMixer() {
      meters.length = 0;
      const mx = AudioOS.nodes.get("mixer");
      const strip = (label, get, set, mute, an, title) => {
        const m = el("div", { className: "snd-meter" }, el("i"));
        meters.push([m.firstChild, an]);
        const r = el("input", { type: "range", min: 0, max: 1.5, step: 0.01, value: get(), title, oninput: () => set(+r.value) });
        return el("div", { className: "snd-strip" }, el("div", { className: "snd-strip-n", textContent: label, title: label }),
          el("div", { className: "snd-fader" }, r, m),
          mute ? (() => { const b = el("button", { className: "btn small" + (mute.get() ? " on" : ""), textContent: "M", title: "Выкл", onclick: () => { mute.set(!mute.get()); b.classList.toggle("on", mute.get()); } }); return b; })() : el("span"));
      };
      const ins = AudioOS.routes.filter(r => r.to === "mixer");
      mixer.replaceChildren(
        ...ins.map(r => strip(AudioOS.title(r.from), () => AudioOS.strip(r.from).vol, v => AudioOS.setStrip(r.from, { vol: v }),
          { get: () => AudioOS.strip(r.from).mute, set: v => AudioOS.setStrip(r.from, { mute: v }) }, mx?.strips.get(r.from)?.meter, "Громкость: " + AudioOS.title(r.from))),
        ins.length ? "" : el("div", { className: "snd-empty", textContent: "В микшер ничего не подключено — тишина" }),
        strip("Мастер", () => AudioOS.mix.master, v => AudioOS.setMaster(v), null, mx?.meter, "Общая громкость ОС"));
    }
    let raf = 0;
    const tick = () => {
      for (const [bar, an] of meters) bar.style.height = Math.min(100, AudioOS.level(an) * 100).toFixed(1) + "%";
      raf = requestAnimationFrame(tick);
    };
    const redraw = () => { drawNodes(); drawMixer(); };
    redraw();
    tick();
    const off = AudioOS.on(redraw);
    w.onClose = () => { off(); cancelAnimationFrame(raf); };
    w.cmd = () => AudioOS.routes.map(routeCmd).join("\n") + "\napp sound";
    if (focus === "mixer") requestAnimationFrame(() => mixer.scrollIntoView({ block: "nearest" }));
  } });
}
