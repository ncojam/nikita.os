#!/usr/bin/env bash
# Обновляет сайт на сервере: подтягивает код, пересобирает образ, перезапускает контейнер.
#
#   ./deploy.sh            -> git pull + пересборка + перезапуск
#   ./deploy.sh --no-pull  -> без git pull (если файлы закинул сам, например через rsync)
#
# Файлы в fs/ подключены к контейнеру напрямую — для них deploy не нужен.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

if [ "${1:-}" != "--no-pull" ] && [ -d .git ]; then
  echo "→ git pull"
  git pull --ff-only
fi

if [ -f modules/.enabled ]; then
  if [ "${1:-}" != "--no-pull" ] && [ -e .git ]; then
    git submodule sync --recursive
    git submodule update --init --recursive
  fi
  python3 tools/materialize_modules.py
fi

# общедоступные файлы из репозитория (seed/ → fs/): только недостающие, твои правки не перезаписываются
if [ -d seed ]; then
  echo "→ seed: докладываю недостающие файлы в fs/"
  cp -rn seed/. fs/
fi

# треки Clown Dungeon — в проводник сайта, чтобы их мог открыть в DAWN любой. Игра читает их из репозитория,
# поэтому копия всегда свежая: старые версии перезаписываются
echo "→ треки Clown Dungeon → fs/home/nikita/Projects/ClownDungeon"
mkdir -p fs/home/nikita/Projects/ClownDungeon
cp -f public/dungeon/music/*.dawn fs/home/nikita/Projects/ClownDungeon/

echo "→ ресурсы японской озвучки (Open JTalk)"
if ! python3 prepare_kana_tts.py; then
  echo "⚠ Open JTalk не подготовлен; сайт продолжит работать без встроенной озвучки"
fi

echo "→ сборка образа и перезапуск контейнера"
docker compose up -d --build --remove-orphans

echo "→ удаляю старые образы без имени"
docker image prune -f >/dev/null

echo "→ жду, пока сайт ответит"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${APP_PORT:-8000}/"; then
    echo "✓ сайт работает"
    docker compose ps
    exit 0
  fi
  sleep 1
done

echo "✗ сайт не ответил за 30 секунд, последние строки лога:"
docker compose logs --tail=40 app
exit 1
