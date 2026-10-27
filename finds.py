"""
Находки: плейлисты по настроениям и лента кандидатов, которую готовит домашний воркер (worker/).

Bump — трек попадает в плейлист и становится примером «нравится», dump — антипример.
Плейлисты публичные (/finds/<id>), голосует и правит только владелец.
Сервер сам никуда не ходит: всё про YouTube/SoundCloud (поиск, скачивание, анализ) делает
воркер на компьютере владельца сайта. Здесь — только хранение и выдача.

  GET    /api/finds/mine                    -> {user, max, playlists:[...]}
  POST   /api/finds/pl      {name, descr, examples:[url]}
  PATCH  /api/finds/pl/{id} {name?, descr?, examples?}        (владелец)
  DELETE /api/finds/pl/{id}                                    (владелец)
  GET    /api/finds/feed/{id}               -> {tracks:[...]}  (владелец; только без голоса)
  POST   /api/finds/vote    {pl, track, v}  v: 1 bump, -1 dump, 0 снять голос
  POST   /api/finds/move    {from, to, track}  перетащили в другой свой плейлист: там bump, тут v=2 (нейтрально)
  GET    /api/finds/pub/{id}                -> {name, descr, owner, mine, examples, tracks:[bump...]}  без входа
  GET    /api/finds/all                     -> {playlists:[{id, name, descr, owner, tracks}]}  каталог, без входа

Воркер — по заголовку X-Finds-Token == NOS_FINDS_TOKEN (без токена на сервере — 404):
  GET    /api/finds/w/state                 -> все плейлисты, примеры, голоса, текущая лента
  POST   /api/finds/w/push  {tracks:[{id,title,artist,duration,published,thumb}],
                             feed:{<pl>:[{track, score, why}]}}   лента плейлиста заменяется целиком

Id трека: yt:<11 символов> | sc:<артист>/<трек>. Ссылка на артиста SoundCloud в примерах — scu:<артист>.
IP пишется в плейлисты и голоса — под будущую чистку «всего контента с одного адреса».
Хранилище — SQLite в NOS_DATA/finds.db.
"""
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit, parse_qs

from aiohttp import web

from chat import clean_text

log = logging.getLogger("nikita.os.finds")

MAX_PL = int(os.environ.get("NOS_FINDS_MAX_PL", "6"))           # плейлистов на аккаунт
NAME_MAX = 40
DESC_MAX = 200
EX_MAX = 20                                                     # ссылок-примеров на плейлист
FEED_MAX = int(os.environ.get("NOS_FINDS_FEED", "20"))          # треков в ленте плейлиста
VOTES_PER_DAY = int(os.environ.get("NOS_FINDS_VOTES_DAY", "500"))
TRACKS_MAX = int(os.environ.get("NOS_FINDS_TRACKS_MAX", "50000"))  # потолок склада треков
PUSH_TRACKS_MAX = 2000                                          # треков в одном push воркера
TITLE_MAX = 200
WHY_MAX = 160
PL_EDITS_PER_HOUR = 60
ALL_MAX = 200                                                   # плейлистов в общем каталоге
MOVED = 2                                                       # голос «перенесён в другой плейлист» — нейтральный

_PL_RE = re.compile(r"^[A-Za-z0-9_-]{8,16}$")
_TID_RE = re.compile(r"^(yt:[A-Za-z0-9_-]{11}|sc:[a-z0-9_-]{1,64}/[a-z0-9_-]{1,160}|scu:[a-z0-9_-]{1,64})$")
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_SC_SEG = re.compile(r"^[a-z0-9_-]{1,160}$")
# служебные страницы SoundCloud — не артисты
_SC_RESERVED = {"discover", "stream", "search", "upload", "you", "charts", "pages", "terms-of-use", "settings", "messages"}


def url_to_id(url):
    """Ссылка YouTube/SoundCloud -> id трека (или артиста SoundCloud). Чужое — None."""
    if not isinstance(url, str) or len(url) > 500:
        return None
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if host.startswith("www.") or host.startswith("m."):
        host = host.split(".", 1)[1]
    parts = [p for p in u.path.split("/") if p]
    if host in ("youtube.com", "music.youtube.com"):
        if u.path == "/watch":
            v = (parse_qs(u.query).get("v") or [""])[0]
            return "yt:" + v if _YT_ID.match(v) else None
        if len(parts) == 2 and parts[0] in ("shorts", "embed", "live") and _YT_ID.match(parts[1]):
            return "yt:" + parts[1]
        return None
    if host == "youtu.be":
        return "yt:" + parts[0] if parts and _YT_ID.match(parts[0]) else None
    if host == "soundcloud.com":
        parts = [p.lower() for p in parts]
        if not parts or parts[0] in _SC_RESERVED or not all(_SC_SEG.match(p) for p in parts):
            return None
        if len(parts) == 1:
            return "scu:" + parts[0][:64]
        if len(parts) == 2 and parts[1] not in ("sets", "tracks", "albums", "reposts", "likes", "popular-tracks"):
            return "sc:" + parts[0][:64] + "/" + parts[1]
    return None


def id_to_url(tid):
    if tid.startswith("yt:"):
        return "https://www.youtube.com/watch?v=" + tid[3:]
    if tid.startswith("sc:"):
        return "https://soundcloud.com/" + tid[3:]
    if tid.startswith("scu:"):
        return "https://soundcloud.com/" + tid[4:]
    return ""


def _https(s):
    s = s if isinstance(s, str) else ""
    return s if s.startswith("https://") and len(s) <= 400 and not re.search(r"[\s\"'<>]", s) else ""


def _int(v, lo=0, hi=10 ** 12):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return 0


def jresp(data, status=200):
    return web.json_response(data, status=status, dumps=lambda o: json.dumps(o, ensure_ascii=False))


def err(text, status=400):
    return jresp({"error": text}, status)


async def body_of(request):
    try:
        b = await request.json()
    except Exception:
        return None
    return b if isinstance(b, dict) else None


class Finds:
    def __init__(self, db_path, user_of, client_ip):
        self.user_of = user_of
        self.client_ip = client_ip
        self.token = os.environ.get("NOS_FINDS_TOKEN", "")
        self.vote_times = defaultdict(deque)     # uid -> времена голосов за сутки
        self.edit_times = defaultdict(deque)     # uid -> времена правок плейлистов за час
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(db_path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS playlists(
            id TEXT PRIMARY KEY, uid INTEGER NOT NULL, owner TEXT, name TEXT NOT NULL, descr TEXT,
            examples TEXT, ip TEXT, created INTEGER, updated INTEGER);
        CREATE TABLE IF NOT EXISTS tracks(
            id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration INTEGER, published INTEGER,
            thumb TEXT, updated INTEGER);
        CREATE TABLE IF NOT EXISTS feed(
            pl TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track TEXT NOT NULL,
            score REAL, why TEXT, added INTEGER, PRIMARY KEY(pl, track));
        CREATE TABLE IF NOT EXISTS votes(
            pl TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track TEXT NOT NULL,
            v INTEGER NOT NULL, ip TEXT, at INTEGER, PRIMARY KEY(pl, track));
        CREATE INDEX IF NOT EXISTS playlists_uid ON playlists(uid);
        CREATE INDEX IF NOT EXISTS votes_track ON votes(track);
        CREATE INDEX IF NOT EXISTS feed_track ON feed(track);
        """)
        self.db.commit()

    # ---------- общее ----------
    def q(self, sql, *a):
        return self.db.execute(sql, a)

    @staticmethod
    def _limited(times, window, limit):
        now = time.time()
        while times and times[0] < now - window:
            times.popleft()
        if len(times) >= limit:
            return True
        times.append(now)
        return False

    def own_pl(self, request, pid):
        """(user, playlist-row) — если плейлист этого пользователя; иначе (user, None)."""
        u = self.user_of(request)
        if not u or not _PL_RE.match(pid or ""):
            return u, None
        row = self.q("SELECT id, uid, owner, name, descr, examples FROM playlists WHERE id = ? AND uid = ?",
                     pid, u[0]).fetchone()
        return u, row

    @staticmethod
    def clean_examples(raw):
        """Список ссылок -> [{id, url}] без дублей; чужие сайты отбрасываются. (список, сколько отброшено)."""
        if not isinstance(raw, list):
            return [], 0
        out, seen, bad = [], set(), 0
        for x in raw[:EX_MAX * 2]:
            tid = url_to_id(x)
            if not tid:
                bad += 1
                continue
            if tid not in seen:
                seen.add(tid)
                out.append({"id": tid, "url": id_to_url(tid)})
        return out[:EX_MAX], bad

    def track_rows(self, sql, *a):
        """Строки (id, title, artist, duration, published, thumb, ...) -> словари для клиента."""
        out = []
        for r in self.q(sql, *a):
            d = {"id": r[0], "url": id_to_url(r[0]), "title": r[1] or "", "artist": r[2] or "",
                 "duration": r[3] or 0, "published": r[4] or 0, "thumb": r[5] or ""}
            if len(r) > 6:
                d["score"] = r[6]
                d["why"] = r[7] or ""
            out.append(d)
        return out

    def pl_json(self, row):
        pid = row[0]
        bumps = self.q("SELECT COUNT(*) FROM votes WHERE pl = ? AND v = 1", pid).fetchone()[0]
        pending = self.q("SELECT COUNT(*) FROM feed f WHERE f.pl = ? AND NOT EXISTS "
                         "(SELECT 1 FROM votes v WHERE v.pl = f.pl AND v.track = f.track)", pid).fetchone()[0]
        return {"id": pid, "name": row[3], "descr": row[4] or "",
                "examples": json.loads(row[5] or "[]"), "bumps": bumps, "feed": pending}

    # ---------- пользователь ----------
    async def api_mine(self, request):
        u = self.user_of(request)
        if not u:
            return jresp({"user": None, "max": MAX_PL, "playlists": []})
        rows = self.q("SELECT id, uid, owner, name, descr, examples FROM playlists WHERE uid = ? ORDER BY created",
                      u[0]).fetchall()
        return jresp({"user": u[1], "max": MAX_PL, "playlists": [self.pl_json(r) for r in rows]})

    async def api_create(self, request):
        u = self.user_of(request)
        if not u:
            return err("Сначала войди в аккаунт (Чат → вход)", 401)
        b = await body_of(request)
        if b is None:
            return err("Плохой запрос")
        name = clean_text(b.get("name"), NAME_MAX).replace("\n", " ")
        if not name:
            return err("Нужно название плейлиста")
        if self.q("SELECT COUNT(*) FROM playlists WHERE uid = ?", u[0]).fetchone()[0] >= MAX_PL:
            return err(f"Не больше {MAX_PL} плейлистов на аккаунт", 403)
        if self._limited(self.edit_times[u[0]], 3600, PL_EDITS_PER_HOUR):
            return err("Слишком часто, попробуй позже", 429)
        ex, bad = self.clean_examples(b.get("examples"))
        pid, now = secrets.token_urlsafe(9), int(time.time())
        self.q("INSERT INTO playlists VALUES(?,?,?,?,?,?,?,?,?)", pid, u[0], u[1], name,
               clean_text(b.get("descr"), DESC_MAX), json.dumps(ex, ensure_ascii=False), self.client_ip(request), now, now)
        self.db.commit()
        row = self.q("SELECT id, uid, owner, name, descr, examples FROM playlists WHERE id = ?", pid).fetchone()
        return jresp({"playlist": self.pl_json(row), "skipped": bad})

    async def api_edit(self, request):
        u, row = self.own_pl(request, request.match_info["id"])
        if not u:
            return err("Сначала войди в аккаунт", 401)
        if not row:
            return err("Нет такого плейлиста", 404)
        b = await body_of(request)
        if b is None:
            return err("Плохой запрос")
        if self._limited(self.edit_times[u[0]], 3600, PL_EDITS_PER_HOUR):
            return err("Слишком часто, попробуй позже", 429)
        name, descr, ex, bad = row[3], row[4], row[5], 0
        if "name" in b:
            name = clean_text(b.get("name"), NAME_MAX).replace("\n", " ")
            if not name:
                return err("Нужно название плейлиста")
        if "descr" in b:
            descr = clean_text(b.get("descr"), DESC_MAX)
        if "examples" in b:
            lst, bad = self.clean_examples(b.get("examples"))
            ex = json.dumps(lst, ensure_ascii=False)
        self.q("UPDATE playlists SET name = ?, descr = ?, examples = ?, owner = ?, updated = ? WHERE id = ?",
               name, descr, ex, u[1], int(time.time()), row[0])
        self.db.commit()
        row = self.q("SELECT id, uid, owner, name, descr, examples FROM playlists WHERE id = ?", row[0]).fetchone()
        return jresp({"playlist": self.pl_json(row), "skipped": bad})

    async def api_delete(self, request):
        u, row = self.own_pl(request, request.match_info["id"])
        if not u:
            return err("Сначала войди в аккаунт", 401)
        if not row:
            return err("Нет такого плейлиста", 404)
        self.q("DELETE FROM playlists WHERE id = ?", row[0])   # лента и голоса — каскадом
        self.db.commit()
        return jresp({"ok": True})

    async def api_feed(self, request):
        u, row = self.own_pl(request, request.match_info["id"])
        if not u:
            return err("Сначала войди в аккаунт", 401)
        if not row:
            return err("Нет такого плейлиста", 404)
        tracks = self.track_rows(
            "SELECT t.id, t.title, t.artist, t.duration, t.published, t.thumb, f.score, f.why "
            "FROM feed f JOIN tracks t ON t.id = f.track WHERE f.pl = ? AND NOT EXISTS "
            "(SELECT 1 FROM votes v WHERE v.pl = f.pl AND v.track = f.track) ORDER BY f.score DESC LIMIT ?",
            row[0], FEED_MAX)
        updated = self.q("SELECT MAX(added) FROM feed WHERE pl = ?", row[0]).fetchone()[0] or 0
        return jresp({"tracks": tracks, "updated": updated})

    async def api_all(self, request):
        """Каталог плейлистов всех пользователей — без входа. Сверху те, где больше bump."""
        rows = self.q(
            "SELECT p.id, p.name, p.descr, p.owner, "
            "(SELECT COUNT(*) FROM votes v WHERE v.pl = p.id AND v.v = 1) AS n, p.updated "
            "FROM playlists p ORDER BY n DESC, p.updated DESC LIMIT ?", ALL_MAX).fetchall()
        return jresp({"playlists": [{"id": r[0], "name": r[1], "descr": r[2] or "", "owner": r[3] or "", "tracks": r[4]}
                                    for r in rows]})

    async def api_vote(self, request):
        b = await body_of(request)
        if b is None:
            return err("Плохой запрос")
        u, row = self.own_pl(request, str(b.get("pl") or ""))
        if not u:
            return err("Сначала войди в аккаунт", 401)
        if not row:
            return err("Нет такого плейлиста", 404)
        tid, v = str(b.get("track") or ""), b.get("v")
        if not _TID_RE.match(tid) or tid.startswith("scu:") or v not in (1, -1, 0):
            return err("Плохой голос")
        if self._limited(self.vote_times[u[0]], 86400, VOTES_PER_DAY):
            return err("На сегодня голосов хватит 🙂", 429)
        if v == 0:
            self.q("DELETE FROM votes WHERE pl = ? AND track = ?", row[0], tid)
        else:
            # трек может быть и не из ленты (например, пример из ссылок) — заводим пустую карточку
            self.q("INSERT OR IGNORE INTO tracks(id, updated) VALUES(?, ?)", tid, int(time.time()))
            self.q("INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(pl, track) DO UPDATE SET v = excluded.v, "
                   "ip = excluded.ip, at = excluded.at", row[0], tid, v, self.client_ip(request), int(time.time()))
        self.db.commit()
        return jresp({"ok": True})

    async def api_move(self, request):
        """Перетащили трек в другой свой плейлист: там — bump, в исходном — «перенесён» (v=2).
        v=2 нейтральный: трек уходит из ленты и плейлиста-источника, но не считается ни bump, ни dump."""
        b = await body_of(request)
        if b is None:
            return err("Плохой запрос")
        u, src = self.own_pl(request, str(b.get("from") or ""))
        _, dst = self.own_pl(request, str(b.get("to") or ""))
        if not u:
            return err("Сначала войди в аккаунт", 401)
        if not src or not dst or src[0] == dst[0]:
            return err("Нет такого плейлиста", 404)
        tid = str(b.get("track") or "")
        if not _TID_RE.match(tid) or tid.startswith("scu:"):
            return err("Плохой трек")
        if self._limited(self.vote_times[u[0]], 86400, VOTES_PER_DAY):
            return err("На сегодня голосов хватит 🙂", 429)
        now, ip = int(time.time()), self.client_ip(request)
        self.q("INSERT OR IGNORE INTO tracks(id, updated) VALUES(?, ?)", tid, now)
        up = ("INSERT INTO votes VALUES(?,?,?,?,?) ON CONFLICT(pl, track) DO UPDATE SET v = excluded.v, "
              "ip = excluded.ip, at = excluded.at")
        self.q(up, dst[0], tid, 1, ip, now)
        self.q(up, src[0], tid, MOVED, ip, now)
        self.db.commit()
        return jresp({"ok": True})

    async def api_pub(self, request):
        pid = request.match_info["id"]
        if not _PL_RE.match(pid):
            return err("Нет такого плейлиста", 404)
        row = self.q("SELECT id, uid, owner, name, descr, examples FROM playlists WHERE id = ?", pid).fetchone()
        if not row:
            return err("Нет такого плейлиста", 404)
        u = self.user_of(request)
        tracks = self.track_rows(
            "SELECT t.id, t.title, t.artist, t.duration, t.published, t.thumb FROM votes v "
            "JOIN tracks t ON t.id = v.track WHERE v.pl = ? AND v.v = 1 ORDER BY v.at DESC", pid)
        return jresp({"id": pid, "name": row[3], "descr": row[4] or "", "owner": row[2] or "",
                      "mine": bool(u and u[0] == row[1]),
                      "examples": json.loads(row[5] or "[]"), "tracks": tracks})

    # ---------- воркер ----------
    def worker_ok(self, request):
        tok = request.headers.get("X-Finds-Token", "")
        return bool(self.token) and hmac.compare_digest(tok.encode(), self.token.encode())

    async def api_w_state(self, request):
        if not self.worker_ok(request):
            raise web.HTTPNotFound()
        out = []
        for r in self.q("SELECT id, uid, owner, name, descr, examples FROM playlists ORDER BY created"):
            out.append({
                "id": r[0], "uid": r[1], "owner": r[2] or "", "name": r[3], "descr": r[4] or "",
                "examples": json.loads(r[5] or "[]"),
                "votes": [{"track": t, "v": v} for t, v in self.q("SELECT track, v FROM votes WHERE pl = ?", r[0])],
                "feed": [t for (t,) in self.q("SELECT track FROM feed WHERE pl = ?", r[0])],
            })
        return jresp({"playlists": out, "feedMax": FEED_MAX})

    async def api_w_push(self, request):
        if not self.worker_ok(request):
            raise web.HTTPNotFound()
        b = await body_of(request)
        if b is None:
            return err("Плохой запрос")
        now = int(time.time())
        tracks = b.get("tracks") if isinstance(b.get("tracks"), list) else []
        n_tracks = 0
        for t in tracks[:PUSH_TRACKS_MAX]:
            if not isinstance(t, dict) or not _TID_RE.match(str(t.get("id") or "")) or t["id"].startswith("scu:"):
                continue
            self.q("INSERT INTO tracks VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, "
                   "artist = excluded.artist, duration = excluded.duration, published = excluded.published, "
                   "thumb = excluded.thumb, updated = excluded.updated",
                   t["id"], clean_text(t.get("title"), TITLE_MAX).replace("\n", " "),
                   clean_text(t.get("artist"), TITLE_MAX).replace("\n", " "),
                   _int(t.get("duration"), 0, 86400), _int(t.get("published")), _https(t.get("thumb")), now)
            n_tracks += 1
        feed = b.get("feed") if isinstance(b.get("feed"), dict) else {}
        n_feed = 0
        for pid, items in feed.items():
            if not _PL_RE.match(str(pid)) or not isinstance(items, list):
                continue
            if not self.q("SELECT 1 FROM playlists WHERE id = ?", pid).fetchone():
                continue
            self.q("DELETE FROM feed WHERE pl = ?", pid)
            for it in items[:FEED_MAX * 3]:
                if not isinstance(it, dict):
                    continue
                tid = str(it.get("track") or "")
                if not self.q("SELECT 1 FROM tracks WHERE id = ?", tid).fetchone():
                    continue
                try:
                    score = float(it.get("score") or 0)
                except (TypeError, ValueError):
                    score = 0.0
                self.q("INSERT OR IGNORE INTO feed VALUES(?,?,?,?,?)", pid, tid, score,
                       clean_text(it.get("why"), WHY_MAX).replace("\n", " "), now)
                n_feed += 1
        self.gc()
        self.db.commit()
        log.info("finds: воркер прислал %d треков, %d в ленты", n_tracks, n_feed)
        return jresp({"ok": True, "tracks": n_tracks, "feed": n_feed})

    def gc(self):
        """Склад переполнен -> выкидываем самые старые треки, на которые никто не ссылается."""
        n = self.q("SELECT COUNT(*) FROM tracks").fetchone()[0]
        if n <= TRACKS_MAX:
            return
        self.q("DELETE FROM tracks WHERE id IN (SELECT id FROM tracks t WHERE "
               "NOT EXISTS (SELECT 1 FROM votes v WHERE v.track = t.id) AND "
               "NOT EXISTS (SELECT 1 FROM feed f WHERE f.track = t.id) ORDER BY updated LIMIT ?)", n - TRACKS_MAX)

    def routes(self, app):
        r = app.router
        r.add_get("/api/finds/mine", self.api_mine)
        r.add_post("/api/finds/pl", self.api_create)
        r.add_patch("/api/finds/pl/{id}", self.api_edit)
        r.add_delete("/api/finds/pl/{id}", self.api_delete)
        r.add_get("/api/finds/feed/{id}", self.api_feed)
        r.add_post("/api/finds/vote", self.api_vote)
        r.add_post("/api/finds/move", self.api_move)
        r.add_get("/api/finds/pub/{id}", self.api_pub)
        r.add_get("/api/finds/all", self.api_all)
        r.add_get("/api/finds/w/state", self.api_w_state)
        r.add_post("/api/finds/w/push", self.api_w_push)
