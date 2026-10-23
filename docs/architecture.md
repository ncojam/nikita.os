# Архитектура

## Общая схема

```
браузер ──HTTP/WS──▶ aiohttp (server.py)
  │                    ├─ статика public/        (serve_public)
  │                    ├─ /fs/...  файлы         (serve_fs: fs → ufs → виртуальная запись)
  │                    ├─ /api/ls|entry|find     сшитый вид fs + ufs + записи
  │                    ├─ chat.py      Chat      аккаунты, общий чат, WS, комменты
  │                    ├─ posts.py     Posts     записи («твиты») + картинки
  │                    ├─ userfs.py    Folders   общие пользовательские папки
  │                    ├─ forum.py     Forum     форум Kursk Artists
  │                    └─ airhockey.py AirHockey арена «Джус» (WS, авторитетная физика)
  │
  └─ Service Worker (sw.js) — перехватывает /api/ls, /api/entry, /api/find, /api/listen, /fs/...
     и накладывает личный слой пользователя из IndexedDB (overlay-core.js)
```

Сервер — один процесс, всё состояние в памяти + JSON/SQLite на диске (`NOS_DATA`). Никаких внешних БД и очередей.

## Сборка серверного приложения — `server.py → make_app()`

Порядок важен — модули получают ссылки друг на друга колбэками:

1. `Plays` — счётчики прослушиваний (`plays.json`).
2. `Chat` — аккаунты; его `user_by_token(request)` — **единственный источник «кто это»** для всех модулей.
3. `Posts(user_of=chat.user_by_token)`, `Folders(..., purge_dir=posts.purge_dir)`.
4. Перекрёстные колбэки: `posts.dir_ok`, `chat.posts`, `posts.on_gone = chat.drop_comments`.
5. `AirHockey`, `Forum` — регистрируют свои маршруты через `.routes(app)`.
6. Общие маршруты; `/{tail:.*}` (статика) — **последним**.

## Запуск страницы — `public/js/main.js`

```
index.html
 ├─ <script> overlay-core.js      (общий с SW код слоя)
 └─ <script type=module> main.js
     ├─ await init_vfs()           регистрация sw.js, ждём контроль над страницей
     ├─ init_wm()                  оконный менеджер
     ├─ init_remote_github()       зеркала GitHub в проводнике
     ├─ init_apps_player()
     ├─ init_desktop()             иконки = /home/nikita/Desktop
     ├─ init_ui_taskbar(), init_ui_wallpaper(), init_ui_context_menu()
     └─ стартовое окно: /browser/<адрес> → openBrowser(адрес), иначе openExplorer(Projects)
```

`init_vfs()` идёт **до** первых запросов к `/api/ls` — иначе первые ответы придут без личного слоя.

## Кто кого вызывает (клиент)

```
desktop / explorer (двойной клик по иконке)
 └─ open.js: openFile(path) | Links.open(.lnk) | openPath(path)
     ├─ kindOf(name) (core/types.js) → тип файла
     ├─ audio → Player.open      video/image/text → WM.open(просмотрщик)
     ├─ web/rom/flash → WM.open(iframe: игра, apps/gba.html, apps/flash.html) + wireIframe
     ├─ post (.запись) → post.js openPost
     └─ .lnk → APPS[app](l) | openPath(l.open) | window.open(l.url)

все приложения
 ├─ WM.open({title, icon, width, height, key, render(c, w)})   окно
 ├─ fetch /api/ls, /fs/...      (прозрачно проходят через SW-слой)
 ├─ VFS.*                       локальные изменения ФС
 ├─ notify()                    тосты
 └─ "nos-posts-changed"         событие: в папке поменялись общие записи/папки → перерисовать
```

## Кто кого вызывает (сервер)

```
request
 ├─ chat.user_by_token(request) → (uid, nick) | None     — во всех модулях
 ├─ client_ip(request)          (X-Forwarded-For только при TRUST_PROXY=1)
 └─ api_ls → resolve_inside(FS_ROOT) + folders.real() + posts.in_dir()
    serve_fs → fs-файл | ufs-файл | posts.file_json()
    folders.delete → posts.purge_dir → chat.drop_comments
```
