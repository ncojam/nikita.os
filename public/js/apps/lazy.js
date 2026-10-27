import { notify } from "../ui/notify.js";

/* ================= ленивая загрузка приложений =================
 * Оболочка ОС (рабочий стол, окна, панель, плеер) грузится сразу, а код приложения — при первом открытии.
 * Каждая функция ниже — та же, что экспортирует приложение, но сначала подгружает его модуль (один раз,
 * дальше браузер берёт из кэша). Если загрузка дольше 300 мс — «Загрузка…», чтобы клик не казался потерянным.
 * Новое приложение: добавь строку сюда и импортируй отсюда, а не из apps/<app>.js напрямую.
 */
const cache = new Map();
function load(path) {
  if (!cache.has(path)) {
    const t = setTimeout(() => notify("Загрузка…", 1200), 300);
    cache.set(path, import(path).finally(() => clearTimeout(t)).catch(e => { cache.delete(path); notify("⚠ Не загрузилось: " + e.message); throw e; }));
  }
  return cache.get(path);
}
const lazy = (path, name) => async (...a) => (await load(path))[name](...a);
export const preload = path => load(path);

export const openExplorer = lazy("./explorer.js", "openExplorer");
export const pickFolder = lazy("./explorer.js", "pickFolder");
export const openSettings = lazy("./settings.js", "openSettings");
export const openBrowser = lazy("./browser.js", "openBrowser");
export const openChat = lazy("./chat.js", "openChat");
export const openFakeDL = lazy("./fakedl.js", "openFakeDL");
export const openPost = lazy("./post.js", "openPost");
export const createPost = lazy("./post.js", "createPost");
export const reportPostByPath = lazy("./post.js", "reportPostByPath");
export const openAirHockey = lazy("./airhockey.js", "openAirHockey");
export const openDawn = lazy("./dawn/index.js", "openDawn");
export const openFinds = lazy("./finds.js", "openFinds");
