// Точка входа nikita.os: подключает модули и запускает их в исходном порядке
import { openExplorer } from "./apps/explorer.js";
import "./apps/id3.js";
import { init_apps_player } from "./apps/player.js";
import "./apps/settings.js";
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
import { init_wm } from "./wm.js";

init_wm();
init_remote_github();
init_apps_player();
init_desktop();
init_ui_taskbar();
init_ui_wallpaper();
init_ui_context_menu();

/* стартовое окно */
openExplorer("/home/nikita/Projects");
