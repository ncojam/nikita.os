#!/usr/bin/env python3
"""
Аэро-арканоид nikita.os — общая многопользовательская арена.

Поле нормировано 0..1 (x вправо, y вниз). Ворота — верхний (y=0) и нижний (y=1) края,
створ по центру (x в [GOAL_L, GOAL_R]). Поле каждой стороны делится пополам: ближняя к
центру половина — мёртвая зона, дальняя (у ворот) — АКТИВНАЯ:
  верхняя активная зона: y в [0, 0.25],  нижняя: y в [0.75, 1].
Игрок водит платформу мышью только в активной зоне (любой — можно метнуться к чужим воротам).
Чем больше игроков, тем уже платформы. Счёт — по воротам; «свой гол» (последний коснувшийся
был на стороне этих ворот) — ник красным. Последние 3 забивших показываем.

Два режима:
  • local  — реальных игроков (соединений с активной платформой) меньше двух. Физику и бота
            primitiveAI считает браузер единственного игрока («владельца»); он шлёт серверу голы
            (идут в общий счёт, с ограничением частоты) и раз в ~100 мс снимок мячей и бота —
            сервер показывает его зрителям и подхватывает при переходе в online.
  • online — двое и больше: сервер авторитетный, физика в цикле ~30/сек, рассылка состояния.
Спри: голы в одни ворота один за другим (каждый следующий — не позже SPREE_WIN после предыдущего,
мяч не успел бы вернуться). За ×2..×6 забившему (живому, не в свои) — бонусы:
  ×2 шире платформа · ×3 замедление мячей для всех (в очередь) · ×4 мяч, приклеенный к платформе
  (в очередь — бросок) · ×5 заморозка мячей и платформ противника (в очередь) · ×6 салют: до
  BARRAGE_N мячей из центра (по одному за тик, веером), живут BARRAGE_LIVES ударов, голов не дают;
  пока салют летит — спри не считаем. Бонусы из очереди игрок применяет по одному (ЛКМ / кнопка).
Анти-пролёт: внутри тика платформа интерполируется из прошлого положения в новое (субшаги считаются
и по её смещению), отскок — по относительной скорости мяча и платформы.
Ушедший игрок (курсор/палец убран) держит платформу ещё GRACE секунд — потом слот освобождается.
Цикл спит при пустой арене.
Лимит одновременных игроков — NOS_AIR_MAX; нет мест → клиенту «full» (он играет nah.wav).
Авторизация игрока — через аккаунт чата (для ника в счёте); зрителям вход не нужен.
"""
import asyncio
import hashlib
import hmac
import json
import math
import os
import random
import time
from pathlib import Path
from urllib.parse import parse_qsl

from aiohttp import web, WSMsgType

FPS = 30
DT = 1.0 / FPS
MAX_PLAYERS = int(os.environ.get("NOS_AIR_MAX", "8"))
SCORE_MAX = int(os.environ.get("NOS_AIR_SCORE_MAX", "999999"))  # потолок счёта команды
GOAL_L, GOAL_R = 0.33, 0.67         # створ ворот по x
PAD_W0 = 0.22                        # ширина платформы при одном игроке
PAD_WMIN = 0.06
PAD_H = 0.022                        # толщина платформы
BALL_R = 0.02
BALL_V0 = float(os.environ.get("NOS_AIR_V0", "0.75"))    # стартовая скорость мяча (единиц поля в сек)
BALL_VMAX = float(os.environ.get("NOS_AIR_VMAX", "2.4")) # потолок скорости
BOUNCE_GAIN = float(os.environ.get("NOS_AIR_GAIN", "0.035"))  # +к скорости за каждый отскок
FREEZE = float(os.environ.get("NOS_AIR_FREEZE", "0.6"))  # пауза после гола (была 1.2)
BOT_NICK = "primitiveAI"            # бот живёт в браузере одиночки (режим local), сервер его только показывает
SPREE_WIN = float(os.environ.get("NOS_AIR_SPREE_WIN", "1.8"))  # окно между голами спри, с
WIDE_K, WIDE_DUR = 1.6, 8.0          # ×2: платформа шире на столько, столько секунд
SLOW_K, SLOW_DUR = 0.35, 5.0         # ×3: мячи медленнее во столько, столько секунд
ICE_DUR = 2.5                        # ×5: заморозка мячей и платформ противника
STICK_V = 1.3                        # ×4: скорость брошенного мяча
BARRAGE_N, BARRAGE_LIVES = 32, 5     # ×6: салют
BARRAGE_V = 0.9
GRACE = float(os.environ.get("NOS_AIR_GRACE", "3"))          # сколько держим платформу ушедшего игрока, с
BOT_SPEED = float(os.environ.get("NOS_AIR_BOT_SPEED", "0.6")) # скорость бота (лёгкий), units/сек
BOT_ERR = float(os.environ.get("NOS_AIR_BOT_ERR", "0.09"))   # промах прицела бота
SPLIT_AT = int(os.environ.get("NOS_AIR_SPLIT", "64"))        # столько отскоков → мяч расщепляется
MAX_BALLS = int(os.environ.get("NOS_AIR_MAXBALLS", "4"))     # потолок числа мячей
# активная зона = 70% от половины стола (половина = 0.5 → активная 0.35 у края).
# Потом будем менять геймплейно, поэтому вынесено в одно место.
ACTIVE_FRAC = float(os.environ.get("NOS_AIR_ACTIVE", "0.7"))
TOP_ACTIVE = 0.5 * ACTIVE_FRAC       # верхняя активная зона: [0, TOP_ACTIVE]
BOT_ACTIVE = 1.0 - 0.5 * ACTIVE_FRAC # нижняя активная зона: [BOT_ACTIVE, 1]


TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
TG_MAX_AGE = 24 * 3600   # initData старше суток не принимаем


def tg_nick(init_data):
    """Проверка подписи Telegram WebApp initData → ник или None."""
    if not TG_BOT_TOKEN or not isinstance(init_data, str) or len(init_data) > 4096:
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    got = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", TG_BOT_TOKEN.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(), got):
        return None
    try:
        if time.time() - int(pairs.get("auth_date", 0)) > TG_MAX_AGE:
            return None
        u = json.loads(pairs.get("user", "{}"))
    except (ValueError, TypeError):
        return None
    name = u.get("username") and "@" + u["username"] or (u.get("first_name") or "").strip()
    if not name:
        name = "tg" + str(u.get("id", ""))
    return name[:24]


def clamp(v, a, b):
    return a if v < a else b if v > b else v


class Player:
    __slots__ = ("ws", "nick", "kind", "x", "y", "side", "active", "leave_at", "ox", "oy", "px", "py")

    def __init__(self, ws, nick, kind="m"):
        self.ws = ws
        self.nick = nick
        self.kind = kind         # "m" — мышь/тач, "k" — клавиатура (вторая платформа)
        self.x = 0.5
        self.y = 0.9
        self.side = "bottom"
        self.active = False      # держит ли слот (курсор/клавиши в активной зоне)
        self.leave_at = 0.0      # ушёл: до этого момента платформа ещё стоит (GRACE)
        self.px = self.ox = 0.5  # положение в конце прошлого тика (для интерполяции внутри тика)
        self.py = self.oy = 0.9


class AirHockey:
    def __init__(self, user_of, data_dir=None):
        self.user_of = user_of
        self.path = (Path(data_dir) / "air.json") if data_dir else None
        self.conns = {}           # ws -> nick (жизненный цикл соединения)
        self.pads = {}            # (ws, kind) -> Player; у коннекта может быть 2 платформы
        self.loop_task = None
        self.balls = []
        self.combo = 0            # текущее комбо (подряд отбитий платформами в розыгрыше)
        self.combo_board = {}     # лидерборд комбо: nick -> лучшее комбо
        self.score = {"top": 0, "bottom": 0}
        self.last = []            # последние забившие: [{nick, own}]
        self.reset_at = 0.0       # пауза после гола до
        self.gid = 0              # счётчик голов (клиент по нему триггерит эффекты)
        self.goal_event = None    # последний гол: {side, x, own, nick, score}
        self.hid = 0              # счётчик ударов по платформе (для звука click)
        self.wid = 0              # счётчик ударов о стену (для звука wall)
        self.board = {}           # лидерборд: nick -> очки (гол +1, в свои -1)
        self.mode = "local"       # local — считает браузер одиночки, online — сервер (2+ игроков)
        self.owner = None         # ws одиночки, который считает игру в режиме local
        self.ghost = None         # последний снимок одиночки: {balls, bot, t} — для зрителей и перехода
        self.local_goal_t = 0.0   # антинакрутка голов от клиента
        self.top_eff = TOP_ACTIVE # текущая граница активной зоны (гуляет на юбилейном событии)
        self.bot_eff = BOT_ACTIVE
        self.wave = 0.0           # амплитуда волны границы (затухает)
        self.wave_t = 0.0         # фаза волны
        self._save_at = 0.0       # троттлинг записи на диск
        self.spree = {"gate": None, "n": 0, "t": 0.0}   # текущая серия голов в одни ворота
        self.fx = {}              # ws -> {"wide": до, "q": [бонусы в очереди]}
        self.slow_until = 0.0     # ×3: замедление мячей для всех
        self.ice_until = 0.0      # ×5: заморозка
        self.ice_side = None      # чья сторона заморожена
        self.barrage = 0          # ×6: сколько мячей салюта ещё выпустить
        self.barrage_i = 0
        self._load()              # счёт, забившие и лидерборд переживают перезапуск
        self._kick(1)

    # ---------- сохранение счёта (переживает рестарт/деплой) ----------
    def _load(self):
        if not self.path:
            return
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            sc = d.get("score", {})
            self.score = {"top": int(sc.get("top", 0)), "bottom": int(sc.get("bottom", 0))}
            self.last = [x for x in d.get("last", []) if isinstance(x, dict)][:3]
            self.board = {str(k): int(v) for k, v in d.get("board", {}).items()}
            self.combo_board = {str(k): int(v) for k, v in d.get("combo_board", {}).items()}
        except (OSError, ValueError, TypeError):
            pass

    def _save(self, force=False):
        if not self.path:
            return
        now = time.monotonic()
        if not force and now - self._save_at < 2.0:   # не чаще раза в 2 с
            return
        self._save_at = now
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"score": self.score, "last": self.last, "board": self.board,
                                       "combo_board": self.combo_board}, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass

    # ---------- слоты ----------
    def active_count(self):
        return sum(1 for p in self.pads.values() if p.active)

    def humans(self):
        """Реальные игроки = соединения, у которых есть активная платформа (мышь и клава одного — один игрок)."""
        return {p.ws for p in self.pads.values() if p.active}

    def human_count(self):
        return len(self.humans())

    def pad_width(self, p, base=None):
        w = self.pad_w() if base is None else base
        f = self.fx.get(p.ws) if p.ws is not None else None
        return w * WIDE_K if f and f.get("wide", 0) > time.monotonic() else w

    def pad_w(self):
        n = max(1, self.active_count() + (1 if self.mode == "local" and self.ghost and self.ghost.get("bot") else 0))
        return clamp(PAD_W0 / (n ** 0.5), PAD_WMIN, PAD_W0)

    # ---------- мяч(и) ----------
    def _newball(self, vx, vy, x=0.5, y=0.5, touch=None, kind=0):
        # kind: 0 — обычный, 1 — мяч салюта (lives ударов), 2 — приклеен к платформе (stuck = ключ пада)
        return {"x": x, "y": y, "vx": vx, "vy": vy, "bounces": 0, "touch": touch, "k": kind,
                "lives": BARRAGE_LIVES, "stuck": None}

    def _normal(self):
        return [b for b in self.balls if b["k"] == 0]

    def _kick(self, n_balls=1):
        self.balls = [b for b in self.balls if b["k"] != 0]   # салют и приклеенные остаются
        for _ in range(max(1, n_balls)):
            self.balls.append(self._newball(random.uniform(-0.3, 0.3), random.choice((-1, 1)) * BALL_V0))
        self.combo = 0

    def _rand_ip(self):
        return ".".join(str(random.randint(1, 254)) for _ in range(4))

    def _score(self, side, touch, gx, spree=None):
        """Засчитать гол (без сброса поля — поле может ещё содержать другие мячи).
        touch = (nick, side, key | None). spree — серию посчитал клиент (режим local)."""
        self.score[side] = min(SCORE_MAX, self.score[side] + 1)
        own = False
        label = self._rand_ip()
        if touch:
            tnick, tside = touch[0], touch[1]
            own = (tside == side)
            if tnick and tnick != BOT_NICK:
                label = tnick
                self.board[tnick] = self.board.get(tnick, 0) + (-1 if own else 1)
            elif tnick == BOT_NICK:
                label = BOT_NICK
        self.last.insert(0, {"nick": label, "own": own})
        del self.last[3:]
        self.gid += 1
        self.goal_event = {"side": side, "x": round(gx, 4), "own": own,
                           "nick": label, "score": self.score[side]}
        n = self._spree(side) if spree is None else max(0, min(99, int(spree)))
        if n >= 2:
            self.goal_event["spree"] = n
            key = touch[2] if touch and len(touch) > 2 else None
            if key and not own and spree is None:
                self._award(n, key)
        if self.score[side] % 10 == 0:
            ev, add = self._jubilee()  # случайное событие на каждый кратный 10 гол
            self.goal_event["ev"], self.goal_event["add"] = ev, add   # в режиме local мячи добавит клиент
        self._save()

    # ---------- спри и бонусы ----------
    def _barrage_on(self):
        return self.barrage > 0 or any(b["k"] == 1 for b in self.balls)

    def _spree(self, side):
        """Гол в ворота side: продолжить или начать серию. Возвращает длину серии (0 — салют летит)."""
        if self._barrage_on():
            return 0
        now = time.monotonic()
        sp = self.spree
        sp["n"] = sp["n"] + 1 if sp["gate"] == side and now - sp["t"] <= SPREE_WIN else 1
        sp["gate"], sp["t"] = side, now
        return sp["n"]

    def _award(self, n, key):
        ws, kind = key
        p = self.pads.get(key)
        f = self.fx.setdefault(ws, {"wide": 0.0, "q": []})
        now = time.monotonic()
        if n == 2:
            f["wide"] = now + WIDE_DUR
        elif n == 3:
            f["q"].append("slow")
        elif n == 4 and p and p.active:
            b = self._newball(0.0, 0.0, p.x, p.y, (p.nick, p.side, key), kind=2)
            b["stuck"] = key
            self.balls.append(b)
            f["q"].append("ball")
        elif n == 5:
            f["q"].append("ice")
        elif n >= 6:
            self.barrage, self.barrage_i = BARRAGE_N, 0
        del f["q"][6:]

    def use_bonus(self, ws):
        f = self.fx.get(ws)
        if not f or not f["q"]:
            return
        what = f["q"].pop(0)
        now = time.monotonic()
        mine = [p for p in self.pads.values() if p.ws is ws and p.active]
        if what == "slow":
            self.slow_until = now + SLOW_DUR
        elif what == "ice":
            side = next((p.side for p in mine if p.kind == "m"), None) or (mine[0].side if mine else "bottom")
            self.ice_until, self.ice_side = now + ICE_DUR, ("top" if side == "bottom" else "bottom")
        elif what == "ball":
            for b in self.balls:
                if b["k"] == 2 and b["stuck"] and b["stuck"][0] is ws:
                    self._throw(b)

    def _throw(self, b):
        p = self.pads.get(b["stuck"])
        up = -1 if (p.side if p else "bottom") == "bottom" else 1
        vx = clamp(((p.x - p.ox) / DT) * 0.4 if p else 0.0, -0.8, 0.8)
        b["vx"], b["vy"], b["k"], b["stuck"] = vx, up * STICK_V, 0, None

    def _stick_follow(self):
        for b in self.balls:
            if b["k"] != 2:
                continue
            p = self.pads.get(b["stuck"])
            if not p or not p.active:
                self._throw(b) if p else b.update(k=0, stuck=None, vy=-STICK_V)
                continue
            off = PAD_H / 2 + BALL_R + 0.003
            b["x"], b["y"] = p.x, p.y - off if p.side == "bottom" else p.y + off

    def _jubilee(self):
        """Случайное событие на юбилейный счёт."""
        ev = random.choice(("wave", "balls"))
        add = 0
        if ev == "wave":
            self.wave = 0.18          # граница активной зоны начинает колебаться и затухать
            self.wave_t = 0.0
        elif ev == "balls":
            add = random.randint(1, 3)
            if self.mode == "online" and len(self.balls) < MAX_BALLS:
                for _ in range(min(add, MAX_BALLS - len(self.balls))):
                    a = random.uniform(0, 6.283)
                    self.balls.append(self._newball(math.cos(a) * BALL_V0, math.sin(a) * BALL_V0))
        return ev, add

    def _update_zone(self, dt):
        if self.wave > 0.005:
            self.wave_t += dt * 7.0
            self.wave *= (1 - dt * 0.5)       # затухание волны → граница возвращается
            off = math.sin(self.wave_t) * self.wave
        else:
            self.wave = 0.0; off = 0.0
        self.top_eff = clamp(TOP_ACTIVE + off, 0.12, 0.45)
        self.bot_eff = clamp(BOT_ACTIVE - off, 0.55, 0.88)

    def _boost(self, b):
        sp = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        if sp <= 1e-6:
            return
        target = min(BALL_VMAX, sp * (1 + BOUNCE_GAIN))
        b["vx"] *= target / sp
        b["vy"] *= target / sp

    def _wall(self, b):
        self.wid += 1
        if b["k"] == 1:
            b["lives"] -= 1
            return
        b["bounces"] += 1
        self._boost(b)

    def _bounce_paddle(self, b, p, w, x, y, pvx, pvy):
        """Удар мяча о платформу в точке (x, y), движущуюся со скоростью (pvx, pvy)."""
        hw, hh = w / 2, PAD_H / 2
        cx = clamp(b["x"], x - hw, x + hw)
        cy = clamp(b["y"], y - hh, y + hh)
        dx, dy = b["x"] - cx, b["y"] - cy
        d2 = dx * dx + dy * dy
        if d2 > BALL_R * BALL_R:
            return False
        if d2 < 1e-9:
            nx, ny = 0.0, (-1.0 if b["y"] < y else 1.0)
        else:
            dist = d2 ** 0.5
            nx, ny = dx / dist, dy / dist
        b["x"] = cx + nx * BALL_R
        b["y"] = cy + ny * BALL_R
        # отражаем ОТНОСИТЕЛЬНУЮ скорость: резкий взмах платформой бьёт по мячу, а не пролетает сквозь
        vn = (b["vx"] - pvx) * nx + (b["vy"] - pvy) * ny
        if vn < 0:
            b["vx"] -= 2 * vn * nx
            b["vy"] -= 2 * vn * ny
        b["vx"] += (b["x"] - x) / hw * 0.25
        sp = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        if sp > BALL_VMAX:
            b["vx"] *= BALL_VMAX / sp; b["vy"] *= BALL_VMAX / sp
        self.hid += 1
        if b["k"] == 1:               # мяч салюта: просто теряет жизнь
            b["lives"] -= 1
            return True
        b["touch"] = (p.nick, p.side, (p.ws, p.kind) if p.ws is not None else None)
        b["bounces"] += 1
        self.combo += 1              # комбо: подряд отбитий платформами в розыгрыше
        if p.nick and p.nick != BOT_NICK:
            self.combo_board[p.nick] = max(self.combo_board.get(p.nick, 0), self.combo)
        self._boost(b)
        return True

    def _advance(self, b, w, tscale):
        """Один мяч на тик (с субшагами). Возвращает (side, gx) при голе, иначе None.
        Платформы внутри тика едут из (ox, oy) в (x, y) — субшагов хватает и на быстрый взмах."""
        speed = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5 * tscale
        pads = [(p, self.pad_width(p, w)) for p in self.pads.values() if p.active]
        pmove = max([abs(p.x - p.ox) + abs(p.y - p.oy) for p, _ in pads] or [0.0])
        n = max(1, min(32, int((speed * DT + pmove) / (BALL_R * 0.6)) + 1))
        sdt = DT * tscale / n
        for i in range(n):
            b["x"] += b["vx"] * sdt
            b["y"] += b["vy"] * sdt
            if b["x"] < BALL_R:
                b["x"] = BALL_R; b["vx"] = abs(b["vx"]); self._wall(b)
            elif b["x"] > 1 - BALL_R:
                b["x"] = 1 - BALL_R; b["vx"] = -abs(b["vx"]); self._wall(b)
            for side in ("top", "bottom"):
                if (side == "top" and b["y"] < BALL_R) or (side == "bottom" and b["y"] > 1 - BALL_R):
                    if GOAL_L < b["x"] < GOAL_R:
                        return (side, b["x"])
                    b["y"] = BALL_R if side == "top" else 1 - BALL_R
                    b["vy"] = abs(b["vy"]) if side == "top" else -abs(b["vy"])
                    self._wall(b)
            t = (i + 1) / n
            for p, pw in pads:
                x, y = p.ox + (p.x - p.ox) * t, p.oy + (p.y - p.oy) * t
                self._bounce_paddle(b, p, pw, x, y, (p.x - p.ox) / DT, (p.y - p.oy) / DT)
            if b["k"] == 1 and b["lives"] <= 0:
                return ("dead", 0)
        return None

    def _expire(self, now):
        """Платформы ушедших игроков освобождают слот, когда истёк GRACE."""
        for p in self.pads.values():
            if p.active and p.leave_at and now >= p.leave_at:
                p.active = False
                p.leave_at = 0.0

    def _update_mode(self):
        hs = self.humans()
        if len(hs) >= 2:
            if self.mode != "online":
                # подхватываем поле одиночки (свежий снимок), иначе — новая подача
                self.mode = "online"
                g = self.ghost
                live = [b for b in (g["balls"] if g else []) if b["k"] == 0]
                if g and time.monotonic() - g["t"] < 1.5 and live:
                    self.balls = [self._newball(b["vx"], b["vy"], b["x"], b["y"]) for b in live]
                    self.reset_at = 0.0
                else:
                    self._kick()
                self.combo = 0
            self.owner = None
            self.ghost = None
        else:
            self.mode = "local"
            self.owner = next(iter(hs)) if hs else None
            self.reset_at = 0.0

    def step(self):
        now = time.monotonic()
        self._update_zone(DT)
        self._expire(now)
        self._update_mode()
        for p in self.pads.values():       # откуда платформа едет в этом тике
            p.ox, p.oy = p.px, p.py
            p.px, p.py = p.x, p.y
        if self.mode != "online":
            return                    # одиночку считает его браузер
        if self.reset_at:
            if now < self.reset_at:
                return
            self.reset_at = 0.0
            self._kick()
        if self.barrage > 0:               # салют: по мячу за тик, веером по кругу (предсказуемо)
            a = self.barrage_i * 2 * math.pi / BARRAGE_N + math.pi / BARRAGE_N
            self.balls.append(self._newball(math.cos(a) * BARRAGE_V, math.sin(a) * BARRAGE_V, kind=1))
            self.barrage -= 1; self.barrage_i += 1
        self._stick_follow()
        frozen = now < self.ice_until
        tscale = SLOW_K if now < self.slow_until else 1.0
        w = self.pad_w()
        add, remove = [], []
        for b in self.balls:
            if b["k"] == 2 or frozen:
                continue
            g = self._advance(b, w, tscale)
            if g:
                remove.append(b)
                if g[0] != "dead" and b["k"] == 0:
                    self._score(g[0], b["touch"], g[1])
            elif b["k"] == 0 and b["bounces"] >= SPLIT_AT and len(self._normal()) + len(add) - len(remove) < MAX_BALLS:
                b["bounces"] = 0                 # расщепление: ОБА мяча расходятся от текущего курса
                sp = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
                base = math.atan2(b["vy"], b["vx"])
                dv = 0.3 + random.uniform(0, 0.12)   # угол расхождения
                b["vx"], b["vy"] = math.cos(base - dv) * sp, math.sin(base - dv) * sp
                add.append(self._newball(math.cos(base + dv) * sp, math.sin(base + dv) * sp,
                                         b["x"], b["y"], b["touch"]))
        for b in remove:
            self.balls.remove(b)
        self.balls += add
        if not any(b["k"] in (0, 2) for b in self.balls):   # обычных мячей нет — заморозка и подача
            self.balls = [b for b in self.balls if b["k"] == 1] + [self._newball(0.0, 0.0)]
            self.reset_at = now + FREEZE
            self.combo = 0

    # ---------- состояние для клиента ----------
    def snapshot(self, me_ws):
        w = self.pad_w()
        now = time.monotonic()
        ice = self.ice_side if now < self.ice_until else None
        pads = [{"x": round(p.x, 4), "y": round(p.y, 4), "side": p.side, "kind": p.kind,
                 "me": p.ws is me_ws, "nick": p.nick, "away": bool(p.leave_at),
                 "pw": round(self.pad_width(p, w), 4), "ice": p.side == ice}
                for p in self.pads.values() if p.active]
        src = self.balls
        if self.mode == "local":
            g = self.ghost
            src = g["balls"] if g and g["balls"] else [self._newball(0.0, 0.0)]
            if g and g.get("bot"):
                bt = g["bot"]
                pads.append({"x": bt["x"], "y": bt["y"], "side": bt["side"], "kind": "bot",
                             "me": False, "nick": BOT_NICK, "away": False, "pw": round(w, 4), "ice": False})
        tscale = SLOW_K if now < self.slow_until and self.mode == "online" else 1.0
        still = 0.0 if ice and self.mode == "online" else tscale
        balls = [{"x": round(b["x"], 4), "y": round(b["y"], 4),
                  "vx": round(b["vx"] * (0 if b.get("k") == 2 else still), 4),
                  "vy": round(b["vy"] * (0 if b.get("k") == 2 else still), 4),
                  "k": b.get("k", 0), "l": b.get("lives", 0)} for b in src]
        f = self.fx.get(me_ws) or {}
        return {"t": "state", "mode": self.mode, "sim": self.mode == "local" and self.owner is me_ws,
                "balls": balls, "ball": balls[0] if balls else {"x": .5, "y": .5, "vx": 0, "vy": 0},
                "pw": round(w, 4), "pads": pads, "score": self.score, "last": self.last,
                "players": self.active_count(), "cap": MAX_PLAYERS, "combo": self.combo,
                "top": round(self.top_eff, 4), "bot": round(self.bot_eff, 4),
                "gid": self.gid, "goal": self.goal_event, "hid": self.hid, "wid": self.wid,
                "launch_in": round(max(0.0, self.reset_at - time.monotonic()), 3)
                             if self.reset_at and self.mode == "online" else 0.0,
                "freeze": FREEZE,
                "slow": round(max(0.0, self.slow_until - now), 2) if self.mode == "online" else 0.0,
                "ice": round(max(0.0, self.ice_until - now), 2) if self.mode == "online" else 0.0,
                "ice_side": ice, "barrage": self.mode == "online" and self._barrage_on(),
                "fx": {"q": f.get("q", []), "wide": round(max(0.0, f.get("wide", 0) - now), 2)}}

    # ---------- цикл ----------
    async def run(self):
        try:
            while self.conns:
                self.step()
                for ws, p in list(self.conns.items()):
                    if ws.closed:
                        continue
                    try:
                        await ws.send_str(json.dumps(self.snapshot(ws), ensure_ascii=False))
                    except Exception:
                        pass
                await asyncio.sleep(DT)
        finally:
            self.loop_task = None
            self._save(force=True)   # арена опустела — зафиксируем счёт

    def ensure_loop(self):
        if self.loop_task is None and self.conns:
            self.loop_task = asyncio.create_task(self.run())

    # ---------- ввод ----------
    def _in_active(self, y):
        if y <= self.top_eff:
            return "top"
        if y >= self.bot_eff:
            return "bottom"
        return None

    async def handle(self, ws, nick, d):
        t = d.get("t")
        kind = "k" if d.get("slot") == "k" else "m"   # m — мышь/тач, k — клавиатура
        key = (ws, kind)
        if t == "move":
            try:
                x = clamp(float(d.get("x")), 0.0, 1.0)
                y = clamp(float(d.get("y")), 0.0, 1.0)
            except (TypeError, ValueError):
                return
            side = self._in_active(y)
            p = self.pads.get(key)
            if side is None:
                if p and p.active and not p.leave_at:
                    p.leave_at = time.monotonic() + GRACE   # ушёл в мёртвую зону — платформа ещё постоит
                return
            if p is None or not p.active:
                if self.active_count() >= MAX_PLAYERS:
                    if p:
                        p.active = False
                    return await self._send(ws, {"t": "full"})
                if p is None:
                    p = self.pads[key] = Player(ws, nick, kind)
                p.active = True
            p.leave_at = 0.0
            if time.monotonic() < self.ice_until and p.side == self.ice_side and self.mode == "online":
                return                   # платформа противника заморожена
            w = self.pad_width(p)
            if side != p.side:           # сменил сторону — телепорт, без «взмаха» через всё поле
                p.ox = p.px = clamp(x, w / 2, 1 - w / 2)
                p.oy = p.py = y
            p.side = side
            p.x = clamp(x, w / 2, 1 - w / 2)
            lo, hi = (0.0, self.top_eff) if side == "top" else (self.bot_eff, 1.0)
            p.y = clamp(y, lo + PAD_H / 2, hi - PAD_H / 2)
        elif t == "leave":
            p = self.pads.get(key)
            if p and p.active and not p.leave_at:
                p.leave_at = time.monotonic() + GRACE
        elif t == "use":
            if self.mode == "online":
                self.use_bonus(ws)
        elif t == "sim":
            self._take_sim(ws, d)
        elif t == "goal":
            self._take_goal(ws, nick, d)

    # ---------- режим local: то, что присылает браузер одиночки ----------
    @staticmethod
    def _num(v, lo, hi):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return clamp(f, lo, hi) if math.isfinite(f) else None

    def _take_sim(self, ws, d):
        if self.mode != "local" or ws is not self.owner:
            return
        balls = []
        for b in (d.get("balls") or [])[:MAX_BALLS]:
            if not isinstance(b, dict):
                continue
            x, y = self._num(b.get("x"), 0, 1), self._num(b.get("y"), 0, 1)
            vx, vy = self._num(b.get("vx"), -BALL_VMAX, BALL_VMAX), self._num(b.get("vy"), -BALL_VMAX, BALL_VMAX)
            if None not in (x, y, vx, vy):
                k = b.get("k") if b.get("k") in (0, 1, 2) else 0
                nb = self._newball(vx, vy, x, y, kind=k)
                nb["lives"] = int(self._num(b.get("l"), 0, BARRAGE_LIVES) or 0)
                balls.append(nb)
        bot = None
        bt = d.get("bot")
        if isinstance(bt, dict) and bt.get("side") in ("top", "bottom"):
            x, y = self._num(bt.get("x"), 0, 1), self._num(bt.get("y"), 0, 1)
            if x is not None and y is not None:
                bot = {"x": round(x, 4), "y": round(y, 4), "side": bt["side"]}
        self.ghost = {"balls": balls, "bot": bot, "t": time.monotonic()}

    def _take_goal(self, ws, nick, d):
        if self.mode != "local" or ws is not self.owner:
            return
        now = time.monotonic()
        if now - self.local_goal_t < FREEZE * 0.8:   # чаще, чем позволяет физика, — не верим
            return
        side = d.get("side")
        if side not in ("top", "bottom"):
            return
        self.local_goal_t = now
        other = "bottom" if side == "top" else "top"
        own = bool(d.get("own"))
        by = d.get("by")
        touch = None
        if by == "me":
            touch = (nick, side if own else other, None)
            try:
                cmb = int(d.get("combo") or 0)
            except (TypeError, ValueError):
                cmb = 0
            if nick and 0 < cmb < 1000:
                self.combo_board[nick] = max(self.combo_board.get(nick, 0), cmb)
        elif by == "bot":
            touch = (BOT_NICK, side if own else other, None)
        self._score(side, touch, self._num(d.get("x"), 0, 1) or 0.5, spree=self._num(d.get("spree"), 0, 99) or 0)

    @staticmethod
    def phys():
        """Параметры физики для клиента (режим local считает в браузере по тем же правилам)."""
        return {"v0": BALL_V0, "vmax": BALL_VMAX, "gain": BOUNCE_GAIN, "freeze": FREEZE,
                "split": SPLIT_AT, "maxBalls": MAX_BALLS, "padW0": PAD_W0, "padWmin": PAD_WMIN,
                "padH": PAD_H, "ballR": BALL_R, "botSpeed": BOT_SPEED, "botErr": BOT_ERR,
                "grace": GRACE, "botNick": BOT_NICK, "spreeWin": SPREE_WIN, "wideK": WIDE_K,
                "wideDur": WIDE_DUR, "slowK": SLOW_K, "slowDur": SLOW_DUR, "iceDur": ICE_DUR,
                "stickV": STICK_V, "barrageN": BARRAGE_N, "barrageLives": BARRAGE_LIVES, "barrageV": BARRAGE_V}

    async def _send(self, ws, data):
        if not ws.closed:
            try:
                await ws.send_str(json.dumps(data, ensure_ascii=False))
            except Exception:
                pass

    async def ws_handler(self, request):
        u = self.user_of(request)         # ник нужен, чтобы попадать в счёт
        nick = u[1] if u else None
        origin = request.headers.get("Origin", "")
        if origin and origin.split("://", 1)[-1] != request.host:
            return web.json_response({"error": "Чужой Origin"}, status=403)
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=4 * 1024)
        await ws.prepare(request)
        self.conns[ws] = nick
        # играть можно всем; аноним в счёте показывается случайным «IP» (генерится на каждый гол)
        await ws.send_str(json.dumps({"t": "hello", "cap": MAX_PLAYERS, "can_play": True, "anon": not nick,
                                      "top": TOP_ACTIVE, "bot": BOT_ACTIVE, "goalL": GOAL_L, "goalR": GOAL_R,
                                      "phys": self.phys()}))
        self.ensure_loop()
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(msg.data)
                except ValueError:
                    continue
                if d.get("t") == "tg":          # вход из Telegram Mini App
                    tn = tg_nick(d.get("init"))
                    if tn and not nick:
                        nick = self.conns[ws] = tn
                        for k in [k for k in self.pads if k[0] is ws]:
                            self.pads[k].nick = nick
                    await self._send(ws, {"t": "hello", "cap": MAX_PLAYERS, "can_play": True, "anon": not nick,
                                          "nick": nick, "top": TOP_ACTIVE, "bot": BOT_ACTIVE,
                                          "goalL": GOAL_L, "goalR": GOAL_R, "phys": self.phys()})
                    continue
                await self.handle(ws, nick, d)   # nick может быть None (аноним)
        finally:
            self.conns.pop(ws, None)
            self.fx.pop(ws, None)
            for b in self.balls:
                if b["k"] == 2 and b["stuck"] and b["stuck"][0] is ws:
                    b.update(k=0, stuck=None, vy=-STICK_V)
            for k in [k for k in self.pads if k[0] is ws]:
                self.pads.pop(k, None)
        return ws

    async def api_leaderboard(self, request):
        pts = sorted(self.board.items(), key=lambda kv: (-kv[1], kv[0]))[:50]
        cmb = sorted(self.combo_board.items(), key=lambda kv: (-kv[1], kv[0]))[:50]
        return web.json_response({"board": [{"nick": n, "points": p} for n, p in pts],
                                  "combo": [{"nick": n, "points": p} for n, p in cmb]})

    def routes(self, app):
        app.router.add_get("/api/air/ws", self.ws_handler)
        app.router.add_get("/api/air/leaderboard", self.api_leaderboard)
