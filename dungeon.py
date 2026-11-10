"""Clown Dungeon — многопользовательская игра для Telegram Mini App (страница /dungeon.html).

Игрок бродит по локации: ничего не случилось, нашёл монеты или вещь, напоролся на монстра. Бой — по ходам,
как в Mother 3: атака запускает комбо, дальше игрок бьёт по врагу в такт сильным нотам боевого трека.
Вся игра считается здесь, клиент только показывает. Единственное, что решает клиент, — попал ли игрок в такт:
только он знает, что звучит у него в наушниках. Удар клиент показывает сразу, не дожидаясь сети, а сервер потом
проверяет, что нота сильная, новая и примерно того времени, и считает настоящий урон.

Протокол (WS /api/dungeon/ws, JSON). Клиент → сервер: auth, ping, wander, use, equip, unequip, pick, join,
throw, hinder, act (attack/item/flee), tap, miss, stop, buy, sell, go. Сервер → клиент: hello, pong, state (снимок мира глазами игрока),
ev (событие для анимации), log (строка в журнал), error.

Данные игры (вещи, враги, локации) — таблицы ниже: новый враг или уровень — это новая запись.
Прогресс Telegram-игроков и аккаунтов сайта лежит в data/dungeon.json; гости живут только в памяти.
Подробности — docs/dungeon.md.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import math
import os
import random
import re
import shutil
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote

from aiohttp import web, WSMsgType

from share import OWNER

log = logging.getLogger("dungeon")

MAX_CONNS = int(os.environ.get("NOS_DUNGEON_CONNS", 300))
MAX_PLAYERS = int(os.environ.get("NOS_DUNGEON_PLAYERS", 20000))
MAX_TRACK = 2 * 1024 * 1024
MAX_STEM = 6 * 1024 * 1024    # одна дорожка кеша музыки
MAX_STEMS = 24                # дорожек на трек
SAVE_EVERY = 10          # с, как часто сбрасывать прогресс на диск
TICK = 0.1               # с, шаг таймеров боя
MSG_RATE = 25            # сообщений в секунду с одного соединения
TG_MAX_AGE = 24 * 3600   # initData старше суток не принимаем

WANDER_CD = 1.0          # с между «бродить»: столько заполняется кнопка у клиента
WANDER_SLACK = 0.15      # сервер прощает столько: нажатие в момент готовности не должно теряться из-за сети
GIGGLE_CHANCE = 0.2      # доля пустых прогулок, когда кто-то хихикает в темноте
HINDER_CD = 12           # с между помехами
GROUND_TTL = 15 * 60     # с, сколько вещи лежат на земле
GROUND_CAP = 30          # вещей на локацию
PARTY_CAP = 4
TURN_SEC = 30            # с на выбор действия
TURN_OFFLINE = 4         # с на ход, если игрок отключился
OFFLINE_LEAVE = 30       # с без связи — и игрок выбывает из боя
FLEE_CHANCE = 0.6
COMBO_DECAY = 1 / 1.5    # каждый следующий удар комбо слабее в полтора раза, минимум 1
CRY_EVERY = 20           # каждые столько ударов в такт подряд монстр плачет, а сила удара возвращается к половине обычной
TEARS_FULL = 3           # полоска слёз: столько плачей — и она полная
TEARS_MULT = 3           # полная полоска: на этом плаче сила удара не сбрасывается к обычной, а умножается, полоска пустеет
COMBO_START_BEATS = 3.5  # долей на первый удар в такт после атаки
COMBO_GRACE_BEATS = 2.6  # долей на следующий: одну сильную ноту можно пропустить
COMBO_NET_SLACK = 0.7    # с сверх этого: тап мог задержаться в сети. Клиент сам закрывает комбо вовремя (stop), это страховка
TAP_EARLY = 1.5          # допуск серверных часов, доли
TAP_LATE = 6.0           # попадание судит клиент, сервер только отсекает явный обман: на медленном интернете тап идёт долго
ENEMY_WINDUP = 0.9       # с, замах врага (удар приходится на ближайшую долю после него)
ENEMY_PAUSE = 0.8        # с после удара врага
ENEMY_GAP = 0.5          # с между ударами врагов, когда их несколько: бьют по очереди
WAIL_RISE_BARS = 2       # тактов завывание нарастает перед тишиной: сбиться за это время ещё не страшно
RESIST_KEEP = 0.25       # какая доля урона доходит при резисте к школе способности
MUSIC_LEAD = 1.0         # с от появления врага до первой доли

BORDER_EVERY = 50        # раз в столько прогулок игрок выходит к краю локации: там лавка и переходы
SELL_SHARE = 0.1         # за сколько от цены лавка берёт вещь

BASE_HP = 30
BASE_MP = 12
BASE_DMG = (4, 7)
SKILL_SLOTS = 4
LEVEL_MP = 2             # игроку за уровень
MP_WANDER = 1            # за прогулку
MP_WIN = 2               # за победу
# уровни: опыт за победу делят не поровну, а дают каждому участнику целиком
XP_KILL = 10             # за врага 1 уровня, дальше +XP_KILL_LVL за каждый уровень
XP_KILL_LVL = 5
XP_LEVEL = 30            # до следующего уровня нужно XP_LEVEL × уровень
LEVEL_HP = 4             # игроку за уровень
LEVEL_DMG_EVERY = 2      # +1 к урону раз в столько уровней
# враг растёт чуть медленнее игрока: его уровень равен уровню того, кто на него наткнулся
ENEMY_HP_LVL = 0.12      # +12% здоровья за уровень
ENEMY_ATK_EVERY = 2      # +1 к атаке раз в столько уровней

# price — цена в лавке; продать можно за SELL_SHARE от неё
ITEMS = {
    "mushroom": {"name": "Светящийся гриб", "kind": "heal", "heal": 8, "price": 10},
    "bandage": {"name": "Бинт", "kind": "heal", "heal": 15, "price": 20},
    "elixir": {"name": "Пещерная настойка", "kind": "heal", "heal": 30, "price": 45},
    "thick_elixir": {"name": "Густая настойка", "kind": "heal", "heal": 70, "price": 100},
    "pickaxe": {"name": "Ржавая кирка", "kind": "weapon", "atk": 3, "price": 60},
    "helmet": {"name": "Шахтёрская каска", "kind": "armor", "def": 2, "price": 60},
    "dark_vial": {"name": "Чёрный пузырёк", "kind": "buff", "resist": "dark", "sec": 180, "price": 80,
                  "desc": "резист к Тёмным способностям на 3 мин"},
    # только в лавке: чем сильнее, тем дороже
    "crowbar": {"name": "Монтировка", "kind": "weapon", "atk": 5, "price": 150},
    "drill": {"name": "Ручной бур", "kind": "weapon", "atk": 8, "price": 400},
    "mallet": {"name": "Клоунский молот", "kind": "weapon", "atk": 12, "price": 1000},
    "sorrow_blade": {"name": "Клинок печали", "kind": "weapon", "atk": 18, "price": 2600},
    "jacket": {"name": "Кожаная куртка", "kind": "armor", "def": 4, "price": 160},
    "chainmail": {"name": "Кольчуга", "kind": "armor", "def": 6, "price": 450},
    "rubber_suit": {"name": "Резиновый костюм", "kind": "armor", "def": 9, "price": 1100},
    "stone_plate": {"name": "Каменный доспех", "kind": "armor", "def": 13, "price": 2800},
}

# школа способности: позже эффекты игрока будут контрить разные школы
ABILITIES = {
    "wail": {"name": "Завывание", "school": "dark"},
    "laugh": {"name": "Смех", "school": "dark"},
}
EVEN_SIGS = {"4/4", "3/4", "2/4"}   # всё остальное — нечётный размер: игрока предупреждаем в начале боя
SCHOOLS = {"dark": "Тёмная"}

# заклинания: урон фиксированный, он не растёт с уровнем — поэтому со временем нужны новые свитки
SPELLS = {
    "spark": {"name": "Искра", "mp": 5, "dmg": 14, "stun": True, "desc": "14 урона, враг пропускает ход"},
}
START_SKILLS = ["spark"]

ENEMIES = {
    "head": {"name": "Печаль", "hp": 50, "atk": (2, 5), "tracks": ["dungeon_00", "dungeon_01", "dungeon_02"],
             "coins": (5, 15), "drops": {"mushroom": 4, "bandage": 2, "elixir": 1, "thick_elixir": 0.5, "pickaxe": 1},
             "loot": 1, "loot_every": 4, "loot_max": 3,
             "hits": ["кусает", "бодает", "плюётся в"],
             # wail: шанс на цепочку ударов, с какого удара начинает, сколько тактов длится тишина
             # half: событие «вдвое реже» — с удара hits ритм на bars тактов идёт через долю, а удар слабеет мягче (decay)
             "abilities": {"wail": {"chance": 0.35, "hits": (5, 10), "bars": (2, 6)},
                           "half": {"chance": 0.3, "hits": (3, 8), "bars": (2, 4), "decay": 0.75}}},
    "clown": {"name": "Клоун", "hp": 70, "atk": (3, 6), "tracks": ["clown_00", "clown_01", "clown_02"],
              "coins": (10, 25), "drops": {"elixir": 5, "thick_elixir": 3, "bandage": 2, "dark_vial": 1, "helmet": 0.5},
              # добыча: столько вещей и ещё одна за каждые loot_every уровней врага, не больше loot_max
              "loot": 2, "loot_every": 2, "loot_max": 7,
              "decay": 0.8,          # сильные доли у клоуна редкие — удар слабеет медленнее
              "cry": 10,             # плачет чаще: каждые столько ударов (по умолчанию CRY_EVERY)
              "hits": ["кусает", "бодает", "хохочет в лицо"],
              # laugh: шанс в ход врага вместо атаки, смешков, на сколько ходов ступор
              # car: при какой доле здоровья выезжает машина, сколько мини-клоунов, их здоровье от полного клоуна
              "abilities": {"laugh": {"chance": 0.3, "count": 7, "stun": (1, 2)},
                            "car": {"below": 0.3, "count": 2, "kind": "mini", "share": 0.3},
                            # fast: событие «вдвое чаще» — на bars тактов сильная каждая четверть, бой не тянется
                            "fast": {"chance": 0.6, "hits": (2, 6), "bars": (2, 4), "decay": 0.85}}},
    "mini": {"name": "Мини-клоун", "hp": 0, "atk": (1, 3), "model": "clown", "summoned": True,
             "hits": ["щиплет", "пищит на", "кусает за палец"]},
}

LOCATIONS = {
    "cave": {
        "name": "Пещера",
        # вес исхода одной прогулки
        "wander": {"nothing": 40, "coins": 20, "item": 15, "monster": 25},
        "coins": (1, 6),
        "items": {"mushroom": 6, "bandage": 3, "elixir": 1, "pickaxe": 1, "helmet": 1, "dark_vial": 0.4, "thick_elixir": 0.4},
        "enemies": {"head": 1, "clown": 1},
        "exits": [],           # соседние локации: на краю можно перейти (у пещеры пока нет)
        "shop": ["crowbar", "jacket", "drill", "chainmail", "mallet", "rubber_suit", "sorrow_blade", "stone_plate", "elixir", "thick_elixir"],
        "border": "Ты вышел к краю пещеры. У стены стоит лавка с фонарём.",
        "giggle": ["Где-то вдалеке хихикают.", "Из темноты доносится смешок.", "Кто-то хихикает прямо за спиной. Никого."],
        "nothing": ["Капает вода.", "Ты споткнулся о камень. Камень не извинился.",
                    "Темно. Сыро. Пахнет гримом.", "Эхо повторяет твои шаги, но с опозданием на долю."],
    },
}
START_LOC = "cave"
STARTER = {"mushroom": 2}


STEM_NAME = re.compile(r"[a-z0-9]{1,16}")
FIELDS = {"foe": int, "item": str, "slot": str, "id": int, "target": str, "a": str, "to": str}   # поля сообщений клиента


def weighted(table):
    return random.choices(list(table), weights=list(table.values()))[0]


def tg_user(init_data):
    """Проверка подписи Telegram WebApp initData → (id, ник) или None.

    У игры может быть свой бот (TG_DUNGEON_BOT_TOKEN) — или та же кнопка, что у Джуса (TG_BOT_TOKEN).
    """
    if not isinstance(init_data, str) or not init_data or len(init_data) > 4096:
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    got = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    for token in (os.environ.get("TG_DUNGEON_BOT_TOKEN", ""), os.environ.get("TG_BOT_TOKEN", "")):
        if not token:
            continue
        secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
        if hmac.compare_digest(hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(), got):
            break
    else:
        return None
    try:
        if time.time() - int(pairs.get("auth_date", 0)) > TG_MAX_AGE:
            return None
        u = json.loads(pairs.get("user", "{}"))
        uid = int(u["id"])
    except (ValueError, TypeError, KeyError):
        return None
    name = u.get("username") and "@" + u["username"] or (u.get("first_name") or "").strip() or f"tg{uid}"
    return uid, clean_nick(name)


def clean_nick(n):
    return re.sub(r"[\x00-\x1f\x7f]", "", str(n)).strip()[:24] or "?"


def role_of(ch):
    """Роль канала по названию — для треков без своего .json."""
    text = f"{ch.get('id', '')} {ch.get('name', '')} {ch.get('sample', '')}".lower()
    for role, words in (("tension", ("suspen", "tension", "напряж")), ("kick", ("kick", "бочк")), ("snare", ("snare", "clap", "малый")),
                        ("hat", ("hat", "хэт", "хет")), ("bass", ("bass", "бас", "sub", "wub")),
                        ("lead", ("bell", "lead", "melod", "pluck", "колок", "мелод"))):
        if any(w in text for w in words):
            return role
    return None


def infer_rules(raw):
    """Правила трека, про который ничего не написано: роли по названиям, сильные ноты — мелодия на целых долях."""
    channels = raw.get("channels", [])
    roles = {c["id"]: r for c in channels if (r := role_of(c))}
    if "lead" not in roles.values():
        lead = next((c["id"] for c in channels if c["id"] not in roles and c.get("type") != "sampler"), None)
        if lead:
            roles[lead] = "lead"
    pick = lambda *want: [i for i, r in roles.items() if r in want]
    return {"roles": roles}       # сильные ноты — по размеру такта, см. meter_groups


def meter_groups(quarters, style="twos"):
    """Сильные доли — только на целых четвертях: в половинки и шестнадцатые попадать невозможно.
    quarters — сколько четвертей в периоде (нечётный размер берём за несколько тактов: 13/8 × 2 = 13 четвертей).
    twos: по две четверти, в конце одна (13 → 2+2+2+2+2+2+1); threes: тройки и двойки (13 → 3+3+3+2+2, 11 → 3+3+3+2)."""
    if quarters <= 3:
        return [quarters]
    if style == "ones":                    # каждая четверть
        return [1] * quarters
    if style == "threes":
        threes = next(k for k in range(quarters // 3, -1, -1) if (quarters - 3 * k) % 2 == 0)
        return [3] * threes + [2] * ((quarters - 3 * threes) // 2)
    return [2] * (quarters // 2) + [1] * (quarters % 2)


def parse_track(track_id, raw, rules):
    """Сетка трека: темп, длина паттерна и сильные ноты. Клиент (music.js) считает их по тем же правилам."""
    pat = next((p for p in raw["patterns"] if p["id"] == rules.get("pattern", raw.get("current"))), raw["patterns"][0])
    num, den = (int(x) for x in str(pat.get("sig", "4/4")).split("/"))
    bar = num * 4 / den
    notes = pat.get("notes", {})
    end = max([bar] + [n[0] + n[1] for L in notes.values() for n in L])
    beats = pat.get("length") or math.ceil(end / bar - 1e-9) * bar
    steps = round(beats * 4)
    # Сильные доли считаются по размеру такта (meter_groups), их можно задать и самому: "strong": {"groups": [3, 2, 2]}
    # в четвертях за период, или выбрать стиль: "strong": {"style": "threes"}.
    # Старый способ — ноты каналов на сетке: "strong": {"channels": ["grapefruit"], "grid": 1}
    want = rules.get("strong", {})
    strong = set()
    if want.get("channels"):
        grid = want.get("grid", 1)
        for ch in want["channels"]:
            for n in notes.get(ch, []):
                if abs(n[0] / grid - round(n[0] / grid)) < 1e-6:
                    strong.add(round(n[0] * 4) % steps)
    else:
        k = next(k for k in range(1, 17) if abs(bar * k - round(bar * k)) < 1e-6)   # тактов в периоде из целых четвертей
        period = round(bar * k)
        offs, at = [], 0
        groups = want.get("groups") or meter_groups(period, want.get("style", "twos"))
        for g in groups:
            offs.append(at * 4)
            at += g
        rules["meter"] = {"groups": groups, "period": at}    # для табло счёта на клиенте
        for start in range(0, steps, period * 4):
            strong.update(start + o for o in offs if start + o < steps)
    strong = strong or set(range(0, steps, 4))
    rules["strongSteps"] = sorted(strong)              # клиент берёт сильные доли отсюда, чтобы не считать по-своему
    s = sorted(strong)
    gap = max(b - a for a, b in zip(s, s[1:] + [s[0] + steps])) / 4      # самая долгая пауза между сильными нотами, доли
    return {"id": track_id, "beat": 60 / raw.get("bpm", 120), "steps": steps, "bar": round(bar * 4), "strong": strong,
            "sig": f"{num}/{den}",
            # в редких треках сильные ноты далеко друг от друга: окно ожидания удара растёт вместе с паузой
            "grace": max(COMBO_GRACE_BEATS, gap + 0.6), "start": max(COMBO_START_BEATS, gap + 0.9),
            "rules": rules}


class Dungeon:
    def __init__(self, user_of, data_dir, public_dir):
        self.user_of = user_of
        self.path = Path(data_dir) / "dungeon.json"
        self.stems_root = Path(data_dir) / "dungeon-stems"
        self.public = public_dir
        self.players = {}        # pid -> запись игрока
        self.conns = {}          # ws -> pid (None до входа)
        self.online = {}         # pid -> set(ws)
        self.battles = {}        # id -> бой
        self.ground = {}         # локация -> [{id, item/coins, ...}]
        self.tracks = {}         # id -> (метка файла, трек)
        self.last_track = None
        self.dirty_locs = set()
        self.dirty_save = False
        self.next_id = 1
        self.task = None
        self.last_save = 0
        self._load()

    # ---------- хранение ----------
    def _load(self):
        try:
            self.players = json.loads(self.path.read_text("utf-8"))
        except FileNotFoundError:
            pass
        except (ValueError, OSError):
            log.exception("dungeon: не прочитать %s", self.path)

    def _save(self):
        keep = {k: v for k, v in self.players.items() if not k.startswith("g:")}
        tmp = self.path.with_suffix(".tmp")
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(keep, ensure_ascii=False, separators=(",", ":")), "utf-8")
            os.replace(tmp, self.path)
            self.dirty_save = False
        except OSError:
            log.exception("dungeon: не сохранить прогресс")

    def uid(self):
        self.next_id += 1
        return self.next_id

    # ---------- музыка ----------
    def track_files(self):
        """Все боевые треки: id → (файл, адрес для клиента). Источник один — файлы игры в репозитории.
        Копия для всех лежит в проводнике сайта (MUSIC_DIR, её кладёт deploy.sh), но игра берёт только отсюда."""
        return {f.stem.lower(): (f, f"/dungeon/music/{quote(f.name)}") for f in (Path(self.public) / "dungeon" / "music").glob("*.dawn")}

    def scan_tracks(self):
        """Перечитать изменившиеся файлы. Битый трек пропускаем: один плохой файл не должен ломать бои."""
        found = {}
        for tid, (path, url) in self.track_files().items():
            try:
                st = path.stat()
                stamp = (str(path), st.st_mtime_ns)
                old = self.tracks.get(tid)
                if old and old[0] == stamp:
                    found[tid] = old
                    continue
                if st.st_size > MAX_TRACK:
                    continue
                raw = json.loads(path.read_text("utf-8"))
                own = Path(self.public) / "dungeon" / "music" / f"{tid}.json"
                rules = json.loads(own.read_text("utf-8")) if own.is_file() else infer_rules(raw)
                rules["file"] = f"{url}?v={st.st_mtime_ns}"
                found[tid] = (stamp, {**parse_track(tid, raw, rules), "v": str(st.st_mtime_ns)})   # строкой: наносекунды не влезают в число JS
            except (OSError, ValueError, KeyError, TypeError, IndexError):
                log.warning("dungeon: не прочитать трек %s", path, exc_info=True)
        self.tracks = found
        for _, t in found.values():
            self.attach_stems(t)
        return [t for _, t in found.values()]

    # ---------- кеш музыки: дорожки, отрендеренные в браузере владельца (stems.js) ----------
    def stem_dir(self, tid, v=None):
        key = hashlib.sha256(tid.encode()).hexdigest()[:16]     # id трека берётся из имени файла: может быть любым
        return self.stems_root / key if v is None else self.stems_root / key / str(v)

    def attach_stems(self, t):
        """Кеш привязан к версии файла: трек поправили — играет синтез, пока кеш не соберут заново."""
        d = self.stem_dir(t["id"], t["v"])
        try:
            m = json.loads((d / "manifest.json").read_text("utf-8"))
            m["base"] = f"/api/dungeon/stem/{d.parent.name}/{t['v']}/"
            t["rules"]["stems"] = m
        except (OSError, ValueError):
            t["rules"].pop("stems", None)

    def owner_track(self, request, tid, v):
        """Трек для записи кеша. Ошибка — готовый ответ, иначе None и трек."""
        if not self.is_owner(request):
            return web.json_response({"error": "нет доступа"}, status=403), None
        origin = request.headers.get("Origin", "")
        if origin and origin.split("://", 1)[-1] != request.host:
            return web.json_response({"error": "Чужой Origin"}, status=403), None
        t = self.tracks.get(tid)
        if not t or str(t[1]["v"]) != str(v):
            return web.json_response({"error": "трек изменился, обнови страницу"}, status=409), None
        return None, t[1]

    def is_owner(self, request):
        u = self.user_of(request)
        return bool(u) and str(u[1]).lower() == OWNER

    async def api_tracks(self, request):
        if not self.is_owner(request):
            return web.json_response({"error": "нет доступа"}, status=403)
        tracks = await asyncio.to_thread(self.scan_tracks)
        return web.json_response([{"id": t["id"], "v": t["v"], "rules": t["rules"], "ready": "stems" in t["rules"]} for t in tracks])

    async def api_stem_put(self, request):
        q = request.query
        err, t = self.owner_track(request, q.get("track", ""), q.get("v", ""))
        if err:
            return err
        name = q.get("name", "")
        if not STEM_NAME.fullmatch(name) or not q.get("part", "").isdigit():
            return web.json_response({"error": "плохое имя дорожки"}, status=400)
        body = await request.read()
        d, part = self.stem_dir(t["id"], t["v"]), int(q["part"])

        def write():
            d.mkdir(parents=True, exist_ok=True)
            tmp = d / f".{name}.part"
            with open(tmp, "wb" if part == 0 else "ab") as f:
                f.write(body)
            if tmp.stat().st_size > MAX_STEM:
                tmp.unlink()
                return False
            if q.get("last") == "1":
                os.replace(tmp, d / f"{name}.wav.gz")
            return True
        if not await asyncio.to_thread(write):
            return web.json_response({"error": "дорожка слишком большая"}, status=413)
        return web.json_response({"ok": True})

    async def api_stems_done(self, request):
        try:
            data = await request.json()
            tid, v, stems, hit = data["track"], data["v"], data["stems"], data.get("hit")
            names = [s["name"] for s in stems] + ([hit["name"]] if hit else [])
            clean = [{"name": str(s["name"]), "role": str(s["role"])[:40], "shift": int(s["shift"])} for s in stems]
            hit = {"name": str(hit["name"]), "n": int(hit["n"]), "edo": int(hit["edo"])} if hit else None
        except (ValueError, KeyError, TypeError):
            return web.json_response({"error": "плохие данные"}, status=400)
        err, t = self.owner_track(request, tid, v)
        if err:
            return err
        d = self.stem_dir(t["id"], t["v"])
        if len(names) > MAX_STEMS or not all(STEM_NAME.fullmatch(n) and (d / f"{n}.wav.gz").is_file() for n in names):
            return web.json_response({"error": "загружены не все дорожки"}, status=400)

        def finish():
            tmp = d / ".manifest.tmp"
            tmp.write_text(json.dumps({"stems": clean, "hit": hit}, ensure_ascii=False), "utf-8")
            os.replace(tmp, d / "manifest.json")
            for old in d.parent.iterdir():       # кеш прошлых версий трека больше не нужен
                if old != d:
                    shutil.rmtree(old, ignore_errors=True)
        await asyncio.to_thread(finish)
        self.attach_stems(t)
        return web.json_response({"ok": True})

    async def api_stem_get(self, request):
        key, v, name = (request.match_info[k] for k in ("key", "v", "name"))
        if not re.fullmatch(r"[0-9a-f]{16}", key) or not v.isdigit() or not STEM_NAME.fullmatch(name):
            raise web.HTTPNotFound()
        p = self.stems_root / key / v / f"{name}.wav.gz"
        try:
            body = await asyncio.to_thread(p.read_bytes)
        except OSError:
            raise web.HTTPNotFound()
        return web.Response(body=body, headers={"Content-Type": "audio/wav", "Content-Encoding": "gzip",
                                                 "Cache-Control": "public, max-age=31536000, immutable"})

    async def pick_track(self, enemy):
        """Случайный трек на бой; два раза подряд один и тот же не ставим, если есть из чего выбрать."""
        tracks = await asyncio.to_thread(self.scan_tracks)
        allowed = [t for t in tracks if t["id"] in enemy["tracks"]] if enemy.get("tracks") else tracks
        pool = [t for t in allowed if t["id"] != self.last_track] or allowed or tracks
        t = random.choice(pool)
        self.last_track = t["id"]
        return t

    # ---------- игроки ----------
    def player(self, pid, nick):
        p = self.players.get(pid)
        if p is None:
            p = self.players[pid] = {"nick": nick, "hp": BASE_HP, "maxhp": BASE_HP, "coins": 0, "inv": dict(STARTER),
                                     "eq": {"weapon": None, "armor": None}, "loc": START_LOC, "kills": 0, "deaths": 0,
                                     "level": 1, "xp": 0}
        p["nick"] = nick
        p.setdefault("level", 1)        # записи из старых версий игры
        p.setdefault("maxmp", BASE_MP + LEVEL_MP * (p["level"] - 1))
        p.setdefault("mp", p["maxmp"])
        p.setdefault("fx", {})
        if "skills" not in p:
            p["skills"] = (START_SKILLS + [None] * SKILL_SLOTS)[:SKILL_SLOTS]
        if p.get("loc") not in LOCATIONS:
            p["loc"] = START_LOC
        p.setdefault("walk", 0)
        p.setdefault("tears", 0)
        p["inv"] = {k: v for k, v in p["inv"].items() if k in ITEMS}     # вещи, убранные из игры (палка, лохмотья)
        p["eq"] = {k: v if v in ITEMS else None for k, v in p["eq"].items()}
        self.dirty_save = True
        return p

    def battle_of(self, pid):
        for b in self.battles.values():
            if pid in b["party"]:
                return b
        return None

    def atk_of(self, p):
        w = p["eq"].get("weapon")
        return (ITEMS[w]["atk"] if w in ITEMS else 0) + (p.get("level", 1) - 1) // LEVEL_DMG_EVERY

    def def_of(self, p):
        a = p["eq"].get("armor")
        return ITEMS[a]["def"] if a in ITEMS else 0

    def inv_add(self, p, item, qty=1):
        p["inv"][item] = p["inv"].get(item, 0) + qty
        self.dirty_save = True

    def inv_take(self, p, item):
        n = p["inv"].get(item, 0)
        if n <= 0:
            return False
        if n == 1:
            del p["inv"][item]
        else:
            p["inv"][item] = n - 1
        self.dirty_save = True
        return True

    # ---------- отправка ----------
    async def send(self, ws, data):
        try:
            await ws.send_str(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        except (ConnectionError, RuntimeError):
            pass

    async def to_player(self, pid, data):
        for ws in list(self.online.get(pid, ())):
            await self.send(ws, data)

    async def say(self, pid, text):
        await self.to_player(pid, {"t": "log", "text": text})

    async def to_party(self, b, data):
        for pid in list(b["party"]):
            await self.to_player(pid, data)

    def mark(self, loc):
        self.dirty_locs.add(loc)

    async def flush(self):
        locs, self.dirty_locs = self.dirty_locs, set()
        for loc in locs:
            for pid in [i for i in self.online if self.players.get(i, {}).get("loc") == loc]:
                await self.to_player(pid, self.view(pid))

    def view(self, pid):
        p = self.players[pid]
        loc = p["loc"]
        here = [self.players[i]["nick"] for i in self.online if i in self.players and self.players[i]["loc"] == loc]
        b = self.battle_of(pid)
        return {
            "t": "state", "srv": now_ms(),
            "me": {"id": pid, "nick": p["nick"], "hp": p["hp"], "maxhp": p["maxhp"], "mp": p["mp"], "maxmp": p["maxmp"], "coins": p["coins"],
                   "skills": [{"id": s, **SPELLS[s]} if s in SPELLS else None for s in p["skills"]],
                   "fx": [{"school": SCHOOLS.get(k, k), "left": round(v - time.time())} for k, v in p["fx"].items() if v > time.time()],
                   "level": p.get("level", 1), "xp": p.get("xp", 0), "xpNext": XP_LEVEL * p.get("level", 1),
                   "atk": self.atk_of(p), "def": self.def_of(p),
                   "eq": {k: self.item_view(v) if v else None for k, v in p["eq"].items()},
                   "inv": [{**self.item_view(k), "qty": v} for k, v in sorted(p["inv"].items())]},
            "loc": {"id": loc, "name": LOCATIONS[loc]["name"], "players": here[:30],
                    "ground": [{"id": g["id"], "name": g["name"], "from": g.get("from")} for g in self.ground.get(loc, [])],
                    "battles": [{"id": x["id"], "enemy": x["enemy"]["name"] + (f" и ещё {len(self.alive(x)) - 1}" if len(self.alive(x)) > 1 else ""), "level": x["enemy"]["level"], "hp": x["enemy"]["hp"] / x["enemy"]["maxhp"],
                                 "party": [{"id": i, "nick": self.players[i]["nick"]} for i in x["party"]],
                                 "mine": pid in x["party"]}
                                for x in self.battles.values() if x["loc"] == loc]},
            "battle": self.battle_view(b, pid) if b else None,
            "border": self.border_view(p) if self.at_border(p) and not b else None,
            "toBorder": BORDER_EVERY - p["walk"] % BORDER_EVERY,
        }

    def at_border(self, p):
        return p["walk"] > 0 and p["walk"] % BORDER_EVERY == 0

    def border_view(self, p):
        L = LOCATIONS[p["loc"]]
        return {"exits": [{"id": x, "name": LOCATIONS[x]["name"]} for x in L.get("exits", []) if x in LOCATIONS],
                "shop": [self.item_view(i) for i in L.get("shop", [])]}

    def item_view(self, item):
        d = ITEMS[item]
        return {"id": item, "name": d["name"], "kind": d["kind"], "heal": d.get("heal"), "atk": d.get("atk"), "def": d.get("def"),
                "desc": d.get("desc"), "price": d.get("price", 0), "sell": self.sell_price(item)}

    def sell_price(self, item):
        return max(1, round(ITEMS[item].get("price", 0) * SELL_SHARE))

    def battle_view(self, b, pid):
        t = b["turn"]
        c = t.get("combo")
        w = c.get("wail") if c else None
        return {"id": b["id"], "track": b["track"]["id"], "music": b["track"]["rules"], "t0": b["t0"], "seed": b["seed"],
                "enemy": self.foe_view(b["enemy"]),
                "foes": [self.foe_view(f) for f in b["foes"]],
                "stunned": {k: v for k, v in b["stunned"].items() if v > 0},
                "sig": b["track"]["sig"], "grace": b["track"]["grace"], "start": b["track"]["start"],
                "party": [{"id": i, "nick": self.players[i]["nick"], "hp": self.players[i]["hp"], "maxhp": self.players[i]["maxhp"],
                           "mp": self.players[i]["mp"], "maxmp": self.players[i]["maxmp"]}
                          for i in b["party"]],
                "turn": {"who": t["who"], "phase": t["phase"], "left": max(0, t["until"] - time.time()),
                         "hits": c["hits"] if c else 0,
                         "wail": {"from": w["from"], "quiet": w["quiet"], "end": w["end"], "silent": w["silent"]} if w else None,
                         "laugh": t.get("laugh"), "foe": t.get("foe"), "half": c.get("half") if c else None},
                "decay": ENEMIES[b["enemy"]["kind"]].get("decay", COMBO_DECAY),
                "cry": ENEMIES[b["enemy"]["kind"]].get("cry", CRY_EVERY),
                "tears": self.players[pid].get("tears", 0) if pid in b["party"] else 0, "tearsFull": TEARS_FULL, "tearsMult": TEARS_MULT,
                "log": b["log"][-5:]}

    def foe_view(self, f):
        return {"id": f["id"], "kind": f["kind"], "model": ENEMIES[f["kind"]].get("model", f["kind"]), "name": f["name"],
                "level": f["level"], "hp": f["hp"], "maxhp": f["maxhp"], "mini": ENEMIES[f["kind"]].get("summoned", False)}

    # ---------- земля ----------
    def drop(self, loc, name, source=None, item=None, coins=0):
        g = self.ground.setdefault(loc, [])
        g.append({"id": self.uid(), "name": name, "item": item, "coins": coins, "from": source, "ts": time.time()})
        del g[:-GROUND_CAP]
        self.mark(loc)

    async def pick(self, pid, gid):
        p = self.players[pid]
        g = self.ground.get(p["loc"], [])
        x = next((i for i in g if i["id"] == gid), None)
        if not x:
            return await self.say(pid, "Кто-то успел раньше.")
        g.remove(x)
        if x["item"]:
            self.inv_add(p, x["item"])
        p["coins"] += x["coins"]
        self.dirty_save = True
        self.mark(p["loc"])
        await self.say(pid, f"Подобрано: {x['name']}.")
        await self.to_player(pid, {"t": "ev", "e": "pickup", "kind": "item" if x["item"] else "coins"})

    # ---------- мир ----------
    async def wander(self, pid):
        p = self.players[pid]
        if self.battle_of(pid):
            return
        now = time.time()
        if now - p.get("_wander", 0) < WANDER_CD - WANDER_SLACK:
            return
        p["_wander"] = now
        p["mp"] = min(p["maxmp"], p["mp"] + MP_WANDER)
        p["walk"] += 1
        self.dirty_save = True
        L = LOCATIONS[p["loc"]]
        what = "border" if self.at_border(p) else weighted(L["wander"])
        if what == "border":       # край локации: спокойный шаг, лавка и переходы до следующей прогулки
            await self.say(pid, L.get("border", "Край локации."))
            await self.to_player(pid, {"t": "ev", "e": "border"})
        elif what == "coins":
            n = random.randint(*L["coins"])
            p["coins"] += n
            self.dirty_save = True
            await self.say(pid, f"Монеты на полу: +{n}.")
            await self.to_player(pid, {"t": "ev", "e": "pickup", "kind": "coins"})
        elif what == "item":
            item = weighted(L["items"])
            self.inv_add(p, item)
            await self.say(pid, f"Находка: {ITEMS[item]['name']}.")
            await self.to_player(pid, {"t": "ev", "e": "pickup", "kind": "item"})
        elif what == "monster":
            await self.start_battle(pid, weighted(L["enemies"]))
        elif random.random() < GIGGLE_CHANCE:
            await self.say(pid, random.choice(L["giggle"]))
            await self.to_player(pid, {"t": "ev", "e": "giggle"})
        else:
            await self.say(pid, random.choice(L["nothing"]))
        await self.to_player(pid, self.view(pid))

    async def use(self, pid, item):
        """Предмет: вне боя — когда угодно, в бою — это ход (см. act)."""
        p = self.players[pid]
        d = ITEMS.get(item)
        if d and d["kind"] == "buff":
            if not self.inv_take(p, item):
                return False
            p["fx"][d["resist"]] = time.time() + d["sec"]
            await self.say(pid, f"{d['name']}: {d['desc']}.")
            self.mark(p["loc"])
            return True
        if not d or d["kind"] != "heal":
            return False
        if p["hp"] >= p["maxhp"]:
            await self.say(pid, "Здоровье и так полное.")
            return False
        if not self.inv_take(p, item):
            return False
        got = min(d["heal"], p["maxhp"] - p["hp"])
        p["hp"] += got
        await self.say(pid, f"{d['name']}: +{got} HP.")
        self.mark(p["loc"])
        return True

    async def equip(self, pid, item):
        """Снаряжение не забирает ход — и в бою, и вне его."""
        p = self.players[pid]
        d = ITEMS.get(item)
        if not d or d["kind"] not in ("weapon", "armor") or not self.inv_take(p, item):
            return
        old = p["eq"].get(d["kind"])
        if old:
            self.inv_add(p, old)
        p["eq"][d["kind"]] = item
        self.mark(p["loc"])

    async def throw(self, pid, item):
        """Выкинуть одну вещь: она ложится на локацию, подобрать может кто угодно. Не тратит ход."""
        p = self.players[pid]
        if item not in ITEMS or not self.inv_take(p, item):
            return
        self.drop(p["loc"], ITEMS[item]["name"], source=p["nick"], item=item)
        await self.say(pid, f"Выброшено: {ITEMS[item]['name']}.")

    async def unequip(self, pid, slot):
        p = self.players[pid]
        if slot not in ("weapon", "armor") or not p["eq"].get(slot):
            return
        self.inv_add(p, p["eq"][slot])
        p["eq"][slot] = None
        self.mark(p["loc"])

    # ---------- край локации: лавка и переходы ----------
    def border_ok(self, p, pid):
        return self.at_border(p) and not self.battle_of(pid)

    async def buy(self, pid, item):
        p = self.players[pid]
        if not self.border_ok(p, pid) or item not in LOCATIONS[p["loc"]].get("shop", []):
            return
        price = ITEMS[item]["price"]
        if p["coins"] < price:
            return await self.say(pid, "Не хватает монет.")
        p["coins"] -= price
        self.inv_add(p, item)
        await self.say(pid, f"Куплено: {ITEMS[item]['name']} за {price}.")
        await self.to_player(pid, {"t": "ev", "e": "pickup", "kind": "coins"})
        self.mark(p["loc"])

    async def sell(self, pid, item):
        p = self.players[pid]
        if not self.border_ok(p, pid) or item not in ITEMS or not self.inv_take(p, item):
            return
        got = self.sell_price(item)
        p["coins"] += got
        await self.say(pid, f"Продано: {ITEMS[item]['name']} за {got}.")
        await self.to_player(pid, {"t": "ev", "e": "pickup", "kind": "coins"})
        self.mark(p["loc"])

    async def go(self, pid, to):
        p = self.players[pid]
        if not self.border_ok(p, pid) or to not in LOCATIONS[p["loc"]].get("exits", []) or to not in LOCATIONS:
            return
        old = p["loc"]
        p["loc"] = to
        p["walk"] += 1          # с края ушёл: на новой локации до её края снова идти
        self.dirty_save = True
        self.mark(old)
        self.mark(to)
        await self.say(pid, f"Ты переходишь: {LOCATIONS[to]['name']}.")

    # ---------- бой ----------
    async def start_battle(self, pid, kind):
        p = self.players[pid]
        e = ENEMIES[kind]
        track = await self.pick_track(e)
        lvl = p.get("level", 1)
        hp = round(e["hp"] * (1 + ENEMY_HP_LVL * (lvl - 1)))
        up = (lvl - 1) // ENEMY_ATK_EVERY
        bid = self.uid()
        now = time.time()
        main = {"id": self.uid(), "kind": kind, "name": e["name"], "level": lvl, "hp": hp, "maxhp": hp,
                "atk": (e["atk"][0] + up, e["atk"][1] + up)}
        b = {"id": bid, "loc": p["loc"], "party": [pid], "order": [pid], "i": -1, "trip": set(), "gone": {},
             "enemy": main, "foes": [main], "stunned": {},
             "track": track, "t0": now_ms() + int(MUSIC_LEAD * 1000), "seed": random.getrandbits(31),
             "turn": {"who": None, "phase": "wait", "until": now}, "log": [f"{e['name']} вылетает из темноты!"]}
        self.battles[bid] = b
        if track["sig"] not in EVEN_SIGS:
            self.blog(b, f"Музыка в {track['sig']}: ритм хромает, держись!")
        self.next_turn(b)
        self.mark(b["loc"])
        await self.say(pid, f"На тебя летит {e['name']}!")
        self.ensure_loop()

    def blog(self, b, text):
        b["log"].append(text)
        del b["log"][:-12]
        self.mark(b["loc"])

    def set_turn(self, b, pid):
        limit = TURN_SEC if pid in self.online else TURN_OFFLINE
        b["turn"] = {"who": pid, "phase": "choose", "until": time.time() + limit}
        self.mark(b["loc"])

    def next_turn(self, b):
        """Следующий живой участник; когда круг кончился — ходит враг."""
        b["i"] += 1
        while b["i"] < len(b["order"]):
            pid = b["order"][b["i"]]
            if pid in b["party"] and b["stunned"].get(pid, 0) > 0:      # ступор от смеха: ход пропадает
                b["stunned"][pid] -= 1
                self.blog(b, f"{self.players[pid]['nick']} в ступоре и пропускает ход.")
            elif pid in b["party"]:
                return self.set_turn(b, pid)
            b["i"] += 1
        main, laugh = b["enemy"], ENEMIES[b["enemy"]["kind"]].get("abilities", {}).get("laugh")
        if b.pop("stun", False):
            self.blog(b, f"{main['name']}: оглушение, враги пропускают ход.")
            b["turn"] = {"who": "enemy", "phase": "pause", "until": time.time() + ENEMY_PAUSE}
        elif laugh and main["hp"] > 0 and random.random() < laugh["chance"]:
            self.start_laugh(b, laugh)
        else:
            b["queue"] = [f["id"] for f in self.alive(b)]
            self.enemy_windup(b, 0)
        self.mark(b["loc"])

    def enemy_windup(self, b, gap):
        """Следующий враг в очереди замахивается; удар — в долю. Очередь кончилась — пауза и новый круг."""
        alive = {f["id"] for f in self.alive(b)}
        while b["queue"] and b["queue"][0] not in alive:
            b["queue"].pop(0)
        if not b["queue"]:
            b["turn"] = {"who": "enemy", "phase": "pause", "until": time.time() + ENEMY_PAUSE}
        else:
            b["turn"] = {"who": "enemy", "phase": "windup", "foe": b["queue"].pop(0),
                         "until": self.next_beat(b, time.time() + gap + ENEMY_WINDUP)}
        self.mark(b["loc"])

    def start_laugh(self, b, a):
        """Тёмная способность клоуна: смешки на восьмых, после них ступор у всех, кто без резиста."""
        tr = b["track"]
        step = (time.time() + 0.3 - b["t0"] / 1000) / (tr["beat"] / 4)
        start = math.ceil(step / 2) * 2
        b["turn"] = {"who": "enemy", "phase": "laugh", "until": self.step_time(b, start + a["count"] * 2) + 0.4,
                     "laugh": {"from": start, "every": 2, "count": a["count"], "foe": b["enemy"]["id"]}}
        self.blog(b, f"{b['enemy']['name']} начинает хохотать…")

    def end_laugh(self, b):
        a = ENEMIES[b["enemy"]["kind"]]["abilities"]["laugh"]
        for pid in b["party"]:
            p = self.players[pid]
            if p["fx"].get(ABILITIES["laugh"]["school"], 0) > time.time():
                self.blog(b, f"{p['nick']} не поддаётся смеху.")
                continue
            n = random.randint(*a["stun"])
            b["stunned"][pid] = b["stunned"].get(pid, 0) + n
            self.blog(b, f"{p['nick']} в ступоре на {n} ход{'а' if n > 1 else ''}.")
        b["turn"] = {"who": "enemy", "phase": "pause", "until": time.time() + ENEMY_PAUSE}

    def alive(self, b):
        return [f for f in b["foes"] if f["hp"] > 0]

    def foe_of(self, b, fid):
        """Цель удара: выбранный враг, если он жив, иначе главный, иначе любой живой."""
        alive = self.alive(b)
        return next((f for f in alive if f["id"] == fid), None) or next((f for f in alive if f is b["enemy"]), None) \
            or (alive[0] if alive else None)

    async def check_car(self, b, f):
        """Клоунская машина: когда у клоуна мало здоровья, из неё вываливаются мини-клоуны."""
        a = ENEMIES[f["kind"]].get("abilities", {}).get("car")
        if not a or b.get("car") or f["hp"] > f["maxhp"] * a["below"]:
            return
        b["car"] = True
        m = ENEMIES[a["kind"]]
        hp = max(1, round(f["maxhp"] * a["share"]))
        up = (f["level"] - 1) // ENEMY_ATK_EVERY
        for _ in range(a["count"]):
            b["foes"].append({"id": self.uid(), "kind": a["kind"], "name": m["name"], "level": f["level"], "hp": hp, "maxhp": hp,
                              "atk": (m["atk"][0] + up, m["atk"][1] + up)})
        self.blog(b, f"Из клоунской машины вываливаются мини-клоуны: {a['count']}!")
        await self.to_party(b, {"t": "ev", "e": "summon"})

    def new_round(self, b):
        b["order"] = list(b["party"])
        b["i"] = -1
        self.next_turn(b)

    def next_beat(self, b, after):
        """Ближайшая доля не раньше момента after: враг бьёт в музыку."""
        t0, beat = b["t0"] / 1000, b["track"]["beat"]
        return t0 + max(0, math.ceil((after - t0) / beat)) * beat

    async def join(self, pid, bid):
        b = self.battles.get(bid)
        p = self.players[pid]
        if not b or b["loc"] != p["loc"] or pid in b["party"] or self.battle_of(pid) or len(b["party"]) >= PARTY_CAP:
            return
        b["party"].append(pid)
        b["order"].append(pid)     # встаёт в конец текущего круга
        self.blog(b, f"{p['nick']} вступает в бой!")

    async def act(self, pid, a, item=None, fid=None):
        b = self.battle_of(pid)
        if not b:
            return
        t = b["turn"]
        if t["who"] != pid or t["phase"] != "choose":
            return
        p = self.players[pid]
        if a == "attack":
            dmg = random.randint(*BASE_DMG) + self.atk_of(p)
            if pid in b["trip"]:
                b["trip"].discard(pid)
                dmg = max(1, dmg // 2)
                self.blog(b, f"{p['nick']} спотыкается, удар слабый.")
            await self.strike(b, pid, dmg, 0, fid)
            if b["id"] in self.battles:
                beat = b["track"]["beat"]
                b["turn"] = {"who": pid, "phase": "combo", "until": time.time() + b["track"]["start"] * beat + COMBO_NET_SLACK,
                             "combo": {"hits": 0, "power": float(dmg), "base": float(dmg), "last": -1, "dealt": dmg,
                                       "wail_at": self.roll_wail(b)}}
                c = b["turn"]["combo"]
                c["half_at"] = None if c["wail_at"] else self.roll_half(b)   # два события в одной цепочке — перебор
                self.mark(b["loc"])
        elif a == "spell":
            s = SPELLS.get(item)
            if not s or item not in p["skills"]:
                return
            if p["mp"] < s["mp"]:
                return await self.say(pid, "Не хватает маны.")
            p["mp"] -= s["mp"]
            self.dirty_save = True
            self.blog(b, f"{p['nick']} применяет: {s['name']}!")
            if s.get("stun"):
                b["stun"] = True
            await self.to_party(b, {"t": "ev", "e": "spell", "by": pid})
            await self.strike(b, pid, s["dmg"], 0, fid)
            if b["id"] in self.battles:
                self.next_turn(b)
        elif a == "item":
            if await self.use(pid, item):
                self.blog(b, f"{p['nick']} использует: {ITEMS[item]['name']}.")
                self.next_turn(b)
        elif a == "flee":
            if random.random() < FLEE_CHANCE:
                self.blog(b, f"{p['nick']} сбегает!")
                await self.say(pid, "Удалось сбежать.")
                await self.leave(b, pid)
            else:
                self.blog(b, f"{p['nick']} не смог сбежать.")
                self.next_turn(b)

    async def strike(self, b, pid, dmg, combo, fid=None):
        e = self.foe_of(b, fid)
        if not e:
            return
        e["hp"] = max(0, e["hp"] - dmg)
        await self.to_party(b, {"t": "ev", "e": "hit", "dmg": dmg, "combo": combo, "by": pid, "foe": e["id"], "hp": e["hp"] / e["maxhp"]})
        self.mark(b["loc"])
        if e["hp"] > 0:
            return await self.check_car(b, e)
        if not self.alive(b):
            return await self.win(b, pid)
        self.blog(b, f"{e['name']} повержен.")
        await self.to_party(b, {"t": "ev", "e": "foe_dead", "foe": e["id"]})

    async def tap(self, pid, step, fid=None):
        b = self.battle_of(pid)
        if not b or isinstance(step, bool) or not isinstance(step, int):
            return
        t = b["turn"]
        if t["who"] != pid or t["phase"] != "combo":
            return
        c, tr = t["combo"], b["track"]
        half = self.in_half(c, step)
        if step <= c["last"] or not self.is_strong(tr, half, step):
            return
        at = b["t0"] / 1000 + step * tr["beat"] / 4
        off = (time.time() - at) / tr["beat"]
        if not -TAP_EARLY <= off <= TAP_LATE:
            return
        c["last"] = step
        c["hits"] += 1
        cry = c["hits"] % ENEMIES[b["enemy"]["kind"]].get("cry", CRY_EVERY) == 0
        dec = half["decay"] if half else ENEMIES[b["enemy"]["kind"]].get("decay", COMBO_DECAY)
        mult = 1
        if cry:                    # полоска слёз: копится у игрока между боями, полная — удар сильнее
            p = self.players[pid]
            p["tears"] = p.get("tears", 0) + 1
            if p["tears"] >= TEARS_FULL:
                p["tears"], mult = 0, TEARS_MULT
            self.dirty_save = True
        c["power"] = c["base"] * dec * mult if cry else c["power"] * dec
        slow = half and half["mode"] == "half"
        t["until"] = at + tr["grace"] * (2 if slow else 1) * tr["beat"] + COMBO_NET_SLACK
        if cry:
            self.blog(b, f"{b['enemy']['name']} плачет!" + (f" Слёзы копились не зря: удар ×{TEARS_MULT}!" if mult > 1 else ""))
            await self.to_party(b, {"t": "ev", "e": "cry", "by": pid, "rage": mult > 1})
        dmg = max(1, round(c["power"]))
        c["dealt"] += dmg
        await self.strike(b, pid, dmg, c["hits"], fid)
        if b["id"] in self.battles and c["hits"] == c.get("wail_at"):
            self.start_wail(b, c)
        if b["id"] in self.battles and c["hits"] == c.get("half_at"):
            self.start_half(b, c)

    def tempo_ability(self, b):
        """Событие смены ритма у врага: half — вдвое реже, fast — вдвое чаще. Одно на врага."""
        ab = ENEMIES[b["enemy"]["kind"]].get("abilities", {})
        for mode in ("half", "fast"):
            if mode in ab:
                return mode, ab[mode]
        return None, None

    def roll_half(self, b):
        _, a = self.tempo_ability(b)
        return random.randint(*a["hits"]) if a and random.random() < a["chance"] else None

    def start_half(self, b, c):
        """Смена ритма со следующего такта: half — сильная только каждая вторая доля, fast — каждая четверть."""
        mode, a = self.tempo_ability(b)
        tr = b["track"]
        step = (time.time() - b["t0"] / 1000) / (tr["beat"] / 4)
        start = math.ceil(step / tr["bar"]) * tr["bar"]
        c["half"] = {"from": start, "end": start + random.randint(*a["bars"]) * tr["bar"], "decay": a["decay"], "mode": mode}
        self.blog(b, f"{b['enemy']['name']} " + ("замедляется: бей через долю!" if mode == "half" else "разгоняется: бей каждую долю!"))

    def is_strong(self, tr, half, step):
        if half and half["mode"] == "fast":
            return step % 4 == 0          # сильные доли и так только на целых четвертях — тут все четверти
        return step % tr["steps"] in tr["strong"] and not (half and (step - half["from"]) % 8)

    def in_half(self, c, step):
        h = c.get("half")
        return h if h and h["from"] <= step < h["end"] else None

    def roll_wail(self, b):
        """На каком ударе этой цепочки начнётся завывание, или None: враг делает это только иногда."""
        a = ENEMIES[b["enemy"]["kind"]].get("abilities", {}).get("wail")
        return random.randint(*a["hits"]) if a and random.random() < a["chance"] else None

    def step_time(self, b, step):
        return b["t0"] / 1000 + step * b["track"]["beat"] / 4

    def start_wail(self, b, c):
        """Завывание идёт по тактам: нарастает, потом тишина. Клиенты узнают границы из снимка мира в шагах сетки."""
        a = ENEMIES[b["enemy"]["kind"]]["abilities"]["wail"]
        tr = b["track"]
        step = (time.time() - b["t0"] / 1000) / (tr["beat"] / 4)
        start = math.ceil(step / tr["bar"]) * tr["bar"]
        quiet = start + WAIL_RISE_BARS * tr["bar"]
        c["wail"] = {"from": start, "quiet": quiet, "end": quiet + random.randint(*a["bars"]) * tr["bar"], "silent": False}
        self.blog(b, f"{b['enemy']['name']} начинает завывать…")

    def step_wail(self, b, now):
        c = b["turn"].get("combo")
        w = c.get("wail") if c else None
        if not w:
            return
        if not w["silent"] and now >= self.step_time(b, w["quiet"]):
            w["silent"] = True
            self.mark(b["loc"])
        if now >= self.step_time(b, w["end"]):
            c["wail"] = None
            self.blog(b, f"{b['enemy']['name']} умолкает.")

    async def backlash(self, b, pid, dealt):
        """Игрок сбился в тишине: весь урон этой цепочки возвращается ему, а враг лечится на столько же."""
        p, e = self.players[pid], b["enemy"]
        school = ABILITIES["wail"]["school"]
        resisted = p["fx"].get(school, 0) > time.time()
        dmg = max(1, round(dealt * RESIST_KEEP)) if resisted else dealt
        e["hp"] = min(e["maxhp"], e["hp"] + dealt)
        p["hp"] = max(0, p["hp"] - dmg)
        self.dirty_save = True
        self.blog(b, f"{e['name']} забирает своё: −{dmg} {p['nick']}, +{dealt} ей." + (" Резист ослабил удар." if resisted else ""))
        await self.to_party(b, {"t": "ev", "e": "backlash", "who": pid, "dmg": dmg, "heal": dealt})
        if p["hp"] <= 0:
            await self.kill(b, pid)

    async def end_combo(self, b, why=None):
        t = b["turn"]
        c = t.get("combo") or {}
        pid = t["who"]
        nick = self.players[pid]["nick"]
        wail = c.pop("wail", None)
        if c.get("hits"):
            self.blog(b, f"{nick}: комбо ×{c['hits'] + 1}" + (f" — {why}." if why else "."))
        elif why:
            self.blog(b, f"{nick}: {why}.")
        await self.to_party(b, {"t": "ev", "e": "combo_end", "hits": c.get("hits", 0)})
        if wail and wail["silent"]:
            await self.backlash(b, pid, c.get("dealt", 0))
            if pid not in b["party"]:      # погиб: очередь уже передана
                return
        self.next_turn(b)

    async def hinder(self, pid, bid, target):
        """Помеха: подножка любому участнику боя. Сбивает идущее комбо, иначе ослабляет следующий удар."""
        b = self.battles.get(bid)
        p = self.players[pid]
        if not b or b["loc"] != p["loc"] or target not in b["party"] or target == pid:
            return
        now = time.time()
        left = HINDER_CD - (now - p.get("_hinder", 0))
        if left > 0:
            return await self.say(pid, f"Отдышись ещё {math.ceil(left)} с.")
        p["_hinder"] = now
        v = self.players[target]
        v["hp"] = max(0, v["hp"] - 1)
        self.dirty_save = True
        t = b["turn"]
        self.blog(b, f"{p['nick']} ставит подножку: {v['nick']}!")
        await self.to_party(b, {"t": "ev", "e": "trip", "who": target})
        if v["hp"] <= 0:
            return await self.kill(b, target)
        if t["who"] == target and t["phase"] == "combo":
            await self.end_combo(b, "сбит с ритма")
        else:
            b["trip"].add(target)

    async def enemy_strike(self, b):
        f = next((x for x in self.alive(b) if x["id"] == b["turn"].get("foe")), None)
        if f and b["party"]:
            e = ENEMIES[f["kind"]]
            pid = random.choice(b["party"])
            p = self.players[pid]
            dmg = max(1, random.randint(*f["atk"]) - self.def_of(p))
            p["hp"] = max(0, p["hp"] - dmg)
            self.dirty_save = True
            self.blog(b, f"{f['name']} {random.choice(e['hits'])} {p['nick']}: −{dmg}.")
            await self.to_party(b, {"t": "ev", "e": "enemy_hit", "who": pid, "dmg": dmg, "foe": f["id"]})
            if p["hp"] <= 0:
                await self.kill(b, pid)
        if b["id"] in self.battles:
            self.enemy_windup(b, ENEMY_GAP)

    async def kill(self, b, pid):
        """Смерть: всё из рюкзака и монеты остаются лежать на локации, надетое — при игроке."""
        p = self.players[pid]
        nick = p["nick"]
        for item, qty in p["inv"].items():
            for _ in range(min(qty, 5)):
                self.drop(p["loc"], ITEMS[item]["name"], source=nick, item=item)
        if p["coins"]:
            self.drop(p["loc"], f"{p['coins']} мон.", source=nick, coins=p["coins"])
        p["inv"] = {}
        p["coins"] = 0
        p["hp"] = p["maxhp"]
        p["mp"] = p["maxmp"]
        p["deaths"] = p.get("deaths", 0) + 1
        self.dirty_save = True
        self.blog(b, f"{nick} повержен! Вещи рассыпались по полу.")
        await self.to_player(pid, {"t": "ev", "e": "dead"})
        await self.say(pid, "Ты очнулся у входа. Рюкзак пуст.")
        await self.leave(b, pid)

    async def leave(self, b, pid):
        was_turn = b["turn"]["who"] == pid
        if pid in b["party"]:
            b["party"].remove(pid)
        b["trip"].discard(pid)
        b["gone"].pop(pid, None)
        await self.to_player(pid, {"t": "ev", "e": "left"})
        self.mark(b["loc"])
        if not b["party"]:
            self.battles.pop(b["id"], None)
        elif was_turn:
            self.next_turn(b)

    async def win(self, b, pid):
        e = ENEMIES[b["enemy"]["kind"]]
        nick = self.players[pid]["nick"]
        lvl = b["enemy"]["level"]
        coins = random.randint(*e["coins"]) + lvl - 1
        self.drop(b["loc"], f"{coins} мон.", source=e["name"], coins=coins)
        n = min(e.get("loot_max", 1), e.get("loot", 1) + (lvl - 1) // e.get("loot_every", 999))
        for _ in range(n):
            item = weighted(e["drops"])
            self.drop(b["loc"], ITEMS[item]["name"], source=e["name"], item=item)
        self.players[pid]["kills"] = self.players[pid].get("kills", 0) + 1
        self.dirty_save = True
        self.battles.pop(b["id"], None)
        await self.to_party(b, {"t": "ev", "e": "win", "by": nick, "enemy": e["name"]})
        for i in b["party"]:
            await self.say(i, "Победа! Добыча упала на пол: кто успел, того и вещи.")
            self.players[i]["mp"] = min(self.players[i]["maxmp"], self.players[i]["mp"] + MP_WIN)
            await self.add_xp(i, XP_KILL + XP_KILL_LVL * (lvl - 1))
        self.mark(b["loc"])

    async def add_xp(self, pid, xp):
        p = self.players[pid]
        p["level"] = p.get("level", 1)
        p["xp"] = p.get("xp", 0) + xp
        while p["xp"] >= XP_LEVEL * p["level"]:
            p["xp"] -= XP_LEVEL * p["level"]
            p["level"] += 1
            p["maxhp"] += LEVEL_HP
            p["hp"] = p["maxhp"]
            p["maxmp"] += LEVEL_MP
            p["mp"] = p["maxmp"]
            await self.say(pid, f"Новый уровень: {p['level']}! Здоровье восстановлено, враги тоже подрастут.")
            await self.to_player(pid, {"t": "ev", "e": "level", "level": p["level"]})
        self.dirty_save = True

    # ---------- таймеры ----------
    async def step_battle(self, b, now):
        for pid in list(b["party"]):
            if pid in self.online:
                b["gone"].pop(pid, None)
            elif now - b["gone"].setdefault(pid, now) > OFFLINE_LEAVE:
                self.blog(b, f"{self.players[pid]['nick']} растворяется в темноте.")
                await self.leave(b, pid)
                if b["id"] not in self.battles:
                    return
        self.step_wail(b, now)
        t = b["turn"]
        if now < t["until"]:
            return
        if t["phase"] == "choose":
            self.blog(b, f"{self.players[t['who']]['nick']} медлит и пропускает ход.")
            self.next_turn(b)
        elif t["phase"] == "combo":
            await self.end_combo(b)
        elif t["phase"] == "windup":
            await self.enemy_strike(b)
        elif t["phase"] == "laugh":
            self.end_laugh(b)
        elif t["phase"] == "pause":
            self.new_round(b)

    def sweep(self, now):
        for loc, g in self.ground.items():
            n = len(g)
            g[:] = [x for x in g if now - x["ts"] < GROUND_TTL]
            if len(g) != n:
                self.mark(loc)
        for pid in [k for k, v in self.players.items()
                    if k.startswith("g:") and k not in self.online and not self.battle_of(k) and now - v.get("_seen", now) > 600]:
            del self.players[pid]

    async def run(self):
        try:
            while True:
                await asyncio.sleep(TICK)
                now = time.time()
                for b in list(self.battles.values()):
                    try:
                        await self.step_battle(b, now)
                    except Exception:
                        log.exception("dungeon: бой %s", b["id"])
                        self.battles.pop(b["id"], None)
                await self.flush()
                if now - self.last_save > SAVE_EVERY:
                    self.last_save = now
                    self.sweep(now)
                    if self.dirty_save:
                        await asyncio.to_thread(self._save)
                if not self.conns and not self.battles:
                    if self.dirty_save:
                        await asyncio.to_thread(self._save)
                    self.task = None
                    return
        except asyncio.CancelledError:
            raise

    def ensure_loop(self):
        if self.task is None:
            self.task = asyncio.create_task(self.run())

    async def shutdown(self, app):
        if self.task:
            self.task.cancel()
        if self.dirty_save:
            self._save()

    # ---------- соединение ----------
    def resolve(self, request, d):
        """Кто пришёл: Telegram → аккаунт сайта → гость (в браузере, для проверки)."""
        tg = tg_user(d.get("init"))
        if tg:
            return f"t:{tg[0]}", tg[1]
        u = self.user_of(request)
        if u:
            return f"c:{u[1]}", clean_nick(u[1])
        g = d.get("guest")
        if isinstance(g, str) and re.fullmatch(r"[a-z0-9]{16,40}", g):
            return "g:" + g, "Гость " + str(int(hashlib.sha256(g.encode()).hexdigest()[:6], 16) % 1000).zfill(3)
        return None

    async def handle(self, pid, d):
        for k, ty in FIELDS.items():      # чужой JSON: тип поля проверяем до того, как оно станет ключом словаря
            if k in d and not isinstance(d[k], ty):
                return
        t = d.get("t")
        if t == "wander":
            await self.wander(pid)
        elif t == "use":
            if not self.battle_of(pid):      # в бою предмет — это ход, см. act
                await self.use(pid, d.get("item"))
        elif t == "equip":
            await self.equip(pid, d.get("item"))
        elif t == "unequip":
            await self.unequip(pid, d.get("slot"))
        elif t == "throw":
            await self.throw(pid, d.get("item"))
        elif t == "pick":
            await self.pick(pid, d.get("id"))
        elif t == "buy":
            await self.buy(pid, d.get("item"))
        elif t == "sell":
            await self.sell(pid, d.get("item"))
        elif t == "go":
            await self.go(pid, d.get("to"))
        elif t == "join":
            await self.join(pid, d.get("id"))
        elif t == "hinder":
            await self.hinder(pid, d.get("id"), d.get("target"))
        elif t == "act":
            await self.act(pid, d.get("a"), d.get("item"), d.get("foe"))
        elif t == "tap":
            await self.tap(pid, d.get("step"), d.get("foe"))
        elif t in ("miss", "stop"):      # stop: игрок перестал бить, клиент считает паузу сам
            b = self.battle_of(pid)
            if b and b["turn"]["who"] == pid and b["turn"]["phase"] == "combo":
                await self.end_combo(b, "мимо такта" if t == "miss" else None)
        await self.flush()

    async def ws_handler(self, request):
        origin = request.headers.get("Origin", "")
        if origin and origin.split("://", 1)[-1] != request.host:
            return web.json_response({"error": "Чужой Origin"}, status=403)
        if len(self.conns) >= MAX_CONNS:
            return web.json_response({"error": "Пещера переполнена"}, status=503)
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=4 * 1024)
        await ws.prepare(request)
        self.conns[ws] = None
        self.ensure_loop()
        pid = None
        window, count = time.time(), 0
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                now = time.time()
                if now - window >= 1:
                    window, count = now, 0
                count += 1
                if count > MSG_RATE:
                    continue
                try:
                    d = json.loads(msg.data)
                except ValueError:
                    continue
                if not isinstance(d, dict):
                    continue
                if d.get("t") == "ping":
                    await self.send(ws, {"t": "pong", "c": d.get("c"), "s": now_ms()})
                elif d.get("t") == "auth" and pid is None:
                    who = self.resolve(request, d)
                    if not who:
                        await self.send(ws, {"t": "error", "error": "Не удалось войти"})
                        continue
                    if who[0] not in self.players and len(self.players) >= MAX_PLAYERS:
                        await self.send(ws, {"t": "error", "error": "Игроков слишком много"})
                        continue
                    pid = who[0]
                    self.player(pid, who[1])
                    self.conns[ws] = pid
                    self.online.setdefault(pid, set()).add(ws)
                    await self.send(ws, {"t": "hello", "id": pid, "nick": who[1], "wander": WANDER_CD,
                                         "owner": pid.startswith("c:") and self.is_owner(request),
                                         "combo": {"decay": COMBO_DECAY, "cry": CRY_EVERY, "grace": COMBO_GRACE_BEATS,
                                                   "start": COMBO_START_BEATS}})
                    await self.send(ws, self.view(pid))
                    self.mark(self.players[pid]["loc"])
                elif pid is not None:
                    await self.handle(pid, d)
        finally:
            self.conns.pop(ws, None)
            if pid is not None:
                s = self.online.get(pid)
                if s:
                    s.discard(ws)
                    if not s:
                        del self.online[pid]
                        p = self.players.get(pid)
                        if p:
                            p["_seen"] = time.time()
                            self.mark(p["loc"])
        return ws

    def routes(self, app):
        app.router.add_get("/api/dungeon/ws", self.ws_handler)
        app.router.add_get("/api/dungeon/tracks", self.api_tracks)
        app.router.add_post("/api/dungeon/stem", self.api_stem_put)
        app.router.add_post("/api/dungeon/stems_done", self.api_stems_done)
        app.router.add_get("/api/dungeon/stem/{key}/{v}/{name}", self.api_stem_get)
        app.on_cleanup.append(self.shutdown)


def now_ms():
    return int(time.time() * 1000)
