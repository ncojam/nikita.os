"""
Слежение за страницей записи в визовый центр (BLS Spain, Москва): только для владельца (ник cojam).

Сервер сам, раз в несколько минут, открывает страницу и записывает в журнал ТОЛЬКО ИЗМЕНЕНИЯ:
повторные «403, 403, 403…» в журнал не попадают — растёт лишь счётчик проверок. Как только страница
отвечает чем-то кроме 403 (или меняется заголовок страницы), сохраняется снимок ответа — заголовки и тело,
— и у записи в журнале появляется кнопка «Состояние».

  GET  /api/visa              -> {url, interval, enabled, last, log: [...]}  (новые записи — в конце)
  GET  /api/visa/snap/{id}    -> {id, t, status, url, headers, body, truncated}  — снимок ответа
  POST /api/visa/check        -> то же, что GET /api/visa, но после внеочередной проверки (не чаще раза в 10 с)

Запись журнала: {t, status, title, note, snap?}
  status — код ответа («403», «200») или «error» (сеть, TLS, таймаут);
  title  — <title> страницы, если есть; note — что случилось по-русски.

Признак изменения — пара (status, title). Тело ответа в признак не входит: у живой страницы в нём токены
и счётчики, которые меняются при каждом запросе, и журнал бы зарос.

Хранилище: NOS_DATA/visa.json (журнал и последнее состояние), NOS_DATA/visa/<id>.json (снимки).
Лимиты — константы ниже, переопределяются через NOS_VISA_*. Всё — только для вошедшего под ником OWNER
(проверка Share.deny на сервере; скрытие кнопки в Пуске — лишь удобство).

Защита BLS — Qrator: он отдаёт 403 всем, кто не прошёл JS-проверку (скрипт /__qrator/qauth.js, WebGL-отпечаток).
Простой HTTP-запрос её не пройдёт, и пока ответ 403 — это и есть наблюдаемое состояние. Если IP сервера
не из России, задай прокси: NOS_VISA_PROXY=http://host:port.
"""
import asyncio
import json
import logging
import os
import random
import re
import secrets
import time
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, web

log = logging.getLogger("nikita.os.visa")

URL = os.environ.get("NOS_VISA_URL", "https://appointment.blsspainrussia.ru/Global/bls/doorstepservice")
ENABLED = os.environ.get("NOS_VISA_ENABLED", "1") != "0"
INTERVAL = max(30, int(os.environ.get("NOS_VISA_INTERVAL", "120")))     # секунд между проверками (≥ 30)
PROXY = os.environ.get("NOS_VISA_PROXY", "") or None                    # http://host:port, пусто — напрямую
TIMEOUT = 25                                                            # секунд на один запрос
LOG_MAX = 500                                                           # записей в журнале
SNAP_MAX = 40                                                           # снимков на диске (старые стираются)
BODY_MAX = 1024 * 1024                                                  # байт тела в снимке
MANUAL_GAP = 10                                                         # секунд между ручными проверками
KEEP_HEADERS = ("content-type", "server", "location", "content-length", "cache-control", "retry-after", "date", "x-qrator-requestid")
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
SNAP_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,24}$")


def page_title(text):
    m = TITLE_RE.search(text[:200_000])
    return re.sub(r"\s+", " ", m.group(1)).strip()[:200] if m else ""


class Visa:
    def __init__(self, data_dir, deny):
        self.file = Path(data_dir) / "visa.json"
        self.snaps = Path(data_dir) / "visa"
        self.snaps.mkdir(parents=True, exist_ok=True)
        self.deny = deny
        self.state = {"log": [], "last": None, "checks": 0, "since": None}
        self.task = None
        self.lock = asyncio.Lock()
        self.manual_at = 0.0
        try:
            d = json.loads(self.file.read_text("utf-8"))
            if isinstance(d, dict) and isinstance(d.get("log"), list):
                self.state.update(d)
        except (OSError, ValueError):
            pass

    # ---------- хранилище ----------
    def save(self):
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
        os.replace(tmp, self.file)

    def write_snap(self, snap):
        p = self.snaps / (snap["id"] + ".json")
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(snap, ensure_ascii=False), "utf-8")
        os.replace(tmp, p)
        old = sorted(self.snaps.glob("*.json"), key=lambda f: f.stat().st_mtime)[:-SNAP_MAX]
        for f in old:
            f.unlink(missing_ok=True)

    # ---------- проверка ----------
    async def fetch(self):
        """Один запрос → (status, title, snap-данные). Ошибки сети не бросаем: это тоже состояние."""
        try:
            async with ClientSession(timeout=ClientTimeout(total=TIMEOUT), headers={
                    "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "ru,en;q=0.7"}) as s:
                async with s.get(URL, proxy=PROXY, allow_redirects=True) as r:
                    raw = await r.content.read(BODY_MAX + 1)
                    body = raw[:BODY_MAX].decode(r.get_encoding() or "utf-8", errors="replace") if raw else ""
                    headers = {k.lower(): v[:300] for k, v in r.headers.items() if k.lower() in KEEP_HEADERS}
                    return {"status": str(r.status), "title": page_title(body), "url": str(r.url),
                            "headers": headers, "body": body, "truncated": len(raw) > BODY_MAX}
        except asyncio.TimeoutError:
            return {"status": "error", "title": "", "note": "таймаут ответа"}
        except Exception as e:  # noqa: BLE001 — любая сетевая беда = состояние «error»
            return {"status": "error", "title": "", "note": f"{type(e).__name__}: {str(e)[:160]}"}

    @staticmethod
    def describe(res):
        s = res["status"]
        if s == "error":
            return res.get("note", "ошибка запроса")
        if s == "403":
            return "403 — защита (Qrator) не пустила"
        if s.startswith("2"):
            return f"{s} — страница открылась"
        return f"ответ {s}"

    async def check(self):
        async with self.lock:
            res = await self.fetch()
            now = int(time.time())
            st = self.state
            st["checks"] = st.get("checks", 0) + 1
            key = (res["status"], res.get("title", ""))
            last = st.get("last")
            changed = not last or (last["status"], last.get("title", "")) != key
            st["last"] = {"t": now, "status": res["status"], "title": res.get("title", ""),
                          "since": now if changed else (last or {}).get("since", now)}
            if changed:
                entry = {"t": now, "status": res["status"], "title": res.get("title", ""), "note": self.describe(res)}
                # снимок — всё, что не 403 и не ошибка сети: это то, ради чего мы смотрим
                if res["status"] not in ("403", "error"):
                    snap = {"id": secrets.token_urlsafe(9), "t": now, "status": res["status"], "url": res.get("url", URL),
                            "headers": res.get("headers", {}), "body": res.get("body", ""), "truncated": res.get("truncated", False)}
                    await asyncio.to_thread(self.write_snap, snap)
                    entry["snap"] = snap["id"]
                st["log"].append(entry)
                del st["log"][:-LOG_MAX]
                log.info("visa: %s", entry["note"])
            await asyncio.to_thread(self.save)
            return changed

    async def run(self):
        await asyncio.sleep(5)
        while True:
            try:
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — цикл не должен умирать
                log.exception("visa: проверка не удалась")
            await asyncio.sleep(INTERVAL * random.uniform(0.9, 1.1))

    # ---------- API ----------
    def view(self):
        st = self.state
        return {"url": URL, "interval": INTERVAL, "enabled": ENABLED, "checks": st.get("checks", 0),
                "last": st.get("last"), "log": st["log"]}

    async def api_get(self, request):
        if (d := self.deny(request)) is not None:
            return d
        return web.json_response(self.view())

    async def api_check(self, request):
        if (d := self.deny(request)) is not None:
            return d
        now = time.monotonic()
        if now - self.manual_at < MANUAL_GAP:
            return web.json_response({"error": "Подожди несколько секунд между проверками"}, status=429)
        self.manual_at = now
        await self.check()
        return web.json_response(self.view())

    async def api_snap(self, request):
        if (d := self.deny(request)) is not None:
            return d
        sid = request.match_info["id"]
        if not SNAP_ID_RE.match(sid):
            return web.json_response({"error": "нет такого снимка"}, status=404)
        try:
            data = json.loads((self.snaps / (sid + ".json")).read_text("utf-8"))
        except (OSError, ValueError):
            return web.json_response({"error": "снимок стёрт (хранятся последние %d)" % SNAP_MAX}, status=404)
        return web.json_response(data)

    # ---------- жизненный цикл ----------
    async def on_start(self, app):
        if ENABLED:
            self.task = asyncio.create_task(self.run())

    async def on_stop(self, app):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    def routes(self, app):
        app.router.add_get("/api/visa", self.api_get)
        app.router.add_post("/api/visa/check", self.api_check)
        app.router.add_get("/api/visa/snap/{id}", self.api_snap)
        app.on_startup.append(self.on_start)
        app.on_cleanup.append(self.on_stop)
