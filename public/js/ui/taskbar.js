import { openExplorer } from "../apps/explorer.js";
import { openSettings } from "../apps/settings.js";
import { D, EASE } from "../core/anim.js";
import { $ } from "../core/util.js";
import { openAbout } from "../open.js";
import { openBrowser } from "../apps/browser.js";
import { WM } from "../wm.js";

/* ================= пуск (с анимацией) ================= */
const startBtn = $("#start-btn"), startMenu = $("#start-menu");

let startAnim = null;

function toggleStart(show) {
  if (show === startBtn.classList.contains("on")) return;
  startAnim?.cancel();
  startBtn.classList.toggle("on", show);
  const b = startBtn.getBoundingClientRect();
  // меню выезжает из кнопки: прижато к её левому краю
  startMenu.style.left = Math.max(10, Math.min(b.left - 8, innerWidth - 310)) + "px";
  startMenu.style.transformOrigin = `${b.left + b.width / 2 - parseFloat(startMenu.style.left)}px 100%`;
  const hidden = { opacity: 0, transform: "translateY(16px) scale(.92)" };
  const shown = { opacity: 1, transform: "none" };
  if (show) startMenu.hidden = false;
  if (!D(1)) { startMenu.hidden = !show; return; }
  const a = startAnim = startMenu.animate(show ? [hidden, shown] : [shown, hidden],
    { duration: show ? 240 : 170, easing: EASE, fill: "forwards" });
  a.finished.then(() => {
    if (!show) startMenu.hidden = true;
    a.cancel();
    if (startAnim === a) startAnim = null;
  }, () => {});
}

/* ================= часы ================= */
function tick() {
  const d = new Date();
  $("#clock").innerHTML =
    d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + "<br>" +
    `<span style="color:var(--muted)">${d.toLocaleDateString("ru-RU")}</span>`;
}

/* ================= полный экран ================= */
const fsBtn = $("#fs-btn");

const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

const syncFs = () => {
  $("#fs-enter").toggleAttribute("hidden", isFs());
  $("#fs-exit").toggleAttribute("hidden", !isFs());
  fsBtn.title = isFs() ? "Выйти из полного экрана" : "Полный экран";
};

/* запуск — вызывается из main.js */
export function init_ui_taskbar() {
  startBtn.onclick = e => { e.stopPropagation(); toggleStart(!startBtn.classList.contains("on")); };

  document.addEventListener("pointerdown", e => {
    if (startBtn.classList.contains("on") && !startMenu.contains(e.target) && !startBtn.contains(e.target)) toggleStart(false);
  });

  startMenu.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    WM.origin = { rect: b.getBoundingClientRect(), t: performance.now() };
    if (b.dataset.open) openExplorer(b.dataset.open);
    if (b.dataset.app === "about") openAbout();
    if (b.dataset.app === "settings") openSettings();
    if (b.dataset.app === "browser") openBrowser();
    toggleStart(false);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && startBtn.classList.contains("on")) toggleStart(false);
  });

  tick();

   setInterval(tick, 10_000);

  fsBtn.onclick = async () => {
    try {
      if (isFs()) await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      else {
        const de = document.documentElement;
        await (de.requestFullscreen?.() ?? de.webkitRequestFullscreen?.());
      }
    } catch (e) { console.warn("Fullscreen:", e); }
  };

  document.addEventListener("fullscreenchange", syncFs);

  document.addEventListener("webkitfullscreenchange", syncFs);

  $("#arrange-btn").onclick = () => WM.arrange();
}

export { fsBtn };
