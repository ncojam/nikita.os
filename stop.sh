#!/usr/bin/env bash
# Останавливает сервер nikita.os (можно запускать двойным кликом).
set -uo pipefail
cd "$(dirname "$(readlink -f "$0")")"
source ./lib.sh

if stop_server; then
  say "nikita.os остановлена"
else
  say "Сервер nikita.os не был запущен"
fi
