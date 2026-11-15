#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9", "playwright>=1.45"]
# ///
"""
Visa Watch: домашний сторож страниц записи в BLS Spain. Ничего общего с сайтом nikita.os не имеет.

Раз в несколько минут (ночью и в начале часа — чаще, см. schedule_* в конфиге) открывает страницы записи
и входа и ведёт журнал ИЗМЕНЕНИЙ: «403, 403, 403…» — одна строка, пока не поменяется код ответа или заголовок страницы.
При каждом изменении сохраняет снимок: скриншот страницы (в режиме browser), HTML и заголовки.
Свой интерфейс открывается в браузере: http://127.0.0.1:8765

Только ваша сеть: приложение НЕ использует системный прокси. Переменные *_proxy вычищаются из окружения,
aiohttp работает с trust_env=False, а Chromium запускается с --no-proxy-server. Если VPN/«прозрачный прокси»
устроен на уровне сети (TUN), приложение не может его обойти — внешний IP, каким нас видит интернет, показан в интерфейсе.

Режимы (config.toml, mode):
  browser — настоящий Chromium (Playwright): честно выполняет проверку страницы, как обычный посетитель, ничего не подделывая;
            делает скриншоты. Тяжёлый (сотни МБ ОЗУ).
  http    — простой запрос без браузера: лёгкий, годится для слабой платы, но защитные проверки он не проходит и скриншотов нет.

Запуск (uv сам поставит зависимости из шапки):
  uv run visa_watch.py --install     один раз: скачать Chromium для Playwright
  uv run visa_watch.py               запустить сторожа и интерфейс
  uv run visa_watch.py --once        одна проверка с выводом в консоль, без интерфейса
Данные — ~/.local/share/visa-watch (state.json, snaps/), конфиг — ~/.config/visa-watch/config.toml (по желанию).
"""
import argparse
import asyncio
import json
import logging
import os
import random
import re
import secrets
import subprocess
import sys
import time
import tomllib
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, web

log = logging.getLogger("visa-watch")

HERE = Path(__file__).resolve().parent
CONFIG = Path.home() / ".config" / "visa-watch" / "config.toml"
PROXY_VARS = ("http_proxy", "https_proxy", "all_proxy", "ftp_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "FTP_PROXY", "NO_PROXY")

DEFAULTS = {
    "targets": [
        {"id": "doorstep", "name": "Запись", "url": "https://appointment.blsspainrussia.ru/Global/bls/doorstepservice"},
        {"id": "login", "name": "Вход", "url": "https://appointment.blsspainrussia.ru/Global/account/login"},
    ],
    "mode": "browser",                        # browser | http
    "host": "127.0.0.1",                      # интерфейс: 0.0.0.0 — из локальной сети (обязательно задай token)
    "port": 8765,
    "token": "",                              # пароль интерфейса, если host не 127.0.0.1: http://адрес:порт/?token=...
    "utc_offset": 3,                          # часовой пояс расписания, Москва = 3
    "night": "2-8",                           # часы «ночного режима» по этому поясу
    "schedule_night": [[10, 30], [30, 60], [60, 180]],   # [до какой минуты часа, пауза в секундах]
    "schedule_day": [[5, 60], [60, 600]],
    "gap": 3,                                 # секунд между страницами в одном обходе
    "timeout": 45,                            # секунд на одну страницу
    "ip_check": True,                         # раз в полчаса узнавать свой внешний IP (api.ipify.org)
    "chromium_path": "",                      # свой Chromium (для Orange Pi: /usr/bin/chromium); пусто — от Playwright
    "data_dir": "",                           # пусто — ~/.local/share/visa-watch
    "log_max": 500,
    "snap_max": 60,
}
MIN_DELAY = 30                                # чаще нельзя ни при каких настройках
MANUAL_GAP = 10
BODY_MAX = 1024 * 1024
KEEP_HEADERS = ("content-type", "server", "location", "content-length", "cache-control", "retry-after", "date", "x-qrator-requestid")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
SNAP_RE = re.compile(r"^[A-Za-z0-9_-]{6,24}$")


def load_config():
    cfg = json.loads(json.dumps(DEFAULTS))
    if CONFIG.exists():
        cfg.update(tomllib.loads(CONFIG.read_text("utf-8")))
    cfg["data_dir"] = Path(cfg["data_dir"] or Path.home() / ".local" / "share" / "visa-watch")
    cfg["delay_floor"] = MIN_DELAY
    return cfg


def delay(cfg, ts=None):
    """(пауза до следующей проверки в секундах, ночной ли режим)."""
    t = time.gmtime((time.time() if ts is None else ts) + float(cfg["utc_offset"]) * 3600)
    a, b = (int(x) for x in str(cfg["night"]).split("-"))
    night = (a <= t.tm_hour < b) if a < b else (t.tm_hour >= a or t.tm_hour < b)
    for until, secs in cfg["schedule_night" if night else "schedule_day"]:
        if t.tm_min < until:
            return max(MIN_DELAY, int(secs)), night
    return MIN_DELAY, night


def page_title(text):
    m = TITLE_RE.search(text[:200_000])
    return re.sub(r"\s+", " ", m.group(1)).strip()[:200] if m else ""


def decode(raw, charset):
    try:
        return raw.decode(charset or "utf-8", errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


# ---------- как ходим на страницу ----------
async def fetch_http(url, cfg):
    try:
        async with ClientSession(timeout=ClientTimeout(total=cfg["timeout"], sock_connect=10), trust_env=False, headers={
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "ru,en;q=0.7"}) as s:
            async with s.get(url, allow_redirects=True) as r:
                raw = await r.content.read(BODY_MAX + 1)
                body = decode(raw[:BODY_MAX], r.charset)
                return {"status": str(r.status), "title": page_title(body), "url": str(r.url),
                        "headers": {k.lower(): v[:300] for k, v in r.headers.items() if k.lower() in KEEP_HEADERS},
                        "body": body, "truncated": len(raw) > BODY_MAX, "shot": None}
    except asyncio.TimeoutError as e:
        what = "не удалось подключиться за 10 с" if type(e).__name__ == "ConnectionTimeoutError" else "таймаут ответа"
        return {"status": "error", "title": "", "note": f"{what} ({type(e).__name__})"}
    except Exception as e:  # noqa: BLE001 — любая сетевая беда тоже состояние
        return {"status": "error", "title": "", "note": f"{type(e).__name__}: {str(e)[:160]}"}


class Chromium:
    """Один браузер на всё время работы; на каждую проверку — чистый контекст (без cookies). Ничего не подделываем."""

    def __init__(self, cfg):
        self.cfg, self.pw, self.browser = cfg, None, None

    async def ensure(self):
        if self.browser and self.browser.is_connected():
            return
        from playwright.async_api import async_playwright
        if not self.pw:
            self.pw = await async_playwright().start()
        kw = {"headless": True, "args": ["--no-proxy-server"]}      # никакого системного прокси
        if self.cfg["chromium_path"]:
            kw["executable_path"] = self.cfg["chromium_path"]
        self.browser = await self.pw.chromium.launch(**kw)

    async def close(self):
        try:
            if self.browser:
                await self.browser.close()
            if self.pw:
                await self.pw.stop()
        except Exception:  # noqa: BLE001
            pass
        self.browser = self.pw = None

    async def fetch(self, url):
        from playwright.async_api import Error as PWError
        from playwright.async_api import TimeoutError as PWTimeout
        try:
            await self.ensure()
        except Exception as e:  # noqa: BLE001 — нет Chromium и т. п.
            return {"status": "error", "title": "", "note": f"браузер не запустился: {str(e).splitlines()[0][:160]} (uv run visa_watch.py --install)"}
        ctx = await self.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            page = await ctx.new_page()
            docs = []
            page.on("response", lambda r: docs.append(r) if r.request.resource_type == "document" and r.frame == page.main_frame else None)
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=self.cfg["timeout"] * 1000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=15_000)    # дать странице пройти свою проверку и перезагрузиться
                except PWTimeout:
                    pass
            except (PWTimeout, PWError) as e:
                if not docs:
                    msg = str(e).splitlines()[0]
                    return {"status": "error", "title": "", "note": ("таймаут: " if isinstance(e, PWTimeout) else "") + msg[:160]}
            last = docs[-1]
            body = (await page.content())[:BODY_MAX]
            shot = None
            try:
                shot = await page.screenshot(full_page=True, timeout=15_000)
            except Exception:  # noqa: BLE001 — без скриншота обойдёмся
                pass
            return {"status": str(last.status), "title": (await page.title())[:200], "url": page.url, "body": body, "truncated": False,
                    "headers": {k.lower(): v[:300] for k, v in last.headers.items() if k.lower() in KEEP_HEADERS}, "shot": shot}
        finally:
            await ctx.close()


# ---------- сторож ----------
class Watch:
    def __init__(self, cfg):
        self.cfg = cfg
        self.dir = cfg["data_dir"]
        (self.dir / "snaps").mkdir(parents=True, exist_ok=True)
        self.file = self.dir / "state.json"
        self.state = {"log": [], "last": {}, "checks": {}}
        try:
            d = json.loads(self.file.read_text("utf-8"))
            if isinstance(d, dict) and isinstance(d.get("log"), list):
                self.state.update(d)
        except (OSError, ValueError):
            pass
        self.lock = asyncio.Lock()
        self.browser = Chromium(cfg) if cfg["mode"] == "browser" else None
        self.checking = False
        self.next_at = 0
        self.manual_at = 0.0
        self.ip = {"value": None, "t": None, "error": None}
        self.tasks = []

    def save(self):
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
        os.replace(tmp, self.file)

    def write_snap(self, sid, res, shot):
        d = self.dir / "snaps"
        head = "\n".join(f"{k}: {v}" for k, v in res.get("headers", {}).items())
        (d / f"{sid}.txt").write_text(f"{res['status']} · {res.get('url', '')}\n{head}\n\n{res.get('body', '')}", "utf-8")
        if shot:
            (d / f"{sid}.png").write_bytes(shot)
        old = sorted(d.glob("*.txt"), key=lambda f: f.stat().st_mtime)[:-self.cfg["snap_max"]]
        for f in old:
            f.unlink(missing_ok=True)
            f.with_suffix(".png").unlink(missing_ok=True)

    @staticmethod
    def describe(res):
        s = res["status"]
        if s == "error":
            return res.get("note", "ошибка запроса")
        if s == "403":
            return "403 — доступ закрыт"
        if s.startswith("2"):
            return f"{s} — страница открылась"
        return f"ответ {s}"

    async def check_one(self, t):
        res = await (self.browser.fetch(t["url"]) if self.browser else fetch_http(t["url"], self.cfg))
        now, st, tid = int(time.time()), self.state, t["id"]
        st["checks"][tid] = st["checks"].get(tid, 0) + 1
        last = st["last"].get(tid)
        changed = not last or (last["status"], last.get("title", "")) != (res["status"], res.get("title", ""))
        st["last"][tid] = {"t": now, "status": res["status"], "title": res.get("title", ""), "since": now if changed else last.get("since", now)}
        if changed:
            e = {"t": now, "target": tid, "status": res["status"], "title": res.get("title", ""), "note": self.describe(res)}
            if res["status"] != "error":                                   # у ответа есть что показать: скриншот и HTML
                sid = secrets.token_urlsafe(9)
                await asyncio.to_thread(self.write_snap, sid, res, res.get("shot"))
                e["snap"], e["shot"] = sid, bool(res.get("shot"))
            st["log"].append(e)
            del st["log"][:-self.cfg["log_max"]]
            log.info("[%s] %s", t["name"], e["note"])
        return changed

    async def check(self):
        async with self.lock:
            self.checking = True
            try:
                for n, t in enumerate(self.cfg["targets"]):
                    if n:
                        await asyncio.sleep(self.cfg["gap"])
                    await self.check_one(t)
                await asyncio.to_thread(self.save)
            finally:
                self.checking = False

    async def loop(self):
        await asyncio.sleep(2)
        while True:
            try:
                await self.check()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("проверка не удалась")
            secs = delay(self.cfg)[0] * random.uniform(0.9, 1.1)
            self.next_at = time.time() + secs
            await asyncio.sleep(secs)

    async def ip_loop(self):
        while True:
            try:
                async with ClientSession(timeout=ClientTimeout(total=15), trust_env=False) as s:
                    async with s.get("https://api.ipify.org?format=json") as r:
                        self.ip = {"value": (await r.json(content_type=None))["ip"], "t": int(time.time()), "error": None}
            except Exception as e:  # noqa: BLE001
                self.ip = {"value": None, "t": int(time.time()), "error": f"{type(e).__name__}"}
            await asyncio.sleep(1800)

    def view(self):
        secs, night = delay(self.cfg)
        st = self.state
        return {"mode": self.cfg["mode"], "interval": secs, "night": night, "next_at": self.next_at, "checking": self.checking, "ip": self.ip,
                "targets": [{**t, "checks": st["checks"].get(t["id"], 0), "last": st["last"].get(t["id"])} for t in self.cfg["targets"]],
                "log": st["log"]}

    # ---------- HTTP ----------
    async def api_state(self, request):
        return web.json_response(self.view())

    async def api_check(self, request):
        if self.checking or time.monotonic() - self.manual_at < MANUAL_GAP:
            return web.json_response({"error": "Подожди несколько секунд"}, status=429)
        self.manual_at = time.monotonic()
        self.tasks.append(asyncio.create_task(self.check()))
        return web.json_response({"ok": True})

    async def api_snap(self, request):
        sid, kind = request.match_info["id"], request.match_info["kind"]
        if not SNAP_RE.match(sid) or kind not in ("shot", "html"):
            raise web.HTTPNotFound()
        f = self.dir / "snaps" / (sid + (".png" if kind == "shot" else ".txt"))
        if not f.is_file():
            raise web.HTTPNotFound(text="снимок стёрт или без скриншота")
        ctype = "image/png" if kind == "shot" else "text/plain; charset=utf-8"      # HTML отдаём как текст: чужую страницу не исполняем
        return web.Response(body=f.read_bytes(), content_type=ctype.split(";")[0], charset="utf-8" if kind == "html" else None,
                            headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"})

    async def index(self, request):
        return web.Response(text=(HERE / "ui.html").read_text("utf-8"), content_type="text/html", headers={"Cache-Control": "no-cache"})

    def app(self):
        @web.middleware
        async def guard(request, handler):
            tok = self.cfg["token"]
            if tok:
                got = request.query.get("token") or request.cookies.get("vw_token", "")
                if not secrets.compare_digest(got, tok):
                    return web.Response(status=401, text="нужен ?token=…")
                resp = await handler(request)
                resp.set_cookie("vw_token", tok, httponly=True, samesite="Strict")
                return resp
            return await handler(request)

        app = web.Application(middlewares=[guard])
        app.router.add_get("/", self.index)
        app.router.add_get("/api/state", self.api_state)
        app.router.add_post("/api/check", self.api_check)
        app.router.add_get("/api/snap/{id}/{kind}", self.api_snap)

        async def start(app):
            self.tasks.append(asyncio.create_task(self.loop()))
            if self.cfg["ip_check"]:
                self.tasks.append(asyncio.create_task(self.ip_loop()))

        async def stop(app):
            for t in self.tasks:
                t.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            if self.browser:
                await self.browser.close()

        app.on_startup.append(start)
        app.on_cleanup.append(stop)
        return app


async def once(cfg):
    w = Watch(cfg)
    try:
        await w.check()
    finally:
        if w.browser:
            await w.browser.close()
    for t in cfg["targets"]:
        last = w.state["last"].get(t["id"])
        print(f"{t['name']}: {last['status']} {last['title']!r}" if last else f"{t['name']}: нет данных")
    print("Журнал:", w.dir / "state.json")


def main():
    ap = argparse.ArgumentParser(description="Сторож записи BLS Spain")
    ap.add_argument("--install", action="store_true", help="скачать Chromium для Playwright")
    ap.add_argument("--once", action="store_true", help="одна проверка и выход")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if a.install:                                                    # здесь прокси из окружения может понадобиться — скачивание
        sys.exit(subprocess.call([sys.executable, "-m", "playwright", "install", "chromium"]))
    for k in PROXY_VARS:                                             # дальше — только наша сеть
        os.environ.pop(k, None)
    cfg = load_config()
    if cfg["host"] not in ("127.0.0.1", "localhost", "::1") and not cfg["token"]:
        sys.exit("host открыт в сеть, а token не задан: добавь token в config.toml")
    if a.once:
        asyncio.run(once(cfg))
        return
    w = Watch(cfg)
    print(f"Интерфейс: http://{cfg['host']}:{cfg['port']}  · режим: {cfg['mode']}  · данные: {w.dir}")
    web.run_app(w.app(), host=cfg["host"], port=cfg["port"], print=None, access_log=None)


if __name__ == "__main__":
    main()
