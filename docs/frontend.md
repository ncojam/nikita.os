# Ядро клиента

## Утилиты (`core/`)

| Файл | Что |
|---|---|
| `util.js` | `el(tag, props, ...kids)`, `$`, пути (`joinPath`, `parentOf`, `baseName`, `fsUrl`), форматтеры, `store` (localStorage) |
| `types.js` | `EXT` → `kindOf(name)`, иконки `GLYPH`, названия `KIND_NAME`. Новый тип файла — сюда + ветка в `open.js` |
| `vfs.js` | API личного слоя (см. [filesystem.md](filesystem.md)) |
| `anim.js` | Константы анимаций, `REDUCED` (prefers-reduced-motion) |

## Оконный менеджер (`wm.js`)

```js
WM.open({ title, icon, width, height, key, render(c, w) { ... } })
```

- `key` — если окно с таким ключом уже открыто, оно разворачивается вместо нового (для «одно окно на файл»). Нужны несколько копий — делай ключ уникальным (`"browser:" + Date.now()`).
- `render(c, w)` получает контейнер содержимого и объект окна: `w.setTitle(t)`, хуки `w.onClose`, `w.onMinimize`, `w.onRestore`.
- Прилипание к краям и соседям, зазор, «Разложить по сетке» — настройки `wm.snap/gap/margin` в `store`.
- `wireIframe(frame, w)` — фокус клавиатуры уходит в iframe игры, клик по iframe поднимает окно.
- `WM.close(w)`.

## Рабочий стол (`desktop.js`)

Рабочий стол = содержимое папки `/home/nikita/Desktop` (ярлыки, файлы, папки; учитывает личный слой). Позиции иконок — по имени, в `store("desk.pos")`. Если папку не прочитать — `FALLBACK_DESKTOP`.

## Открытие (`open.js`)

- `openFile(path, link)` — по `kindOf` выбирает просмотрщик (таблица в [architecture.md](architecture.md)).
- `openPath(path)` — спрашивает `/api/entry`, при отсутствии пробует зеркала GitHub, дальше папка → проводник, файл → `openFile`.
- `APPS` — реестр приложений для ярлыков (`settings`, `about`, `chat`, `explorer`, `fakedl`, `airhockey`, `browser`).

### Ярлык `.lnk`

JSON-файл:

```json
{ "name": "Graveblood", "icon": "🕹️ или /путь/к/картинке.png",
  "open": "/путь/в/fs"  |  "app": "browser", "path": "kursk.artists"  |  "url": "https://…",
  "width": 960, "height": 640 }
```

Проводник и рабочий стол подменяют иконку и подпись данными ярлыка (`Links.decorate`).

## UI (`ui/`)

| Файл | Что |
|---|---|
| `taskbar.js` | Пуск (кнопки `data-open` / `data-app`), список окон, полноэкранный режим, часы |
| `icons.js` | `makeIcon`, `setGlyph` (эмодзи или картинка), выделение рамкой |
| `fs-dnd.js` | Перетаскивание, удаление, переименование, загрузка файлов с компьютера (через VFS) |
| `context-menu.js` | Правый клик: действия над файлами/папками/рабочим столом |
| `notify.js` | `notify()` тосты, `copyText`, `download`, `openProperties` |
| `wallpaper.js` | Обои: `os.json` по умолчанию, выбор посетителя важнее |

## Стили

Один `public/style.css`. Переменные темы в `:root` (`--text`, `--muted`, `--accent`, `--glass-border`). У приложений — свой префикс классов (`chat-`, `post-`, `cmt-`, `br-`, `ka-` …).

## Языки (`core/i18n.js`, `js/i18n/*.js`)

Исходный язык интерфейса — русский. Языковой пакет сопоставляет русской строке перевод: `addPack({ "Настройки": ["Settings", "設定"] })` — `[English, 日本語]`; `{0}`, `{1}` делают строку шаблоном. Код менять не нужно: `init_i18n()` следит за DOM и переводит текст и `title/placeholder/aria-label`, а также `alert/confirm/prompt`. Где текст не попадает в DOM (canvas) — `t("…")`. Чтобы не переводить кусок (имена, пользовательский текст) — класс `no-i18n` или атрибут `data-no-i18n`.

Язык: cookie `nos_lang` (Настройки → 🌐 Язык, смена перезагружает страницу) → иначе по часовому поясу (Токио → ja, Россия/СНГ → ru) → иначе английский. Нет японского перевода у строки — показывается английский. `globalThis.NOS_LOCALE` — локаль для дат и чисел.

Новое приложение: свой пакет `js/i18n/<app>.js` и импорт его из приложения. Переведены оболочка ОС (`i18n/os.js`, en+ja) и DAWN (`i18n/dawn.js`, пока en); Джус и чат — следующими.
