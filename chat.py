"""
Чатилка nikita.os: аккаунты, общий чат и сигнализация для P2P-личек.

  POST /api/chat/auth     {login, password} -> нет такого ника: регистрация, есть: вход
  POST /api/chat/logout
  GET  /api/chat/me       -> {nick} | 401
  GET  /api/chat/history?before=<id>&limit=50 -> общий чат, страницами (ленивая загрузка)
  GET  /api/chat/ws       -> WebSocket: общий чат, онлайн-статусы, пересылка WebRTC-сигналов

Личные сообщения через сервер НЕ идут: сервер только сводит два браузера (offer/answer/ICE),
дальше текст летит напрямую по WebRTC DataChannel.

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
        CREATE INDEX IF NOT EXISTS users_regip ON users(reg_ip, created);
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

    # ---------- аккаунты ----------
    def user_by_token(self, request):
        tok = request.cookies.get(COOKIE)
        if not tok:
            return None
        row = self.db.q("SELECT u.id, u.nick FROM sessions s JOIN users u ON u.id = s.uid "
                        "WHERE s.token = ? AND s.expires > ?", tok, int(time.time())).fetchone()
        return row

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
        await ws.send_str(json.dumps({"t": "hello", "nick": nick, "online": list(self.online)}, ensure_ascii=False))
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
            self.online[nick].discard(ws)
            if not self.online[nick]:
                del self.online[nick]
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
        elif t == "signal":
            to = d.get("to")
            payload = d.get("data")
            if not isinstance(to, str) or to == nick or len(json.dumps(payload)) > SIGNAL_MAX:
                return
            if to not in self.online:
                return await ws.send_str(json.dumps({"t": "presence", "nick": to, "online": False}, ensure_ascii=False))
            await self.send_to(to, {"t": "signal", "from": nick, "data": payload})
        elif t == "status":
            to = d.get("nick")
            if isinstance(to, str):
                await ws.send_str(json.dumps({"t": "presence", "nick": to, "online": to in self.online}, ensure_ascii=False))

    def routes(self, app):
        app.router.add_post("/api/chat/auth", self.api_auth)
        app.router.add_post("/api/chat/logout", self.api_logout)
        app.router.add_get("/api/chat/me", self.api_me)
        app.router.add_get("/api/chat/history", self.api_history)
        app.router.add_get("/api/chat/ws", self.api_ws)
