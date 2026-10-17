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
        self.ball = {"x": 0.5, "y": 0.5, "vx": 0.0, "vy": 0.0}
        self.score = {"top": 0, "bottom": 0}
        self.last = []            # последние забившие: [{nick, own}]
        self.last_touch = None    # (nick, side) кто последним коснулся мяча
        self.reset_at = 0.0       # пауза после гола до
        self.gid = 0              # счётчик голов (клиент по нему триггерит эффекты)
        self.goal_event = None    # последний гол: {side, x, own, nick, score}
        self.hid = 0              # счётчик ударов по платформе (для звука click)
        self.wid = 0              # счётчик ударов о стену (для звука wall)
        self.board = {}           # лидерборд: nick -> очки (гол +1, в свои -1)
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
            tmp.write_text(json.dumps({"score": self.score, "last": self.last, "board": self.board},
                                      ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass

    # ---------- слоты ----------
    def active_count(self):
        return sum(1 for p in self.pads.values() if p.active)

    def pad_w(self):
        n = max(1, self.active_count())
        return clamp(PAD_W0 / (n ** 0.5), PAD_WMIN, PAD_W0)

    # ---------- мяч ----------
    def _kick(self, direction=0):
        self.ball = {"x": 0.5, "y": 0.5,
                     "vx": random.uniform(-0.3, 0.3),
                     "vy": (direction or random.choice((-1, 1))) * BALL_V0}
        self.last_touch = None

    def _rand_ip(self):
        return ".".join(str(random.randint(1, 254)) for _ in range(4))

    def _goal(self, side):
        """side — в какие ворота влетел мяч ('top' | 'bottom')."""
        gx = self.ball["x"]            # где пересёк линию ворот (для эпицентра тряски)
        self.score[side] = min(SCORE_MAX, self.score[side] + 1)
        own = False
        label = self._rand_ip()        # имя забившего по умолчанию — случайный «IP» (аноним)
        if self.last_touch:
            tnick, tside = self.last_touch
            own = (tside == side)      # коснувшийся был на стороне этих ворот → свой гол
            if tnick:                  # залогинен — настоящий ник + лидерборд (гол +1, свой -1)
                label = tnick
                self.board[tnick] = self.board.get(tnick, 0) + (-1 if own else 1)
        self.last.insert(0, {"nick": label, "own": own})
        del self.last[3:]
        self.gid += 1
        self.goal_event = {"side": side, "x": round(gx, 4), "own": own,
                           "nick": label, "score": self.score[side]}
        self.reset_at = time.monotonic() + FREEZE
        self.ball["vx"] = self.ball["vy"] = 0.0
        self.ball["x"], self.ball["y"] = 0.5, 0.5
        self._save()

    def _boost(self):
        b = self.ball
        sp = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        if sp <= 1e-6:
            return
        target = min(BALL_VMAX, sp * (1 + BOUNCE_GAIN))
        b["vx"] *= target / sp
        b["vy"] *= target / sp

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
        # «английский» от смещения по платформе + разгон за отскок
        b["vx"] += (b["x"] - p.x) / hw * 0.25
        self._boost()
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
        # субшаги: быстрый мяч не проскакивает сквозь платформу/стену (анти-туннелинг)
        speed = (b["vx"] ** 2 + b["vy"] ** 2) ** 0.5
        n = max(1, min(24, int(speed * DT / (BALL_R * 0.6)) + 1))
        sdt = DT / n
        w = self.pad_w()
        for _ in range(n):
            b["x"] += b["vx"] * sdt
            b["y"] += b["vy"] * sdt
            # боковые стены
            if b["x"] < BALL_R:
                b["x"] = BALL_R; b["vx"] = abs(b["vx"]); self._wall()
            elif b["x"] > 1 - BALL_R:
                b["x"] = 1 - BALL_R; b["vx"] = -abs(b["vx"]); self._wall()
            # верх/низ: гол в створе, иначе стена
            for side in ("top", "bottom"):
                if (side == "top" and b["y"] < BALL_R) or (side == "bottom" and b["y"] > 1 - BALL_R):
                    if GOAL_L < b["x"] < GOAL_R:
                        self._goal(side)
                        return
                    b["y"] = BALL_R if side == "top" else 1 - BALL_R
                    b["vy"] = abs(b["vy"]) if side == "top" else -abs(b["vy"])
                    self._wall()
            # платформы
            for p in self.pads.values():
                if p.active and self._bounce_paddle(p, w):
                    self.hid += 1

    def _wall(self):
        self.wid += 1
        self._boost()

    # ---------- состояние для клиента ----------
    def snapshot(self, me_ws):
        w = self.pad_w()
        pads = [{"x": round(p.x, 4), "y": round(p.y, 4), "side": p.side, "kind": p.kind,
                 "me": p.ws is me_ws, "nick": p.nick}
                for p in self.pads.values() if p.active]
        return {"t": "state",
                "ball": {"x": round(self.ball["x"], 4), "y": round(self.ball["y"], 4),
                         "vx": round(self.ball["vx"], 4), "vy": round(self.ball["vy"], 4)},
                "pw": round(w, 4), "pads": pads, "score": self.score, "last": self.last,
                "players": self.active_count(), "cap": MAX_PLAYERS,
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
        if y <= TOP_ACTIVE:
            return "top"
        if y >= BOT_ACTIVE:
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
            lo, hi = (0.0, TOP_ACTIVE) if side == "top" else (BOT_ACTIVE, 1.0)
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
        top = sorted(self.board.items(), key=lambda kv: (-kv[1], kv[0]))[:50]
        return web.json_response({"board": [{"nick": n, "points": p} for n, p in top]})

    def routes(self, app):
        app.router.add_get("/api/air/ws", self.ws_handler)
        app.router.add_get("/api/air/leaderboard", self.api_leaderboard)
