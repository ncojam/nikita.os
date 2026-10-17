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
import os
import random
import time

from aiohttp import web, WSMsgType

FPS = 30
DT = 1.0 / FPS
MAX_PLAYERS = int(os.environ.get("NOS_AIR_MAX", "8"))
GOAL_L, GOAL_R = 0.33, 0.67         # створ ворот по x
PAD_W0 = 0.22                        # ширина платформы при одном игроке
PAD_WMIN = 0.06
PAD_H = 0.022                        # толщина платформы
BALL_R = 0.02
BALL_V0 = 0.55                       # стартовая скорость мяча (единиц поля в секунду)
BALL_VMAX = 1.3
TOP_ACTIVE = 0.25                    # верхняя активная зона: [0, 0.25]
BOT_ACTIVE = 0.75                    # нижняя активная зона: [0.75, 1]


def clamp(v, a, b):
    return a if v < a else b if v > b else v


class Player:
    __slots__ = ("ws", "nick", "x", "y", "side", "active", "last_move")

    def __init__(self, ws, nick):
        self.ws = ws
        self.nick = nick
        self.x = 0.5
        self.y = 0.9
        self.side = "bottom"
        self.active = False      # держит ли слот (курсор в активной зоне)
        self.last_move = 0.0


class AirHockey:
    def __init__(self, user_of):
        self.user_of = user_of
        self.conns = {}           # ws -> Player
        self.loop_task = None
        self.ball = {"x": 0.5, "y": 0.5, "vx": 0.0, "vy": 0.0}
        self.score = {"top": 0, "bottom": 0}
        self.last = []            # последние забившие: [{nick, own}]
        self.last_touch = None    # (nick, side) кто последним коснулся мяча
        self.reset_at = 0.0       # пауза после гола до
        self._kick(1)

    # ---------- слоты ----------
    def active_count(self):
        return sum(1 for p in self.conns.values() if p.active)

    def pad_w(self):
        n = max(1, self.active_count())
        return clamp(PAD_W0 / (n ** 0.5), PAD_WMIN, PAD_W0)

    # ---------- мяч ----------
    def _kick(self, direction=0):
        self.ball = {"x": 0.5, "y": 0.5,
                     "vx": random.uniform(-0.3, 0.3),
                     "vy": (direction or random.choice((-1, 1))) * BALL_V0}
        self.last_touch = None

    def _goal(self, side):
        """side — в какие ворота влетел мяч ('top' | 'bottom')."""
        self.score[side] += 1
        if self.last_touch:
            nick, tside = self.last_touch
            own = (tside == side)   # коснувшийся был на стороне этих ворот → свой гол
            self.last.insert(0, {"nick": nick, "own": own})
            del self.last[3:]
        self.reset_at = time.monotonic() + 1.2
        self.ball["vx"] = self.ball["vy"] = 0.0
        self.ball["x"], self.ball["y"] = 0.5, 0.5

    def _bounce_paddle(self, p, w):
        """Отражение мяча от платформы игрока p (горизонтальный брусок w×PAD_H)."""
        b = self.ball
        hw, hh = w / 2, PAD_H / 2
        cx = clamp(b["x"], p.x - hw, p.x + hw)
        cy = clamp(b["y"], p.y - hh, p.y + hh)
        dx, dy = b["x"] - cx, b["y"] - cy
        d2 = dx * dx + dy * dy
        if d2 > BALL_R * BALL_R:
            return False
        # нормаль столкновения
        if d2 < 1e-9:
            nx, ny = 0.0, (-1.0 if b["y"] < p.y else 1.0)
            dist = 0.0
        else:
            dist = d2 ** 0.5
            nx, ny = dx / dist, dy / dist
        # выталкиваем и отражаем
        b["x"] = cx + nx * BALL_R
        b["y"] = cy + ny * BALL_R
        vn = b["vx"] * nx + b["vy"] * ny
        if vn < 0:
            b["vx"] -= 2 * vn * nx
            b["vy"] -= 2 * vn * ny
        # «английский» от смещения по платформе + лёгкий разгон
        b["vx"] += (b["x"] - p.x) / hw * 0.25
        sp = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        boost = min(BALL_VMAX, sp * 1.03)
        if sp > 1e-6:
            b["vx"] *= boost / sp
            b["vy"] *= boost / sp
        self.last_touch = (p.nick, p.side)
        return True

    def step(self):
        now = time.monotonic()
        if self.reset_at:
            if now < self.reset_at:
                return
            self.reset_at = 0.0
            self._kick()
        b = self.ball
        b["x"] += b["vx"] * DT
        b["y"] += b["vy"] * DT
        # боковые стены
        if b["x"] < BALL_R:
            b["x"] = BALL_R; b["vx"] = abs(b["vx"])
        elif b["x"] > 1 - BALL_R:
            b["x"] = 1 - BALL_R; b["vx"] = -abs(b["vx"])
        # верх/низ: гол в створе, иначе стена
        for edge, side in ((0.0, "top"), (1.0, "bottom")):
            if (side == "top" and b["y"] < BALL_R) or (side == "bottom" and b["y"] > 1 - BALL_R):
                if GOAL_L < b["x"] < GOAL_R:
                    self._goal(side)
                    return
                b["y"] = BALL_R if side == "top" else 1 - BALL_R
                b["vy"] = abs(b["vy"]) if side == "top" else -abs(b["vy"])
        # платформы
        w = self.pad_w()
        for p in self.conns.values():
            if p.active:
                self._bounce_paddle(p, w)

    # ---------- состояние для клиента ----------
    def snapshot(self, me_ws):
        w = self.pad_w()
        pads = [{"x": round(p.x, 4), "y": round(p.y, 4), "side": p.side,
                 "me": p.ws is me_ws, "nick": p.nick}
                for p in self.conns.values() if p.active]
        return {"t": "state", "ball": {"x": round(self.ball["x"], 4), "y": round(self.ball["y"], 4)},
                "pw": round(w, 4), "pads": pads, "score": self.score, "last": self.last,
                "players": self.active_count(), "cap": MAX_PLAYERS}

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

    def ensure_loop(self):
        if self.loop_task is None and self.conns:
            self.loop_task = asyncio.create_task(self.run())

    # ---------- ввод ----------
    def _in_active(self, y):
        if y <= TOP_ACTIVE:
            return "top"
        if y >= BOT_ACTIVE:
            return "bottom"
        return None

    async def handle(self, p, d):
        t = d.get("t")
        if t == "move":
            try:
                x = clamp(float(d.get("x")), 0.0, 1.0)
                y = clamp(float(d.get("y")), 0.0, 1.0)
            except (TypeError, ValueError):
                return
            side = self._in_active(y)
            if side is None:
                p.active = False     # курсор ушёл в мёртвую зону/за поле
                return
            if not p.active:
                # хочет занять слот
                if self.active_count() >= MAX_PLAYERS:
                    p.active = False
                    return await self._send(p, {"t": "full"})
                p.active = True
            w = self.pad_w()
            p.side = side
            p.x = clamp(x, w / 2, 1 - w / 2)
            lo, hi = (0.0, TOP_ACTIVE) if side == "top" else (BOT_ACTIVE, 1.0)
            p.y = clamp(y, lo + PAD_H / 2, hi - PAD_H / 2)
        elif t == "leave":
            p.active = False

    async def _send(self, p, data):
        if not p.ws.closed:
            try:
                await p.ws.send_str(json.dumps(data, ensure_ascii=False))
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
        if not nick:
            await ws.send_str(json.dumps({"t": "need_login"}))
            # зритель без ника: покажем состояние, но слот не дадим
        p = Player(ws, nick or "?")
        self.conns[ws] = p
        await ws.send_str(json.dumps({"t": "hello", "cap": MAX_PLAYERS, "can_play": bool(nick)}))
        self.ensure_loop()
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    d = json.loads(msg.data)
                except ValueError:
                    continue
                if not nick:
                    if d.get("t") == "move":
                        await self._send(p, {"t": "need_login"})
                    continue
                await self.handle(p, d)
        finally:
            self.conns.pop(ws, None)
        return ws

    def routes(self, app):
        app.router.add_get("/api/air/ws", self.ws_handler)
