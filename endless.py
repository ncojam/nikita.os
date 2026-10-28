"""ENDLESS MC SERVER — лендинг с одной кнопкой (/endless).

POST /api/endless/press  {action: "check" | "register"}
  -> {known, me, list}
Храним только inner = sha256(ip + SALT). Наружу отдаём outer = sha256(inner + SALT).
"""
import hashlib
import json
import os
from pathlib import Path

from aiohttp import web

SALT = os.environ.get("ENDLESS_SALT", "endless-v1")
LIST_LIMIT = 200


def _h(s):
    return hashlib.sha256(s.encode()).hexdigest()


class Endless:
    def __init__(self, data_dir: Path, client_ip):
        self.path = Path(data_dir) / "endless.json"
        self.client_ip = client_ip
        try:
            self.inner = json.loads(self.path.read_text())  # список inner-хешей, новые в начале
        except (OSError, ValueError):
            self.inner = []
        self.known = set(self.inner)

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.inner))
        tmp.replace(self.path)

    async def press(self, request):
        try:
            action = (await request.json()).get("action")
        except Exception:
            action = "check"
        inner = _h(self.client_ip(request) + SALT)
        known = inner in self.known
        if action == "register" and not known:
            self.inner.insert(0, inner)
            self.known.add(inner)
            self._save()
        return web.json_response(
            {"known": known, "me": _h(inner + SALT),
             "list": [_h(i + SALT) for i in self.inner[:LIST_LIMIT]]},
            headers={"Cache-Control": "no-store"})

    def routes(self, app):
        app.router.add_post("/api/endless/press", self.press)
