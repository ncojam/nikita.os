#!/usr/bin/env python3
"""
NETWORK (net.work) — нетворкинг-сайт для криейтеров во встроенном браузере nikita.os.

Аккаунт — общий для всей системы (chat.user_by_token, вход — /api/chat/auth). Здесь — только то, что своё у NETWORK:
  • профиль криейтера: имя, аватарка (кружок), ссылки (≤ 30), виды деятельности (≤ 30 тегов), статус, локация,
    «о себе», прикреплённые треки (mp3 или проект DAWN из ФС);
  • свои mp3: ≤ MP3_PER_USER файлов в папке /home/network/<ник> (настоящие файлы общего слоя /ufs —
    проводник, плеер и /fs видят их без особого кода);
  • поиск людей (фильтры) и «найди мне своих» (подбор по интересам);
  • общая стена граффити: штрихи баллончика. Свежие хранятся списком (клиент рисует их сам), а раз в какое-то время
    браузер владельца (WALL_ADMIN, по умолчанию cojam) «запекает» всю краску в одну картинку WebP/PNG —
    штрихи до неё удаляются. Сервер не рисует (рисовалка спрея — только в JS) и чужие картинки стены не принимает.
Форум NETWORK — тот же forum.Forum, отдельный экземпляр (см. server.py), аватарки постов берёт отсюда (decorate).

Хранилище: UFS_ROOT/.meta/network.json (профили), .meta/network_media/<id>.jpg (аватарки),
           .meta/netwall.jsonl (незапечённые штрихи: по строке на штрих, дописываем в конец),
           .meta/netwall_bake.json + netwall_bake.webp|png (запечённая краска), .meta/netwall_log.jsonl (кто где
           рисовал: id, uid, время, рамка — для модерации; сами точки после запекания не хранятся).

  GET    /api/net/me                       -> {nick, profile|null, uploads, limits}
  PUT    /api/net/me        {профиль}      -> {profile}
  POST   /api/net/me/avatar <jpeg> / DELETE
  GET    /api/net/u/{nick}                 -> профиль
  GET    /api/net/people?q=&tags=a,b&status=&seeks=&loc=&web=1&page=
  GET    /api/net/match                    -> подбор для меня (нужен профиль)
  GET    /api/net/tags                     -> [[тег, сколько]] — теги, которые уже кто-то указал
  GET    /api/net/home                     -> счётчики и новенькие
  POST   /api/net/tracks?name=…  <mp3>     -> {path}     (потоком)
  DELETE /api/net/tracks?name=…
  GET    /api/net/wall?since=ID            -> {strokes, last, bake: {url, upto} | null, canBake}
  POST   /api/net/wall      {c,k,s,p}      -> {id}
  POST   /api/net/wall/bake?upto=ID <webp|png 1600×900>   (только WALL_ADMIN) -> {ok, upto}
  GET    /media/nw/bake                    -> запечённая краска
  GET    /media/na/{id}                    -> аватарка
"""
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path

from aiohttp import web

from forum import clean_line, clean_md, _ID_RE

log = logging.getLogger("nikita.os.network")

NAME_MAX, ABOUT_MAX, WITH_MAX = 40, 1000, 120
LINKS_MAX, TAGS_MAX, ROLES_MAX, TRACKS_MAX = 30, 30, 10, 6
TAG_MAX_LEN = 32
AVA_DIM = int(os.environ.get("NOS_NET_AVA_DIM", "400"))                # аватарка: крупнее и качественнее форумной
AVA_BYTES = int(os.environ.get("NOS_NET_AVA_KB", "180")) * 1024
MP3_PER_USER = int(os.environ.get("NOS_NET_MP3_PER_USER", "2"))
MP3_MAX = int(os.environ.get("NOS_NET_MP3_MB", "12")) * 1024 * 1024
MP3_CAP = int(os.environ.get("NOS_NET_MP3_CAP_MB", "3000")) * 1024 * 1024   # все mp3 NETWORK вместе
TRACKS_DIR = "/home/network"                                           # виртуальная папка, внутри — по нику
STATUS = ("collab", "looking", "creating", "busy", "with", "idle")     # wanna collab, looking for, … don't do shit
PAGE = 24
SAVE_EVERY, UPLOAD_EVERY, AVA_EVERY = 3, 8, 10

# стена: размер мира, ограничения штриха
WALL_W, WALL_H = 1600, 900
WALL_COLORS, WALL_CAPS = 10, 3
WALL_PTS = 260                         # точек в штрихе (x, y, dt)
WALL_DUR = 9000                        # мс: дольше держать кнопку в одном штрихе нельзя
WALL_CAP = int(os.environ.get("NOS_NET_WALL_STROKES", "2500"))   # потолок незапечённых: дальше старые уходят
WALL_ADMIN = os.environ.get("NOS_NET_WALL_ADMIN", os.environ.get("NOS_SHARE_OWNER", "cojam")).lower()
BAKE_MAX = 8 * 1024 * 1024                                        # картинка запекания (обычно 0.3–2 МБ)
WALL_DAY = int(os.environ.get("NOS_NET_WALL_DAY", "600"))        # штрихов на человека в сутки
WALL_EVERY = 0.15
DAY = 24 * 3600

_TAG_BAD = re.compile(r"[^\w \-+&./#']", re.UNICODE)
_MP3_NAME_BAD = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


def norm_tag(s):
    s = _TAG_BAD.sub("", str(s or "").lower().replace("_", " "))
    return re.sub(r"\s+", " ", s).strip(" -./")[:TAG_MAX_LEN]


def norm_tags(raw, limit):
    out = []
    for t in raw if isinstance(raw, list) else []:
        t = norm_tag(t)
        if t and t not in out:
            out.append(t)
        if len(out) >= limit:
            break
    return out


def is_mp3(head):
    return head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)


class Network:
    """user_of(request) -> (uid, nick) | None; real(v) -> путь в /ufs; file_ok(v) -> есть ли файл в сшитой ФС."""

    def __init__(self, ufs_root, user_of, real, file_ok, forum=None):
        self.root = Path(ufs_root)
        self.dir = self.root / ".meta"
        self.path = self.dir / "network.json"
        self.media = self.dir / "network_media"
        self.wall_path = self.dir / "netwall.jsonl"
        self.log_path = self.dir / "netwall_log.jsonl"
        self.bake_meta = self.dir / "netwall_bake.json"
        self.user_of, self.real, self.file_ok = user_of, real, file_ok
        self.forum = forum                       # форум NETWORK: свежие ветки и счётчики в профиле
        self.rate = {}
        self.profiles = {}                       # uid(str) -> профиль
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(raw.get("profiles"), dict):
                self.profiles = raw["profiles"]
        except (FileNotFoundError, ValueError, OSError):
            pass
        self.wall, self.wall_last = [], 0      # wall: [(id, готовая JSON-строка штриха)] — в памяти ≈ размер файла
        self.bake = None                       # {upto, v, ext}
        self._load_wall()

    # ---------- диск ----------
    def save(self):
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"profiles": self.profiles}, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError as e:
            log.warning("network.json не сохранился: %s", e)

    def _load_wall(self):
        try:
            b = json.loads(self.bake_meta.read_text(encoding="utf-8"))
            if isinstance(b.get("upto"), int) and (self.dir / f"netwall_bake.{b.get('ext')}").is_file():
                self.bake = b
        except (OSError, ValueError):
            pass
        upto = self.bake["upto"] if self.bake else 0
        try:
            with self.wall_path.open(encoding="utf-8") as f:
                for line in f:
                    try:
                        x = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(x, dict) and isinstance(x.get("id"), int) and x["id"] > upto:
                        self.wall.append((x["id"], self._pub_line(x)))
        except OSError:
            pass
        self.wall = self.wall[-WALL_CAP:]
        self.wall_last = max(self.wall[-1][0] if self.wall else 0, upto)

    @staticmethod
    def _pub_line(x):
        return json.dumps({k: x[k] for k in ("id", "c", "k", "s", "p")}, separators=(",", ":"))

    def _rewrite_wall(self):
        tmp = self.wall_path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            for _, line in self.wall:
                f.write(line + "\n")
        os.replace(tmp, self.wall_path)

    def _append_wall(self, sid, line, log):
        try:
            self.dir.mkdir(parents=True, exist_ok=True)
            if len(self.wall) > WALL_CAP:          # давно не запекали: старые штрихи уходят, файл переписываем
                self.wall = self.wall[-WALL_CAP:]
                self._rewrite_wall()
            else:
                with self.wall_path.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(log, separators=(",", ":")) + "\n")
        except OSError as e:
            logging.getLogger("nikita.os.network").warning("стена не сохранилась: %s", e)

    # ---------- помощники ----------
    def _me(self, request):
        u = self.user_of(request)
        return (str(u[0]), u[1]) if u else (None, None)

    def _too_soon(self, uid, kind, every):
        now = time.time()
        last = self.rate.get((uid, kind), 0)
        if now - last < every:
            return max(1, int(every - (now - last)) + 1)
        self.rate[(uid, kind)] = now
        return 0

    @staticmethod
    def _err(text, status=400, **extra):
        return web.json_response({"error": text, **extra}, status=status)

    async def _body(self, request):
        try:
            b = await request.json()
            return b if isinstance(b, dict) else {}
        except (ValueError, TypeError):
            return {}

    def pub(self, pr):
        return {k: pr.get(k) for k in ("nick", "name", "ava", "links", "tags", "status", "loc", "about",
                                        "tracks", "joined", "updated")}

    def card(self, pr):
        """Короткая карточка для списков."""
        return {k: pr.get(k) for k in ("nick", "name", "ava", "tags", "status", "loc", "updated")}

    def decorate(self, uid):
        pr = self.profiles.get(str(uid))
        if not pr:
            return {}
        return {"ava": pr.get("ava"), "name": pr.get("name"), "st": (pr.get("status") or {}).get("k")}

    def by_nick(self, nick):
        nick = nick.lower()
        for uid, pr in self.profiles.items():
            if pr.get("nick", "").lower() == nick:
                return uid, pr
        return None, None

    # ---------- свои mp3 ----------
    def _tracks_vdir(self, nick):
        return f"{TRACKS_DIR}/{nick}"

    def _tracks_real(self, nick):
        return self.real(self._tracks_vdir(nick))

    def uploads(self, nick):
        d = self._tracks_real(nick)
        out = []
        if d and d.is_dir():
            for f in sorted(d.iterdir()):
                if f.is_file() and f.suffix.lower() == ".mp3" and not f.name.startswith("."):
                    out.append({"name": f.name, "path": f"{self._tracks_vdir(nick)}/{f.name}", "size": f.stat().st_size})
        return out

    def _mp3_total(self):
        base = self.real(TRACKS_DIR)
        if not base or not base.is_dir():
            return 0
        return sum(f.stat().st_size for f in base.rglob("*.mp3") if f.is_file())

    async def api_upload(self, request):
        uid, nick = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        name = _MP3_NAME_BAD.sub("_", str(request.query.get("name") or "").split("/")[-1]).strip(" .")
        stem = name[:-4] if name.lower().endswith(".mp3") else name
        stem = stem.strip(" .")[:80]
        if not stem:
            return self._err("нужно имя файла")
        name = stem + ".mp3"
        d = self._tracks_real(nick)
        if d is None:
            return self._err("плохое имя папки")
        mine = self.uploads(nick)
        if len(mine) >= MP3_PER_USER and name not in {m["name"] for m in mine}:
            return self._err(f"можно держать только {MP3_PER_USER} mp3 — удалите старый", 409)
        clen = request.content_length
        if clen is not None and clen > MP3_MAX:
            return self._err(f"файл больше {MP3_MAX // 1048576} МБ", 413)
        if self._mp3_total() + (clen or 0) > MP3_CAP:
            return self._err("склад треков NETWORK заполнен", 507)
        wait = self._too_soon(uid, "upload", UPLOAD_EVERY)
        if wait:
            return self._err(f"не так быстро — подождите {wait} с", 429)
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / (".up-" + secrets.token_hex(4))
        got, head = 0, b""
        try:
            with tmp.open("wb") as f:
                async for chunk in request.content.iter_chunked(64 * 1024):
                    if len(head) < 4:
                        head += chunk[:4]
                        if len(head) >= 4 and not is_mp3(head):
                            raise ValueError("это не mp3")
                    got += len(chunk)
                    if got > MP3_MAX:
                        raise ValueError(f"файл больше {MP3_MAX // 1048576} МБ")
                    f.write(chunk)
            if got < 1024 or not is_mp3(head):
                raise ValueError("это не mp3")
            os.replace(tmp, d / name)
        except ValueError as e:
            tmp.unlink(missing_ok=True)
            return self._err(str(e))
        except OSError:
            tmp.unlink(missing_ok=True)
            return self._err("не удалось сохранить", 500)
        return web.json_response({"path": f"{self._tracks_vdir(nick)}/{name}", "uploads": self.uploads(nick)})

    async def api_upload_del(self, request):
        uid, nick = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        name = str(request.query.get("name") or "").split("/")[-1]
        d = self._tracks_real(nick)
        f = d / name if d and name and not name.startswith(".") else None
        if not f or not f.is_file():
            return self._err("нет такого файла", 404)
        f.unlink()
        v = f"{self._tracks_vdir(nick)}/{name}"
        pr = self.profiles.get(uid)
        if pr and v in (pr.get("tracks") or []):
            pr["tracks"].remove(v)
            self.save()
        return web.json_response({"ok": True, "uploads": self.uploads(nick)})

    # ---------- профиль ----------
    async def api_me(self, request):
        uid, nick = self._me(request)
        if not uid:
            return web.json_response({"nick": None})
        pr = self.profiles.get(uid)
        return web.json_response({"nick": nick, "profile": self.pub(pr) if pr else None, "uploads": self.uploads(nick),
                                  "limits": {"mp3": MP3_PER_USER, "mp3MB": MP3_MAX // 1048576, "links": LINKS_MAX,
                                             "tags": TAGS_MAX, "tracks": TRACKS_MAX, "about": ABOUT_MAX,
                                             "avaDim": AVA_DIM, "avaKB": AVA_BYTES // 1024}})

    def _clean_links(self, raw):
        out = []
        for x in raw if isinstance(raw, list) else []:
            if not isinstance(x, dict):
                continue
            u = clean_line(x.get("u"), 300)
            if not re.match(r"^https?://[^\s/]+\.[^\s]+", u):
                continue
            out.append({"u": u, "t": clean_line(x.get("t"), 24)})
            if len(out) >= LINKS_MAX:
                break
        return out

    def _clean_status(self, raw):
        raw = raw if isinstance(raw, dict) else {}
        k = raw.get("k") if raw.get("k") in STATUS else "creating"
        st = {"k": k}
        if k in ("collab", "looking"):
            st["roles"] = norm_tags(raw.get("roles"), ROLES_MAX)
        if k == "with":
            st["with"] = clean_line(raw.get("with"), WITH_MAX)
        return st

    async def api_me_save(self, request):
        uid, nick = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        b = await self._body(request)
        name = clean_line(b.get("name"), NAME_MAX)
        if not name:
            return self._err("укажите имя")
        if isinstance(b.get("links"), list) and len(b["links"]) > LINKS_MAX:
            return self._err(f"не больше {LINKS_MAX} ссылок")
        if isinstance(b.get("tags"), list) and len(b["tags"]) > TAGS_MAX:
            return self._err(f"не больше {TAGS_MAX} видов деятельности")
        tracks = []
        for v in b.get("tracks") if isinstance(b.get("tracks"), list) else []:
            v = "/" + str(v or "").strip("/")
            if re.search(r"\.(mp3|dawn|wav|ogg|flac|m4a|opus)$", v, re.I) and v not in tracks and self.file_ok(v):
                tracks.append(v)
            if len(tracks) >= TRACKS_MAX:
                break
        loc = b.get("loc") if isinstance(b.get("loc"), dict) else {}
        wait = self._too_soon(uid, "save", SAVE_EVERY)
        if wait:
            return self._err(f"не так быстро — подождите {wait} с", 429)
        now = int(time.time())
        pr = self.profiles.setdefault(uid, {"joined": now})
        pr.update({
            "nick": nick, "name": name, "links": self._clean_links(b.get("links")),
            "tags": norm_tags(b.get("tags"), TAGS_MAX), "status": self._clean_status(b.get("status")),
            "loc": {"city": clean_line(loc.get("city"), 60), "country": clean_line(loc.get("country"), 60),
                    "web": bool(loc.get("web"))},
            "about": clean_md(b.get("about"), ABOUT_MAX), "tracks": tracks, "updated": now,
        })
        self.save()
        return web.json_response({"profile": self.pub(pr)})

    def _media_path(self, mid):
        return self.media / (mid + ".jpg")

    async def api_avatar(self, request):
        uid, nick = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        if uid not in self.profiles:
            return self._err("сначала сохраните профиль", 409)
        data = await request.read()
        if len(data) > AVA_BYTES:
            return self._err(f"картинка больше {AVA_BYTES // 1024} КБ")
        bad = self._check_jpeg(data)
        if bad:
            return self._err(bad)
        wait = self._too_soon(uid, "ava", AVA_EVERY)
        if wait:
            return self._err(f"не так быстро — подождите {wait} с", 429)
        mid = secrets.token_urlsafe(9)
        try:
            self.media.mkdir(parents=True, exist_ok=True)
            tmp = self._media_path(mid).with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, self._media_path(mid))
        except OSError:
            return self._err("не удалось сохранить", 500)
        pr = self.profiles[uid]
        self._drop_ava(pr)
        pr["ava"] = "/media/na/" + mid
        self.save()
        return web.json_response({"url": pr["ava"]})

    @staticmethod
    def _check_jpeg(data):
        # check_jpeg из forum режет по своему потолку байт (120 КБ) — у аватарки NETWORK потолок свой
        from posts import jpeg_dims
        if data[:3] != b"\xff\xd8\xff":
            return "это не JPEG"
        dims = jpeg_dims(data)
        if not dims:
            return "битый JPEG"
        if dims[0] < 1 or dims[1] < 1 or max(dims) > AVA_DIM:
            return f"картинка должна быть не больше {AVA_DIM}×{AVA_DIM}"
        return None

    def _drop_ava(self, pr):
        old = pr.pop("ava", None)
        if old:
            try:
                self._media_path(old.rsplit("/", 1)[-1]).unlink()
            except OSError:
                pass

    async def api_avatar_del(self, request):
        uid, _ = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        pr = self.profiles.get(uid)
        if pr and pr.get("ava"):
            self._drop_ava(pr)
            self.save()
        return web.json_response({"ok": True})

    async def serve_media(self, request):
        mid = request.match_info["id"]
        f = self._media_path(mid)
        if not _ID_RE.match(mid) or not f.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(f, headers={"Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400"})

    async def api_user(self, request):
        uid, pr = self.by_nick(request.match_info["nick"])
        if not pr:
            return self._err("такого криейтера в NETWORK нет", 404)
        out = self.pub(pr)
        if self.forum:
            out["threads"] = self.forum.user_threads(uid)
            out["posts"] = self.forum.user_posts(uid)
        return web.json_response(out)

    # ---------- поиск и подбор ----------
    @staticmethod
    def _seeks(pr):
        st = pr.get("status") or {}
        return set(st.get("roles") or []) if st.get("k") in ("collab", "looking") else set()

    async def api_people(self, request):
        q = request.query
        text = (q.get("q") or "").strip().lower()[:60]
        tags = set(norm_tags((q.get("tags") or "").split(","), 30))
        status = q.get("status") if q.get("status") in STATUS else None
        seeks = norm_tag(q.get("seeks") or "")
        loc = (q.get("loc") or "").strip().lower()[:60]
        web_only = q.get("web") == "1"
        rows = []
        for pr in self.profiles.values():
            st = pr.get("status") or {}
            if status and st.get("k") != status:
                continue
            if seeks and seeks not in self._seeks(pr):
                continue
            lc = pr.get("loc") or {}
            if web_only and not lc.get("web"):
                continue
            if loc and loc not in (lc.get("city") or "").lower() and loc not in (lc.get("country") or "").lower():
                continue
            hit = len(tags & set(pr.get("tags") or [])) if tags else 0
            if tags and not hit:
                continue
            if text:
                hay = " ".join([pr.get("nick", ""), pr.get("name", ""), pr.get("about", ""),
                                " ".join(pr.get("tags") or [])]).lower()
                if text not in hay:
                    continue
            rows.append((-hit, -pr.get("updated", 0), pr))
        rows.sort(key=lambda r: (r[0], r[1]))
        p = request.query.get("page", "1")
        page = max(1, int(p)) if p.isdigit() else 1
        pages = max(1, -(-len(rows) // PAGE))
        chunk = rows[(page - 1) * PAGE: page * PAGE]
        return web.json_response({"total": len(rows), "page": page, "pages": pages,
                                  "people": [dict(self.card(r[2]), hit=-r[0]) for r in chunk]})

    async def api_match(self, request):
        uid, _ = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        me = self.profiles.get(uid)
        if not me:
            return self._err("сначала заполните профиль — без него не с чем сравнивать", 409)
        my_tags, my_seeks = set(me.get("tags") or []), self._seeks(me)
        ml = me.get("loc") or {}
        out = []
        for ouid, pr in self.profiles.items():
            if ouid == uid:
                continue
            tags, seeks = set(pr.get("tags") or []), self._seeks(pr)
            lc = pr.get("loc") or {}
            score, why = 0.0, []
            they_need = sorted(seeks & my_tags)
            i_need = sorted(my_seeks & tags)
            common = sorted(my_tags & tags)
            if they_need:
                score += 5 * len(they_need); why.append("ищет " + ", ".join(they_need) + " — это ты")
            if i_need:
                score += 5 * len(i_need); why.append("ты ищешь " + ", ".join(i_need))
            if common:
                score += 2 * len(common); why.append("общее: " + ", ".join(common[:5]))
            city, country = (lc.get("city") or "").lower(), (lc.get("country") or "").lower()
            if city and city == (ml.get("city") or "").lower():
                score += 3; why.append("тоже " + lc["city"])
            elif country and country == (ml.get("country") or "").lower():
                score += 1.5; why.append("тоже " + lc["country"])
            if lc.get("web") and ml.get("web"):
                score += 1; why.append("оба в вебе")
            k = (pr.get("status") or {}).get("k")
            score += {"collab": 1.5, "looking": 1.5, "creating": 0.5, "busy": -0.5, "idle": -1}.get(k, 0)
            if score <= 0.5:
                continue
            score += min(1.0, (pr.get("updated", 0) - time.time() + 90 * DAY) / (90 * DAY))   # свежим — чуть выше
            out.append((score, dict(self.card(pr), why=why, score=round(score, 1))))
        out.sort(key=lambda x: -x[0])
        return web.json_response({"people": [x[1] for x in out[:24]]})

    async def api_tags(self, request):
        cnt = {}
        for pr in self.profiles.values():
            for t in set((pr.get("tags") or []) + list(self._seeks(pr))):
                cnt[t] = cnt.get(t, 0) + 1
        return web.json_response({"tags": sorted(cnt.items(), key=lambda x: (-x[1], x[0]))[:400]})

    async def api_home(self, request):
        fresh = sorted(self.profiles.values(), key=lambda p: -p.get("joined", 0))[:8]
        collab = sum(1 for p in self.profiles.values() if (p.get("status") or {}).get("k") in ("collab", "looking"))
        return web.json_response({"people": len(self.profiles), "collab": collab, "strokes": self.wall_last,
                                  "fresh": [self.card(p) for p in fresh],
                                  "threads": self.forum.recent(6) if self.forum else []})

    # ---------- стена граффити ----------
    def _can_bake(self, request):
        u = self.user_of(request)
        return bool(u and u[1].lower() == WALL_ADMIN)

    async def api_wall(self, request):
        s = request.query.get("since", "0")
        since = int(s) if s.isdigit() else 0
        lines = [line for sid, line in self.wall if sid > since]
        bake = {"url": f"/media/nw/bake?v={self.bake['v']}", "upto": self.bake["upto"]} if self.bake and not since else None
        head = json.dumps({"w": WALL_W, "h": WALL_H, "last": self.wall_last, "bake": bake, "canBake": self._can_bake(request)})
        # строки штрихов уже готовые — склеиваем, а не разбираем и собираем заново
        resp = web.Response(text=head[:-1] + ',"strokes":[' + ",".join(lines) + "]}", content_type="application/json",
                            headers={"Cache-Control": "no-store"})
        resp.enable_compression()
        return resp

    @staticmethod
    def _img_dims(data):
        """Размер картинки по заголовку (без декодирования): PNG или WebP (VP8X / VP8L / VP8)."""
        if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
            return "png", int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            ch = data[12:16]
            if ch == b"VP8X":
                return "webp", 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
            if ch == b"VP8L" and data[20] == 0x2F:
                b = int.from_bytes(data[21:25], "little")
                return "webp", (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
            if ch == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
                return "webp", int.from_bytes(data[26:28], "little") & 0x3FFF, int.from_bytes(data[28:30], "little") & 0x3FFF
        return None, 0, 0

    async def api_wall_bake(self, request):
        if not self._can_bake(request):
            return self._err("запекать стену может только владелец сайта", 403)
        q = request.query.get("upto", "")
        upto = int(q) if q.isdigit() else -1
        done = self.bake["upto"] if self.bake else 0
        if not done < upto <= self.wall_last:
            return self._err("нечего запекать")
        data = bytearray()
        async for chunk in request.content.iter_chunked(64 * 1024):
            data += chunk
            if len(data) > BAKE_MAX:
                return self._err("картинка стены слишком большая", 413)
        ext, w, h = self._img_dims(bytes(data[:64]))
        if not ext or (w, h) != (WALL_W, WALL_H):
            return self._err(f"нужна картинка PNG или WebP {WALL_W}×{WALL_H}")
        try:
            dst = self.dir / f"netwall_bake.{ext}"
            tmp = dst.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, dst)
            for other in ("png", "webp"):
                if other != ext:
                    (self.dir / f"netwall_bake.{other}").unlink(missing_ok=True)
            self.bake = {"upto": upto, "v": int(time.time()), "ext": ext}
            tmp = self.bake_meta.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.bake), encoding="utf-8")
            os.replace(tmp, self.bake_meta)
            self.wall = [x for x in self.wall if x[0] > upto]
            self._rewrite_wall()
        except OSError:
            return self._err("не удалось сохранить", 500)
        log.info("стена запечена до штриха %s (%s КБ, осталось штрихов %s)", upto, len(data) // 1024, len(self.wall))
        return web.json_response({"ok": True, "upto": upto, "left": len(self.wall)})

    async def serve_bake(self, request):
        if not self.bake:
            raise web.HTTPNotFound()
        f = self.dir / f"netwall_bake.{self.bake['ext']}"
        return web.FileResponse(f, headers={"Content-Type": "image/" + self.bake["ext"], "Cache-Control": "public, max-age=31536000"})

    async def api_wall_add(self, request):
        uid, _ = self._me(request)
        if not uid:
            return self._err("нужно войти", 401, login=True)
        b = await self._body(request)
        c, k, seed, p = b.get("c"), b.get("k"), b.get("s"), b.get("p")
        if not (isinstance(c, int) and 0 <= c < WALL_COLORS and isinstance(k, int) and 0 <= k < WALL_CAPS
                and isinstance(seed, int) and 0 <= seed < 2 ** 31 and isinstance(p, list)):
            return self._err("кривой штрих")
        if len(p) % 3 or not 3 <= len(p) <= WALL_PTS * 3 or not all(isinstance(v, int) for v in p):
            return self._err("кривой штрих")
        dur = 0
        for i in range(0, len(p), 3):
            x, y, dt = p[i], p[i + 1], p[i + 2]
            if not (-40 <= x <= WALL_W + 40 and -40 <= y <= WALL_H + 40 and 0 <= dt <= 1000):
                return self._err("кривой штрих")
            dur += dt
        if dur > WALL_DUR:
            return self._err("слишком долгий штрих")
        day = int(time.time()) // DAY
        n = self.rate.get((uid, "wall-day"), (day, 0))
        n = n if n[0] == day else (day, 0)
        if n[1] >= WALL_DAY:
            return self._err("баллончики на сегодня пусты — приходите завтра", 429)
        if self._too_soon(uid, "wall", WALL_EVERY):
            return self._err("не так быстро", 429)
        self.rate[(uid, "wall-day")] = (day, n[1] + 1)
        self.wall_last += 1
        sid = self.wall_last
        line = self._pub_line({"id": sid, "c": c, "k": k, "s": seed, "p": p})
        self.wall.append((sid, line))
        xs, ys = p[0::3], p[1::3]
        self._append_wall(sid, line, {"id": sid, "u": uid, "t": int(time.time()), "b": [min(xs), min(ys), max(xs), max(ys)]})
        return web.json_response({"id": sid})

    def routes(self, app):
        r = app.router
        r.add_get("/api/net/me", self.api_me)
        r.add_put("/api/net/me", self.api_me_save)
        r.add_post("/api/net/me/avatar", self.api_avatar)
        r.add_delete("/api/net/me/avatar", self.api_avatar_del)
        r.add_get("/api/net/u/{nick}", self.api_user)
        r.add_get("/api/net/people", self.api_people)
        r.add_get("/api/net/match", self.api_match)
        r.add_get("/api/net/tags", self.api_tags)
        r.add_get("/api/net/home", self.api_home)
        r.add_post("/api/net/tracks", self.api_upload)
        r.add_delete("/api/net/tracks", self.api_upload_del)
        r.add_get("/api/net/wall", self.api_wall)
        r.add_post("/api/net/wall", self.api_wall_add)
        r.add_post("/api/net/wall/bake", self.api_wall_bake)
        r.add_get("/media/nw/bake", self.serve_bake)
        r.add_get("/media/na/{id}", self.serve_media)
