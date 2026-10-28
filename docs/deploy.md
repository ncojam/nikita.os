# Запуск и деплой

## Локально

`./run.sh` — ставит aiohttp в `.venv` (если нет системного), перезапускает сервер в фоне (лог `server.log`, pid `.server.pid`), открывает сайт. `./stop.sh` — остановить. Общие функции — `lib.sh`.

## Docker (`compose.yaml`, `Dockerfile`)

- `docker compose up -d --build` — только сайт на `127.0.0.1:8000`, перед ним свой nginx (`deploy/nginx-site.conf`).
- `docker compose --profile caddy up -d --build` — Caddy сам занимает 80/443 и делает HTTPS (`Caddyfile`, `SITE_ADDRESS`).
- Контейнер: `./fs` подключён **read-only**, данные — в томе (`/data`), корневая ФС read-only, `cap_drop: ALL`, `no-new-privileges`, лимит памяти.
- `deploy.sh` — выкладка на сервер: `git pull`, `seed/` → `fs/`, пересборка, ожидание ответа сайта.

## Переменные окружения

| Переменная | По умолчанию | Что |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `8000` | Где слушать |
| `NOS_FS` | `./fs` | Канон |
| `NOS_DATA` | `./data` | Счётчики, чат |
| `NOS_UFS` | `$NOS_DATA/ufs` | Общие папки, записи, форум |
| `TRUST_PROXY` | — | `1`: IP из `X-Forwarded-For` (только за своим прокси) |
| `NOS_ADMIN_TOKEN` | — | Включает `/api/mod/*`; передаётся заголовком `Authorization: Bearer …`. В `compose.yaml` его нет — добавь `NOS_ADMIN_TOKEN: ${NOS_ADMIN_TOKEN:-}` в `environment:` и значение в `.env` |
| `TG_BOT_TOKEN` | — | Ники Telegram для Джуса |
| `NOS_POST_*` | см. `posts.py` | Лимиты записей |
| `NOS_UFS_MAX_*` | см. `userfs.py` | Лимиты папок |
| `NOS_FORUM_*` | см. `forum.py` | Лимиты форума |
| `NOS_AIR_MAX`, `NOS_AIR_GRACE` | см. `airhockey.py` | Игроков на арене; сколько держится платформа ушедшего |
| `NOS_FINDS_TOKEN` | — | Ключ домашнего воркера «Находок» |
| `NOS_VISITS_UNIQ_MAX` | `200000` | Потолок уникальных посетителей в счётчике |
| `NOS_DAWN_MAX_PROJECTS`, `NOS_DAWN_MAX_BYTES` | `10`, 2 МБ | Общие проекты DAWN на аккаунт и размер одного |

## Что важно при деплое

- `deploy.sh` после `git pull` докладывает недостающие файлы из `seed/` в `fs/` (`cp -rn`: твои правки не перезаписываются) — так в репозитории живут общедоступные файлы вроде `seed/home/nikita/Projects/Bayati in 7-8.dawn`.
- Ярлыки рабочего стола из `DEFAULT_DESKTOP` создаются **только на пустой** `fs/home/nikita/Desktop` — новые ярлыки на живом сайте кладутся руками.
- В `deploy/nginx-site.conf` тела запросов ограничены 64k, кроме `/api/dawn/save` (3m) — иначе проекты DAWN больше ~60 КБ не сохраняются на сервер (413). Конфиг nginx `deploy.sh` не обновляет: после правки — скопировать и `sudo nginx -t && sudo systemctl reload nginx`.
- Порт приложения должен оставаться на `127.0.0.1` — иначе при `TRUST_PROXY=1` можно подделать IP. Как проверить — в [security.md](security.md#ip-посетителя).
- После деплоя проверить заголовки: `curl -sI https://сайт/ | grep -i content-security`.
- `server.log` и `.server.pid` — локальные файлы `run.sh`, в git не попадают.
- Прокси не должен резать WebSocket (`/api/chat/ws`, арена) и заголовки COOP/COEP.
