"""
Поездки: несколько проектов-поездок, у каждого — план по дням с картой, варианты пути с ценой и стыковками,
чек-лист «что куплено» (public/js/apps/trip.js, trip-routes.js, trip-todo.js).

  GET  /api/trip                  -> {trips: [...], owner}: читать может любой (скрытые поездки видит только владелец)
  POST /api/trip/project          {id?, name, icon, cur, private} -> то же: создать или переименовать поездку
  POST /api/trip/project/delete   {id} -> то же (последнюю поездку удалить нельзя)

Дальше во всех запросах есть поле `trip` — id поездки. Ответ у всех — то же {trips, owner}.
  POST /api/trip/card             {trip, id?, date, time, comment, leg, place: {id?, name, lat?, lng?}}
  POST /api/trip/card/delete      {trip, id}
  POST /api/trip/day              {trip, date, title}: подпись дня
  POST /api/trip/stay             {trip, id?, name, lat, lng, price, url, comment, dates}: вариант ночлега
  POST /api/trip/stay/delete      {trip, id}
  POST /api/trip/route            {trip, id?, name, comment, steps: [{id?, mode, num, frm, to, dep, tzd, arr, tza, price, comment}]}
  POST /api/trip/route/delete     {trip, id}
  POST /api/trip/route/choose     {trip, route: id | null}: выбранный вариант (по нему заполняется чек-лист)
  POST /api/trip/todo             {trip, id?, text, kind, done, link}: пункт чек-листа; у существующего меняются только присланные поля
  POST /api/trip/todo/delete      {trip, id}
  POST /api/trip/todo/fill        {trip}: билеты на каждый перегон выбранного варианта, которых ещё нет в чек-листе
  GET  /api/trip/leg/{trip}/{a}/{b} -> {dist, mins, up, down, geo, prof}: пеший путь между местами

Менять может только вошедший под ником владельца: проверка общая с файлообменником (Share.deny).
День существует, пока в нём есть карточка; порядок карточек внутри дня — по времени.
Место живёт отдельно от карточки: одна точка на карте может встречаться в нескольких карточках.
Место без карточек удаляется само.

Вариант пути — цепочка перегонов (поезд, самолёт…). Даты и время — местные, у каждого конца свой часовой пояс
(UTC+N): иначе Москва → Сургут не сложить. Длительность и пересадки считаем в UTC. Пункт чек-листа может
ссылаться на перегон (`link: {route, step}`) или на ночлег (`link: {stay}`): так видно, какой билет уже куплен.
Поездка с `private` отдаётся только владельцу.

Лежит в NOS_DATA/trip.json. Файл версии 2 (одна поездка) при первом запуске оборачивается в поездку «Кансай»,
рядом остаётся копия trip.json.v2. Новая установка начинается с trip_seed.py.

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
from datetime import date as Date, datetime
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
DOC_VERSION = 3
MAX_TRIPS = int(os.environ.get("NOS_TRIP_MAX_TRIPS", "30"))
MAX_ROUTES = int(os.environ.get("NOS_TRIP_MAX_ROUTES", "60"))
MAX_STEPS = 12
MAX_TODOS = int(os.environ.get("NOS_TRIP_MAX_TODOS", "300"))
TRIP_NAME_MAX = 60
TODO_MAX = 200
NUM_MAX = 40
MONEY_MAX = 10_000_000
MODES = {"train", "plane", "bus", "car", "ship", "other"}
KINDS = {"ticket", "stay", "docs", "other"}
MAX_LEGS = int(os.environ.get("NOS_TRIP_MAX_LEGS", "3000"))
ROUTER = os.environ.get("NOS_TRIP_ROUTER", "https://routing.openstreetmap.de/routed-foot/route/v1/driving")
ELEVATION = os.environ.get("NOS_TRIP_ELEVATION", "https://api.open-meteo.com/v1/elevation")
USER_AGENT = "nikita.os trip planner (https://github.com/ncojam/nikita.os)"
PROFILE_POINTS = 60      # точек профиля высот на путь (сервис принимает до 100)
CLIMB_STEP = 3.0         # метры: колебания меньше этого не считаем подъёмом (шум модели рельефа)
NAISMITH_M_PER_MIN = 10
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$")


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


def valid_dt(s):
    """Местные дата и время «2027-05-12T18:30»."""
    if not isinstance(s, str) or not DT_RE.match(s):
        return False
    return valid_date(s[:10])


def tz_of(v):
    """Часовой пояс как UTC+N (шаг в четверть часа), иначе ошибка."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not -12 <= v <= 14 or (v * 4) % 1:
        raise Bad("часовой пояс — от UTC−12 до UTC+14")
    return float(v)


def utc_min(dt, tz):
    """Минуты от эпохи в UTC для местного времени dt в поясе UTC+tz."""
    return int((datetime.fromisoformat(dt) - datetime(1970, 1, 1)).total_seconds() // 60 - tz * 60)


def money(v):
    if v in (None, ""):
        return None
    if isinstance(v, bool):
        raise Bad("цена — число")
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise Bad("цена — число") from None
    if not 0 <= n <= MONEY_MAX:
        raise Bad("цена не похожа на настоящую")
    return round(n, 2)


def wrap_trip(old):
    """Одиночный план версии 2 → поездка «Кансай» внутри нового хранилища."""
    return {"id": "kansai", "name": "Кансай 2027 · BitSummit", "icon": "🏯", "cur": "¥", "private": False,
            "days": old["days"], "places": old["places"], "cards": old["cards"], "stays": old["stays"],
            "routes": [], "todos": [], "chosen": None}


def legacy_migrate(d):
    """Доносит новое из trip_seed.py в план версии 2, не трогая правки владельца (до оборачивания в проекты)."""
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


class Trip:
    def __init__(self, path, deny, is_owner):
        self.path = Path(path)
        self.deny = deny                # None — можно; иначе готовый ответ 401/403
        self.is_owner = is_owner
        self.load()
        self.legs_path = self.path.with_name("trip_legs.json")
        try:
            self.legs = json.loads(self.legs_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.legs = {}
        self.leg_lock = asyncio.Lock()

    def load(self):
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = None
        if raw is None:
            self.data = {"v": DOC_VERSION, "trips": [wrap_trip(json.loads(json.dumps(SEED)))]}
        elif "trips" in raw:
            self.data = raw
        else:   # версия 2: одна поездка. Копия — на случай отката
            legacy_migrate(raw)
            self.path.with_suffix(".json.v2").write_text(self.path.read_text(encoding="utf-8"), encoding="utf-8")
            self.data = {"v": DOC_VERSION, "trips": [wrap_trip(raw)]}
        for t in self.data["trips"]:
            t.setdefault("routes", [])
            t.setdefault("todos", [])
            t.setdefault("chosen", None)
            t.setdefault("private", False)
            t.setdefault("cur", "₽")
            t.setdefault("icon", "🧳")
        self.save()

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def visible(self, request):
        owner = self.is_owner(request)
        return owner, [t for t in self.data["trips"] if owner or not t["private"]]

    def answer(self, request):
        owner, trips = self.visible(request)
        return web.json_response({"trips": trips, "owner": owner}, headers={"Cache-Control": "no-store"})

    def fail(self, text, status=400):
        return web.json_response({"error": text}, status=status)

    async def body(self, request):
        try:
            b = await request.json()
        except (ValueError, TypeError):
            b = None
        return b if isinstance(b, dict) else {}

    async def ctx(self, request):
        """(тело, поездка, готовый ответ-ошибка): права и поездка проверяются одним местом."""
        if (d := self.deny(request)):
            return None, None, d
        b = await self.body(request)
        t = next((x for x in self.data["trips"] if x["id"] == b.get("trip")), None)
        if t is None:
            return b, None, self.fail("такой поездки нет", 404)
        return b, t, None

    def place_for(self, t, raw):
        """Вернёт id места: существующее (можно переименовать и подвинуть) или новое."""
        if not isinstance(raw, dict):
            raise Bad("не указано место")
        places = t["places"]
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

    def drop_orphans(self, t):
        used = {c["place"] for c in t["cards"]}
        t["places"] = [p for p in t["places"] if p["id"] in used]
        days = {c["date"] for c in t["cards"]}
        t["days"] = {d: x for d, x in t["days"].items() if d in days}

    def clean_link(self, t, raw):
        """Связь пункта чек-листа с перегоном или ночлегом; битая связь = нет связи."""
        if not isinstance(raw, dict):
            return None
        if raw.get("stay") and any(s["id"] == raw["stay"] for s in t["stays"]):
            return {"stay": raw["stay"]}
        route = next((r for r in t["routes"] if r["id"] == raw.get("route")), None)
        if route and any(s["id"] == raw.get("step") for s in route["steps"]):
            return {"route": route["id"], "step": raw["step"]}
        return None

    def relink(self, t):
        """После удаления ночлега, варианта или перегона пункты остаются, но без связи."""
        for todo in t["todos"]:
            if todo.get("link"):
                todo["link"] = self.clean_link(t, todo["link"])
        if t["chosen"] and not any(r["id"] == t["chosen"] for r in t["routes"]):
            t["chosen"] = None

    # ---------- поездки ----------
    async def api_project(self, request):
        if (d := self.deny(request)):
            return d
        b = await self.body(request)
        trips = self.data["trips"]
        t = next((x for x in trips if x["id"] == b.get("id")), None)
        if b.get("id") and t is None:
            return self.fail("поездка уже удалена", 404)
        if t is None and len(trips) >= MAX_TRIPS:
            return self.fail("слишком много поездок", 413)
        name = clean(b.get("name"), TRIP_NAME_MAX)
        if not name:
            return self.fail("назови поездку")
        fields = {"name": name, "icon": clean(b.get("icon"), 8) or "🧳", "cur": clean(b.get("cur"), 4) or "₽",
                  "private": bool(b.get("private"))}
        if t is None:
            trips.append({"id": uuid.uuid4().hex[:10], **fields, "days": {}, "places": [], "cards": [], "stays": [],
                          "routes": [], "todos": [], "chosen": None})
        else:
            t.update(fields)
        self.save()
        return self.answer(request)

    async def api_project_delete(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        if len(self.data["trips"]) <= 1:
            return self.fail("последнюю поездку удалить нельзя")
        self.data["trips"] = [x for x in self.data["trips"] if x is not t]
        self.save()
        return self.answer(request)

    # ---------- план по дням ----------
    async def api_card(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        cards = t["cards"]
        card = next((c for c in cards if c["id"] == b.get("id")), None)
        if b.get("id") and card is None:
            return self.fail("карточка уже удалена", 404)
        if card is None and len(cards) >= MAX_CARDS:
            return self.fail("слишком много карточек", 413)
        if not valid_date(b.get("date")) or not TIME_RE.match(str(b.get("time"))):
            return self.fail("проверь дату и время")
        try:
            pid = self.place_for(t, b.get("place"))
        except Bad as e:
            return self.fail(str(e))
        fields = {"date": b["date"], "time": b["time"], "place": pid, "comment": clean(b.get("comment"), COMMENT_MAX),
                  "leg": "transit" if b.get("leg") == "transit" else "walk"}
        if card is None:
            cards.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            card.update(fields)
        self.drop_orphans(t)
        self.save()
        return self.answer(request)

    async def api_card_delete(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        left = [c for c in t["cards"] if c["id"] != b.get("id")]
        if len(left) == len(t["cards"]):
            return self.fail("нет такой карточки", 404)
        t["cards"] = left
        self.drop_orphans(t)
        self.save()
        return self.answer(request)

    async def api_day(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        day = b.get("date")
        if not valid_date(day) or not any(c["date"] == day for c in t["cards"]):
            return self.fail("нет такого дня", 404)
        title = clean(b.get("title"), DAY_TITLE_MAX)
        if title:
            t["days"][day] = title
        else:
            t["days"].pop(day, None)
        self.save()
        return self.answer(request)

    # ---------- ночлег ----------
    async def api_stay(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        stays = t["stays"]
        stay = next((s for s in stays if s["id"] == b.get("id")), None)
        if b.get("id") and stay is None:
            return self.fail("вариант уже удалён", 404)
        if stay is None and len(stays) >= MAX_STAYS:
            return self.fail("слишком много вариантов", 413)
        name = clean(b.get("name"), NAME_MAX)
        lat, lng = coord(b.get("lat"), 90), coord(b.get("lng"), 180)
        dates = b.get("dates")
        if not name or lat is None or lng is None:
            return self.fail("нужны название и точка на карте")
        if not isinstance(dates, list) or not dates or len(dates) > 60 or not all(valid_date(x) for x in dates):
            return self.fail("выбери хотя бы один день")
        fields = {"name": name, "lat": lat, "lng": lng, "price": clean(b.get("price"), PRICE_MAX),
                  "url": clean_url(b.get("url")), "comment": clean(b.get("comment"), COMMENT_MAX), "dates": sorted(set(dates))}
        if stay is None:
            stays.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            stay.update(fields)
        self.save()
        return self.answer(request)

    async def api_stay_delete(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        left = [s for s in t["stays"] if s["id"] != b.get("id")]
        if len(left) == len(t["stays"]):
            return self.fail("нет такого варианта", 404)
        t["stays"] = left
        self.relink(t)
        self.save()
        return self.answer(request)

    # ---------- варианты пути ----------
    def clean_steps(self, raw):
        if not isinstance(raw, list) or not raw or len(raw) > MAX_STEPS:
            raise Bad(f"в варианте нужен хотя бы один перегон, не больше {MAX_STEPS}")
        out, seen = [], set()
        for s in raw:
            if not isinstance(s, dict):
                raise Bad("перегон нечитаем")
            frm, to = clean(s.get("frm"), NAME_MAX), clean(s.get("to"), NAME_MAX)
            if not frm or not to:
                raise Bad("у каждого перегона нужны «откуда» и «куда»")
            dep, arr = s.get("dep"), s.get("arr")
            if not valid_dt(dep) or not valid_dt(arr):
                raise Bad(f"{frm} → {to}: проверь дату и время отправления и прибытия")
            tzd, tza = tz_of(s.get("tzd", 3)), tz_of(s.get("tza", 3))
            if utc_min(arr, tza) <= utc_min(dep, tzd):
                raise Bad(f"{frm} → {to}: прибытие должно быть позже отправления (проверь часовые пояса)")
            sid = s.get("id") if isinstance(s.get("id"), str) and re.fullmatch(r"[0-9a-f]{10}", s["id"]) and s["id"] not in seen \
                else uuid.uuid4().hex[:10]
            seen.add(sid)
            out.append({"id": sid, "mode": s.get("mode") if s.get("mode") in MODES else "other", "num": clean(s.get("num"), NUM_MAX),
                        "frm": frm, "to": to, "dep": dep, "tzd": tzd, "arr": arr, "tza": tza,
                        "price": money(s.get("price")), "comment": clean(s.get("comment"), COMMENT_MAX)})
        return out

    async def api_route(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        routes = t["routes"]
        route = next((r for r in routes if r["id"] == b.get("id")), None)
        if b.get("id") and route is None:
            return self.fail("вариант уже удалён", 404)
        if route is None and len(routes) >= MAX_ROUTES:
            return self.fail("слишком много вариантов пути", 413)
        name = clean(b.get("name"), NAME_MAX)
        if not name:
            return self.fail("назови вариант, например «Поезд + самолёт через Сургут»")
        try:
            steps = self.clean_steps(b.get("steps"))
        except Bad as e:
            return self.fail(str(e))
        fields = {"name": name, "comment": clean(b.get("comment"), COMMENT_MAX), "steps": steps}
        if route is None:
            routes.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            route.update(fields)
        self.relink(t)
        self.save()
        return self.answer(request)

    async def api_route_delete(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        left = [r for r in t["routes"] if r["id"] != b.get("id")]
        if len(left) == len(t["routes"]):
            return self.fail("нет такого варианта", 404)
        t["routes"] = left
        self.relink(t)
        self.save()
        return self.answer(request)

    async def api_route_choose(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        rid = b.get("route")
        if rid is not None and not any(r["id"] == rid for r in t["routes"]):
            return self.fail("нет такого варианта", 404)
        t["chosen"] = rid
        self.save()
        return self.answer(request)

    # ---------- чек-лист ----------
    async def api_todo(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        todos = t["todos"]
        todo = next((x for x in todos if x["id"] == b.get("id")), None)
        if b.get("id") and todo is None:
            return self.fail("пункт уже удалён", 404)
        if todo is None and len(todos) >= MAX_TODOS:
            return self.fail("слишком много пунктов", 413)
        old = todo or {"text": "", "kind": "other", "done": False, "link": None}
        text = clean(b["text"] if "text" in b else old["text"], TODO_MAX)
        if not text:
            return self.fail("напиши, что нужно сделать")
        kind = b["kind"] if b.get("kind") in KINDS else old["kind"]
        fields = {"text": text, "kind": kind, "done": bool(b["done"]) if "done" in b else old["done"],
                  "link": self.clean_link(t, b["link"]) if "link" in b else old["link"]}
        if todo is None:
            todos.append({"id": uuid.uuid4().hex[:10], **fields})
        else:
            todo.update(fields)
        self.save()
        return self.answer(request)

    async def api_todo_delete(self, request):
        b, t, err = await self.ctx(request)
        if err:
            return err
        left = [x for x in t["todos"] if x["id"] != b.get("id")]
        if len(left) == len(t["todos"]):
            return self.fail("нет такого пункта", 404)
        t["todos"] = left
        self.save()
        return self.answer(request)

    async def api_todo_fill(self, request):
        """Билет на каждый перегон выбранного варианта — тем, у кого ещё нет своего пункта."""
        b, t, err = await self.ctx(request)
        if err:
            return err
        route = next((r for r in t["routes"] if r["id"] == t["chosen"]), None)
        if route is None:
            return self.fail("сначала выбери вариант пути")
        have = {x["link"]["step"] for x in t["todos"] if x.get("link") and x["link"].get("step")}
        for s in route["steps"]:
            if s["id"] in have:
                continue
            if len(t["todos"]) >= MAX_TODOS:
                return self.fail("слишком много пунктов", 413)
            text = f'Билет: {s["frm"]} → {s["to"]}' + (f' ({s["num"]})' if s["num"] else "")
            t["todos"].append({"id": uuid.uuid4().hex[:10], "text": clean(text, TODO_MAX), "kind": "ticket", "done": False,
                               "link": {"route": route["id"], "step": s["id"]}})
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
        owner, trips = self.visible(request)
        t = next((x for x in trips if x["id"] == request.match_info["trip"]), None)
        if t is None:
            return self.fail("такой поездки нет", 404)
        places = {p["id"]: p for p in t["places"]}
        a, b = places.get(request.match_info["a"]), places.get(request.match_info["b"])
        if not a or not b:
            return self.fail("нет такого места", 404)
        key = f'{a["lat"]},{a["lng"]}>{b["lat"]},{b["lng"]}'
        async with self.leg_lock:      # внешние сервисы бесплатные: по одному запросу за раз
            leg = self.legs.get(key)
            if leg is None:
                if len(self.legs) >= MAX_LEGS:
                    return self.fail("кэш путей заполнен", 503)
                try:
                    leg = await self.fetch_leg(a, b)
                except (aiohttp.ClientError, asyncio.TimeoutError, KeyError, IndexError, TypeError, ValueError) as e:
                    log.warning("trip: нет пути %s: %s", key, e)
                    return self.fail("сервис маршрутов не ответил", 503)
                self.legs[key] = leg
                tmp = self.legs_path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.legs, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, self.legs_path)
        return web.json_response(leg, headers={"Cache-Control": "public, max-age=3600"})

    async def api_get(self, request):
        return self.answer(request)

    def routes(self, app):
        r = app.router
        r.add_get("/api/trip", self.api_get)
        for path, handler in (("project", self.api_project), ("project/delete", self.api_project_delete),
                              ("card", self.api_card), ("card/delete", self.api_card_delete), ("day", self.api_day),
                              ("stay", self.api_stay), ("stay/delete", self.api_stay_delete),
                              ("route", self.api_route), ("route/delete", self.api_route_delete), ("route/choose", self.api_route_choose),
                              ("todo", self.api_todo), ("todo/delete", self.api_todo_delete), ("todo/fill", self.api_todo_fill)):
            r.add_post("/api/trip/" + path, handler)
        r.add_get("/api/trip/leg/{trip}/{a}/{b}", self.api_leg)
