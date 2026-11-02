import { el } from "../../core/util.js";
import { WM, wireIframe } from "../../wm.js";

/* Clown Dungeon в окне сайта: та же страница, что в Telegram. Закрыли окно — iframe исчез вместе со звуком. */
export function openDungeon() {
  return WM.open({ title: "Clown Dungeon (тест)", icon: "🤡", width: 420, height: 760, key: "dungeon", render(c, w) {
    const f = el("iframe", { className: "viewer-frame", src: "/dungeon.html?site=1", allow: "autoplay" });
    c.append(f);
    wireIframe(f, w);
  }});
}
