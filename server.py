#!/usr/bin/env python3
"""
Сервер nikita.os на aiohttp (асинхронный: медленные клиенты не съедают потоки).

  /                     -> статика из ./public
  /fs/x/y.mp3           -> файл ./fs/x/y.mp3 (Range, If-Modified-Since — для аудио/видео)
  /api/ls?path=/x       -> содержимое папки (у аудио — число прослушиваний)
  /api/entry?path=/x    -> есть ли такой путь, файл это или папка
  /api/find?ext=png,jpg -> поиск файлов по расширению
  POST /api/listen?path=/x.mp3 -> +1 прослушивание (защита от накруток: 1 раз с адреса за 30 минут)
  /api/chat/...         -> чатилка (см. chat.py)

Виртуальная ФС живёт в ./fs: путь /home/nikita/Projects == ./fs/home/nikita/Projects.
Прослушивания хранятся в ./data/plays.json (вне fs — снаружи их не скачать).

Переменные окружения:
  HOST, PORT          — где слушать (по умолчанию 127.0.0.1:8000)
  NOS_FS, NOS_DATA    — папки fs и data (по умолчанию рядом с server.py)
  TRUST_PROXY=1       — брать адрес клиента из X-Forwarded-For (только за своим прокси, напр. Caddy)
"""
import asyncio
import hashlib
import json
import logging
import mimetypes
import os
import re
import secrets
import sys
import time
from collections import deque
from pathlib import Path

try:
    from aiohttp import web
except ImportError:
    sys.exit("Нужен aiohttp: запусти ./run.sh (он сам поставит) или sudo pacman -S python-aiohttp")

BASE = Path(__file__).resolve().parent
PUBLIC = (BASE / "public").resolve()
FS_ROOT = Path(os.environ.get("NOS_FS") or BASE / "fs").resolve()
DATA_DIR = Path(os.environ.get("NOS_DATA") or BASE / "data").resolve()
# пользовательский (писучий) корень: папки, записи и картинки живут здесь, под /data
UFS_ROOT = Path(os.environ.get("NOS_UFS") or DATA_DIR / "ufs").resolve()
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
TRUST_PROXY = os.environ.get("TRUST_PROXY") == "1"

log = logging.getLogger("nikita.os")

mimetypes.add_type("audio/flac", ".flac")
mimetypes.add_type("audio/ogg", ".opus")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")
for _ext in (".gba", ".gb", ".gbc"):
    mimetypes.add_type("application/octet-stream", _ext)
mimetypes.add_type("application/json", ".lnk")

AUDIO_EXT = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"}

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
    "08 Джус.lnk": {"name": "Джус", "icon": "🍒", "app": "airhockey"},
    "07 Браузер.lnk": {"name": "Браузер", "icon": "🌐", "app": "browser"},
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
        "_help": "Настройки эмулятора GBA (mGBA). keys: кнопка GBA -> клавиша (имена SDL: X, Z, A, S, Return, Backspace, Up, Down, Left, Right, Space, Left Shift ...). hotkeys: клавиши окна эмулятора (имена KeyboardEvent.code). audio.contextRate: частота звукового контекста (48000 по умолчанию, или 'device'); audio.sampleRate: 'auto' или число; audio.bufferSize: 1024/2048/4096 — больше = стабильнее звук, но больше задержка; audio.output: 'worklet' (отдельный аудиопоток, по умолчанию) или 'sdl' (старый вывод); audio.latencyMs: запас звука для worklet. Сохранения хранятся в браузере (IndexedDB).",
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

# os.json, созданный старой версией и не тронутый руками, обновляем до новых значений по умолчанию
OLD_OS_HELP = "Настройки по умолчанию для всех посетителей. wallpaper: 'glow' или путь к картинке в fs, напр. '/home/nikita/wallpapers/bg.jpg'. dim: затемнение картинки 0..0.8. Посетитель может выбрать своё в Настройках — это хранится у него в браузере."


# ======================= пути =======================

def natural_key(name):
    """track2 < track10: числа сравниваются как числа."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", name.lower()) if t]


def resolve_inside(root, rel):
    """Путь внутри root (с учётом симлинков) или None: выход наружу и скрытые (.*) части запрещены."""
    rel = rel.strip("/")
    if "\x00" in rel:
        return None
    p = (root / rel).resolve() if rel else root
    if p != root and root not in p.parents:
        return None
    if any(part.startswith(".") for part in p.relative_to(root).parts):
        return None
    return p


def virtual_of(p):
    """Реальный путь внутри fs -> виртуальный ("/home/nikita/x.mp3")."""
    rel = p.relative_to(FS_ROOT).as_posix()
    return "/" if rel == "." else "/" + rel


# ---- сшивка /fs (канон) и /ufs (пользовательское) в один вид ----
def unified_dir_exists(app, v):
    v = "/" + v.strip("/")
    if v == "/":
        return True
    pf = resolve_inside(FS_ROOT, v)
    if pf and pf.is_dir():
        return True
    return app["folders"].dir_exists(v)


def unified_name_taken(app, v):
    v = "/" + v.strip("/")
    pf = resolve_inside(FS_ROOT, v)
    if pf and pf.exists():
        return True
    if app["folders"].entry_exists(v):
        return True
    _, post = app["posts"].by_vpath(v)
    return bool(post)


def qpath(request):
    return "/" + request.query.get("path", "/").strip("/")


def json_response(data, status=200):
    return web.json_response(data, status=status, dumps=lambda d: json.dumps(d, ensure_ascii=False),
                             headers={"Cache-Control": "no-store"})


def text_ctype(path):
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
        ctype += "; charset=utf-8"
    return ctype


# ======================= прослушивания =======================

class Plays:
    """Счётчик прослушиваний: {виртуальный путь: число}, хранится в data/plays.json.

    Накрутка ограничена: с одного адреса один трек засчитывается не чаще раза в DEDUP секунд,
    и всего не больше PER_IP_HOUR прослушиваний в час. Сами адреса на диск не пишутся —
    в памяти лежат только их хэши с солью, которая живёт до перезапуска.
    """
    DEDUP = 30 * 60
    PER_IP_HOUR = 120

    def __init__(self, path):
        self.path = path
        self.counts = {}
        self.dirty = False
        self.salt = secrets.token_bytes(16)
        self.recent = {}   # (ip_hash, vpath) -> время последнего засчитанного
        self.per_ip = {}   # ip_hash -> deque(время)
        try:
            self.counts = self.load(path)
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as e:
            # битый файл не перезаписываем (вдруг его можно починить руками), пишем рядом
            self.path = path.with_name("plays.recovered.json")
            try:
                self.counts = self.load(self.path)
            except (OSError, ValueError):
                pass
            log.warning("plays.json не прочитался (%s) — счётчики пишутся в %s, старый файл не трогаю",
                        e, self.path.name)

    @staticmethod
    def load(path):
        data = json.loads(path.read_text(encoding="utf-8"))
        return {k: int(v) for k, v in data.get("plays", {}).items() if isinstance(k, str)}

    def get(self, vpath):
        return self.counts.get(vpath, 0)

    def hit(self, vpath, ip):
        now = time.monotonic()
        h = hashlib.blake2s(ip.encode(), key=self.salt, digest_size=12).digest()
        last = self.recent.get((h, vpath))
        if last is not None and now - last < self.DEDUP:
            return False
        q = self.per_ip.setdefault(h, deque())
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= self.PER_IP_HOUR:
            return False
        q.append(now)
        self.recent[(h, vpath)] = now
        self.counts[vpath] = self.counts.get(vpath, 0) + 1
        self.dirty = True
        if len(self.recent) > 50_000:
            self.prune(now)
        return True

    def prune(self, now):
        self.recent = {k: t for k, t in self.recent.items() if now - t < self.DEDUP}
        self.per_ip = {h: q for h, q in self.per_ip.items() if q and now - q[-1] < 3600}

    def save(self):
        if not self.dirty:
            return
        self.dirty = False
        data = json.dumps({"plays": self.counts}, ensure_ascii=False, indent=1, sort_keys=True)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(data + "\n", encoding="utf-8")
            os.replace(tmp, self.path)  # атомарно: файл никогда не окажется наполовину записанным
        except OSError as e:
            self.dirty = True
            log.error("Не удалось сохранить %s: %s", self.path, e)

    async def autosave(self):
        try:
            while True:
                await asyncio.sleep(5)
                self.prune(time.monotonic())
                self.save()
        except asyncio.CancelledError:
            self.save()
            raise


def client_ip(request):
    if TRUST_PROXY:
        xff = request.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[-1].strip()
    return request.remote or "?"


# ======================= API =======================

async def api_ls(request):
    virtual = qpath(request)
    pf = resolve_inside(FS_ROOT, virtual)
    folders = request.app["folders"]
    pu = folders.real(virtual)
    if pf is None and pu is None:
        return json_response({"error": "Доступ запрещён"}, 403)
    fs_dir = bool(pf and pf.is_dir())
    ufs_dir = bool(pu and pu.is_dir())
    if pf and pf.exists() and not pf.is_dir():
        return json_response({"error": "Это не папка"}, 400)
    if not fs_dir and not ufs_dir and virtual != "/":
        return json_response({"error": "Нет такой папки"}, 404)

    def scan():
        plays = request.app["plays"]
        by_name = {}
        # 1) канон /fs — он главнее при коллизии имён
        if fs_dir:
            for c in pf.iterdir():
                if c.name.startswith("."):
                    continue
                try:
                    st = c.stat()
                except OSError:
                    continue
                e = {"name": c.name, "type": "dir" if c.is_dir() else "file",
                     "size": st.st_size if c.is_file() else 0, "mtime": int(st.st_mtime)}
                if e["type"] == "file" and c.suffix.lower() in AUDIO_EXT:
                    try:
                        e["plays"] = plays.get(virtual_of(c.resolve()))
                    except ValueError:
                        pass
                by_name[c.name] = e
        # 2) пользовательский /ufs — только то, чего нет в каноне
        if ufs_dir:
            for c in pu.iterdir():
                if c.name.startswith(".") or c.name in by_name:
                    continue
                try:
                    st = c.stat()
                except OSError:
                    continue
                by_name[c.name] = {"name": c.name, "type": "dir" if c.is_dir() else "file",
                                   "size": st.st_size if c.is_file() else 0, "mtime": int(st.st_mtime),
                                   "ufs": True}
        return list(by_name.values())

    try:
        entries = await asyncio.to_thread(scan)
    except PermissionError:
        return json_response({"error": "Нет прав на чтение папки"}, 403)
    # 3) общие записи («твиты») в этой папке
    have = {e["name"] for e in entries}
    entries += [e for e in request.app["posts"].in_dir(virtual) if e["name"] not in have]
    entries.sort(key=lambda e: (e["type"] != "dir", natural_key(e["name"])))
    return json_response({"path": virtual, "entries": entries})


async def api_entry(request):
    virtual = qpath(request)
    p = resolve_inside(FS_ROOT, virtual)
    if p is None or not p.exists():
        # пользовательская папка/файл из /ufs
        pu = request.app["folders"].real(virtual)
        if pu and pu.exists():
            st = pu.stat()
            return json_response({"path": virtual, "exists": True, "name": pu.name,
                                  "type": "dir" if pu.is_dir() else "file",
                                  "size": st.st_size if pu.is_file() else 0,
                                  "mtime": int(st.st_mtime), "ufs": True})
        # виртуальный файл записи
        pid, post = request.app["posts"].by_vpath(virtual)
        if post:
            return json_response({"path": virtual, "exists": True, "name": post["name"],
                                  "type": "file", "size": request.app["posts"]._size(pid, post),
                                  "mtime": post.get("edited") or post.get("created", 0), "post": True})
        return json_response({"path": virtual, "exists": False})
    st = p.stat()
    return json_response({
        "path": virtual, "exists": True, "name": p.name or "/",
        "type": "dir" if p.is_dir() else "file",
        "size": st.st_size if p.is_file() else 0, "mtime": int(st.st_mtime),
    })


async def api_find(request):
    """Рекурсивный поиск файлов по расширению по всей fs."""
    exts = {"." + e.strip().lower().lstrip(".") for e in request.query.get("ext", "").split(",") if e.strip()}
    if not exts:
        return json_response({"error": "Укажи ext"}, 400)

    def walk():
        found = []
        for dirpath, dirnames, filenames in os.walk(FS_ROOT):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in sorted(filenames):
                if name.startswith(".") or os.path.splitext(name)[1].lower() not in exts:
                    continue
                found.append("/" + Path(dirpath, name).relative_to(FS_ROOT).as_posix())
                if len(found) >= 2000:
                    return found, True
        return found, False

    found, truncated = await asyncio.to_thread(walk)
    return json_response({"files": found, **({"truncated": True} if truncated else {})})


async def api_listen(request):
    p = resolve_inside(FS_ROOT, qpath(request))
    if p is None or not p.is_file() or p.suffix.lower() not in AUDIO_EXT:
        return json_response({"error": "Нет такого трека"}, 404)
    vpath = virtual_of(p)  # по реальному пути: ссылки на один файл считаются вместе
    plays = request.app["plays"]
    counted = plays.hit(vpath, client_ip(request))
    return json_response({"path": vpath, "plays": plays.get(vpath), "counted": counted})


# ======================= прикол: «качалка», которая не докачается =======================
# Отдаём браузеру ответ с огромным Content-Length и роняем в него байты по капле.
# Файл честно появляется в менеджере загрузок и ползёт — но до конца не доедет никогда.
# На async-сервере висящее соединение дёшево (сокет + спящая корутина, без отдельного потока),
# но не бесплатно, поэтому держим жёсткие лимиты, чтобы этим нельзя было заддосить.
DL_FAKE_SIZE = 284 * 1024**3 + 700 * 1024**2             # ~284.7 ГБ по умолчанию
DL_BYTE_EVERY = float(os.environ.get("NOS_DL_EVERY", "20"))    # байт раз в N секунд (≥30 с режет nginx send_timeout)
DL_MAX_SECONDS = int(os.environ.get("NOS_DL_MAXSEC", "1800"))  # дольше 30 мин одно соединение не живёт
DL_MAX_TOTAL = int(os.environ.get("NOS_DL_MAX", "48"))         # всего одновременных «загрузок»
DL_MAX_PER_IP = int(os.environ.get("NOS_DL_MAX_IP", "3"))      # с одного адреса
_dl_total = 0
_dl_per_ip = {}
_DL_NAME_RE = re.compile(r"[^\w.\- ]")


async def serve_grab(request):
    global _dl_total
    ip = client_ip(request)
    if _dl_total >= DL_MAX_TOTAL or _dl_per_ip.get(ip, 0) >= DL_MAX_PER_IP:
        raise web.HTTPTooManyRequests(text="Слишком много загрузок — попробуйте позже")

    name = _DL_NAME_RE.sub("_", request.match_info["name"])[:80] or "download.iso"
    try:
        size = int(request.query.get("size", DL_FAKE_SIZE))
    except ValueError:
        size = DL_FAKE_SIZE
    size = max(1, min(size, 1 << 50))  # потолок 1 ПБ — без безумных чисел

    # поддержка «докачки»: браузер переподключается с Range — продолжаем с нужного места
    start = 0
    m = re.match(r"bytes=(\d+)-", request.headers.get("Range", ""))
    if m:
        start = min(int(m.group(1)), size - 1)
    remaining = size - start

    resp = web.StreamResponse(status=206 if start else 200, headers={
        "Content-Type": "application/octet-stream",
        "Content-Disposition": f'attachment; filename="{name}"',
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
    })
    resp.content_length = remaining
    if start:
        resp.headers["Content-Range"] = f"bytes {start}-{size - 1}/{size}"
    resp.force_close()  # Content-Length не доберём — соединение одноразовое, не держим keep-alive

    _dl_total += 1
    _dl_per_ip[ip] = _dl_per_ip.get(ip, 0) + 1
    try:
        await resp.prepare(request)
        deadline = time.monotonic() + DL_MAX_SECONDS
        sent = 0
        while sent < remaining and time.monotonic() < deadline:
            await asyncio.sleep(DL_BYTE_EVERY)
            await resp.write(b"\0")
            sent += 1
        # выходим молча: байты не добраны, браузер оставит загрузку «приостановленной»
        # (её можно возобновить — вернётся с Range и покапает снова)
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        _dl_total -= 1
        left = _dl_per_ip.get(ip, 1) - 1
        if left > 0:
            _dl_per_ip[ip] = left
        else:
            _dl_per_ip.pop(ip, None)
    return resp


# ======================= записи («твиты») =======================

_PID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


async def _json_body(request):
    try:
        return await request.json()
    except (ValueError, TypeError):
        return {}


async def api_posts_create(request):
    body = await _json_body(request)
    title = body.get("title") or body.get("name")   # name — для совместимости
    pid, err = request.app["posts"].create(request, body.get("dir"), title, body.get("text"))
    if err:
        return json_response({"error": err}, 400)
    post = request.app["posts"].posts[pid]
    return json_response({"id": pid, "path": request.app["posts"].vpath(post), "name": post["name"]})


async def api_posts_get(request):
    posts = request.app["posts"]
    p = posts.posts.get(request.match_info["id"])
    if not p:
        return json_response({"error": "не найдено"}, 404)
    return json_response({**posts.public(request.match_info["id"], p), "path": posts.vpath(p)})


async def api_posts_edit(request):
    body = await _json_body(request)
    err = request.app["posts"].edit(request, request.match_info["id"], body.get("text", ""))
    return json_response({"error": err}, 403 if err else 200) if err else json_response({"ok": True})


async def api_posts_delete(request):
    err = request.app["posts"].delete(request, request.match_info["id"])
    return json_response({"error": err}, 403) if err else json_response({"ok": True})


async def api_posts_image(request):
    data = await request.read()
    err = request.app["posts"].set_image(request, request.match_info["id"], data)
    return json_response({"error": err}, 400) if err else json_response({"ok": True})


async def api_posts_image_del(request):
    err = request.app["posts"].drop_image(request, request.match_info["id"])
    return json_response({"error": err}, 403) if err else json_response({"ok": True})


# ---- пользовательские папки (/ufs) ----
async def api_folders_create(request):
    import userfs
    body = await _json_body(request)
    parent = "/" + str(body.get("parent") or "/").strip("/")
    name = body.get("name")
    v = "/" + (parent.rstrip("/") + "/" + userfs.clean_name(name)).strip("/") if name else parent
    exists = unified_dir_exists(request.app, parent)
    taken = bool(name) and unified_name_taken(request.app, v)
    path, err = request.app["folders"].create(request, parent, name, exists, taken)
    return json_response({"error": err}, 400) if err else json_response({"path": path})


async def api_folders_delete(request):
    body = await _json_body(request)
    err = request.app["folders"].delete(request, str(body.get("path") or ""))
    return json_response({"error": err}, 403) if err else json_response({"ok": True})


async def serve_media(request):
    pid = request.match_info["id"]
    if not _PID_RE.match(pid):
        raise web.HTTPNotFound()
    if request.app["posts"].is_hidden(pid):
        raise web.HTTPForbidden(text="картинка скрыта на проверке")
    f = request.app["posts"].media_path(pid)
    if not f.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(f, headers={"Content-Type": "image/jpeg", "Cache-Control": "no-cache"})


async def api_posts_report(request):
    res, err = request.app["posts"].report(request, request.match_info["id"])
    return json_response({"error": err}, 400) if err else json_response(res)


def _admin_ok(request):
    token = os.environ.get("NOS_ADMIN_TOKEN", "")
    return bool(token) and secrets.compare_digest(request.query.get("token", ""), token)


async def api_mod_reports(request):
    # список жалоб для ревью; доступ по токену NOS_ADMIN_TOKEN (без него — функция выключена)
    if not _admin_ok(request):
        raise web.HTTPNotFound()
    return json_response({"reports": request.app["posts"].admin_list()})


async def api_mod_show(request):
    if not _admin_ok(request):
        raise web.HTTPNotFound()
    hide = request.query.get("hide") == "1"   # ?hide=1 — снова скрыть, иначе показать
    err = request.app["posts"].admin_set_hidden(request.match_info["id"], hide)
    return json_response({"error": err}, 404) if err else json_response({"ok": True, "hidden": hide})


# ======================= файлы =======================

# Сжатые файлы веб-сборок (Unity: Game.wasm.br, Game.data.gz): отдаём как есть,
# с Content-Encoding и типом внутреннего файла — браузер распакует сам
ENCODED = {".br": "br", ".gz": "gzip"}
INNER_CTYPE = {".js": "application/javascript", ".wasm": "application/wasm", ".data": "application/octet-stream"}


async def serve_fs(request):
    tail = request.match_info["tail"]
    p = resolve_inside(FS_ROOT, tail)
    if p is None or not p.is_file() or not os.access(p, os.R_OK):
        # 1) реальный файл из /ufs (картинки появятся в Фазе 2b)
        pu = request.app["folders"].real("/" + tail)
        if pu and pu.is_file() and os.access(pu, os.R_OK):
            return web.FileResponse(pu, chunk_size=256 * 1024, headers={"Content-Type": text_ctype(pu)})
        # 2) виртуальный файл записи — отдаём его JSON
        posts = request.app["posts"]
        pid, post = posts.by_vpath("/" + tail)
        if post:
            return web.Response(body=posts.file_json(pid, post),
                                headers={"Content-Type": "application/json; charset=utf-8",
                                         "Cache-Control": "no-store"})
        raise web.HTTPNotFound()
    headers = {"Content-Type": text_ctype(p)}
    enc = ENCODED.get(p.suffix.lower())
    inner = Path(p.stem).suffix.lower()
    if enc and inner in INNER_CTYPE:
        headers["Content-Type"] = INNER_CTYPE[inner]
        headers["Content-Encoding"] = enc
    return web.FileResponse(p, chunk_size=256 * 1024, headers=headers)


async def serve_public(request):
    p = resolve_inside(PUBLIC, request.match_info["tail"])
    if p is not None and p.is_dir():
        p = p / "index.html"
    if p is None or not p.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(p, headers={"Content-Type": text_ctype(p)})


async def serve_browser(request):
    return web.FileResponse(PUBLIC / "index.html", headers={"Content-Type": "text/html; charset=utf-8"})


async def add_headers(request, response):
    h = response.headers
    # cross-origin isolation: нужна эмулятору mGBA (SharedArrayBuffer + потоки)
    if request.path != "/tg.html":   # Telegram Mini App: грузит telegram.org, живёт в чужом окне
        h["Cross-Origin-Opener-Policy"] = "same-origin"
        h["Cross-Origin-Embedder-Policy"] = "require-corp"
    h["Cross-Origin-Resource-Policy"] = "same-origin"
    h["X-Content-Type-Options"] = "nosniff"
    h["Referrer-Policy"] = "strict-origin-when-cross-origin"
    h["Server"] = "nikita.os"  # не светим версии Python и aiohttp
    if not request.path.startswith("/fs/") and "Cache-Control" not in h:
        h["Cache-Control"] = "no-cache"  # статику не кэшируем — правки видны сразу


# ======================= запуск =======================

def init_fs():
    """Файлы по умолчанию. Если fs смонтирована только для чтения (Docker) — молча пропускаем."""
    try:
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
    except OSError as e:
        log.info("fs только для чтения (%s) — файлы по умолчанию не создаю", e.strerror or e)


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
        log.info("fs/etc/os.json обновлён: обои по умолчанию — %s", new["wallpaper"])


def raise_fd_limit():
    """Больше одновременных соединений: поднимаем мягкий лимит открытых файлов до жёсткого."""
    try:
        import resource
        soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        want = hard if hard != resource.RLIM_INFINITY else 65536
        want = min(want, 65536)
        if soft < want:
            resource.setrlimit(resource.RLIMIT_NOFILE, (want, hard))
    except (ImportError, ValueError, OSError):
        pass


async def on_startup(app):
    app["autosave"] = asyncio.create_task(app["plays"].autosave())


async def on_cleanup(app):
    app["autosave"].cancel()
    try:
        await app["autosave"]
    except asyncio.CancelledError:
        pass
    app["plays"].save()


def make_app():
    app = web.Application(client_max_size=256 * 1024)  # тела маленькие; потолок — под сжатые картинки записей
    app["plays"] = Plays(DATA_DIR / "plays.json")
    app.on_response_prepare.append(add_headers)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_get("/api/ls", api_ls)
    app.router.add_get("/api/entry", api_entry)
    app.router.add_get("/api/find", api_find)
    app.router.add_post("/api/listen", api_listen)
    app.router.add_get("/grab/{name}", serve_grab)  # прикол: «качалка», которая не докачается
    from chat import Chat
    app["chat"] = Chat(DATA_DIR / "chat.db", client_ip)
    app["chat"].routes(app)
    # записи («твиты») — общий слой; авторизация через аккаунт чата
    from posts import Posts
    from userfs import Folders
    app["posts"] = Posts(UFS_ROOT, app["chat"].user_by_token, client_ip, old_dir=DATA_DIR)
    app["folders"] = Folders(UFS_ROOT, app["chat"].user_by_token, app["posts"].purge_dir)
    app["posts"].dir_ok = lambda v: unified_dir_exists(app, v)   # запись — только в общей папке
    app["chat"].posts = app["posts"]            # чату — доступ к постам (титул/проверка для комментов)
    app["posts"].on_gone = app["chat"].drop_comments  # удалили пост → снести его комнату комментов
    # аэро-арканоид — общая арена (игровой цикл спит, пока нет игроков)
    from airhockey import AirHockey
    app["air"] = AirHockey(app["chat"].user_by_token, DATA_DIR)
    app["air"].routes(app)
    app.router.add_post("/api/folders", api_folders_create)
    app.router.add_post("/api/folders/delete", api_folders_delete)
    app.router.add_post("/api/posts", api_posts_create)
    app.router.add_get("/api/posts/{id}", api_posts_get)
    app.router.add_patch("/api/posts/{id}", api_posts_edit)
    app.router.add_delete("/api/posts/{id}", api_posts_delete)
    app.router.add_post("/api/posts/{id}/image", api_posts_image)
    app.router.add_delete("/api/posts/{id}/image", api_posts_image_del)
    app.router.add_post("/api/posts/{id}/report", api_posts_report)
    app.router.add_get("/api/mod/reports", api_mod_reports)
    app.router.add_post("/api/mod/show/{id}", api_mod_show)
    app.router.add_get("/media/{id}", serve_media)
    # встроенный браузер: псевдо-сайты (форум Kursk Artists); аккаунт — из чата
    from forum import Forum
    app["forum"] = Forum(UFS_ROOT, app["chat"].user_by_token)
    app["forum"].routes(app)
    app.router.add_get("/browser{tail:(/.*)?}", serve_browser)  # прямые ссылки -> та же ОС, браузер откроет адрес
    app.router.add_get("/fs/{tail:.*}", serve_fs)
    app.router.add_get("/{tail:.*}", serve_public)
    return app


def main():
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s", datefmt="%d/%b/%Y %H:%M:%S")
    raise_fd_limit()
    init_fs()
    app = make_app()
    log.info("nikita.os запущена: http://%s:%s  (Ctrl+C — остановить)", HOST, PORT)
    web.run_app(
        app, host=HOST, port=PORT, print=None,
        keepalive_timeout=15,                 # простаивающие соединения закрываем через 15 с
        access_log_format='%a "%r" %s',
        shutdown_timeout=3,
    )


if __name__ == "__main__":
    main()
