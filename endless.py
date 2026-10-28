"""ENDLESS MC SERVER — лендинг с одной кнопкой (/endless).

POST /api/endless/press  {action: check|register|fake|unfake|gamefake|tap|mode|c2|secret|prog, value?}
  -> {known, fake, uaSame, me, lang, list, n, f, mode, c2, sec, prog}
  lang — "ru" для российских IP (по RIPE), иначе "en"
  n — засчитанные нажатия в игре, f — полученные фейковые зелёные
POST /api/endless/email  {email} -> {ok}

Храним только inner = sha256(ip + SALT). Наружу отдаём outer = sha256(inner + SALT).
data/endless.json        — [[inner, {"ua": sha(UA), "fake": bool, "t": unix}], ...], новые в начале
data/endless_emails.jsonl — по строке на e-mail: {"email", "inner", "t"}
"""
import asyncio
import bisect
import hashlib
import ipaddress
import json
import os
import re
import time
from pathlib import Path

from aiohttp import web

SALT = os.environ.get("ENDLESS_SALT", "endless-v1")
LIST_LIMIT = 200
# с этих IP видна тестовая кнопка «стереть мою регистрацию»
ADMIN_IPS = {x.strip() for x in os.environ.get("ENDLESS_ADMIN_IPS", "82.38.67.16").split(",") if x.strip()}
EMAILS_PER_IP = 5
MAX_TAPS_PER_SEC = 25
SECRET_RE = re.compile(r"^[a-z0-9]{1,16}$")
GEO_URL = "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest"
GEO_MAX_AGE = 30 * 86400
RU_LANGS = ("ru", "uk", "be", "kk")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s.]{2,}$")


def _h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def _resp(data, status=200):
    return web.json_response(data, status=status, headers={"Cache-Control": "no-store"})


class RuGeo:
    """Российские диапазоны IP из открытой статистики RIPE NCC (delegated-ripencc-latest).
    Файл лежит в data/ и обновляется раз в 30 дней; пока его нет — язык берётся из Accept-Language."""

    def __init__(self, path: Path):
        self.path = path
        self.starts, self.ends = [], []   # отсортированные диапазоны (int), v4 и v6 вместе: v6 сдвинуты за 2**32
        self.load()

    def load(self):
        try:
            text = self.path.read_text()
        except OSError:
            return
        rng = []
        for line in text.splitlines():
            f = line.split("|")
            if len(f) < 7 or f[1] != "RU" or f[2] not in ("ipv4", "ipv6"):
                continue
            try:
                if f[2] == "ipv4":
                    a = int(ipaddress.IPv4Address(f[3])); rng.append((a, a + int(f[4]) - 1))
                else:
                    n = ipaddress.IPv6Network(f"{f[3]}/{f[4]}")
                    rng.append((2**32 + int(n.network_address), 2**32 + int(n.broadcast_address)))
            except ValueError:
                continue
        rng.sort()
        self.starts, self.ends = [r[0] for r in rng], [r[1] for r in rng]

    @property
    def ready(self):
        return bool(self.starts)

    def is_ru(self, ip: str):
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return None
        if a.is_private or a.is_loopback:
            return None
        x = int(a) if a.version == 4 else 2**32 + int(a)
        i = bisect.bisect_right(self.starts, x) - 1
        return i >= 0 and x <= self.ends[i]

    async def refresh(self):
        try:
            if self.path.exists() and time.time() - self.path.stat().st_mtime < GEO_MAX_AGE:
                return
            from aiohttp import ClientSession, ClientTimeout
            async with ClientSession(timeout=ClientTimeout(total=120)) as s:
                async with s.get(GEO_URL) as r:
                    if r.status != 200:
                        return
                    data = await r.read()
            tmp = self.path.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(self.path)
            self.load()
        except Exception:
            pass  # нет сети — живём на Accept-Language


class Endless:
    def __init__(self, data_dir: Path, client_ip):
        self.path = Path(data_dir) / "endless.json"
        self.emails_path = Path(data_dir) / "endless_emails.jsonl"
        self.client_ip = client_ip
        self.order, self.meta = [], {}
        self.taps, self._saved_at = {}, 0.0
        self.geo = RuGeo(Path(data_dir) / "delegated-ripencc-latest")
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

    def _save_soon(self):  # нажатия в игре сыплются часто — пишем на диск не чаще раза в 2 с
        if time.monotonic() - self._saved_at > 2:
            self._save()

    def _save(self):
        self._saved_at = time.monotonic()
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps([[i, self.meta[i]] for i in self.order]))
        tmp.replace(self.path)

    def lang(self, request):
        ru = self.geo.is_ru(self.client_ip(request)) if self.geo.ready else None
        if ru is None:  # нет базы или локальный адрес — по языку браузера
            al = request.headers.get("Accept-Language", "").lower()
            ru = al[:2] in RU_LANGS
        return "ru" if ru else "en"

    def _inner(self, request):
        return _h(self.client_ip(request) + SALT)

    async def press(self, request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        action, value = body.get("action", "check"), body.get("value")
        inner = self._inner(request)
        ua = _h(request.headers.get("User-Agent", ""))
        meta = self.meta.get(inner)
        known = meta is not None
        if action == "register" and not known:
            meta = {"ua": ua, "fake": False, "t": int(time.time())}
            self.order.insert(0, inner)
            self.meta[inner] = meta
            self._save()
        elif known and action in ("fake", "unfake"):
            meta["fake"] = action == "fake"
            if action == "fake":
                meta["f"] = meta.get("f", 0) + 1
            self._save()
        elif known and action == "gamefake" and meta.get("mode") == "game":
            meta["f"] = meta.get("f", 0) + 1
            self._save()
        elif known and action == "tap" and meta.get("mode") == "game":
            sec = int(time.time())
            last_sec, cnt = self.taps.get(inner, (0, 0))
            cnt = cnt + 1 if last_sec == sec else 1
            self.taps[inner] = (sec, cnt)
            if cnt <= MAX_TAPS_PER_SEC:       # автокликеру не больше 25 засчитанных в секунду
                meta["n"] = meta.get("n", 0) + 1
                self._save_soon()
        elif known and action == "mode":
            meta["mode"] = "game" if value == "game" else None
            meta["fake"] = False
            self._save()
        elif known and action == "secret" and isinstance(value, str) and SECRET_RE.match(value):
            sec = meta.setdefault("sec", [])
            if value not in sec and len(sec) < 64:
                sec.append(value)
                self._save()
        elif known and action == "prog" and isinstance(value, dict):
            k, v = value.get("k"), value.get("v")
            prog = meta.setdefault("prog", {})
            if isinstance(k, str) and SECRET_RE.match(k) and isinstance(v, int) and 0 <= v <= 10**6 and (k in prog or len(prog) < 32):
                prog[k] = v
                self._save()
        elif known and action == "c2":
            meta["c2"] = bool(value)
            self._save()
        return _resp({
            "known": known,
            "fake": bool(meta and meta.get("fake")),
            "uaSame": bool(meta) and meta.get("ua", ua) == ua,
            "me": _h(inner + SALT),
            "admin": self.client_ip(request) in ADMIN_IPS,
            "lang": self.lang(request),
            "n": (meta or {}).get("n", 0), "f": (meta or {}).get("f", 0),
            "mode": (meta or {}).get("mode"), "c2": bool((meta or {}).get("c2")),
            "sec": (meta or {}).get("sec", []), "prog": (meta or {}).get("prog", {}),
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

    async def reset(self, request):
        if self.client_ip(request) not in ADMIN_IPS:
            raise web.HTTPForbidden()
        inner = self._inner(request)
        if self.meta.pop(inner, None) is not None:
            self.order.remove(inner)
            self._save()
        return _resp({"ok": True})

    def routes(self, app):
        async def _geo(app):
            app["endless_geo_task"] = asyncio.create_task(self.geo.refresh())
        app.on_startup.append(_geo)
        app.router.add_post("/api/endless/reset", self.reset)
        app.router.add_post("/api/endless/press", self.press)
        app.router.add_post("/api/endless/email", self.email)
