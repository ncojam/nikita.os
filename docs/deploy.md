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
| `TG_DUNGEON_BOT_TOKEN` | — | Бот Clown Dungeon (пусто — подойдёт `TG_BOT_TOKEN`) |
| `NOS_DUNGEON_CONNS`, `NOS_DUNGEON_PLAYERS` | см. `dungeon.py` | Соединений и игроков в Clown Dungeon |
| `NOS_POST_*` | см. `posts.py` | Лимиты записей |
| `NOS_UFS_MAX_*` | см. `userfs.py` | Лимиты папок |
| `NOS_FORUM_*` | см. `forum.py` | Лимиты форума |
| `NOS_AIR_MAX`, `NOS_AIR_GRACE` | см. `airhockey.py` | Игроков на арене; сколько держится платформа ушедшего |
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

## Pinkshake: лобби мультиплеера (`pinkshake.py`)

Сервер только находит игроков и помогает им "пробить" роутеры (UDP hole punching); сама игра идёт напрямую между игроками.

- Слушает **UDP 27015** (`PINKSHAKE_UDP_PORT`), в `compose.yaml` порт проброшен наружу: `27015:27015/udp`.
- nginx для этого **не нужен** и ничего в его конфиге менять не надо: UDP идёт мимо него прямо в контейнер.
- Открыть порт в фаерволе сервера: `sudo ufw allow 27015/udp` (или аналог в панели хостинга).
- Проверить, что лобби живо: `curl -s https://сайт/api/pinkshake/hosts` → JSON со списком открытых игр (без IP).
- Лимиты: 20 пакетов/с с адреса, до 200 хостов, запись хоста живёт 8 с без "я в сети".
