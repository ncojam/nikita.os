"""Private Kana learning progress, keyed by the existing authenticated user ID."""
import json
import re
import sqlite3
import time
from aiohttp import web

MAX_BYTES = 768 * 1024
MAX_COUNT = 10**8
MAP_LIMITS = {"kana": 1024, "words": 4096, "writing": 256, "modeStats": 32, "scriptKana": 1024, "dailyStats": 1440}
HIST_LIMITS = {"hist": 365, "examHist": 365, "writingHist": 365}


def integer(value, low=0, high=MAX_COUNT):
    return type(value) is int and low <= value <= high


def validate(data):
    if not isinstance(data, dict):
        return False
    if not integer(data.get("level"), 1, 6) or not integer(data.get("max"), 1, 6):
        return False
    if not integer(data.get("examCredit", 0)):
        return False
    for key, limit in MAP_LIMITS.items():
        rows = data.get(key, {})
        if not isinstance(rows, dict) or len(rows) > limit:
            return False
        for word, row in rows.items():
            if not isinstance(word, str) or not 1 <= len(word) <= 128 or not isinstance(row, dict):
                return False
            if any(not integer(row.get(k, 0)) for k in ("ok", "err", "streak", "unguided", "audioOk", "copyLapses", "recallLapses", "typeOk", "typeErr", "checkOk", "checkErr", "examOk", "examErr", "completed", "skipped", "assisted", "strokeOk", "strokeErr", "scriptFallback")):
                return False
            if not integer(row.get("ms", 0), 0, 10**14):
                return False
            if key == "dailyStats" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}\|(type|check|exam|writing)\.(hira|kata|mixed|other)", word):
                return False
            if not integer(row.get("first", 0), 0, 10**14):
                return False
            if not integer(row.get("last", 0), 0, 10**14):
                return False
            if not isinstance(row.get("ru", ""), str) or len(row.get("ru", "")) > 512:
                return False
    for key, limit in HIST_LIMITS.items():
        rows = data.get(key, [])
        if not isinstance(rows, list) or len(rows) > limit:
            return False
        for row in rows:
            if not isinstance(row, dict) or not integer(row.get("at"), 0, 10**14):
                return False
            if key == "hist":
                if not integer(row.get("level"), 1, 6) or not integer(row.get("kpm", 0), 0, 10**6):
                    return False
                if row.get("grade") not in ("S", "A", "B", "C"):
                    return False
                for field in ("acc", "check"):
                    v = row.get(field)
                    if not isinstance(v, str) or not v.endswith("%") or not v[:-1].isdigit() or int(v[:-1]) > 100:
                        return False
            else:
                if not integer(row.get("total"), 1, 100) or not integer(row.get("ok"), 0, row["total"]):
                    return False
                if not integer(row.get("ms", 0), 0, 10**14):
                    return False
                if key == "writingHist" and (not integer(row.get("completed"), 0, row["total"]) or not integer(row.get("skipped"), 0, row["total"]) or row["ok"] > row["completed"] or row["completed"] + row["skipped"] != row["total"] or any(not integer(row.get(x)) for x in ("strokeOk", "strokeErr"))):
                    return False
    return True


class KanaProgress:
    def __init__(self, path, auth):
        self.auth = auth
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS progress (uid INTEGER PRIMARY KEY, rev INTEGER NOT NULL, state TEXT NOT NULL, updated INTEGER NOT NULL)")
        self.db.execute("CREATE TABLE IF NOT EXISTS operations (uid INTEGER NOT NULL, op TEXT NOT NULL, PRIMARY KEY(uid,op))")
        self.db.commit()

    @staticmethod
    def response(data, status=200):
        return web.json_response(data, status=status, headers={"Cache-Control": "no-store"})

    def read(self, uid):
        row = self.db.execute("SELECT rev,state FROM progress WHERE uid=?", (uid,)).fetchone()
        return (row[0], json.loads(row[1])) if row else (0, None)

    async def get(self, request):
        user = self.auth(request)
        if not user:
            return self.response({"error": "Войди в аккаунт"}, 401)
        uid, nick = user
        rev, state = self.read(uid)
        return self.response({"uid": uid, "nick": nick, "rev": rev, "state": state})

    async def put(self, request):
        user = self.auth(request)
        if not user:
            return self.response({"error": "Войди в аккаунт"}, 401)
        uid, nick = user
        if request.content_type != "application/json":
            return self.response({"error": "JSON required"}, 415)
        if request.content_length is not None and request.content_length > MAX_BYTES:
            return self.response({"error": "Слишком много данных"}, 413)
        try:
            raw = await request.read()
            if len(raw) > MAX_BYTES:
                return self.response({"error": "Слишком много данных"}, 413)
            body = json.loads(raw)
            if not isinstance(body, dict) or body.get("uid") != uid or not integer(body.get("rev")):
                return self.response({"error": "Аккаунт или версия изменились"}, 409)
            op = body.get("op")
            if not isinstance(op, str) or not 1 <= len(op) <= 80 or not all(c.isascii() and (c.isalnum() or c in "-_.") for c in op):
                return self.response({"error": "Некорректный ID операции"}, 400)
            state = body.get("state")
            if not validate(state):
                return self.response({"error": "Некорректная статистика"}, 400)
            encoded = json.dumps(state, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        except (ValueError, TypeError, RecursionError):
            return self.response({"error": "Некорректный JSON"}, 400)
        rev, current = self.read(uid)
        if self.db.execute("SELECT 1 FROM operations WHERE uid=? AND op=?", (uid, op)).fetchone():
            return self.response({"uid": uid, "rev": rev, "state": current})
        if rev != body["rev"]:
            return self.response({"uid": uid, "rev": rev, "state": current}, 409)
        # No await between read and write: serialized in the aiohttp event loop.
        self.db.execute("INSERT INTO progress VALUES(?,?,?,?) ON CONFLICT(uid) DO UPDATE SET rev=excluded.rev,state=excluded.state,updated=excluded.updated",
                        (uid, rev+1, encoded, int(time.time())))
        self.db.execute("INSERT INTO operations VALUES(?,?)", (uid, op))
        self.db.commit()
        return self.response({"uid": uid, "rev": rev+1, "state": state})

    def routes(self, app):
        app.router.add_get("/api/kana/progress", self.get)
        app.router.add_put("/api/kana/progress", self.put)
        async def close(_app):
            self.db.close()
        app.on_cleanup.append(close)
