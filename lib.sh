# Общие функции для run.sh и stop.sh (сам по себе не запускается)

PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
URL="http://127.0.0.1:${PORT}"
PIDFILE=".server.pid"
LOG="server.log"
HERE="$(pwd -P)"

# сообщение: в терминал, а при запуске двойным кликом — всплывающим уведомлением
say() {
  echo "$1"
  if [ ! -t 1 ] && command -v notify-send >/dev/null; then
    notify-send -a "nikita.os" "nikita.os" "$1" 2>/dev/null || true
  fi
}

# это точно наш server.py из этой папки?
is_ours() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  local -a argv
  mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || return 1
  # именно «python… server.py», а не любой процесс, где встречается это слово (редактор и т.п.)
  [[ "$(basename "${argv[0]:-}")" == python* && "${argv[1]:-}" == *server.py ]] || return 1
  [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$HERE" ]
}

# PID-ы наших серверов: из .server.pid и (на всякий случай) все server.py, запущенные из этой папки
our_pids() {
  local pid
  [ -f "$PIDFILE" ] && is_ours "$(cat "$PIDFILE")" && cat "$PIDFILE"
  for pid in $(pgrep -f "python.*server\.py" 2>/dev/null); do
    is_ours "$pid" && echo "$pid"
  done | sort -u
}

# возвращает 0, если что-то было остановлено
stop_server() {
  local pids pid
  pids="$(our_pids | sort -u)"
  rm -f "$PIDFILE"
  [ -z "$pids" ] && return 1
  kill $pids 2>/dev/null
  local alive
  for _ in $(seq 1 30); do                     # ждём до 3 секунд
    alive=0
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.1
  done
  for pid in $pids; do kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null; done
  sleep 0.2                                    # дать ОС освободить порт
  return 0
}
