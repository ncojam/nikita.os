import { baseName, el, fsUrl, parentOf } from "../core/util.js";
import { notify } from "../ui/notify.js";
import { Ctx } from "../ui/context-menu.js";
import { Player } from "./player.js";
import { openDawn, openExplorer } from "./lazy.js";

/* ================= карточка трека (форумы, профили NETWORK) =================
 * trackCard(path) — карточка mp3/аудио или проекта DAWN; hydrateTracks(root) — оживить заглушки
 * <span class="md-trk" data-path> из Markdown ([[track:/путь]]).
 *   аудио  → ▶ открывает наш плеер маленьким окошком в правом верхнем углу (Player.open(path, {mini: true}));
 *   .dawn  → ▶ играет прямо в карточке мини-плеером DAWN (окна DAWN не открываем — не грузим обзор),
 *            🌸 — открыть в DAWN, 📂 — показать файл в проводнике. То же — в контекстном меню (ПКМ или ⋯).
 */
let mini = null;                                   // мини-плеер DAWN грузим, только когда нажали ▶ у проекта
const loadMini = async () => (mini ||= (await import("./dawn/miniplayer.js")).DawnMini);

const isDawn = p => /\.dawn$/i.test(p);
const nameOf = p => baseName(p).replace(/\.[^.]+$/, "");

function showInFs(path) { openExplorer(parentOf(path), { select: baseName(path) }); }

function menuFor(path, play) {
  return isDawn(path) ? [
    { icon: "▶", label: "Играть здесь", run: play, bold: true },
    { icon: "🌸", label: "Открыть в DAWN", run: () => openDawn(path) },
    { icon: "📂", label: "Показать в ФС", run: () => showInFs(path) },
  ] : [
    { icon: "▶", label: "Играть в плеере", run: play, bold: true },
    { icon: "📂", label: "Показать в ФС", run: () => showInFs(path) },
    "-",
    { icon: "⬇", label: "Скачать", run: () => { const a = el("a", { href: fsUrl(path), download: baseName(path) }); a.click(); } },
  ];
}

export function trackCard(path, { onRemove = null } = {}) {
  const dawn = isDawn(path);
  const playB = el("button", { className: "trk-play", title: dawn ? "Играть (без открытия DAWN)" : "Играть в плеере", textContent: "▶" });
  const bar = el("div", { className: "trk-bar" }, el("i"));
  const more = el("button", { className: "trk-btn", title: "Ещё", textContent: "⋯" });
  const card = el("div", { className: "trk" + (dawn ? " dawn" : ""), title: path },
    playB,
    el("div", { className: "trk-meta" },
      el("b", { textContent: nameOf(path) }),
      el("small", { textContent: dawn ? "🌸 проект DAWN" : "🎵 " + baseName(path).split(".").pop().toUpperCase() }),
      dawn ? bar : ""),
    dawn ? el("button", { className: "trk-btn", title: "Открыть в DAWN", textContent: "🌸", onclick: () => openDawn(path) }) : "",
    el("button", { className: "trk-btn", title: "Показать в ФС", textContent: "📂", onclick: () => showInFs(path) }),
    more,
    onRemove ? el("button", { className: "trk-btn trk-x", title: "Убрать", textContent: "✕", onclick: onRemove }) : "");

  let off = null;
  const play = async () => {
    if (!dawn) return Player.open(path, { mini: true });
    try {
      const m = await loadMini();
      if (!off) off = m.on(d => {
        if (!card.isConnected) { off(); off = null; return; }
        const mine = d.path === path;
        card.classList.toggle("playing", mine && d.playing);
        card.classList.toggle("loading", mine && !d.playing && m.path === path && !m.G);
        playB.textContent = mine && d.playing ? "■" : "▶";
        bar.firstChild.style.width = mine && d.len ? (d.pos / d.len * 100).toFixed(1) + "%" : "0";
      });
      Player.audio.pause();                     // два трека разом — каша
      await m.toggle(path);
    } catch (e) { notify("Проект не играет: " + e.message); card.classList.remove("loading"); }
  };
  playB.onclick = play;
  const menu = e => { e.preventDefault(); e.stopPropagation(); const r = e.type === "click" ? more.getBoundingClientRect() : null;
    Ctx.show(r ? r.left : e.clientX, r ? r.bottom + 4 : e.clientY, menuFor(path, play)); };
  more.onclick = menu;
  card.addEventListener("contextmenu", menu);
  return card;
}

export function hydrateTracks(root) {
  for (const s of root.querySelectorAll(".md-trk")) {
    const p = s.dataset.path;
    if (p) s.replaceWith(trackCard(p));
  }
}
