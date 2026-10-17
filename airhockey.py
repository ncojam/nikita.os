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

Сервер авторитетный: физика в цикле ~30/сек, рассылка состояния. Цикл спит при пустой арене.
Лимит одновременных игроков — NOS_AIR_MAX; нет мест → клиенту «full» (он играет nah.wav).
Авторизация игрока — через аккаунт чата (для ника в счёте); зрителям вход не нужен.
"""
import asyncio
import json
import math
import os
import random
import time
from pathlib import Path

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
BOT_NICK = "primitiveAI"
BOT_TRIGGER = int(os.environ.get("NOS_AIR_BOT_GOALS", "3"))   # одиночка забил столько → приходит бот
BOT_SPEED = float(os.environ.get("NOS_AIR_BOT_SPEED", "0.6")) # скорость бота (лёгкий), units/сек
BOT_ERR = float(os.environ.get("NOS_AIR_BOT_ERR", "0.09"))   # промах прицела бота
SPLIT_AT = int(os.environ.get("NOS_AIR_SPLIT", "64"))        # столько отскоков → мяч расщепляется
MAX_BALLS = int(os.environ.get("NOS_AIR_MAXBALLS", "4"))     # потолок числа мячей
# активная зона = 70% от половины стола (половина = 0.5 → активная 0.35 у края).
# Потом будем менять геймплейно, поэтому вынесено в одно место.
ACTIVE_FRAC = float(os.environ.get("NOS_AIR_ACTIVE", "0.7"))
TOP_ACTIVE = 0.5 * ACTIVE_FRAC       # верхняя активная зона: [0, TOP_ACTIVE]
BOT_ACTIVE = 1.0 - 0.5 * ACTIVE_FRAC # нижняя активная зона: [BOT_ACTIVE, 1]


def clamp(v, a, b):
    return a if v < a else b if v > b else v


class Player:
    __slots__ = ("ws", "nick", "kind", "x", "y", "side", "active")

    def __init__(self, ws, nick, kind="m"):
        self.ws = ws
        self.nick = nick
        self.kind = kind         # "m" — мышь/тач, "k" — клавиатура (вторая платформа)
        self.x = 0.5
        self.y = 0.9
        self.side = "bottom"
        self.active = False      # держит ли слот (курсор/клавиши в активной зоне)


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
        self.bot = None           # Player бота primitiveAI или None
        self.solo_goals = 0       # сколько забил одиночный игрок (копим до BOT_TRIGGER)
        self.bot_err = 0.0        # текущий промах прицела бота
        self.bot_cool = 0.0       # до какого момента бот ещё «остывает» без игрока
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

    def human_count(self):
        return sum(1 for p in self.pads.values() if p.active and p.kind != "bot")

    def _lone_human(self):
        hs = [p for p in self.pads.values() if p.active and p.kind != "bot"]
        return hs[0] if len(hs) == 1 else None

    def pad_w(self):
        n = max(1, self.active_count())
        return clamp(PAD_W0 / (n ** 0.5), PAD_WMIN, PAD_W0)

    # ---------- мяч(и) ----------
    def _newball(self, vx, vy, x=0.5, y=0.5, touch=None):
        return {"x": x, "y": y, "vx": vx, "vy": vy, "bounces": 0, "touch": touch}

    def _kick(self, n_balls=1):
        # когда игрок один (и нет бота) — подача летит В ЕГО сторону; иначе случайно
        lone = self._lone_human() if (self.bot is None and self.human_count() == 1) else None
        self.balls = []
        for _ in range(max(1, n_balls)):
            if lone:
                dir_y = 1 if lone.side == "bottom" else -1
            else:
                dir_y = random.choice((-1, 1))
            self.balls.append(self._newball(random.uniform(-0.3, 0.3), dir_y * BALL_V0))
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
            if tnick and tnick != BOT_NICK and not own and self.bot is None and self.human_count() == 1:
                self.solo_goals += 1
        self.last.insert(0, {"nick": label, "own": own})
        del self.last[3:]
        self.gid += 1
        self.goal_event = {"side": side, "x": round(gx, 4), "own": own,
                           "nick": label, "score": self.score[side]}
        if self.score[side] % 10 == 0:
            self._jubilee()           # случайное событие на каждый кратный 10 гол
        self._save()

    def _jubilee(self):
        """Случайное событие на юбилейный счёт."""
        ev = random.choice(("wave", "balls"))
        if ev == "wave":
            self.wave = 0.18          # граница активной зоны начинает колебаться и затухать
            self.wave_t = 0.0
        elif ev == "balls" and len(self.balls) < MAX_BALLS:
            add = random.randint(1, min(3, MAX_BALLS - len(self.balls)))
            for _ in range(add):
                a = random.uniform(0, 6.283)
                self.balls.append(self._newball(math.cos(a) * BALL_V0, math.sin(a) * BALL_V0))

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

    def _manage_bot(self, now):
        """Лёгкий бот primitiveAI против одиночки; с кулдауном, чтобы не пропадать от случайного вывода курсора."""
        human = self._lone_human()
        humans = self.human_count()
        if humans >= 2:                        # реальная игра вдвоём+ — бот не нужен сразу
            if self.bot is not None:
                self.pads.pop(("bot", "bot"), None); self.bot = None
            self.solo_goals = 0
            return
        if human is None:                      # игрок увёл курсор — даём боту «остыть»
            if self.bot is not None:
                if not self.bot_cool:
                    self.bot_cool = now + 4.0
                elif now >= self.bot_cool:
                    self.pads.pop(("bot", "bot"), None); self.bot = None; self.bot_cool = 0.0; self.solo_goals = 0
            return
        self.bot_cool = 0.0                     # игрок вернулся — отменяем остывание
        if self.bot is None:
            if self.solo_goals < BOT_TRIGGER:
                return
            self.bot = Player(None, BOT_NICK, "bot")
            self.bot.active = True; self.bot.x = 0.5; self.bot.y = 0.1
            self.pads[("bot", "bot")] = self.bot
        side = "top" if human.side == "bottom" else "bottom"
        self.bot.side = side
        w = self.pad_w()
        lo, hi = (0.0, self.top_eff) if side == "top" else (self.bot_eff, 1.0)
        if random.random() < 0.03:
            self.bot_err = random.uniform(-BOT_ERR, BOT_ERR)
        ball = min(self.balls, key=lambda b: abs(b["y"] - self.bot.y)) if self.balls else None
        maxd = BOT_SPEED * DT
        if ball:
            tx = clamp(ball["x"] + self.bot_err, w / 2, 1 - w / 2)
            self.bot.x = clamp(self.bot.x + clamp(tx - self.bot.x, -maxd, maxd), w / 2, 1 - w / 2)
            # теперь бот ездит и вверх-вниз в своей зоне: подъезжает к мячу, когда тот близко
            ty = clamp(ball["y"], lo + PAD_H / 2, hi - PAD_H / 2)
            self.bot.y = clamp(self.bot.y + clamp(ty - self.bot.y, -maxd, maxd), lo + PAD_H / 2, hi - PAD_H / 2)

    def step(self):
        now = time.monotonic()
        self._update_zone(DT)
        self._manage_bot(now)
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
                 "me": p.ws is me_ws, "nick": p.nick}
                for p in self.pads.values() if p.active]
        balls = [{"x": round(b["x"], 4), "y": round(b["y"], 4),
                  "vx": round(b["vx"], 4), "vy": round(b["vy"], 4)} for b in self.balls]
        return {"t": "state",
                "balls": balls, "ball": balls[0] if balls else {"x": .5, "y": .5, "vx": 0, "vy": 0},
                "pw": round(w, 4), "pads": pads, "score": self.score, "last": self.last,
                "players": self.active_count(), "cap": MAX_PLAYERS, "combo": self.combo,
                "top": round(self.top_eff, 4), "bot": round(self.bot_eff, 4),
                "gid": self.gid, "goal": self.goal_event, "hid": self.hid, "wid": self.wid,
                "launch_in": round(max(0.0, self.reset_at - time.monotonic()), 3) if self.reset_at else 0.0,
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
                if p:
                    p.active = False     # ушёл в мёртвую зону/за поле
                return
            if p is None or not p.active:
                if self.active_count() >= MAX_PLAYERS:
                    if p:
                        p.active = False
                    return await self._send(ws, {"t": "full"})
                if p is None:
                    p = self.pads[key] = Player(ws, nick, kind)
                p.active = True
            w = self.pad_w()
            p.side = side
            p.x = clamp(x, w / 2, 1 - w / 2)
            lo, hi = (0.0, self.top_eff) if side == "top" else (self.bot_eff, 1.0)
            p.y = clamp(y, lo + PAD_H / 2, hi - PAD_H / 2)
        elif t == "leave":
            p = self.pads.get(key)
            if p:
                p.active = False

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
                                      "top": TOP_ACTIVE, "bot": BOT_ACTIVE, "goalL": GOAL_L, "goalR": GOAL_R}))
        self.ensure_loop()
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(msg.data)
                except ValueError:
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
