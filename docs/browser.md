# Браузер и псевдо-сайты

## Браузер (`apps/browser.js`)

Окно с адресной строкой, ←/→/⟳/⌂ и 🔗 (копировать ссылку). Ходит **только** по сайтам из реестра `SITES`; неизвестный адрес — страница «Сайт недоступен».

- Адрес: `хост/путь?query`, напр. `kursk.artists/general/<tid>?page=2`. `about:home` — закладки.
- История — своя, на окно (`hist`, `pos`). `go(addr, replace)`, `step(±1)`, `reload()`.
- **Прямые ссылки:** `https://сайт/browser/<адрес>`. Сервер отдаёт на `/browser/*` обычный `index.html`, `main.js` видит путь и открывает браузер на этом адресе. Пока окно браузера активно, его адрес отражается в настоящей адресной строке (`history.replaceState`), после закрытия — `/`.
- Поэтому в `index.html` все пути абсолютные (`/style.css`, `/js/main.js`).
- Внутренние ссылки в контенте: `<a data-nav="адрес">` — перехватываются окном.

### Новый сайт

```js
const MySite = { title: "…", async render(b, parts, query) { b.paint(node); } };
SITES["my.site"] = MySite;          // + закладка в homePage()
```

`b` даёт `go`, `reload`, `paint`, `scrollEnd`, `addr`.

## Форум Kursk Artists (`kursk.artists`)

Клиент — объект `KA` в `browser.js`, сервер — `forum.py`. Аккаунт общий с чатом (вход на странице `kursk.artists/login` зовёт `/api/chat/auth`).

### Маршруты сайта

| Адрес | Страница |
|---|---|
| `kursk.artists` | Разделы |
| `kursk.artists/<раздел>` | Ветки раздела (`?page=`) |
| `kursk.artists/<раздел>/new` | Новая ветка |
| `kursk.artists/<раздел>/<tid>` | Ветка (`?page=N` / `?page=last`) |
| `kursk.artists/user/<ник>` | Профиль (свой — с редактором) |
| `kursk.artists/login?back=` | Вход / регистрация |

Разделы — словарь `SECTIONS` в `forum.py` (пока `general: "Общий"`).

### API

| Метод | Путь | Что |
|---|---|---|
| GET | `/api/forum/sections` | Разделы со счётчиками |
| GET | `/api/forum/s/{sec}?page=` | Ветки (свежие сверху) |
| GET | `/api/forum/t/{tid}?page=` | Ветка и посты |
| POST | `/api/forum/threads` | `{section, title, text}` — ветка + первый пост |
| POST | `/api/forum/t/{tid}/posts` | Ответ |
| PATCH / DELETE | `/api/forum/p/{id}` | Правка / удаление (автор; первый пост = вся ветка) |
| POST | `/api/forum/img` | JPEG ≤ 800px, ≤ 120 КБ → `{url}` для Markdown |
| GET | `/api/forum/u/{nick}` | Профиль |
| PATCH | `/api/forum/me` | `{about, city, site}` |
| POST / DELETE | `/api/forum/me/avatar` | Аватарка ≤ 256px |
| GET | `/media/f/{id}` | Картинка |

Лимиты: ветка раз в 10 мин, пост раз в 20 с, 30 картинок в сутки, склад `NOS_FORUM_STORE_CAP` (переполнение — удаляются старые картинки постов, аватарки не трогаем).

### Markdown

`md(src)` в `browser.js` — свой мини-рендер: **сначала экранирует весь текст**, потом размечает. Поддержка: заголовки `#..###`, `**жирный**`, `*курсив*`, `~~зачёркнутый~~`, `` `код` ``, блоки ```` ``` ````, `>` цитаты, списки, `---`, ссылки и автоссылки.
Картинки — только с `/media/...` (чужие адреса не грузим). Ссылки на `kursk.artists/…` и `…/browser/…` нашего сайта открываются внутри браузера.
Редактор `mdEditor()` — панель кнопок, загрузка картинки (вставляет `![картинка](/media/f/…)`), превью.
