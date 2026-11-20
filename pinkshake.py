"""Pinkshake: сервер поиска игроков (лобби) + помощь в пробиве NAT.

Сервер НЕ передаёт игровые данные — игра идёт напрямую между игроками (p2p).
Он только:
  * хранит список открытых хостов (хост шлёт "я в сети" раз в ~2 с, запись живёт 8 с);
  * отдаёт этот список игрокам;
  * когда гость хочет подключиться — сообщает хосту и гостю публичные адреса друг друга,
    чтобы оба одновременно "постучались" друг к другу и роутеры пропустили соединение (UDP hole punching).

Протокол — UDP, формат совместим с "unconnected message" библиотеки LiteNetLib:
первый байт 0x09 (заголовок LiteNetLib), дальше наш пакет:
    'H' ver:u8 id:str name:str scene:u8 players:u8 max:u8 localPort:u16 nLocal:u8 [ip:str]*   — хост в сети
    'U' id:str                                                                             — хост закрылся
    'L' ver:u8 [нули до 1000+ байт]                                                        — дай список (ответ не больше запроса)
    'l' n:u8 [id:str name:str scene:u8 players:u8 max:u8]*                                  — список
    'J' id:str localPort:u16 nLocal:u8 [ip:str]*                                           — хочу к хосту id
    'P' ip:str port:u16 localPort:u16 nLocal:u8 [ip:str]*                                  — (хосту) к тебе идёт гость
    'p' ip:str port:u16 localPort:u16 nLocal:u8 [ip:str]*                                  — (гостю) адрес хоста
    'E' code:u8                                                                            — ошибка (1 — хоста нет)
Строки: длина u8 + UTF-8. Числа little-endian.

HTTP: GET /api/pinkshake/hosts — тот же список в JSON (без IP), например для страницы на сайте.
"""
import asyncio
import os
import struct
import time

from aiohttp import web

LNL_UNCONNECTED = 0x09
HOST_TTL = 8.0          # сколько живёт запись без "я в сети"
MAX_HOSTS = 200
MAX_LIST = 30           # сколько хостов отдаём за раз (влезает в один UDP-пакет)
RATE_PER_SEC = 20       # пакетов в секунду с одного адреса
MIN_LIST_REQUEST = 1000 # запрос списка должен быть не меньше ответа — иначе сервер можно использовать
                        # как "усилитель" UDP-атак (подделать чужой адрес и получить ответ больше запроса)
PROTOCOL_VERSION = 1


class _Reader:
    def __init__(self, data):
        self.d, self.i = data, 0

    def u8(self):
        v = self.d[self.i]; self.i += 1; return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.i)[0]; self.i += 2; return v

    def s(self):
        n = self.u8(); v = self.d[self.i:self.i + n].decode("utf-8", "replace"); self.i += n; return v


def _s(v):
    b = v.encode("utf-8")[:255]
    return bytes([len(b)]) + b


def _locals(ips):
    ips = [i for i in ips if i][:4]
    return bytes([len(ips)]) + b"".join(_s(i) for i in ips)


class _Proto(asyncio.DatagramProtocol):
    def __init__(self, lobby):
        self.lobby = lobby

    def connection_made(self, transport):
        self.lobby.transport = transport

    def datagram_received(self, data, addr):
        try:
            self.lobby.handle(data, addr)
        except Exception:
            pass  # битый пакет — просто игнорируем


class PinkshakeLobby:
    def __init__(self, port=None):
        self.port = int(port or os.environ.get("PINKSHAKE_UDP_PORT", "27015"))
        self.hosts = {}      # id -> dict
        self.rate = {}       # ip -> (секунда, счётчик)
        self.transport = None

    # ------------------------------------------------------------------ aiohttp
    def routes(self, app):
        app.on_startup.append(self._start)
        app.on_cleanup.append(self._stop)
        app.router.add_get("/api/pinkshake/hosts", self.api_hosts)

    async def _start(self, app):
        loop = asyncio.get_running_loop()
        await loop.create_datagram_endpoint(lambda: _Proto(self), local_addr=("0.0.0.0", self.port))

    async def _stop(self, app):
        if self.transport:
            self.transport.close()

    async def api_hosts(self, request):
        self._expire()
        return web.json_response([
            {"name": h["name"], "scene": h["scene"], "players": h["players"], "max": h["max"]}
            for h in list(self.hosts.values())[:MAX_LIST]
        ])

    # ------------------------------------------------------------------ UDP
    def _send(self, payload, addr):
        if self.transport:
            self.transport.sendto(bytes([LNL_UNCONNECTED]) + payload, addr)

    def _expire(self):
        now = time.monotonic()
        for k in [k for k, h in self.hosts.items() if now - h["seen"] > HOST_TTL]:
            del self.hosts[k]

    def _allowed(self, ip):
        sec = int(time.monotonic())
        s, n = self.rate.get(ip, (sec, 0))
        if s != sec:
            s, n = sec, 0
        n += 1
        self.rate[ip] = (s, n)
        if len(self.rate) > 5000:
            self.rate.clear()
        return n <= RATE_PER_SEC

    def handle(self, data, addr):
        if len(data) < 2 or data[0] & 0x1F != LNL_UNCONNECTED or not self._allowed(addr[0]):
            return
        r = _Reader(data)
        r.u8()
        kind = chr(r.u8())
        if kind == "H":
            if r.u8() != PROTOCOL_VERSION:
                return
            hid, name, scene, players, mx, lport = r.s(), r.s()[:24], r.u8(), r.u8(), r.u8(), r.u16()
            local = [r.s() for _ in range(min(r.u8(), 4))]
            if hid not in self.hosts and len(self.hosts) >= MAX_HOSTS:
                self._expire()
                if len(self.hosts) >= MAX_HOSTS:
                    return
            self.hosts[hid] = {"name": name or "Pinkshake", "scene": scene, "players": players, "max": mx,
                               "addr": addr, "lport": lport, "local": local, "seen": time.monotonic()}
        elif kind == "U":
            h = self.hosts.get(r.s())
            if h and h["addr"] == addr:
                del self.hosts[[k for k, v in self.hosts.items() if v is h][0]]
        elif kind == "L":
            if len(data) < MIN_LIST_REQUEST or r.u8() != PROTOCOL_VERSION:
                return
            self._expire()
            limit = len(data) - 1   # ответ (с заголовком 0x09) не больше запроса
            body = bytearray()
            n = 0
            for hid, h in list(self.hosts.items())[:MAX_LIST]:
                item = _s(hid) + _s(h["name"]) + bytes([h["scene"], h["players"], h["max"]])
                if 2 + len(body) + len(item) > limit:
                    break
                body += item
                n += 1
            self._send(b"l" + bytes([n]) + bytes(body), addr)
        elif kind == "J":
            hid, lport = r.s(), r.u16()
            local = [r.s() for _ in range(min(r.u8(), 4))]
            self._expire()
            h = self.hosts.get(hid)
            if not h:
                self._send(b"E\x01", addr)
                return
            # хосту — адрес гостя, гостю — адрес хоста; оба начинают "стучаться"
            self._send(b"P" + _s(addr[0]) + struct.pack("<HH", addr[1], lport) + _locals(local), h["addr"])
            self._send(b"p" + _s(h["addr"][0]) + struct.pack("<HH", h["addr"][1], h["lport"]) + _locals(h["local"]), addr)
