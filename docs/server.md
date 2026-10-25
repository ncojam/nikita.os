# Сервер

Один процесс aiohttp. Каждый модуль — класс со своим хранилищем и методом `routes(app)` (или маршрутами в `make_app`).

## Модули

| Файл | Класс | Хранилище | О чём |
|---|---|---|---|
| `server.py` | — , `Plays` | `NOS_DATA/plays.json` | Статика, сшитая ФС, прослушивания, сборка приложения, заголовки |
| `chat.py` | `Chat`, `ChatDB` | `NOS_DATA/chat.db` (SQLite, WAL) | Аккаунты, сессии, общий чат, WS, сигнализация WebRTC, комменты |
| `posts.py` | `Posts` | `ufs/.meta/posts.json`, `.meta/media/` | Записи «.запись», картинки, жалобы |
| `userfs.py` | `Folders` | `ufs/folders.json` + реальные каталоги в `ufs/` | Общие пользовательские папки |
| `forum.py` | `Forum` | `ufs/.meta/forum.json`, `.meta/forum_media/` | Форум Kursk Artists |
| `airhockey.py` | `AirHockey` | `NOS_DATA` (таблица рекордов) | Арена «Джус» |
| `dawnstore.py` | `Projects`, `Visits` | файлы `.dawn` в `ufs/` + `ufs/.meta/projects.json`; `NOS_DATA/visits.json` | Общие проекты DAWN (до 10 на аккаунт, ≤ 2 МБ), счётчик посещений |

## Эндпоинты

| Метод | Путь | Модуль | Что |
|---|---|---|---|
| GET | `/api/ls?path=` | server | Содержимое папки (fs + ufs + записи), у аудио `plays` |
| GET | `/api/entry?path=` | server | Есть ли путь, файл/папка (не `/api/stat` — режут блокировщики) |
| GET | `/api/find?ext=` | server | Поиск файлов по расширению |
| POST | `/api/listen?path=` | server | +1 прослушивание (1 раз с IP за 30 мин) |
| GET | `/fs/{path}` | server | Файл: канон → ufs → JSON виртуальной записи. `.br/.gz` отдаются с `Content-Encoding` (Unity) |
| GET | `/grab/{name}` | server | «Бесконечная загрузка» для fakedl |
| GET | `/browser/...`, `/dawn/...` | server | `index.html` — прямые ссылки в браузер ОС и в DAWN (`/dawn/<путь к .dawn>`) |
| POST | `/api/dawn/save` `{dir, name, data}` | dawnstore | Сохранить проект в папку (нужен вход; своё — перезаписывается) |
| POST | `/api/dawn/delete` `{path}` | dawnstore | Удалить свой проект |
| GET | `/api/dawn/mine` | dawnstore | Кто я, мои проекты, лимиты |
| POST | `/api/visit` `{app, id, hit}` | dawnstore | Счётчик: `hit` — засчитать открытие; ответ `{total, unique}` (id хранится хэшем) |
| POST | `/api/chat/auth`, `/api/chat/logout` | chat | Вход/регистрация, выход |
| GET | `/api/chat/me`, `/api/chat/history`, `/api/chat/comments` | chat | Кто я, история, комменты комнаты |
| WS | `/api/chat/ws` | chat | Общий чат, онлайн, P2P-сигналы, комнаты комментов |
| POST/GET/PATCH/DELETE | `/api/posts`, `/api/posts/{id}` | posts | Создать / прочитать / текст / удалить запись |
| POST/DELETE | `/api/posts/{id}/image` | posts | Картинка записи |
| POST | `/api/posts/{id}/report` | posts | Жалоба (2 разных → картинка скрыта) |
| GET | `/media/{id}` | posts | Картинка записи |
| POST | `/api/folders`, `/api/folders/delete` | userfs | Общие папки |
| GET/POST | `/api/mod/reports`, `/api/mod/show/{id}?token=` | posts | Модерация, только с `NOS_ADMIN_TOKEN` (без него — 404) |
| * | `/api/forum/...`, `/media/f/{id}` | forum | См. [browser.md](browser.md) |
| * | маршруты `AirHockey.routes` | airhockey | WS арены, таблица рекордов |

## Пути и безопасность

- `resolve_inside(root, rel)` — **единственный** способ превратить путь из запроса в путь на диске: запрещает выход за корень (с учётом симлинков) и любые части, начинающиеся с точки.
- Поэтому всё служебное лежит в `.meta/` — его невозможно скачать через `/fs`.
- `client_ip()` берёт `X-Forwarded-For` только при `TRUST_PROXY=1`.
- `client_max_size = 2,5 МБ` — под проект DAWN (≤ 2 МБ) и сжатые картинки записей; лимиты модулей строже.
- Аккаунт один на всё: чат, форум, Джус, общие папки, записи, проекты DAWN — `chat.user_by_token`.
