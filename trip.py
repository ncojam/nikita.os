"""
Поездка: планировщик по дням с картой (окна «Менеджер» и «Карта», public/js/apps/trip.js).

  GET  /api/trip                -> {days, places, cards, owner}: читать может любой
  POST /api/trip/card           {id?, date, time, comment, place: {id?, name, lat?, lng?}} -> то же
  POST /api/trip/card/delete    {id} -> то же
  POST /api/trip/day            {date, title} -> то же: подпись дня

Менять может только вошедший под ником владельца: проверка общая с файлообменником (Share.deny).
День существует, пока в нём есть карточка; порядок карточек внутри дня — по времени.
Место живёт отдельно от карточки: одна точка на карте может встречаться в нескольких карточках.
Место без карточек удаляется само. Лежит в NOS_DATA/trip.json, при первом запуске — из trip_seed.py.
"""
import json
import logging
import os
import re
import uuid
from datetime import date as Date
from pathlib import Path

from aiohttp import web

from posts import _CTRL
from trip_seed import SEED

log = logging.getLogger("nikita.os.trip")

MAX_CARDS = int(os.environ.get("NOS_TRIP_MAX_CARDS", "1000"))
NAME_MAX = 120
COMMENT_MAX = 2000
DAY_TITLE_MAX = 80
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
        fields = {"date": b["date"], "time": b["time"], "place": pid, "comment": clean(b.get("comment"), COMMENT_MAX)}
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

    def routes(self, app):
        app.router.add_get("/api/trip", self.api_get)
        app.router.add_post("/api/trip/card", self.api_card)
        app.router.add_post("/api/trip/card/delete", self.api_card_delete)
        app.router.add_post("/api/trip/day", self.api_day)
