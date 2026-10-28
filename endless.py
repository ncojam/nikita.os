"""ENDLESS MC SERVER — лендинг с одной кнопкой (/endless).

POST /api/endless/press  {action: "check" | "register" | "fake" | "unfake"}
  -> {known, fake, uaSame, me, list}
POST /api/endless/email  {email} -> {ok}

Храним только inner = sha256(ip + SALT). Наружу отдаём outer = sha256(inner + SALT).
data/endless.json        — [[inner, {"ua": sha(UA), "fake": bool, "t": unix}], ...], новые в начале
data/endless_emails.jsonl — по строке на e-mail: {"email", "inner", "t"}
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

from aiohttp import web

SALT = os.environ.get("ENDLESS_SALT", "endless-v1")
LIST_LIMIT = 200
EMAILS_PER_IP = 5
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s.]{2,}$")


def _h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def _resp(data, status=200):
    return web.json_response(data, status=status, headers={"Cache-Control": "no-store"})


class Endless:
    def __init__(self, data_dir: Path, client_ip):
        self.path = Path(data_dir) / "endless.json"
        self.emails_path = Path(data_dir) / "endless_emails.jsonl"
        self.client_ip = client_ip
        self.order, self.meta = [], {}
        try:
            raw = json.loads(self.path.read_text())
        except (OSError, ValueError):
            raw = []
        for item in raw:  # старый формат — просто список хешей
            inner, meta = (item, {}) if isinstance(item, str) else (item[0], item[1])
            if inner not in self.meta:
                self.order.append(inner)
                self.meta[inner] = meta
        self.email_count = {}
        try:
            for line in self.emails_path.read_text().splitlines():
                i = json.loads(line).get("inner")
                self.email_count[i] = self.email_count.get(i, 0) + 1
        except (OSError, ValueError):
            pass

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps([[i, self.meta[i]] for i in self.order]))
        tmp.replace(self.path)

    def _inner(self, request):
        return _h(self.client_ip(request) + SALT)

    async def press(self, request):
        try:
            action = (await request.json()).get("action")
        except Exception:
            action = "check"
        inner = self._inner(request)
        ua = _h(request.headers.get("User-Agent", ""))
        meta = self.meta.get(inner)
        known = meta is not None
        if action == "register" and not known:
            meta = {"ua": ua, "fake": False, "t": int(time.time())}
            self.order.insert(0, inner)
            self.meta[inner] = meta
            self._save()
        elif action in ("fake", "unfake") and known:
            meta["fake"] = action == "fake"
            self._save()
        return _resp({
            "known": known,
            "fake": bool(meta and meta.get("fake")),
            "uaSame": bool(meta) and meta.get("ua", ua) == ua,
            "me": _h(inner + SALT),
            "list": [_h(i + SALT) for i in self.order[:LIST_LIMIT]],
        })

    async def email(self, request):
        try:
            email = str((await request.json()).get("email", "")).strip()
        except Exception:
            email = ""
        if len(email) > 254 or not EMAIL_RE.match(email):
            return _resp({"ok": False, "error": "bad email"}, 400)
        inner = self._inner(request)
        if self.email_count.get(inner, 0) >= EMAILS_PER_IP:
            return _resp({"ok": False, "error": "limit"}, 429)
        self.email_count[inner] = self.email_count.get(inner, 0) + 1
        with self.emails_path.open("a") as f:
            f.write(json.dumps({"email": email, "inner": inner, "t": int(time.time())}, ensure_ascii=False) + "\n")
        return _resp({"ok": True})

    def routes(self, app):
        app.router.add_post("/api/endless/press", self.press)
        app.router.add_post("/api/endless/email", self.email)
