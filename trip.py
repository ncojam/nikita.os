"""
Поездка: планировщик по дням с картой (окна «Менеджер» и «Карта», public/js/apps/trip.js).

  GET  /api/trip                -> {days, places, cards, owner}: читать может любой
  POST /api/trip/card           {id?, date, time, comment, place: {id?, name, lat?, lng?}} -> то же
  POST /api/trip/card/delete    {id} -> то же
  POST /api/trip/day            {date, title} -> то же: подпись дня
  POST /api/trip/stay           {id?, name, lat, lng, price, url, comment, dates} -> то же: вариант ночлега
  POST /api/trip/stay/delete    {id} -> то же
  GET  /api/trip/leg/{a}/{b}    -> {dist, mins, up, down, geo, prof}: пеший путь между местами

Менять может только вошедший под ником владельца: проверка общая с файлообменником (Share.deny).
День существует, пока в нём есть карточка; порядок карточек внутри дня — по времени.
Место живёт отдельно от карточки: одна точка на карте может встречаться в нескольких карточках.
Место без карточек удаляется само. Лежит в NOS_DATA/trip.json, при первом запуске — из trip_seed.py.

Пеший путь сервер берёт сам: посетители не ходят во внешние сервисы, а готовый ответ лежит в
NOS_DATA/trip_legs.json навсегда (одна пара точек — один запрос). Маршрут — OSRM FOSSGIS на данных OSM,
высоты — Open-Meteo. Нет ответа — клиент рисует прямую, в кэш ошибка не попадает.
Время: скорость пешехода от OSRM плюс правило Нейсмита, минута на 10 м подъёма.
"""
import asyncio
import json
import logging
import math
import os
import re
import uuid
from datetime import date as Date
from pathlib import Path

import aiohttp
from aiohttp import web

from posts import _CTRL
from trip_seed import SEED, UPDATED, VERSION

log = logging.getLogger("nikita.os.trip")

MAX_CARDS = int(os.environ.get("NOS_TRIP_MAX_CARDS", "1000"))
NAME_MAX = 120
COMMENT_MAX = 2000
DAY_TITLE_MAX = 80
PRICE_MAX = 80
URL_MAX = 500
MAX_STAYS = int(os.environ.get("NOS_TRIP_MAX_STAYS", "100"))
MAX_LEGS = int(os.environ.get("NOS_TRIP_MAX_LEGS", "3000"))
ROUTER = os.environ.get("NOS_TRIP_ROUTER", "https://routing.openstreetmap.de/routed-foot/route/v1/driving")
ELEVATION = os.environ.get("NOS_TRIP_ELEVATION", "https://api.open-meteo.com/v1/elevation")
USER_AGENT = "nikita.os trip planner (https://github.com/ncojam/nikita.os)"
PROFILE_POINTS = 60      # точек профиля высот на путь (сервис принимает до 100)
CLIMB_STEP = 3.0         # метры: колебания меньше этого не считаем подъёмом (шум модели рельефа)
NAISMITH_M_PER_MIN = 10
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def clean(s, limit):
    return _CTRL.sub("", str(s or "").replace("\r\n", "\n").replace("\r", "\n")).strip()[:limit]


def valid_date(s):
    try:
        return isinstance(s, str) and len(s) == 10 and Date.fromisoformat(s).isoformat() == s
    except ValueError:
        return False


def coord(v, limit):
    """Число в пределах ±limit, иначе None (bool — тоже int, отсекаем)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not -limit <= v <= limit:
        return None
    return round(float(v), 6)


def clean_url(raw):
    url = str(raw or "").strip()[:URL_MAX]
    return url if re.match(r"^https?://[^\s<>\"]+$", url) else ""


def meters(a, b):
    """Расстояние между [lng, lat]: для точек маршрута плоского приближения достаточно."""
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320


def sample(line, count):
    """count точек через равные расстояния вдоль линии."""
    if len(line) <= count:
        return line
    steps = [0.0]
    for a, b in zip(line, line[1:]):
        steps.append(steps[-1] + meters(a, b))
    out, i = [], 0
    for n in range(count):
        want = steps[-1] * n / (count - 1)
        while i < len(steps) - 2 and steps[i + 1] < want:
            i += 1
        out.append(line[i + 1] if steps[i + 1] - want < want - steps[i] else line[i])
    return out


def climb(heights):
    """Набор и сброс высоты с порогом: мелкая рябь модели рельефа не накапливается."""
    up = down = 0.0
    base = heights[0] if heights else 0
    for h in heights[1:]:
        if h - base >= CLIMB_STEP:
            up += h - base
            base = h
        elif base - h >= CLIMB_STEP:
            down += base - h
            base = h
    return up, down


class Bad(Exception):
    """Ошибка для клиента: текст показываем как есть."""


class Trip:
    def __init__(self, path, deny, is_owner):
        self.path = Path(path)
        self.deny = deny                # None — можно; иначе готовый ответ 401/403
        self.is_owner = is_owner
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            self.data = json.loads(json.dumps(SEED))
            self.save()
        self.migrate()
        self.legs_path = self.path.with_name("trip_legs.json")
        try:
            self.legs = json.loads(self.legs_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.legs = {}
        self.leg_lock = asyncio.Lock()

    def migrate(self):
        """Доносит новое из trip_seed.py в уже идущий план, не трогая правки владельца."""
        d = self.data
        if d.get("v", 1) >= VERSION:
            return
        seed = json.loads(json.dumps(SEED))
        d.setdefault("stays", seed["stays"])
        have = {c["id"]: c for c in d["cards"]}
        for c in d["cards"]:
            c.setdefault("leg", "walk")
        for c in seed["cards"]:
            old = have.get(c["id"])
            if old is None:
                if c["date"] in {x["date"] for x in d["cards"]}:
                    d["cards"].append(c)
            elif c["id"] in UPDATED and (old["time"], old["comment"]) == UPDATED[c["id"]]:
                old.update(time=c["time"], comment=c["comment"], leg=c["leg"])
        used = {c["place"] for c in d["cards"]}
        known = {p["id"] for p in d["places"]}
        d["places"] += [p for p in seed["places"] if p["id"] in used and p["id"] not in known]
        d["v"] = VERSION
        self.save()

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def answer(self, request):
        return web.json_response({**self.data, "owner": self.is_owner(request)},
                                 headers={"Cache-Control": "no-store"})

    def place_for(self, raw):
        """Вернёт id места: существующее (можно переименовать и подвинуть) или новое."""
        if not isinstance(raw, dict):
            raise Bad("не указано место")
        places = self.data["places"]
        name = clean(raw.get("name"), NAME_MAX)
        given = "lat" in raw or "lng" in raw
        lat, lng = coord(raw.get("lat"), 90), coord(raw.get("lng"), 180)
        if given and (lat is None or lng is None):
            raise Bad("координаты не похожи на настоящие")
        place = next((p for p in places if p["id"] == raw.get("id")), None) or \
            next((p for p in places if p["name"].lower() == name.lower()), None)
        if place is None:
            if not name:
                raise Bad("укажи название места")
            if not given:
                raise Bad("новому месту нужна точка на карте")
            place = {"id": uuid.uuid4().hex[:10], "name": name, "lat": lat, "lng": lng}
            places.append(place)
        else:
            place["name"] = name or place["name"]
            if given:
                place["lat"], place["lng"] = lat, lng
        return place["id"]

    def drop_orphans(self):
        used = {c["place"] for c in self.data["cards"]}
        self.data["places"] = [p for p in self.data["places"] if p["id"] in used]
        days = {c["date"] for c in self.data["cards"]}
        self.data["days"] = {d: t for d, t in self.data["days"].items() if d in days}

    # ---------- обработчики ----------
    async def api_get(self, request):
        return self.answer(request)

    async def body(self, request):
        try:
            b = await request.json()
        except (ValueError, TypeError):
            b = None
        return b if isinstance(b, dict) else {}

    async def api_card(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        cards = self.data["cards"]
        card = next((c for c in cards if c["id"] == b.get("id")), None)
        if b.get("id") and card is None:
            return web.json_response({"error": "карточка уже удалена"}, status=404)
        if card is None and len(cards) >= MAX_CARDS:
            return web.json_response({"error": "слишком много карточек"}, status=413)
        if not valid_date(b.get("date")) or not TIME_RE.match(str(b.get("time"))):
            return web.json_response({"error": "проверь дату и время"}, status=400)
        try:
            pid = self.place_for(b.get("place"))
        except Bad as e:
            return web.json_response({"error": str(e)}, status=400)
        fields = {"date": b["date"], "time": b["time"], "place": pid, "comment": clean(b.get("comment"), COMMENT_MAX),
                  "leg": "transit" if b.get("leg") == "transit" else "walk"}
        if card is None:
            cards.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            card.update(fields)
        self.drop_orphans()
        self.save()
        return self.answer(request)

    async def api_card_delete(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        left = [c for c in self.data["cards"] if c["id"] != b.get("id")]
        if len(left) == len(self.data["cards"]):
            return web.json_response({"error": "нет такой карточки"}, status=404)
        self.data["cards"] = left
        self.drop_orphans()
        self.save()
        return self.answer(request)

    async def api_day(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        day = b.get("date")
        if not valid_date(day) or not any(c["date"] == day for c in self.data["cards"]):
            return web.json_response({"error": "нет такого дня"}, status=404)
        title = clean(b.get("title"), DAY_TITLE_MAX)
        if title:
            self.data["days"][day] = title
        else:
            self.data["days"].pop(day, None)
        self.save()
        return self.answer(request)

    # ---------- ночлег ----------
    async def api_stay(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        stays = self.data["stays"]
        stay = next((s for s in stays if s["id"] == b.get("id")), None)
        if b.get("id") and stay is None:
            return web.json_response({"error": "вариант уже удалён"}, status=404)
        if stay is None and len(stays) >= MAX_STAYS:
            return web.json_response({"error": "слишком много вариантов"}, status=413)
        name = clean(b.get("name"), NAME_MAX)
        lat, lng = coord(b.get("lat"), 90), coord(b.get("lng"), 180)
        dates = b.get("dates")
        if not name or lat is None or lng is None:
            return web.json_response({"error": "нужны название и точка на карте"}, status=400)
        if not isinstance(dates, list) or not dates or len(dates) > 60 or not all(valid_date(x) for x in dates):
            return web.json_response({"error": "выбери хотя бы один день"}, status=400)
        fields = {"name": name, "lat": lat, "lng": lng, "price": clean(b.get("price"), PRICE_MAX),
                  "url": clean_url(b.get("url")), "comment": clean(b.get("comment"), COMMENT_MAX), "dates": sorted(set(dates))}
        if stay is None:
            stays.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            stay.update(fields)
        self.save()
        return self.answer(request)

    async def api_stay_delete(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        left = [s for s in self.data["stays"] if s["id"] != b.get("id")]
        if len(left) == len(self.data["stays"]):
            return web.json_response({"error": "нет такого варианта"}, status=404)
        self.data["stays"] = left
        self.save()
        return self.answer(request)

    # ---------- пеший путь ----------
    async def fetch_leg(self, a, b):
        headers = {"User-Agent": USER_AGENT}
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(headers=headers, timeout=timeout) as http:
            url = f'{ROUTER}/{a["lng"]},{a["lat"]};{b["lng"]},{b["lat"]}?overview=full&geometries=geojson'
            async with http.get(url) as r:
                route = (await r.json(content_type=None))["routes"][0]
            geo = route["geometry"]["coordinates"]
            leg = {"dist": round(route["distance"]), "mins": round(route["duration"] / 60),
                   "geo": [[round(x, 6), round(y, 6)] for x, y in geo], "prof": [], "up": None, "down": None}
            try:   # без высот путь всё равно полезен
                pts = sample(geo, PROFILE_POINTS)
                query = {"latitude": ",".join(str(p[1]) for p in pts), "longitude": ",".join(str(p[0]) for p in pts)}
                async with http.get(ELEVATION, params=query) as r:
                    prof = (await r.json(content_type=None))["elevation"]
                up, down = climb(prof)
                leg.update(prof=[round(h) for h in prof], up=round(up), down=round(down),
                           mins=leg["mins"] + round(up / NAISMITH_M_PER_MIN))
            except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, TypeError, ValueError) as e:
                log.warning("trip: нет высот: %s", e)
        return leg

    async def api_leg(self, request):
        places = {p["id"]: p for p in self.data["places"]}
        a, b = places.get(request.match_info["a"]), places.get(request.match_info["b"])
        if not a or not b:
            return web.json_response({"error": "нет такого места"}, status=404)
        key = f'{a["lat"]},{a["lng"]}>{b["lat"]},{b["lng"]}'
        async with self.leg_lock:      # внешние сервисы бесплатные: по одному запросу за раз
            leg = self.legs.get(key)
            if leg is None:
                if len(self.legs) >= MAX_LEGS:
                    return web.json_response({"error": "кэш путей заполнен"}, status=503)
                try:
                    leg = await self.fetch_leg(a, b)
                except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, IndexError, TypeError, ValueError) as e:
                    log.warning("trip: нет пути %s: %s", key, e)
                    return web.json_response({"error": "сервис маршрутов не ответил"}, status=503)
                self.legs[key] = leg
                tmp = self.legs_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.legs, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, self.legs_path)
        return web.json_response(leg, headers={"Cache-Control": "public, max-age=3600"})

    def routes(self, app):
        app.router.add_get("/api/trip", self.api_get)
        app.router.add_post("/api/trip/card", self.api_card)
        app.router.add_post("/api/trip/card/delete", self.api_card_delete)
        app.router.add_post("/api/trip/day", self.api_day)
        app.router.add_post("/api/trip/stay", self.api_stay)
        app.router.add_post("/api/trip/stay/delete", self.api_stay_delete)
        app.router.add_get("/api/trip/leg/{a}/{b}", self.api_leg)
