// Точка входа nikita.os: подключает модули и запускает их в исходном порядке
import { init_i18n } from "./core/i18n.js";   // язык — первым: остальные модули уже видят NOS_LOCALE
import "./i18n/os.js";
import { openBrowser, openExplorer } from "./apps/lazy.js";   // приложения — лениво, при первом открытии
import "./apps/id3.js";
import { init_apps_player } from "./apps/player.js";
import "./core/anim.js";
import "./core/types.js";
import "./core/util.js";
import { init_desktop } from "./desktop.js";
import "./open.js";
import { init_remote_github } from "./remote/github.js";
import { init_ui_context_menu } from "./ui/context-menu.js";
import "./ui/icons.js";
import "./ui/notify.js";
import { init_ui_taskbar } from "./ui/taskbar.js";
import { init_ui_wallpaper } from "./ui/wallpaper.js";
import { init_ui_glow } from "./ui/glow.js";
import { init_wm } from "./wm.js";
import { init_vfs } from "./core/vfs.js";
import { init_params } from "./core/params.js";
import "./core/uiparams.js";   // любые регуляторы и окна ОС — цели для проводков

init_i18n();   // перевод интерфейса (DOM-наблюдатель) — до появления окон

// пользовательский слой fs (Service Worker) — до первых запросов к /api/ls
await init_vfs();
init_params();   // параметры ОС для модуляции (etc/params.json) — в фоне

init_wm();
init_remote_github();
init_apps_player();
init_desktop();
init_ui_taskbar();
init_ui_wallpaper();
init_ui_glow();
// Браузер начинает «родное» перетаскивание, если зацепить выделенный текст или картинку, — и тащит
// снимок всей страницы вместо окна или нот. Разрешаем его только тем, кто явно draggable="true".
document.addEventListener("dragstart", e => {
  const t = e.target;
  if (t.nodeType !== 1 || !t.closest('[draggable="true"]')) e.preventDefault();
}, true);
init_ui_context_menu();

/* стартовое окно: прямая ссылка /browser/<адрес> открывает браузер на этом адресе */
if (location.pathname === "/dawn" || location.pathname.startsWith("/dawn/")) {
  // /dawn — DAWN с демо (или черновиком); /dawn/<путь к .dawn> — открыть этот проект
  const p = decodeURIComponent(location.pathname.slice(5));
  import("./apps/dawn/index.js").then(m => m.openDawn(p && p !== "/" ? p : undefined));
}
else if (location.pathname.startsWith("/browser")) openBrowser(decodeURIComponent(location.pathname.slice(8).replace(/^\/+/, "")) + location.search);
else openExplorer("/home/nikita/Projects");
