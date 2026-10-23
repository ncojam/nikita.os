# Приложения

| Приложение | Файлы | Как открывается |
|---|---|---|
| Проводник | `apps/explorer.js` | `openExplorer(path, {select})`; слушает `nos-posts-changed` |
| Плеер | `apps/player.js`, `apps/id3.js` | аудиофайл; плейлист из папки, теги и обложки ID3 (cp1251 для старых русских тегов), `POST /api/listen` |
| Просмотр видео / картинок / текста | `open.js` | по типу файла |
| GBA / GB | `public/apps/gba.html`, `gba.js`, `vendor/mgba` | `.gba/.gb/.gbc` → iframe `gba.html?rom=`. Настройки `fs/etc/gba.json`, сохранения в IndexedDB. Нужны COOP/COEP |
| Flash | `public/apps/flash.html`, `vendor/ruffle` | `.swf` → iframe |
| Веб-игры (Unity и др.) | `open.js` | `index.html` → iframe; `.br/.gz` сервер отдаёт с `Content-Encoding` |
| Записи | `apps/post.js`, `apps/comments.js` | `.запись`, см. [social.md](social.md) |
| Чат | `apps/chat.js` | `app: "chat"` |
| Браузер | `apps/browser.js` | `app: "browser"` (`path` — стартовый адрес), см. [browser.md](browser.md) |
| Настройки | `apps/settings.js` | обои, окна (прилипание, зазор, поля) |
| Джус (аэро-арканоид) | `apps/airhockey.js`, `airhockey.py`, `public/tg.html` | `app: "airhockey"`; также Telegram Mini App |
| «Загрузчик» | `apps/fakedl.js`, `server.py: serve_grab` | ярлык `{app:"fakedl", file, size}` |

## Джус

Сервер авторитетный: физика ~30 тиков/с в `AirHockey.run()`, цикл спит при пустой арене. Поле 0..1, активные зоны у ворот, ширина платформ зависит от числа игроков, бот приходит к одиночке. Клиент экстраполирует мяч и рисует на частоте экрана, звуки через WebAudio с питчем. Ники — из аккаунта чата или из Telegram (`TG_BOT_TOKEN`, проверка `initData`). Лимит игроков `NOS_AIR_MAX`.

## «Загрузчик»

Окно рисует «живую» загрузку, а `/grab/<file>` отдаёт ответ с огромным `Content-Length` и капает по байту — файл честно висит в менеджере загрузок браузера. Признание спрятано за ⓘ. `"real": false` в ярлыке — без настоящей загрузки.
