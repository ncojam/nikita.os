#!/usr/bin/env python3
"""
Мини-сервер для nikita.os — только стандартная библиотека Python.

  /                -> статика из ./public (index.html, wallpaper.jpg, ...)
  /api/ls?path=/x  -> JSON со списком файлов в ./fs/x
  /fs/x/y.mp3      -> отдать файл ./fs/x/y.mp3 (с поддержкой Range для аудио/видео)

Виртуальная ФС живёт в ./fs: путь /home/nikita/Projects == ./fs/home/nikita/Projects
Положи туда свою музыку/игры — они сразу появятся в проводнике.
"""
import json
import mimetypes
import os
import re
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "public"
FS_ROOT = (BASE / "fs").resolve()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
CHUNK = 64 * 1024

mimetypes.add_type("audio/flac", ".flac")
mimetypes.add_type("audio/ogg", ".opus")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
for _ext in (".gba", ".gb", ".gbc"):
    mimetypes.add_type("application/octet-stream", _ext)
mimetypes.add_type("application/json", ".lnk")

# Содержимое рабочего стола = папка /home/nikita/Desktop. Создаётся один раз, дальше — твоя.
# Ярлык .lnk — это JSON:
#   name  — подпись под иконкой
#   icon  — эмодзи или путь к картинке в fs ("/home/nikita/icons/game.png")
#   и одно из: open (путь в fs: папка или файл), app (settings | about | explorer), url (внешняя ссылка)
DESKTOP_DIR = "home/nikita/Desktop"
DEFAULT_DESKTOP = {
    "01 nikita.lnk": {"name": "nikita", "icon": "🏠", "open": "/home/nikita"},
    "02 Projects.lnk": {"name": "Projects", "icon": "📁", "open": "/home/nikita/Projects"},
    "03 Graveblood.lnk": {"name": "Graveblood", "icon": "🕹️",
                          "open": "/home/nikita/Projects/Graveblood 0.0.1.1.5.2 demo.gba"},
    "09 Настройки.lnk": {"name": "Настройки", "icon": "⚙️", "app": "settings"},
}

# Конфиги по умолчанию — создаются в fs/etc, только если их там ещё нет
DEFAULT_CONFIGS = {
    "os.json": {
        "_help": "Настройки по умолчанию для всех посетителей. wallpaper: путь к картинке в fs или 'glow' (чёрный с подсветкой). wallpaperDir: из какой папки предлагать обои в Настройках. dim: затемнение картинки 0..0.8. Посетитель может выбрать своё в Настройках — это хранится у него в браузере.",
        "wallpaper": "/home/nikita/Wallpapers/wallpaper.jpg",
        "wallpaperDir": "/home/nikita/Wallpapers",
        "dim": 0.25,
    },
    "gba.json": {
        "_help": "Настройки эмулятора GBA (mGBA). keys: кнопка GBA -> клавиша (имена SDL: X, Z, A, S, Return, Backspace, Up, Down, Left, Right, Space, Left Shift ...). hotkeys: клавиши окна эмулятора (имена KeyboardEvent.code). audio.sampleRate: 'auto' (частота звуковой системы) или число, напр. 48000; audio.bufferSize: 1024/2048/4096 — больше = стабильнее звук, но больше задержка; audio.output: 'worklet' (отдельный аудиопоток, по умолчанию) или 'sdl' (старый вывод); audio.latencyMs: запас звука для worklet. Сохранения хранятся в браузере (IndexedDB).",
        "keys": {
            "A": "X", "B": "Z", "L": "A", "R": "S",
            "Start": "Return", "Select": "Backspace",
            "Up": "Up", "Down": "Down", "Left": "Left", "Right": "Right",
        },
        "hotkeys": {"fastForward": "Tab", "saveState": "F5", "loadState": "F8", "pause": "KeyP"},
        "volume": 1.0,
        "fastForwardSpeed": 3,
        "integerScale": False,
        "audio": {"contextRate": 48000, "sampleRate": "auto", "bufferSize": 2048, "output": "worklet", "latencyMs": 120},
        "core": {
            "showFpsCounter": False,
            "rewindEnable": True,
            "autoSaveStateEnable": True,
            "restoreAutoSaveStateOnLoad": True,
        },
    },
}


def natural_key(name):
    """track2 < track10: числа сравниваются как числа."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", name.lower()) if t]


def resolve_fs(virtual):
    """Виртуальный путь -> реальный внутри FS_ROOT, или None при попытке выйти наружу."""
    rel = virtual.strip("/")
    p = (FS_ROOT / rel).resolve() if rel else FS_ROOT
    if p != FS_ROOT and FS_ROOT not in p.parents:
        return None
    return p


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    # ---------- helpers ----------
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # во время разработки не кэшируем статику
        if not self.path.startswith("/fs/"):
            self.send_header("Cache-Control", "no-cache")
        # cross-origin isolation: нужна эмулятору mGBA (SharedArrayBuffer + потоки).
        # Побочный эффект: страницы из fs не смогут грузить ресурсы с чужих CDN без CORP/CORS.
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- routing ----------
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        try:
            if url.path == "/api/ls":
                return self.api_ls(url)
            if url.path == "/api/find":
                return self.api_find(url)
            if url.path == "/api/entry":
                return self.api_entry(url)
            if url.path.startswith("/fs/") or url.path == "/fs":
                return self.serve_fs(urllib.parse.unquote(url.path[3:]), head=False)
            return super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_HEAD(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/fs/"):
            return self.serve_fs(urllib.parse.unquote(url.path[3:]), head=True)
        return super().do_HEAD()

    # ---------- /api/ls ----------
    def api_ls(self, url):
        qs = urllib.parse.parse_qs(url.query)
        virtual = "/" + qs.get("path", ["/"])[0].strip("/")
        p = resolve_fs(virtual)
        if p is None:
            return self.send_json(403, {"error": "Доступ запрещён"})
        if not p.exists():
            return self.send_json(404, {"error": "Нет такой папки"})
        if not p.is_dir():
            return self.send_json(400, {"error": "Это не папка"})

        entries = []
        children = sorted(p.iterdir(), key=lambda c: (not c.is_dir(), natural_key(c.name)))
        for c in children:
            if c.name.startswith("."):
                continue
            try:
                st = c.stat()
            except OSError:
                continue
            entries.append({
                "name": c.name,
                "type": "dir" if c.is_dir() else "file",
                "size": st.st_size if c.is_file() else 0,
                "mtime": int(st.st_mtime),
            })
        return self.send_json(200, {"path": virtual, "entries": entries})

    # ---------- /api/entry?path=/x ----------
    def api_entry(self, url):
        virtual = "/" + urllib.parse.parse_qs(url.query).get("path", ["/"])[0].strip("/")
        p = resolve_fs(virtual)
        if p is None or not p.exists() or any(part.startswith(".") for part in p.relative_to(FS_ROOT).parts):
            return self.send_json(200, {"path": virtual, "exists": False})
        st = p.stat()
        return self.send_json(200, {
            "path": virtual, "exists": True, "name": p.name or "/",
            "type": "dir" if p.is_dir() else "file",
            "size": st.st_size if p.is_file() else 0, "mtime": int(st.st_mtime),
        })

    # ---------- /api/find?ext=png,jpg ----------
    def api_find(self, url):
        """Рекурсивно ищет файлы с нужными расширениями по всей fs (для выбора обоев и т.п.)."""
        qs = urllib.parse.parse_qs(url.query)
        exts = {"." + e.strip().lower().lstrip(".") for e in qs.get("ext", [""])[0].split(",") if e.strip()}
        if not exts:
            return self.send_json(400, {"error": "Укажи ext"})
        found = []
        for dirpath, dirnames, filenames in os.walk(FS_ROOT):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in sorted(filenames):
                if name.startswith(".") or os.path.splitext(name)[1].lower() not in exts:
                    continue
                rel = Path(dirpath, name).relative_to(FS_ROOT).as_posix()
                found.append("/" + rel)
                if len(found) >= 2000:
                    return self.send_json(200, {"files": found, "truncated": True})
        return self.send_json(200, {"files": found})

    # ---------- /fs/... ----------
    def serve_fs(self, virtual, head):
        p = resolve_fs(virtual)
        if p is None or not p.is_file() or any(part.startswith(".") for part in p.relative_to(FS_ROOT).parts):
            return self.send_error(404, "Not found")

        size = p.stat().st_size
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "text/javascript"):
            ctype += "; charset=utf-8"

        start, end, status = 0, max(size - 1, 0), 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes=") and size > 0:
            s, _, e = rng[6:].split(",")[0].strip().partition("-")
            try:
                if s:
                    start = int(s)
                    end = int(e) if e else size - 1
                else:  # bytes=-500 -> последние 500 байт
                    start = max(0, size - int(e))
                    end = size - 1
            except ValueError:
                start, end = 0, size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            status = 206

        length = (end - start + 1) if size > 0 else 0
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head or length == 0:
            return

        with open(p, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(CHUNK, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main():
    # стартовая структура: только корень fs; своё содержимое сервер больше не трогает
    FS_ROOT.mkdir(parents=True, exist_ok=True)
    desktop = FS_ROOT / DESKTOP_DIR
    if not desktop.exists():
        desktop.mkdir(parents=True)
        for name, data in DEFAULT_DESKTOP.items():
            (desktop / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    etc = FS_ROOT / "etc"
    etc.mkdir(exist_ok=True)
    for name, data in DEFAULT_CONFIGS.items():
        cfg = etc / name
        if not cfg.exists():
            cfg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    migrate_os_json(etc / "os.json")


# os.json, созданный старой версией и не тронутый руками, обновляем до новых значений по умолчанию
OLD_OS_HELP = "Настройки по умолчанию для всех посетителей. wallpaper: 'glow' или путь к картинке в fs, напр. '/home/nikita/wallpapers/bg.jpg'. dim: затемнение картинки 0..0.8. Посетитель может выбрать своё в Настройках — это хранится у него в браузере."


def migrate_os_json(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    untouched = (data.get("_help") == OLD_OS_HELP and data.get("wallpaper") == "glow"
                 and set(data) <= {"_help", "wallpaper", "wallpaperDir", "dim"})
    if untouched:
        new = dict(DEFAULT_CONFIGS["os.json"], dim=data.get("dim", 0.25))
        path.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("fs/etc/os.json обновлён: обои по умолчанию —", new["wallpaper"], flush=True)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"nikita.os запущена: http://{HOST}:{PORT}  (Ctrl+C — остановить)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
