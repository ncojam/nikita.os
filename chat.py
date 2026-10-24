"""
Чатилка nikita.os: аккаунты, общий чат и сигнализация для P2P-личек.

  POST /api/chat/auth     {login, password} -> нет такого ника: регистрация, есть: вход
  POST /api/chat/logout
  GET  /api/chat/me       -> {nick} | 401
  GET  /api/chat/history?before=<id>&limit=50 -> общий чат, страницами (ленивая загрузка)
  GET  /api/chat/ws       -> WebSocket: общий чат, онлайн-статусы, пересылка WebRTC-сигналов

Личные сообщения через сервер НЕ идут: сервер только сводит два браузера (offer/answer/ICE),
дальше текст летит напрямую по WebRTC DataChannel. При P2P собеседники узнают IP друг друга,
поэтому сначала через сервер идёт запрос на переписку (без текста), и сигналы пересылаются
только между теми, кто оба согласились. Согласия сервер держит только в памяти: каждый
браузер присылает свой список при подключении — на диске о личке нет ничего.

Хранилище — SQLite в NOS_DATA/chat.db. Пароли — scrypt, сессии — случайный токен в HttpOnly-cookie.
IP записывается при регистрации и входе (журнал на случай противоправного контента).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import re
import secrets
import sqlite3
import time
import unicodedata
from collections import defaultdict, deque

from aiohttp import web, WSMsgType

log = logging.getLogger("nikita.os.chat")

NICK_RE = re.compile(r"^[A-Za-z0-9_\-А-Яа-яЁё]{3,20}$")
PASS_MIN, PASS_MAX = 6, 128
MSG_MAX = 500                     # символов в сообщении
PUBLIC_KEEP = 1000                # сообщений общего чата храним
REG_PER_IP_SEC = 30 * 24 * 3600   # одна регистрация с адреса в 30 дней
SESSION_TTL = 60 * 24 * 3600
COOKIE = "nos_chat"
SIGNAL_MAX = 8 * 1024             # размер одного WebRTC-сигнала
COMMENT_MAX = 500                 # символов в комментарии
COMMENT_KEEP = 500                # комментариев на пост храним
GLOBAL_ROOM = "posts"             # виртуальная комната: лента комментов всех постов
ROOM_RE = re.compile(r"^post:[A-Za-z0-9_-]{1,64}$")


def clean_text(s, limit):
    """Убираем управляющие символы, невидимки и bidi-трюки; HTML экранирует клиент (textContent)."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFC", s)
    out = []
    for ch in s:
        if ch == "\n":
            out.append(ch)
            continue
        cat = unicodedata.category(ch)
        if cat in ("Cc", "Cf", "Cs", "Co", "Cn"):   # control, format (zero-width, RLO…), суррогаты, private, unassigned
            continue
        out.append(ch)
    s = re.sub(r"\n{3,}", "\n\n", "".join(out)).strip()
    return s[:limit]


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return salt.hex() + "$" + h.hex()


def check_pw(pw, stored):
    salt, h = stored.split("$")
    return hmac.compare_digest(hash_pw(pw, bytes.fromhex(salt)).split("$")[1], h)


class ChatDB:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY, nick TEXT NOT NULL, nick_lc TEXT UNIQUE NOT NULL,
            pw TEXT NOT NULL, reg_ip TEXT, created INTEGER, last_ip TEXT, last_seen INTEGER);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, uid INTEGER, expires INTEGER);
        CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, uid INTEGER, nick TEXT,
            text TEXT, ts INTEGER, ip TEXT);
        CREATE TABLE IF NOT EXISTS ip_log(uid INTEGER, ip TEXT, ts INTEGER, what TEXT);
        -- комментарии к постам: pid — id поста, reply_to — id родительского коммента (или NULL)
        CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, pid TEXT, uid INTEGER, nick TEXT,
            text TEXT, ts INTEGER, ip TEXT, reply_to INTEGER);
        CREATE INDEX IF NOT EXISTS users_regip ON users(reg_ip, created);
        CREATE INDEX IF NOT EXISTS comments_pid ON comments(pid, id);
        """)
        self.db.commit()

    def q(self, sql, *a):
        return self.db.execute(sql, a)

    def commit(self):
        self.db.commit()


class Chat:
    def __init__(self, db_path, client_ip):
        self.db = ChatDB(db_path)
        self.client_ip = client_ip
        self.online = defaultdict(set)          # nick -> {ws}
        self.fails = defaultdict(deque)         # ip -> времена неудачных входов
        self.rate = {}                          # nick -> время последнего сообщения
        self.allow = defaultdict(set)           # nick -> с кем согласен на P2P (присылает клиент)
        self.pending = defaultdict(set)         # кому -> от кого ждёт ответа запрос на личку
        self.req_times = defaultdict(deque)     # nick -> времена отправленных запросов
        self.rooms = defaultdict(set)           # имя комнаты -> {ws}, кто сейчас её смотрит
        self.crate = {}                         # nick -> время последнего коммента (антиспам)
        self.posts = None                       # ссылка на Posts (ставится в make_app) — титул/проверка поста

    # ---------- аккаунты ----------
    def user_by_token(self, request):
        tok = request.cookies.get(COOKIE)
        if not tok:
            return None
        row = self.db.q("SELECT u.id, u.nick FROM sessions s JOIN users u ON u.id = s.uid "
                        "WHERE s.token = ? AND s.expires > ?", tok, int(time.time())).fetchone()
        return row

    def nick_exists(self, nick):
        """Есть ли аккаунт чата с таким ником (без учёта регистра)."""
        return self.db.q("SELECT 1 FROM users WHERE nick_lc = ?", str(nick).lower()).fetchone() is not None

    def new_session(self, uid, resp, request):
        tok = secrets.token_urlsafe(32)
        self.db.q("INSERT INTO sessions VALUES(?,?,?)", tok, uid, int(time.time()) + SESSION_TTL)
        self.db.commit()
        resp.set_cookie(COOKIE, tok, max_age=SESSION_TTL, httponly=True, samesite="Strict",
                        secure=request.secure or request.headers.get("X-Forwarded-Proto") == "https", path="/")

    async def api_auth(self, request):
        ip = self.client_ip(request)
        now = time.time()
        f = self.fails[ip]
        while f and now - f[0] > 600:
            f.popleft()
        if len(f) >= 10:
            return web.json_response({"error": "Слишком много попыток, подождите 10 минут"}, status=429)
        try:
            body = await request.json()
            login, pw = str(body.get("login", "")).strip(), str(body.get("password", ""))
        except Exception:
            return web.json_response({"error": "Плохой запрос"}, status=400)
        if not NICK_RE.match(login):
            return web.json_response({"error": "Ник: 3–20 символов, буквы, цифры, _ и -"}, status=400)
        if not PASS_MIN <= len(pw) <= PASS_MAX:
            return web.json_response({"error": f"Пароль: от {PASS_MIN} до {PASS_MAX} символов"}, status=400)

        row = self.db.q("SELECT id, nick, pw FROM users WHERE nick_lc = ?", login.lower()).fetchone()
        loop = asyncio.get_running_loop()
        if row:
            ok = await loop.run_in_executor(None, check_pw, pw, row[2])
            if not ok:
                f.append(now)
                return web.json_response({"error": "Неверный пароль (или ник уже занят)"}, status=403)
            uid, nick, created = row[0], row[1], False
        else:
            last = self.db.q("SELECT 1 FROM users WHERE reg_ip = ? AND created > ?",
                             ip, int(now) - REG_PER_IP_SEC).fetchone()
            if last:
                return web.json_response({"error": "С вашего адреса уже регистрировались в этом месяце"}, status=429)
            pwh = await loop.run_in_executor(None, hash_pw, pw)
            try:
                cur = self.db.q("INSERT INTO users(nick, nick_lc, pw, reg_ip, created) VALUES(?,?,?,?,?)",
                                login, login.lower(), pwh, ip, int(now))
            except sqlite3.IntegrityError:
                return web.json_response({"error": "Ник только что заняли"}, status=409)
            uid, nick, created = cur.lastrowid, login, True
        self.db.q("UPDATE users SET last_ip = ?, last_seen = ? WHERE id = ?", ip, int(now), uid)
        self.db.q("INSERT INTO ip_log VALUES(?,?,?,?)", uid, ip, int(now), "register" if created else "login")
        resp = web.json_response({"nick": nick, "created": created})
        self.new_session(uid, resp, request)
        return resp

    async def api_logout(self, request):
        tok = request.cookies.get(COOKIE)
        if tok:
            self.db.q("DELETE FROM sessions WHERE token = ?", tok)
            self.db.commit()
        resp = web.json_response({"ok": True})
        resp.del_cookie(COOKIE, path="/")
        return resp

    async def api_me(self, request):
        u = self.user_by_token(request)
        if not u:
            return web.json_response({"error": "Не вошли"}, status=401)
        return web.json_response({"nick": u[1]})

    async def api_history(self, request):
        if not self.user_by_token(request):
            return web.json_response({"error": "Не вошли"}, status=401)
        try:
            before = int(request.query.get("before", 0)) or 2 ** 62
            limit = max(1, min(100, int(request.query.get("limit", 50))))
        except ValueError:
            return web.json_response({"error": "Плохой запрос"}, status=400)
        rows = self.db.q("SELECT id, nick, text, ts FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?",
                         before, limit).fetchall()
        return web.json_response({"messages": [
            {"id": r[0], "nick": r[1], "text": r[2], "ts": r[3]} for r in reversed(rows)]})

    # ---------- websocket ----------
    async def send_all(self, data):
        raw = json.dumps(data, ensure_ascii=False)
        for socks in list(self.online.values()):
            for ws in list(socks):
                if not ws.closed:
                    await ws.send_str(raw)

    async def send_to(self, nick, data):
        raw = json.dumps(data, ensure_ascii=False)
        for ws in list(self.online.get(nick, ())):
            if not ws.closed:
                await ws.send_str(raw)

    async def api_ws(self, request):
        u = self.user_by_token(request)
        if not u:
            return web.json_response({"error": "Не вошли"}, status=401)
        # защита от подключений с чужих сайтов: cookie SameSite=Strict + проверка Origin
        origin = request.headers.get("Origin", "")
        if origin and origin.split("://", 1)[-1] != request.host:
            return web.json_response({"error": "Чужой Origin"}, status=403)
        uid, nick = u
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=16 * 1024)
        await ws.prepare(request)
        first = not self.online[nick]
        self.online[nick].add(ws)
        await ws.send_str(json.dumps({"t": "hello", "nick": nick, "online": list(self.online),
                                      "requests": sorted(self.pending.get(nick, ()))}, ensure_ascii=False))
        if first:
            await self.send_all({"t": "presence", "nick": nick, "online": True})
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    data = json.loads(msg.data)
                except ValueError:
                    continue
                await self.handle(uid, nick, ws, data, request)
        finally:
            for socks in self.rooms.values():   # снимаем подписки этого сокета на комнаты
                socks.discard(ws)
            self.online[nick].discard(ws)
            if not self.online[nick]:
                del self.online[nick]
                self.allow.pop(nick, None)   # вернётся со следующим подключением
                await self.send_all({"t": "presence", "nick": nick, "online": False})
        return ws

    async def handle(self, uid, nick, ws, d, request):
        t = d.get("t")
        if t == "say":
            now = time.time()
            if now - self.rate.get(nick, 0) < 1.0:
                return await ws.send_str(json.dumps({"t": "error", "error": "Не так быстро"}))
            text = clean_text(d.get("text"), MSG_MAX)
            if not text:
                return
            self.rate[nick] = now
            cur = self.db.q("INSERT INTO messages(uid, nick, text, ts, ip) VALUES(?,?,?,?,?)",
                            uid, nick, text, int(now * 1000), self.client_ip(request))
            mid = cur.lastrowid
            self.db.q("DELETE FROM messages WHERE id <= ?", mid - PUBLIC_KEEP)
            self.db.commit()
            await self.send_all({"t": "msg", "id": mid, "nick": nick, "text": text, "ts": int(now * 1000)})
        elif t == "allow":
            # список собеседников, с которыми этот браузер согласен на P2P
            nicks = d.get("nicks")
            if not isinstance(nicks, list):
                return
            self.allow[nick] = {n for n in nicks[:500] if isinstance(n, str) and NICK_RE.match(n)}
            for n in self.allow[nick]:
                await self.check_mutual(nick, n)
        elif t == "dm_request":
            to = d.get("to")
            if not isinstance(to, str) or not NICK_RE.match(to) or to == nick:
                return
            if not self.db.q("SELECT 1 FROM users WHERE nick = ?", to).fetchone():
                return await ws.send_str(json.dumps({"t": "error", "error": "Нет такого пользователя"}))
            q = self.req_times[nick]
            now = time.time()
            while q and now - q[0] > 3600:
                q.popleft()
            if len(q) >= 20:
                return await ws.send_str(json.dumps({"t": "error", "error": "Слишком много запросов, попробуйте через час"}))
            q.append(now)
            self.allow[nick].add(to)
            if nick in self.allow.get(to, ()):
                return await self.check_mutual(nick, to)
            if nick not in self.pending[to]:
                self.pending[to].add(nick)
                await self.send_to(to, {"t": "dm_request", "from": nick})
        elif t == "dm_answer":
            frm, ok = d.get("to"), d.get("ok") is True
            if not isinstance(frm, str) or frm not in self.pending.get(nick, ()):
                return
            self.pending[nick].discard(frm)
            if ok:
                self.allow[nick].add(frm)
                await self.check_mutual(nick, frm)
            else:
                await self.send_to(frm, {"t": "dm_declined", "nick": nick})
        elif t == "allow_remove":
            n = d.get("nick")
            if isinstance(n, str):
                self.allow[nick].discard(n)
                self.pending[nick].discard(n)
        elif t == "signal":
            to = d.get("to")
            payload = d.get("data")
            if not isinstance(to, str) or to == nick or len(json.dumps(payload)) > SIGNAL_MAX:
                return
            if not self.mutual(nick, to):
                return   # без обоюдного согласия IP не раскрываем
            if to not in self.online:
                return await ws.send_str(json.dumps({"t": "presence", "nick": to, "online": False}, ensure_ascii=False))
            await self.send_to(to, {"t": "signal", "from": nick, "data": payload})
        elif t == "status":
            to = d.get("nick")
            if isinstance(to, str):
                await ws.send_str(json.dumps({"t": "presence", "nick": to, "online": to in self.online}, ensure_ascii=False))
        elif t == "sub":
            room = d.get("room")
            if room == GLOBAL_ROOM or (isinstance(room, str) and ROOM_RE.match(room)):
                self.rooms[room].add(ws)
        elif t == "unsub":
            room = d.get("room")
            if isinstance(room, str):
                self.rooms.get(room, set()).discard(ws)
        elif t == "csay":
            await self.comment(uid, nick, ws, d, request)
        elif t == "cdel":
            await self.comment_del(uid, nick, d)

    def mutual(self, a, b):
        return b in self.allow.get(a, ()) and a in self.allow.get(b, ())

    async def check_mutual(self, a, b):
        if self.mutual(a, b):
            self.pending[a].discard(b)
            self.pending[b].discard(a)
            await self.send_to(a, {"t": "dm_ok", "nick": b})
            await self.send_to(b, {"t": "dm_ok", "nick": a})

    # ---------- комментарии к постам (комнаты) ----------
    async def send_room(self, room, data):
        raw = json.dumps(data, ensure_ascii=False)
        for ws in list(self.rooms.get(room, ())):
            if not ws.closed:
                await ws.send_str(raw)

    def _reply_preview(self, reply_to):
        """Краткая цитата родительского коммента: {id, nick, text} или None."""
        if not reply_to:
            return None
        r = self.db.q("SELECT id, nick, text FROM comments WHERE id = ?", reply_to).fetchone()
        if not r:
            return None
        return {"id": r[0], "nick": r[1], "text": r[2][:120]}

    async def comment(self, uid, nick, ws, d, request):
        room = d.get("room")
        if not isinstance(room, str) or not ROOM_RE.match(room):   # писать можно только в реальный пост
            return await ws.send_str(json.dumps({"t": "error", "error": "Нет такой комнаты"}))
        pid = room.split(":", 1)[1]
        if self.posts and not self.posts.posts.get(pid):
            return await ws.send_str(json.dumps({"t": "error", "error": "Пост не найден"}))
        now = time.time()
        if now - self.crate.get(nick, 0) < 2.0:
            return await ws.send_str(json.dumps({"t": "error", "error": "Не так быстро"}))
        text = clean_text(d.get("text"), COMMENT_MAX)
        if not text:
            return
        reply_to = d.get("reply_to")
        reply_to = reply_to if isinstance(reply_to, int) else None
        if reply_to and not self.db.q("SELECT 1 FROM comments WHERE id = ? AND pid = ?", reply_to, pid).fetchone():
            reply_to = None   # отвечать можно только на коммент из этого же поста
        self.crate[nick] = now
        ts = int(now * 1000)
        cur = self.db.q("INSERT INTO comments(pid, uid, nick, text, ts, ip, reply_to) VALUES(?,?,?,?,?,?,?)",
                        pid, uid, nick, text, ts, self.client_ip(request), reply_to)
        cid = cur.lastrowid
        # держим не больше COMMENT_KEEP комментов на пост
        self.db.q("""DELETE FROM comments WHERE pid = ? AND id NOT IN
                     (SELECT id FROM comments WHERE pid = ? ORDER BY id DESC LIMIT ?)""",
                  pid, pid, COMMENT_KEEP)
        self.db.commit()
        title = (self.posts.posts.get(pid, {}).get("title", "") if self.posts else "")
        msg = {"t": "cmsg", "room": room, "id": cid, "pid": pid, "title": title,
               "nick": nick, "text": text, "ts": ts, "reply_to": reply_to,
               "reply_preview": self._reply_preview(reply_to)}
        await self.send_room(room, msg)             # в комнату самого поста
        await self.send_room(GLOBAL_ROOM, msg)      # и в глобальную ленту всех постов

    async def comment_del(self, uid, nick, d):
        cid = d.get("id")
        if not isinstance(cid, int):
            return
        r = self.db.q("SELECT pid, uid FROM comments WHERE id = ?", cid).fetchone()
        if not r:
            return
        pid, cuid = r
        post = self.posts.posts.get(pid) if self.posts else None
        # удаляет автор коммента или автор поста
        if uid != cuid and not (post and post.get("uid") == uid):
            return
        self.db.q("DELETE FROM comments WHERE id = ?", cid)
        self.db.commit()
        gone = {"t": "cdel", "room": "post:" + pid, "pid": pid, "id": cid}
        await self.send_room("post:" + pid, gone)
        await self.send_room(GLOBAL_ROOM, gone)

    def drop_comments(self, pid):
        """Снести комнату поста (зовётся из Posts при удалении поста)."""
        try:
            self.db.q("DELETE FROM comments WHERE pid = ?", pid)
            self.db.commit()
        except Exception:
            pass

    async def api_comments(self, request):
        if not self.user_by_token(request):
            return web.json_response({"error": "Не вошли"}, status=401)
        room = request.query.get("room", "")
        try:
            before = int(request.query.get("before", 0)) or 2 ** 62
            limit = max(1, min(100, int(request.query.get("limit", 50))))
        except ValueError:
            return web.json_response({"error": "Плохой запрос"}, status=400)
        if room == GLOBAL_ROOM:
            rows = self.db.q("SELECT id, pid, nick, text, ts, reply_to FROM comments WHERE id < ? "
                             "ORDER BY id DESC LIMIT ?", before, limit).fetchall()
        elif ROOM_RE.match(room):
            pid = room.split(":", 1)[1]
            rows = self.db.q("SELECT id, pid, nick, text, ts, reply_to FROM comments WHERE pid = ? AND id < ? "
                             "ORDER BY id DESC LIMIT ?", pid, before, limit).fetchall()
        else:
            return web.json_response({"error": "Нет такой комнаты"}, status=400)
        titles = {}
        if self.posts:
            for r in rows:
                if r[1] not in titles:
                    titles[r[1]] = self.posts.posts.get(r[1], {}).get("title", "")
        out = [{"id": r[0], "pid": r[1], "title": titles.get(r[1], ""), "nick": r[2], "text": r[3],
                "ts": r[4], "reply_to": r[5], "reply_preview": self._reply_preview(r[5])}
               for r in reversed(rows)]
        return web.json_response({"comments": out})

    def routes(self, app):
        app.router.add_post("/api/chat/auth", self.api_auth)
        app.router.add_post("/api/chat/logout", self.api_logout)
        app.router.add_get("/api/chat/me", self.api_me)
        app.router.add_get("/api/chat/history", self.api_history)
        app.router.add_get("/api/chat/comments", self.api_comments)
        app.router.add_get("/api/chat/ws", self.api_ws)
