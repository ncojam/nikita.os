# Запуск и деплой

## Локально

`./run.sh` — ставит aiohttp в `.venv` (если нет системного), перезапускает сервер в фоне (лог `server.log`, pid `.server.pid`), открывает сайт. `./stop.sh` — остановить. Общие функции — `lib.sh`.

## Docker (`compose.yaml`, `Dockerfile`)

- `docker compose up -d --build` — только сайт на `127.0.0.1:8000`, перед ним свой nginx (`deploy/nginx-site.conf`).
- `docker compose --profile caddy up -d --build` — Caddy сам занимает 80/443 и делает HTTPS (`Caddyfile`, `SITE_ADDRESS`).
- Контейнер: `./fs` подключён **read-only**, данные — в томе (`/data`), корневая ФС read-only, `cap_drop: ALL`, `no-new-privileges`, лимит памяти.
- `deploy.sh` — выкладка на сервер.

## Переменные окружения

| Переменная | По умолчанию | Что |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `8000` | Где слушать |
| `NOS_FS` | `./fs` | Канон |
| `NOS_DATA` | `./data` | Счётчики, чат |
| `NOS_UFS` | `$NOS_DATA/ufs` | Общие папки, записи, форум |
| `TRUST_PROXY` | — | `1`: IP из `X-Forwarded-For` (только за своим прокси) |
| `NOS_ADMIN_TOKEN` | — | Включает `/api/mod/*` |
| `TG_BOT_TOKEN` | — | Ники Telegram для Джуса |
| `NOS_POST_*` | см. `posts.py` | Лимиты записей |
| `NOS_UFS_MAX_*` | см. `userfs.py` | Лимиты папок |
| `NOS_FORUM_*` | см. `forum.py` | Лимиты форума |
| `NOS_AIR_MAX`, `NOS_AIR_GRACE` | см. `airhockey.py` | Игроков на арене; сколько держится платформа ушедшего |

## Что важно при деплое

- Ярлыки рабочего стола из `DEFAULT_DESKTOP` создаются **только на пустой** `fs/home/nikita/Desktop` — новые ярлыки на живом сайте кладутся руками.
- Прокси не должен резать WebSocket (`/api/chat/ws`, арена) и заголовки COOP/COEP.
