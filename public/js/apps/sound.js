import { AudioOS } from "../core/audio.js";
import { Bus } from "../core/bus.js";
import { el } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { pickGrid } from "../ui/grid.js";
import { WM } from "../wm.js";

/* ================= Звук: коммутация и микшер ОС =================
 * Сверху — коммутация: слева источники (плеер, деки пульта…), в середине обработка (педали), справа микшер ОС.
 * Тяни от ● выхода к ● входу — кабель; клик по кабелю — вынуть. Узел, которого сейчас нет (окно закрыто),
 * показан бледным — его кабели сохранены и оживут, когда он появится.
 * Снизу — микшер ОС: полоса на каждый кабель в микшер (громкость, выкл, индикатор) и мастер.
 * Все ползунки — цели проводков (LFO на громкость деки — и т. п.).
 */
export async function openSound(focus = "patch") {
  const { Player } = await import("./player.js");
  Player.initGraph();   // плеер — всегда в коммутации, даже если ещё не играл
  if (Bus.rig.pedals.length) (await import("./rig/pedalboard.js")).Pedalboard.boot();
  return WM.open({ title: "Звук", icon: "🔊", key: "sound", width: 860, height: 600, render(c, w) {
    const patch = el("div", { className: "snd-patch" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("snd-wires");
    const cols = el("div", { className: "snd-cols" });
    patch.append(svg, cols);
    const mixer = el("div", { className: "snd-mixer" });
    const bar = el("div", { className: "snd-bar" },
      el("button", { className: "btn small", textContent: "＋ Педаль", onclick: e => addPedal(e.currentTarget) }),
      el("button", { className: "btn small", textContent: "🎛 Педали", onclick: () => import("./rig/index.js").then(m => m.openRig("pedals")) }),
      el("button", { className: "btn small", textContent: "🎧 Пульт", onclick: () => import("./dj.js").then(m => m.openDJ()) }),
      el("span", { className: "snd-hint", textContent: "Тяни от ● выхода к ● входу. Клик по кабелю — вынуть." }));
    c.append(el("div", { className: "sound" }, bar, patch, el("div", { className: "snd-mix-title", textContent: "🎚 Микшер ОС" }), mixer));

    /* ---------- коммутация ---------- */
    const jacks = new Map();   // "out:id" | "in:id" → элемент
    function nodesView() {
      const live = [...AudioOS.nodes.values()];
      const ghosts = new Set();
      for (const r of AudioOS.routes) for (const id of [r.from, r.to]) if (!AudioOS.nodes.has(id)) ghosts.add(id);
      const all = [...live, ...[...ghosts].map(id => ({ id, ghost: true, kind: id.startsWith("pedal:") ? "fx" : id === "mixer" ? "sink" : "source",
        title: id.startsWith("pedal:") ? "Педаль (нет)" : id.startsWith("dj.") ? `Дека ${id.slice(3).toUpperCase()} (пульт закрыт)` : id, icon: "◌" }))];
      return { source: all.filter(n => n.kind === "source"), fx: all.filter(n => n.kind === "fx"), sink: all.filter(n => n.kind === "sink") };
    }
    function drawNodes() {
      jacks.clear();
      const v = nodesView();
      const box = n => {
        const hasIn = n.kind !== "source", hasOut = n.kind !== "sink";
        const jin = hasIn ? el("span", { className: "snd-jack in", title: "Вход" }) : null;
        const jout = hasOut ? el("span", { className: "snd-jack out", title: "Выход: тяни кабель" }) : null;
        if (jin) { jin.dataset.id = n.id; jacks.set("in:" + n.id, jin); }
        if (jout) { jout.dataset.id = n.id; jacks.set("out:" + n.id, jout); jout.onpointerdown = e => startDrag(e, n.id); }
        return el("div", { className: "snd-node" + (n.ghost ? " ghost" : ""), title: n.id }, jin || el("span", { className: "snd-jack none" }),
          el("span", { className: "snd-name", textContent: `${n.icon || ""} ${n.title}` }), jout || el("span", { className: "snd-jack none" }));
      };
      cols.replaceChildren(
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Источники" }), ...v.source.map(box)),
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Обработка" }),
          ...(v.fx.length ? v.fx.map(box) : [el("div", { className: "snd-empty", textContent: "Педалей нет — «＋ Педаль»" })])),
        el("div", { className: "snd-col" }, el("div", { className: "snd-col-h", textContent: "Выход" }), ...v.sink.map(box)));
      requestAnimationFrame(drawWires);
    }
    const center = j => { const r = j.getBoundingClientRect(), p = patch.getBoundingClientRect(); return [r.left + r.width / 2 - p.left, r.top + r.height / 2 - p.top]; };
    const curve = ([x1, y1], [x2, y2]) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };
    let temp = null;
    function drawWires() {
      if (!patch.isConnected) return;
      svg.setAttribute("width", patch.scrollWidth); svg.setAttribute("height", patch.scrollHeight);
      svg.replaceChildren();
      for (const r of AudioOS.routes) {
        const a = jacks.get("out:" + r.from), b = jacks.get("in:" + r.to);
        if (!a || !b) continue;
        const live = AudioOS.nodes.has(r.from) && AudioOS.nodes.has(r.to);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", curve(center(a), center(b)));
        path.setAttribute("class", "snd-cable" + (live ? "" : " ghost"));
        path.onclick = () => { AudioOS.disconnect(r.from, r.to); notify(`🔌 Кабель вынут: ${AudioOS.title(r.from)} → ${AudioOS.title(r.to)}`); };
        path.append(Object.assign(document.createElementNS("http://www.w3.org/2000/svg", "title"), { textContent: `${AudioOS.title(r.from)} → ${AudioOS.title(r.to)} (клик — вынуть)` }));
        svg.append(path);
      }
      if (temp) svg.append(temp);
    }
    function startDrag(e, from) {
      e.preventDefault(); e.stopPropagation();
      const a = center(e.currentTarget);
      temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
      temp.setAttribute("class", "snd-cable temp");
      const move = ev => { const p = patch.getBoundingClientRect(); temp.setAttribute("d", curve(a, [ev.clientX - p.left, ev.clientY - p.top])); };
      const up = ev => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", up);
        temp = null; drawWires();
        const to = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".snd-jack.in")?.dataset.id;
        if (!to) return;
        try { if (AudioOS.connect(from, to)) notify(`🔌 ${AudioOS.title(from)} → ${AudioOS.title(to)}`); }
        catch (err) { notify("⚠ " + err.message); }
      };
      addEventListener("pointermove", move); addEventListener("pointerup", up);
      move(e);
    }
    async function addPedal(anchor) {
      const { RIG_FX, newPedal, Pedalboard } = await import("./rig/pedalboard.js");
      const { FX } = await import("./dawn/fx.js");
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
    const ro = new ResizeObserver(() => drawWires()); ro.observe(patch);
    patch.addEventListener("scroll", drawWires);
    w.onClose = () => { off(); ro.disconnect(); cancelAnimationFrame(raf); };
    w.cmd = () => AudioOS.routes.map(r => `audio.route ${r.from} ${r.to}`).join("\n") + "\napp sound";
    if (focus === "mixer") requestAnimationFrame(() => mixer.scrollIntoView({ block: "nearest" }));
  } });
}
