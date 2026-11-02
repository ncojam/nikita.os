"""Clown Dungeon — многопользовательская игра для Telegram Mini App (страница /dungeon.html).

Игрок бродит по локации: ничего не случилось, нашёл монеты или вещь, напоролся на монстра. Бой — по ходам,
как в Mother 3: атака запускает комбо, дальше игрок бьёт по врагу в такт сильным нотам боевого трека.
Вся игра считается здесь, клиент только показывает. Единственное, что решает клиент, — попал ли игрок в такт:
только он знает, что звучит у него в наушниках. Сервер проверяет, что нота сильная, новая и близка по времени.

Протокол (WS /api/dungeon/ws, JSON). Клиент → сервер: auth, ping, wander, use, equip, unequip, pick, join,
throw, hinder, act (attack/item/flee), tap, miss. Сервер → клиент: hello, pong, state (снимок мира глазами игрока),
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
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote

from aiohttp import web, WSMsgType

from share import OWNER

log = logging.getLogger("dungeon")

MAX_CONNS = int(os.environ.get("NOS_DUNGEON_CONNS", 300))
MAX_PLAYERS = int(os.environ.get("NOS_DUNGEON_PLAYERS", 20000))
MUSIC_DIR = os.environ.get("NOS_DUNGEON_MUSIC", "/home/nikita/Projects/ClownDungeon")   # папка треков на сайте
MAX_TRACK = 2 * 1024 * 1024
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
COMBO_DECAY = 0.5        # каждый следующий удар комбо слабее: вдвое, минимум 1
COMBO_START_BEATS = 3.5  # долей на первый удар в такт после атаки
COMBO_GRACE_BEATS = 2.6  # долей на следующий: одну сильную ноту можно пропустить
TAP_EARLY = 1.5          # допуск серверных часов, доли
TAP_LATE = 2.0
ENEMY_WINDUP = 0.9       # с, замах врага (удар приходится на ближайшую долю после него)
ENEMY_PAUSE = 0.8        # с после удара врага
MUSIC_LEAD = 1.0         # с от появления врага до первой доли

BASE_HP = 30
BASE_DMG = (4, 7)
# уровни: опыт за победу делят не поровну, а дают каждому участнику целиком
XP_KILL = 10             # за врага 1 уровня, дальше +XP_KILL_LVL за каждый уровень
XP_KILL_LVL = 5
XP_LEVEL = 30            # до следующего уровня нужно XP_LEVEL × уровень
LEVEL_HP = 4             # игроку за уровень
LEVEL_DMG_EVERY = 2      # +1 к урону раз в столько уровней
# враг растёт чуть медленнее игрока: его уровень равен уровню того, кто на него наткнулся
ENEMY_HP_LVL = 0.12      # +12% здоровья за уровень
ENEMY_ATK_EVERY = 2      # +1 к атаке раз в столько уровней

ITEMS = {
    "mushroom": {"name": "Светящийся гриб", "kind": "heal", "heal": 8},
    "bandage": {"name": "Бинт", "kind": "heal", "heal": 15},
    "elixir": {"name": "Пещерная настойка", "kind": "heal", "heal": 30},
    "stick": {"name": "Палка", "kind": "weapon", "atk": 1},
    "pickaxe": {"name": "Ржавая кирка", "kind": "weapon", "atk": 3},
    "rags": {"name": "Лохмотья", "kind": "armor", "def": 1},
    "helmet": {"name": "Шахтёрская каска", "kind": "armor", "def": 2},
}

ENEMIES = {
    "head": {"name": "Злая летающая голова", "hp": 50, "atk": (2, 5),
             "coins": (5, 15), "drops": {"mushroom": 4, "bandage": 2, "elixir": 1, "pickaxe": 1},
             "hits": ["кусает", "бодает", "плюётся в"]},
}

LOCATIONS = {
    "cave": {
        "name": "Пещера",
        # вес исхода одной прогулки
        "wander": {"nothing": 40, "coins": 20, "item": 15, "monster": 25},
        "coins": (1, 6),
        "items": {"mushroom": 6, "bandage": 3, "elixir": 1, "stick": 2, "pickaxe": 1, "rags": 2, "helmet": 1},
        "enemies": {"head": 1},
        "giggle": ["Где-то вдалеке хихикают.", "Из темноты доносится смешок.", "Кто-то хихикает прямо за спиной. Никого."],
        "nothing": ["Капает вода.", "Ты споткнулся о камень. Камень не извинился.",
                    "Темно. Сыро. Пахнет гримом.", "Эхо повторяет твои шаги, но с опозданием на долю."],
    },
}
START_LOC = "cave"
STARTER = {"mushroom": 2}


FIELDS = {"item": str, "slot": str, "id": int, "target": str, "a": str}   # поля сообщений клиента


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
    return {"roles": roles, "strong": {"channels": pick("lead") or pick("kick", "snare"), "grid": 1}}


def parse_track(track_id, raw, rules):
    """Сетка трека: темп, длина паттерна и сильные ноты. Клиент (music.js) считает их по тем же правилам."""
    pat = next((p for p in raw["patterns"] if p["id"] == rules.get("pattern", raw.get("current"))), raw["patterns"][0])
    num, den = (int(x) for x in str(pat.get("sig", "4/4")).split("/"))
    bar = num * 4 / den
    notes = pat.get("notes", {})
    end = max([bar] + [n[0] + n[1] for L in notes.values() for n in L])
    beats = pat.get("length") or math.ceil(end / bar - 1e-9) * bar
    steps = round(beats * 4)
    grid = rules.get("strong", {}).get("grid", 1)
    strong = set()
    for ch in rules.get("strong", {}).get("channels", []):
        for n in notes.get(ch, []):
            if abs(n[0] / grid - round(n[0] / grid)) < 1e-6:
                strong.add(round(n[0] * 4) % steps)
    return {"id": track_id, "beat": 60 / raw.get("bpm", 120), "steps": steps, "strong": strong or set(range(0, steps, 4)),
            "rules": rules}


class Dungeon:
    def __init__(self, user_of, data_dir, public_dir, fs_root, ufs_real, projects):
        self.user_of = user_of
        self.fs_root = Path(fs_root)
        self.ufs_real = ufs_real          # виртуальный путь → файл в общих папках
        self.projects = projects          # кто автор общего проекта DAWN
        self.path = Path(data_dir) / "dungeon.json"
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
        """Все боевые треки: id → (файл, адрес для клиента).

        Папка MUSIC_DIR сильнее файлов из репозитория: сохранил трек в DAWN — он сразу в игре, без деплоя.
        Общая папка открыта на запись всем вошедшим, поэтому оттуда берём только проекты владельца сайта.
        """
        out = {}
        for f in (Path(self.public) / "dungeon" / "music").glob("*.dawn"):
            out[f.stem.lower()] = (f, f"/dungeon/music/{quote(f.name)}")
        for f in (self.fs_root / MUSIC_DIR.strip("/")).glob("*.dawn"):
            out[f.stem.lower()] = (f, f"/fs{quote(MUSIC_DIR)}/{quote(f.name)}")
        shared = self.ufs_real(MUSIC_DIR)
        for f in shared.glob("*.dawn") if shared else ():
            who = self.projects.map.get(f"{MUSIC_DIR}/{f.name}", {}).get("nick", "")
            if str(who).lower() == OWNER:
                out[f.stem.lower()] = (f, f"/fs{quote(MUSIC_DIR)}/{quote(f.name)}")
        return out

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
                found[tid] = (stamp, parse_track(tid, raw, rules))
            except (OSError, ValueError, KeyError, TypeError, IndexError):
                log.warning("dungeon: не прочитать трек %s", path, exc_info=True)
        self.tracks = found
        return [t for _, t in found.values()]

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
        if p.get("loc") not in LOCATIONS:
            p["loc"] = START_LOC
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
            "me": {"id": pid, "nick": p["nick"], "hp": p["hp"], "maxhp": p["maxhp"], "coins": p["coins"],
                   "level": p.get("level", 1), "xp": p.get("xp", 0), "xpNext": XP_LEVEL * p.get("level", 1),
                   "atk": self.atk_of(p), "def": self.def_of(p),
                   "eq": {k: self.item_view(v) if v else None for k, v in p["eq"].items()},
                   "inv": [{**self.item_view(k), "qty": v} for k, v in sorted(p["inv"].items())]},
            "loc": {"id": loc, "name": LOCATIONS[loc]["name"], "players": here[:30],
                    "ground": [{"id": g["id"], "name": g["name"], "from": g.get("from")} for g in self.ground.get(loc, [])],
                    "battles": [{"id": x["id"], "enemy": x["enemy"]["name"], "level": x["enemy"]["level"], "hp": x["enemy"]["hp"] / x["enemy"]["maxhp"],
                                 "party": [{"id": i, "nick": self.players[i]["nick"]} for i in x["party"]],
                                 "mine": pid in x["party"]}
                                for x in self.battles.values() if x["loc"] == loc]},
            "battle": self.battle_view(b, pid) if b else None,
        }

    def item_view(self, item):
        d = ITEMS[item]
        return {"id": item, "name": d["name"], "kind": d["kind"], "heal": d.get("heal"), "atk": d.get("atk"), "def": d.get("def")}

    def battle_view(self, b, pid):
        t = b["turn"]
        c = t.get("combo")
        return {"id": b["id"], "track": b["track"]["id"], "music": b["track"]["rules"], "t0": b["t0"], "seed": b["seed"],
                "enemy": {"kind": b["enemy"]["kind"], "name": b["enemy"]["name"], "level": b["enemy"]["level"],
                          "hp": b["enemy"]["hp"], "maxhp": b["enemy"]["maxhp"]},
                "party": [{"id": i, "nick": self.players[i]["nick"], "hp": self.players[i]["hp"], "maxhp": self.players[i]["maxhp"]}
                          for i in b["party"]],
                "turn": {"who": t["who"], "phase": t["phase"], "left": max(0, t["until"] - time.time()),
                         "hits": c["hits"] if c else 0},
                "log": b["log"][-5:]}

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
        L = LOCATIONS[p["loc"]]
        what = weighted(L["wander"])
        if what == "coins":
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
        b = {"id": bid, "loc": p["loc"], "party": [pid], "order": [pid], "i": -1, "trip": set(), "gone": {},
             "enemy": {"kind": kind, "name": e["name"], "level": lvl, "hp": hp, "maxhp": hp, "atk": (e["atk"][0] + up, e["atk"][1] + up)},
             "track": track, "t0": now_ms() + int(MUSIC_LEAD * 1000), "seed": random.getrandbits(31),
             "turn": {"who": None, "phase": "wait", "until": now}, "log": [f"{e['name']} вылетает из темноты!"]}
        self.battles[bid] = b
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
        while b["i"] < len(b["order"]) and b["order"][b["i"]] not in b["party"]:
            b["i"] += 1
        if b["i"] < len(b["order"]):
            return self.set_turn(b, b["order"][b["i"]])
        b["turn"] = {"who": "enemy", "phase": "windup", "until": self.next_beat(b, time.time() + ENEMY_WINDUP)}
        self.mark(b["loc"])

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

    async def act(self, pid, a, item=None):
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
            await self.strike(b, pid, dmg, 0)
            if b["id"] in self.battles:
                beat = b["track"]["beat"]
                b["turn"] = {"who": pid, "phase": "combo", "until": time.time() + COMBO_START_BEATS * beat,
                             "combo": {"hits": 0, "power": float(dmg), "last": -1}}
                self.mark(b["loc"])
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

    async def strike(self, b, pid, dmg, combo):
        e = b["enemy"]
        e["hp"] = max(0, e["hp"] - dmg)
        await self.to_party(b, {"t": "ev", "e": "hit", "dmg": dmg, "combo": combo, "by": pid, "hp": e["hp"] / e["maxhp"]})
        self.mark(b["loc"])
        if e["hp"] <= 0:
            await self.win(b, pid)

    async def tap(self, pid, step):
        b = self.battle_of(pid)
        if not b or isinstance(step, bool) or not isinstance(step, int):
            return
        t = b["turn"]
        if t["who"] != pid or t["phase"] != "combo":
            return
        c, tr = t["combo"], b["track"]
        if step <= c["last"] or step % tr["steps"] not in tr["strong"]:
            return
        at = b["t0"] / 1000 + step * tr["beat"] / 4
        off = (time.time() - at) / tr["beat"]
        if not -TAP_EARLY <= off <= TAP_LATE:
            return
        c["last"] = step
        c["hits"] += 1
        c["power"] *= COMBO_DECAY
        t["until"] = at + COMBO_GRACE_BEATS * tr["beat"]
        await self.strike(b, pid, max(1, round(c["power"])), c["hits"])

    async def end_combo(self, b, why=None):
        t = b["turn"]
        c = t.get("combo") or {}
        nick = self.players[t["who"]]["nick"]
        if c.get("hits"):
            self.blog(b, f"{nick}: комбо ×{c['hits'] + 1}" + (f" — {why}." if why else "."))
        elif why:
            self.blog(b, f"{nick}: {why}.")
        await self.to_party(b, {"t": "ev", "e": "combo_end", "hits": c.get("hits", 0)})
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
        alive = [i for i in b["party"]]
        if not alive:
            return
        e = ENEMIES[b["enemy"]["kind"]]
        pid = random.choice(alive)
        p = self.players[pid]
        dmg = max(1, random.randint(*b["enemy"]["atk"]) - self.def_of(p))
        p["hp"] = max(0, p["hp"] - dmg)
        self.dirty_save = True
        self.blog(b, f"{e['name']} {random.choice(e['hits'])} {p['nick']}: −{dmg}.")
        await self.to_party(b, {"t": "ev", "e": "enemy_hit", "who": pid, "dmg": dmg})
        if p["hp"] <= 0:
            await self.kill(b, pid)
        if b["id"] in self.battles:
            b["turn"] = {"who": "enemy", "phase": "pause", "until": time.time() + ENEMY_PAUSE}

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
        item = weighted(e["drops"])
        self.drop(b["loc"], ITEMS[item]["name"], source=e["name"], item=item)
        self.players[pid]["kills"] = self.players[pid].get("kills", 0) + 1
        self.dirty_save = True
        self.battles.pop(b["id"], None)
        await self.to_party(b, {"t": "ev", "e": "win", "by": nick, "enemy": e["name"]})
        for i in b["party"]:
            await self.say(i, "Победа! Добыча упала на пол: кто успел, того и вещи.")
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
        elif t == "join":
            await self.join(pid, d.get("id"))
        elif t == "hinder":
            await self.hinder(pid, d.get("id"), d.get("target"))
        elif t == "act":
            await self.act(pid, d.get("a"), d.get("item"))
        elif t == "tap":
            await self.tap(pid, d.get("step"))
        elif t == "miss":
            b = self.battle_of(pid)
            if b and b["turn"]["who"] == pid and b["turn"]["phase"] == "combo":
                await self.end_combo(b, "мимо такта")
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
                    await self.send(ws, {"t": "hello", "id": pid, "nick": who[1], "wander": WANDER_CD})
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
        app.on_cleanup.append(self.shutdown)


def now_ms():
    return int(time.time() * 1000)
