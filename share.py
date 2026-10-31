"""
Файлообменник: личная папка владельца (ник cojam) — закинул файл с одного устройства, забрал с другого.

  GET  /api/share/list              -> {files: [{name, size, t}], max, quota, used}
  POST /api/share/upload            multipart, поле(я) "file" — потоково, по одному файлу за раз
  GET  /api/share/file/{name}       -> файл (Range работает); ?inline=1 — показать картинку/аудио/видео/PDF
  POST /api/share/delete {name}

Всё — только для вошедшего под ником OWNER. Проверка на сервере (скрытие кнопки в UI — лишь удобство).
Файлы лежат в NOS_DATA/share (плоская папка, без подпапок), наружу через /fs не торчат.
"""
import json
import logging
import mimetypes
import os
import re
import time
from pathlib import Path
from urllib.parse import quote

from aiohttp import web

log = logging.getLogger("nikita.os.share")

OWNER = os.environ.get("NOS_SHARE_OWNER", "cojam").lower()
MAX_FILE = int(os.environ.get("NOS_SHARE_MAX_MB", "500")) * 1024 * 1024     # один файл
QUOTA = int(os.environ.get("NOS_SHARE_QUOTA_MB", "5000")) * 1024 * 1024     # всё вместе
INLINE_OK = ("image/png", "image/jpeg", "image/gif", "image/webp", "audio/", "video/", "application/pdf")
NAME_BAD = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


def clean_name(raw):
    name = NAME_BAD.sub("_", str(raw or "").replace("\\", "/").split("/")[-1]).strip(" .")
    return name[:150]


class Share:
    def __init__(self, root, user_of):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.user_of = user_of

    # ---------- доступ ----------
    def owner(self, request):
        u = self.user_of(request)
        return bool(u) and str(u[1]).lower() == OWNER

    def deny(self, request):
        """None — можно; иначе готовый ответ 401/403."""
        u = self.user_of(request)
        if not u:
            return web.json_response({"error": "нужно войти", "login": True}, status=401)
        if str(u[1]).lower() != OWNER:
            return web.json_response({"error": "нет доступа"}, status=403)
        return None

    # ---------- файлы ----------
    def path_of(self, name):
        name = clean_name(name)
        if not name or name.startswith("."):
            return None
        p = (self.root / name).resolve()
        return p if p.parent == self.root else None

    def listing(self):
        out = []
        for p in self.root.iterdir():
            if p.is_file() and not p.name.startswith(".") and not p.name.endswith(".part"):
                st = p.stat()
                out.append({"name": p.name, "size": st.st_size, "t": int(st.st_mtime)})
        out.sort(key=lambda f: -f["t"])
        return out

    def unique(self, name):
        p = self.root / name
        if not p.exists():
            return p
        stem, dot, ext = name.rpartition(".")
        if not dot:
            stem, ext = name, ""
        for i in range(2, 1000):
            q = self.root / (f"{stem} ({i})" + (f".{ext}" if ext else ""))
            if not q.exists():
                return q
        return self.root / f"{int(time.time())}-{name}"

    # ---------- обработчики ----------
    async def api_list(self, request):
        if (d := self.deny(request)):
            return d
        files = self.listing()
        return web.json_response({"files": files, "max": MAX_FILE, "quota": QUOTA,
                                  "used": sum(f["size"] for f in files)}, headers={"Cache-Control": "no-store"})

    async def api_upload(self, request):
        if (d := self.deny(request)):
            return d
        used = sum(f["size"] for f in self.listing())
        saved = []
        reader = await request.multipart()
        while (part := await reader.next()) is not None:
            if part.name != "file" or not part.filename:
                continue
            name = clean_name(part.filename)
            if not name or name.startswith("."):
                name = "file"
            dest = self.unique(name)
            tmp = dest.with_name(dest.name + ".part")
            size = 0
            try:
                with open(tmp, "wb") as f:
                    while (chunk := await part.read_chunk(1024 * 1024)):
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise web.HTTPRequestEntityTooLarge(max_size=MAX_FILE, actual_size=size,
                                                                text=json.dumps({"error": "файл слишком большой"}))
                        if used + size > QUOTA:
                            raise web.HTTPRequestEntityTooLarge(max_size=QUOTA, actual_size=used + size,
                                                                text=json.dumps({"error": "папка заполнена"}))
                        f.write(chunk)
                os.replace(tmp, dest)
            except BaseException:
                tmp.unlink(missing_ok=True)
                raise
            used += size
            saved.append(dest.name)
            log.info("share: +%s (%d Б)", dest.name, size)
        return web.json_response({"ok": True, "saved": saved}, headers={"Cache-Control": "no-store"})

    async def api_file(self, request):
        if (d := self.deny(request)):
            return d
        p = self.path_of(request.match_info["name"])
        if p is None or not p.is_file():
            raise web.HTTPNotFound()
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        inline = request.query.get("inline") == "1" and ctype.startswith(INLINE_OK)
        # даже «inline» — только безопасные типы; всё остальное (html, svg, js…) скачивается
        disp = ("inline" if inline else "attachment") + "; filename*=UTF-8''" + quote(p.name)
        return web.FileResponse(p, headers={"Content-Type": ctype if inline else "application/octet-stream",
                                            "Content-Disposition": disp, "Cache-Control": "private, no-store"})

    async def api_delete(self, request):
        if (d := self.deny(request)):
            return d
        try:
            body = await request.json()
        except (ValueError, TypeError):
            body = {}
        p = self.path_of(body.get("name"))
        if p is None or not p.is_file():
            return web.json_response({"error": "нет такого файла"}, status=404)
        p.unlink()
        log.info("share: -%s", p.name)
        return web.json_response({"ok": True}, headers={"Cache-Control": "no-store"})

    def routes(self, app):
        app.router.add_get("/api/share/list", self.api_list)
        app.router.add_post("/api/share/upload", self.api_upload)
        app.router.add_get("/api/share/file/{name}", self.api_file)
        app.router.add_post("/api/share/delete", self.api_delete)
