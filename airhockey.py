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
    __slots__ = ("ws", "nick", "kind", "x", "y", "side", "active", "leave_at")

    def __init__(self, ws, nick, kind="m"):
        self.ws = ws
        self.nick = nick
        self.kind = kind         # "m" — мышь/тач, "k" — клавиатура (вторая платформа)
        self.x = 0.5
        self.y = 0.9
        self.side = "bottom"
        self.active = False      # держит ли слот (курсор/клавиши в активной зоне)
        self.leave_at = 0.0      # ушёл: до этого момента платформа ещё стоит (GRACE)


class AirHockey:
    def __init__(self, user_of, data_dir=None):
        self.user_of = user_of
        self.path = (Path(data_dir) / "air.json") if data_dir else None
        self.conns = {}           # ws -> nick (жизненный цикл соединения)
        self.pads = {}            # (ws, kind) -> Player; у коннекта может быть 2 платформы
        self.loop_task = None
        self.balls = [{"x": 0.5, "y": 0.5, "vx": 0.0, "vy": 0.0, "bounces": 0, "touch": None}]
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

    def pad_w(self):
        n = max(1, self.active_count() + (1 if self.mode == "local" and self.ghost and self.ghost.get("bot") else 0))
        return clamp(PAD_W0 / (n ** 0.5), PAD_WMIN, PAD_W0)

    # ---------- мяч(и) ----------
    def _newball(self, vx, vy, x=0.5, y=0.5, touch=None):
        return {"x": x, "y": y, "vx": vx, "vy": vy, "bounces": 0, "touch": touch}

    def _kick(self, n_balls=1):
        self.balls = []
        for _ in range(max(1, n_balls)):
            self.balls.append(self._newball(random.uniform(-0.3, 0.3), random.choice((-1, 1)) * BALL_V0))
        self.combo = 0

    def _rand_ip(self):
        return ".".join(str(random.randint(1, 254)) for _ in range(4))

    def _score(self, side, touch, gx):
        """Засчитать гол (без сброса поля — поле может ещё содержать другие мячи)."""
        self.score[side] = min(SCORE_MAX, self.score[side] + 1)
        own = False
        label = self._rand_ip()
        if touch:
            tnick, tside = touch
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
        if self.score[side] % 10 == 0:
            ev, add = self._jubilee()  # случайное событие на каждый кратный 10 гол
            self.goal_event["ev"], self.goal_event["add"] = ev, add   # в режиме local мячи добавит клиент
        self._save()

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
        b["bounces"] += 1
        self.wid += 1
        self._boost(b)

    def _bounce_paddle(self, b, p, w):
        hw, hh = w / 2, PAD_H / 2
        cx = clamp(b["x"], p.x - hw, p.x + hw)
        cy = clamp(b["y"], p.y - hh, p.y + hh)
        dx, dy = b["x"] - cx, b["y"] - cy
        d2 = dx * dx + dy * dy
        if d2 > BALL_R * BALL_R:
            return False
        if d2 < 1e-9:
            nx, ny = 0.0, (-1.0 if b["y"] < p.y else 1.0)
        else:
            dist = d2 ** 0.5
            nx, ny = dx / dist, dy / dist
        b["x"] = cx + nx * BALL_R
        b["y"] = cy + ny * BALL_R
        vn = b["vx"] * nx + b["vy"] * ny
        if vn < 0:
            b["vx"] -= 2 * vn * nx
            b["vy"] -= 2 * vn * ny
        b["vx"] += (b["x"] - p.x) / hw * 0.25
        b["touch"] = (p.nick, p.side)
        b["bounces"] += 1
        self.hid += 1
        self.combo += 1              # комбо: подряд отбитий платформами в розыгрыше
        if p.nick and p.nick != BOT_NICK:
            self.combo_board[p.nick] = max(self.combo_board.get(p.nick, 0), self.combo)
        self._boost(b)
        return True

    def _advance(self, b, w):
        """Один мяч на кадр (с субшагами). Возвращает (side, gx) при голе, иначе None."""
        speed = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        n = max(1, min(24, int(speed * DT / (BALL_R * 0.6)) + 1))
        sdt = DT / n
        for _ in range(n):
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
            for p in self.pads.values():
                if p.active:
                    self._bounce_paddle(b, p, w)
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
                if g and time.monotonic() - g["t"] < 1.5 and g["balls"]:
                    self.balls = [self._newball(b["vx"], b["vy"], b["x"], b["y"]) for b in g["balls"]]
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
        if self.mode != "online":
            return                    # одиночку считает его браузер
        if self.reset_at:
            if now < self.reset_at:
                return
            self.reset_at = 0.0
            self._kick()
        w = self.pad_w()
        add, remove = [], []
        for b in self.balls:
            g = self._advance(b, w)
            if g:
                self._score(g[0], b["touch"], g[1]); remove.append(b)
            elif b["bounces"] >= SPLIT_AT and len(self.balls) + len(add) - len(remove) < MAX_BALLS:
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
        if not self.balls:                       # поле пусто — заморозка и новая подача
            self.balls = [self._newball(0.0, 0.0)]
            self.reset_at = now + FREEZE
            self.combo = 0

    # ---------- состояние для клиента ----------
    def snapshot(self, me_ws):
        w = self.pad_w()
        pads = [{"x": round(p.x, 4), "y": round(p.y, 4), "side": p.side, "kind": p.kind,
                 "me": p.ws is me_ws, "nick": p.nick, "away": bool(p.leave_at)}
                for p in self.pads.values() if p.active]
        src = self.balls
        if self.mode == "local":
            g = self.ghost
            src = g["balls"] if g and g["balls"] else [self._newball(0.0, 0.0)]
            if g and g.get("bot"):
                bt = g["bot"]
                pads.append({"x": bt["x"], "y": bt["y"], "side": bt["side"], "kind": "bot",
                             "me": False, "nick": BOT_NICK, "away": False})
        balls = [{"x": round(b["x"], 4), "y": round(b["y"], 4),
                  "vx": round(b["vx"], 4), "vy": round(b["vy"], 4)} for b in src]
        return {"t": "state", "mode": self.mode, "sim": self.mode == "local" and self.owner is me_ws,
                "balls": balls, "ball": balls[0] if balls else {"x": .5, "y": .5, "vx": 0, "vy": 0},
                "pw": round(w, 4), "pads": pads, "score": self.score, "last": self.last,
                "players": self.active_count(), "cap": MAX_PLAYERS, "combo": self.combo,
                "top": round(self.top_eff, 4), "bot": round(self.bot_eff, 4),
                "gid": self.gid, "goal": self.goal_event, "hid": self.hid, "wid": self.wid,
                "launch_in": round(max(0.0, self.reset_at - time.monotonic()), 3)
                             if self.reset_at and self.mode == "online" else 0.0,
                "freeze": FREEZE}

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
            w = self.pad_w()
            p.side = side
            p.x = clamp(x, w / 2, 1 - w / 2)
            lo, hi = (0.0, self.top_eff) if side == "top" else (self.bot_eff, 1.0)
            p.y = clamp(y, lo + PAD_H / 2, hi - PAD_H / 2)
        elif t == "leave":
            p = self.pads.get(key)
            if p and p.active and not p.leave_at:
                p.leave_at = time.monotonic() + GRACE
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
                balls.append(self._newball(vx, vy, x, y))
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
            touch = (nick, side if own else other)
            try:
                cmb = int(d.get("combo") or 0)
            except (TypeError, ValueError):
                cmb = 0
            if nick and 0 < cmb < 1000:
                self.combo_board[nick] = max(self.combo_board.get(nick, 0), cmb)
        elif by == "bot":
            touch = (BOT_NICK, side if own else other)
        self._score(side, touch, self._num(d.get("x"), 0, 1) or 0.5)

    @staticmethod
    def phys():
        """Параметры физики для клиента (режим local считает в браузере по тем же правилам)."""
        return {"v0": BALL_V0, "vmax": BALL_VMAX, "gain": BOUNCE_GAIN, "freeze": FREEZE,
                "split": SPLIT_AT, "maxBalls": MAX_BALLS, "padW0": PAD_W0, "padWmin": PAD_WMIN,
                "padH": PAD_H, "ballR": BALL_R, "botSpeed": BOT_SPEED, "botErr": BOT_ERR,
                "grace": GRACE, "botNick": BOT_NICK}

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
