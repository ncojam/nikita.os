#!/usr/bin/env python3
"""
Псевдо-сайты встроенного браузера nikita.os. Первый — форум Kursk Artists (kursk.artists).

Аккаунт — общий с чатом (chat.user_by_token): регистрация/вход через /api/chat/auth.
Картинки (аватарки и картинки в постах) жмёт браузер тем же инструментом, что и записи,
сервер проверяет их posts.validate_jpeg-логикой (магия, размер, размеры из SOF) без декодирования.

Хранилище — UFS_ROOT/.meta/forum.json (+ .meta/forum_media/<id>.jpg), как у записей.

  GET    /api/forum/sections                   -> разделы со счётчиками
  GET    /api/forum/s/{sec}?page=N             -> ветки раздела (свежие сверху)
  GET    /api/forum/t/{tid}?page=N             -> ветка + посты
  POST   /api/forum/threads   {section,title,text}
  POST   /api/forum/t/{tid}/posts {text}
  PATCH  /api/forum/p/{id}    {text}           (автор)
  DELETE /api/forum/p/{id}                     (автор; первый пост ветки — удаляет ветку)
  POST   /api/forum/img       <jpeg>           -> {url}  картинка для markdown-поста
  GET    /api/forum/u/{nick}                   -> профиль
  PATCH  /api/forum/me        {about, site, city}
  POST   /api/forum/me/avatar <jpeg> / DELETE
  GET    /media/f/{id}                         -> картинка
"""
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path

from aiohttp import web

from posts import jpeg_dims, clean_title

log = logging.getLogger("nikita.os.forum")

SECTIONS = {"general": "Общий"}           # пока один раздел
TITLE_MAX = 100
POST_MAX = int(os.environ.get("NOS_FORUM_POST_MAX", "8000"))     # markdown-текст поста
ABOUT_MAX, FIELD_MAX = 600, 60
IMG_MAX_BYTES = int(os.environ.get("NOS_FORUM_IMG_MAX", str(120 * 1024)))
IMG_MAX_DIM = int(os.environ.get("NOS_FORUM_IMG_DIM", "800"))    # картинка в посте
AVA_MAX_DIM = 256                                                # аватарка
STORE_CAP = int(os.environ.get("NOS_FORUM_STORE_CAP", str(300 * 1024 * 1024)))
IMG_PER_DAY = 30                         # загрузок картинок на пользователя в сутки
THREAD_EVERY = 10 * 60                   # новая ветка — не чаще раза в 10 минут
POST_EVERY = 20                          # пост — не чаще раза в 20 секунд
PAGE = 20                                # постов/веток на страницу
DAY = 24 * 3600

_CTRL = re.compile(r"[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


def clean_md(s, limit):
    s = _CTRL.sub("", str(s or "").replace("\r\n", "\n").replace("\r", "\n"))
    s = re.sub(r"\n{4,}", "\n\n\n", s).strip()
    return s[:limit]


def clean_line(s, limit):
    return _CTRL.sub("", str(s or "").replace("\n", " ")).strip()[:limit]


def check_jpeg(data, max_dim):
    if len(data) > IMG_MAX_BYTES:
        return f"картинка больше {IMG_MAX_BYTES // 1024} КБ"
    if data[:3] != b"\xff\xd8\xff":
        return "это не JPEG"
    dims = jpeg_dims(data)
    if not dims:
        return "битый JPEG"
    w, h = dims
    if w < 1 or h < 1 or w > max_dim or h > max_dim:
        return f"картинка должна быть не больше {max_dim}×{max_dim}"
    return None


class Forum:
    def __init__(self, ufs_root, user_of):
        self.dir = Path(ufs_root) / ".meta"
        self.media = self.dir / "forum_media"
        self.path = self.dir / "forum.json"
        self.user_of = user_of
        self.rate = {}                  # (uid, kind) -> время последнего действия (в памяти)
        self.d = {"threads": {}, "posts": {}, "profiles": {}, "images": {}}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            for k in self.d:
                if isinstance(raw.get(k), dict):
                    self.d[k] = raw[k]
        except (FileNotFoundError, ValueError, OSError):
            pass

    # ---------- диск ----------
    def save(self):
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.d, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("forum.json не сохранился: %s", e)

    def media_path(self, mid):
        return self.media / (mid + ".jpg")

    def _store_img(self, data):
        mid = secrets.token_urlsafe(9)
        self.media.mkdir(parents=True, exist_ok=True)
        tmp = self.media_path(mid).with_suffix(".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, self.media_path(mid))
        return mid

    def _rm_img(self, mid):
        self.d["images"].pop(mid, None)
        try:
            self.media_path(mid).unlink()
        except OSError:
            pass

    def _store_size(self):
        return sum(i.get("size", 0) for i in self.d["images"].values())

    def _enforce_cap(self):
        # склад переполнен — снимаем самые старые картинки постов (аватарки не трогаем)
        if self._store_size() <= STORE_CAP:
            return
        old = sorted((i.get("ts", 0), mid) for mid, i in self.d["images"].items() if i.get("kind") == "post")
        for _, mid in old:
            if self._store_size() <= STORE_CAP:
                break
            self._rm_img(mid)

    # ---------- помощники ----------
    def _me(self, request):
        u = self.user_of(request)
        return (u[0], u[1]) if u else (None, None)

    def _too_soon(self, uid, kind, every):
        now = time.time()
        last = self.rate.get((uid, kind), 0)
        if now - last < every:
            return int(every - (now - last)) + 1
        self.rate[(uid, kind)] = now
        return 0

    def _thread_posts(self, tid):
        return sorted((p for p in self.d["posts"].values() if p["tid"] == tid), key=lambda p: p["created"])

    def _pub_post(self, pid, p):
        prof = self.d["profiles"].get(str(p["uid"]), {})
        return {"id": pid, "author": p["nick"], "ava": prof.get("ava"), "text": p["text"],
                "created": p["created"], "edited": p.get("edited", 0)}

    def _pub_thread(self, tid, t):
        return {"id": tid, "section": t["section"], "title": t["title"], "author": t["nick"],
                "created": t["created"], "last": t.get("last", t["created"]),
                "last_by": t.get("last_by", t["nick"]), "replies": max(0, t.get("count", 1) - 1)}

    # ---------- чтение ----------
    async def api_sections(self, request):
        out = []
        for sid, name in SECTIONS.items():
            th = [t for t in self.d["threads"].values() if t["section"] == sid]
            out.append({"id": sid, "name": name, "threads": len(th),
                        "posts": sum(t.get("count", 1) for t in th),
                        "last": max((t.get("last", 0) for t in th), default=0)})
        return web.json_response({"sections": out})

    async def api_section(self, request):
        sid = request.match_info["sec"]
        if sid not in SECTIONS:
            return web.json_response({"error": "нет такого раздела"}, status=404)
        q = request.query.get("page", "1")
        page = max(1, int(q)) if q.isdigit() else 1
        th = sorted(((tid, t) for tid, t in self.d["threads"].items() if t["section"] == sid),
                    key=lambda x: -x[1].get("last", 0))
        pages = max(1, -(-len(th) // PAGE))
        chunk = th[(page - 1) * PAGE: page * PAGE]
        return web.json_response({"section": {"id": sid, "name": SECTIONS[sid]}, "page": page, "pages": pages,
                                  "threads": [self._pub_thread(tid, t) for tid, t in chunk]})

    async def api_thread(self, request):
        tid = request.match_info["tid"]
        t = self.d["threads"].get(tid)
        if not t:
            return web.json_response({"error": "ветка не найдена"}, status=404)
        q = request.query.get("page", "1")
        posts = [(p["_id"], p) for p in self._thread_posts(tid)]
        pages = max(1, -(-len(posts) // PAGE))
        page = pages if q == "last" else max(1, min(pages, int(q) if q.isdigit() else 1))
        chunk = posts[(page - 1) * PAGE: page * PAGE]
        return web.json_response({"thread": self._pub_thread(tid, t), "page": page, "pages": pages,
                                  "section_name": SECTIONS.get(t["section"], t["section"]),
                                  "posts": [self._pub_post(pid, p) for pid, p in chunk]})

    async def api_user(self, request):
        nick = request.match_info["nick"].lower()
        mine = [p for p in self.d["posts"].values() if p["nick"].lower() == nick]
        uid = None
        for k, pr in self.d["profiles"].items():
            if pr.get("nick", "").lower() == nick:
                uid = k
        if uid is None and mine:
            uid = str(mine[0]["uid"])
        if uid is None:
            return web.json_response({"error": "нет такого пользователя на форуме"}, status=404)
        pr = self.d["profiles"].get(uid, {})
        threads = [self._pub_thread(tid, t) for tid, t in self.d["threads"].items() if str(t["uid"]) == uid]
        threads.sort(key=lambda t: -t["created"])
        nick_shown = pr.get("nick") or (mine[0]["nick"] if mine else nick)
        return web.json_response({"nick": nick_shown, "about": pr.get("about", ""), "site": pr.get("site", ""),
                                  "city": pr.get("city", ""), "ava": pr.get("ava"),
                                  "joined": pr.get("joined") or min((p["created"] for p in mine), default=0),
                                  "posts": len(mine), "threads": threads[:20]})

    # ---------- запись ----------
    async def _body(self, request):
        try:
            return await request.json()
        except (ValueError, TypeError):
            return {}

    def _touch_profile(self, uid, nick):
        pr = self.d["profiles"].setdefault(str(uid), {})
        pr["nick"] = nick
        pr.setdefault("joined", int(time.time()))
        return pr

    def _add_post(self, tid, uid, nick, text):
        pid = secrets.token_urlsafe(8)
        now = int(time.time())
        self.d["posts"][pid] = {"_id": pid, "tid": tid, "uid": uid, "nick": nick, "text": text, "created": now}
        t = self.d["threads"][tid]
        t["count"] = t.get("count", 0) + 1
        t["last"], t["last_by"] = now, nick
        self._touch_profile(uid, nick)
        return pid

    async def api_new_thread(self, request):
        uid, nick = self._me(request)
        if not uid:
            return web.json_response({"error": "нужно войти"}, status=401)
        b = await self._body(request)
        sid = b.get("section")
        if sid not in SECTIONS:
            return web.json_response({"error": "нет такого раздела"}, status=400)
        title = clean_title(b.get("title"))[:TITLE_MAX]
        text = clean_md(b.get("text"), POST_MAX)
        if not title or not text:
            return web.json_response({"error": "нужны заголовок и текст"}, status=400)
        wait = self._too_soon(uid, "thread", THREAD_EVERY)
        if wait:
            return web.json_response({"error": f"новую ветку можно через ~{wait // 60 + 1} мин"}, status=429)
        tid = secrets.token_urlsafe(6)
        self.d["threads"][tid] = {"section": sid, "title": title, "uid": uid, "nick": nick,
                                  "created": int(time.time()), "count": 0}
        self._add_post(tid, uid, nick, text)
        self.save()
        return web.json_response({"id": tid, "section": sid})

    async def api_reply(self, request):
        uid, nick = self._me(request)
        if not uid:
            return web.json_response({"error": "нужно войти"}, status=401)
        tid = request.match_info["tid"]
        if tid not in self.d["threads"]:
            return web.json_response({"error": "ветка не найдена"}, status=404)
        text = clean_md((await self._body(request)).get("text"), POST_MAX)
        if not text:
            return web.json_response({"error": "пустой пост"}, status=400)
        wait = self._too_soon(uid, "post", POST_EVERY)
        if wait:
            return web.json_response({"error": f"не так быстро — подождите {wait} с"}, status=429)
        pid = self._add_post(tid, uid, nick, text)
        self.save()
        return web.json_response({"id": pid})

    def _own_post(self, request):
        uid, _ = self._me(request)
        p = self.d["posts"].get(request.match_info["id"])
        if not p:
            return None, web.json_response({"error": "пост не найден"}, status=404)
        if not uid or uid != p["uid"]:
            return None, web.json_response({"error": "это может только автор"}, status=403)
        return p, None

    async def api_edit(self, request):
        p, err = self._own_post(request)
        if err:
            return err
        text = clean_md((await self._body(request)).get("text"), POST_MAX)
        if not text:
            return web.json_response({"error": "пустой пост"}, status=400)
        p["text"], p["edited"] = text, int(time.time())
        self.save()
        return web.json_response({"ok": True})

    async def api_delete(self, request):
        p, err = self._own_post(request)
        if err:
            return err
        tid = p["tid"]
        first = self._thread_posts(tid)[0]
        if first["_id"] == p["_id"]:
            # первый пост = вся ветка (удалить ветку может только её автор, а он и есть автор 1-го поста)
            for q in self._thread_posts(tid):
                self.d["posts"].pop(q["_id"], None)
            self.d["threads"].pop(tid, None)
            self.save()
            return web.json_response({"ok": True, "thread_gone": True})
        self.d["posts"].pop(p["_id"], None)
        t = self.d["threads"][tid]
        t["count"] = max(1, t.get("count", 1) - 1)
        self.save()
        return web.json_response({"ok": True})

    async def _take_img(self, request, max_dim, kind):
        uid, nick = self._me(request)
        if not uid:
            return None, None, web.json_response({"error": "нужно войти"}, status=401)
        data = await request.read()
        bad = check_jpeg(data, max_dim)
        if bad:
            return None, None, web.json_response({"error": bad}, status=400)
        day = int(time.time()) // DAY
        today = sum(1 for i in self.d["images"].values() if i["uid"] == uid and i.get("ts", 0) // DAY == day)
        if today >= IMG_PER_DAY:
            return None, None, web.json_response({"error": "на сегодня картинок хватит"}, status=429)
        try:
            mid = self._store_img(data)
        except OSError:
            return None, None, web.json_response({"error": "не удалось сохранить"}, status=500)
        self.d["images"][mid] = {"uid": uid, "ts": int(time.time()), "size": len(data), "kind": kind}
        return uid, nick, mid

    async def api_img(self, request):
        uid, nick, mid = await self._take_img(request, IMG_MAX_DIM, "post")
        if not uid:
            return mid
        self._enforce_cap()
        self.save()
        return web.json_response({"url": "/media/f/" + mid})

    async def api_me_edit(self, request):
        uid, nick = self._me(request)
        if not uid:
            return web.json_response({"error": "нужно войти"}, status=401)
        b = await self._body(request)
        pr = self._touch_profile(uid, nick)
        pr["about"] = clean_md(b.get("about"), ABOUT_MAX)
        pr["city"] = clean_line(b.get("city"), FIELD_MAX)
        site = clean_line(b.get("site"), 200)
        pr["site"] = site if re.match(r"^https?://", site) else ""
        self.save()
        return web.json_response({"ok": True})

    async def api_avatar(self, request):
        uid, nick, mid = await self._take_img(request, AVA_MAX_DIM, "ava")
        if not uid:
            return mid
        pr = self._touch_profile(uid, nick)
        old = pr.get("ava")
        pr["ava"] = "/media/f/" + mid
        if old:
            self._rm_img(old.rsplit("/", 1)[-1])
        self.save()
        return web.json_response({"url": pr["ava"]})

    async def api_avatar_del(self, request):
        uid, nick = self._me(request)
        if not uid:
            return web.json_response({"error": "нужно войти"}, status=401)
        pr = self._touch_profile(uid, nick)
        if pr.get("ava"):
            self._rm_img(pr.pop("ava").rsplit("/", 1)[-1])
            self.save()
        return web.json_response({"ok": True})

    async def serve_media(self, request):
        mid = request.match_info["id"]
        if not _ID_RE.match(mid) or mid not in self.d["images"]:
            raise web.HTTPNotFound()
        f = self.media_path(mid)
        if not f.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(f, headers={"Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400"})

    def routes(self, app):
        r = app.router
        r.add_get("/api/forum/sections", self.api_sections)
        r.add_get("/api/forum/s/{sec}", self.api_section)
        r.add_get("/api/forum/t/{tid}", self.api_thread)
        r.add_post("/api/forum/threads", self.api_new_thread)
        r.add_post("/api/forum/t/{tid}/posts", self.api_reply)
        r.add_patch("/api/forum/p/{id}", self.api_edit)
        r.add_delete("/api/forum/p/{id}", self.api_delete)
        r.add_post("/api/forum/img", self.api_img)
        r.add_get("/api/forum/u/{nick}", self.api_user)
        r.add_patch("/api/forum/me", self.api_me_edit)
        r.add_post("/api/forum/me/avatar", self.api_avatar)
        r.add_delete("/api/forum/me/avatar", self.api_avatar_del)
        r.add_get("/media/f/{id}", self.serve_media)
