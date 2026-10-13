#!/usr/bin/env bash
# (Пере)запускает сервер nikita.os и открывает сайт в браузере.
#
#   Двойной клик        -> сервер работает в фоне, лог в server.log.
#                          Повторный двойной клик = перезапуск. Остановить: stop.sh
#   ./run.sh в терминале -> сервер в этом терминале, Ctrl+C — остановить.
#
#   PORT=9000 ./run.sh    -> другой порт
#   HOST=0.0.0.0 ./run.sh -> доступ из локальной сети
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"
source ./lib.sh

if ! command -v python3 >/dev/null; then
  say "Нужен python3 (sudo pacman -S python)"
  exit 1
fi

stop_server            # если уже запущен — останавливаем, чтобы подхватить новый код

open_browser() {
  for _ in $(seq 1 50); do      # ждём, пока сервер поднимется
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && break
    sleep 0.1
  done
  if command -v xdg-open >/dev/null; then
    xdg-open "$URL" >/dev/null 2>&1 &
  else
    echo "Открой в браузере: $URL"
  fi
}

if [ -t 1 ]; then
  # запущен из терминала: работаем на переднем плане
  PORT="$PORT" HOST="$HOST" python3 server.py &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PIDFILE"
  trap 'kill "$SERVER_PID" 2>/dev/null; rm -f "$PIDFILE"' EXIT INT TERM
  open_browser
  wait "$SERVER_PID"
else
  # двойной клик: отвязываемся от файлового менеджера и уходим в фон
  PORT="$PORT" HOST="$HOST" setsid nohup python3 server.py >>"$LOG" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  sleep 0.3
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    say "Сервер не запустился — см. server.log"
    exit 1
  fi
  open_browser
  say "nikita.os запущена: $URL  (остановить — stop.sh)"
fi
