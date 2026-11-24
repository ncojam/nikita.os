"""Глубина для фото: сервер досчитывает карты глубины для картинок, у которых нет файла <картинка>.depth.png рядом.

Главный путь — тулчейн автора (tools/photo3d): он считает глубину на домашнем компьютере и кладёт файл рядом
с картинкой, сервер тогда ничего не делает. Этот модуль — подстраховка для картинок, залитых без глубины.

Сервер маленький (2 ГБ, рядом VPN), поэтому считает только в «тихие часы» и при низкой нагрузке, по одной картинке:
  будни 04–08, выходные 04–09 по Москве (NOS_DEPTH_WEEKDAY="4-8", NOS_DEPTH_WEEKEND="4-9"),
  нагрузка (loadavg / ядра) ниже NOS_DEPTH_MAXLOAD (0.5). NOS_DEPTH_ANYTIME=1 — считать сразу (для проверки дома).
После очереди модель выгружается — память возвращается.

Модель та же, что у браузера: fs/usr/share/depth/model.onnx (её кладёт туда тулчейн, «📦 Подготовить сайт»).
Зависимости необязательные: onnxruntime, numpy, Pillow (requirements.txt). Нет их или модели — /api/depth
отвечает 404, и просмотрщик предлагает посчитать в браузере.

  GET /api/depth?path=/путь/картинка.jpg -> 200 image/png (готово) | 202 {queued, position} | 404 {error}

Кэш — NOS_DATA/depth/<sha1(путь|mtime|размер)>.png (поменял картинку — посчитается заново), очередь —
NOS_DATA/depth/queue.json, не длиннее NOS_DEPTH_QUEUE (300).
"""
import asyncio
import hashlib
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from aiohttp import web

log = logging.getLogger("nikita.os.depth")

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
QUEUE_MAX = int(os.environ.get("NOS_DEPTH_QUEUE", "300"))
MAX_BYTES = int(os.environ.get("NOS_DEPTH_MAX_BYTES", str(30 * 1024 * 1024)))
MAX_LOAD = float(os.environ.get("NOS_DEPTH_MAXLOAD", "0.5"))
ANYTIME = os.environ.get("NOS_DEPTH_ANYTIME") == "1"
MSK = timezone(timedelta(hours=3))     # Москва без перехода на летнее время; в slim-образе может не быть tzdata
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def _hours(env, default):
    try:
        a, b = (int(x) for x in os.environ.get(env, default).split("-"))
        return a, b
    except ValueError:
        return tuple(int(x) for x in default.split("-"))


WEEKDAY = _hours("NOS_DEPTH_WEEKDAY", "4-8")
WEEKEND = _hours("NOS_DEPTH_WEEKEND", "4-9")


def jres(data, status=200):
    return web.json_response(data, status=status, dumps=lambda d: json.dumps(d, ensure_ascii=False),
                             headers={"Cache-Control": "no-store"})


def quiet_now():
    """Тихие часы и низкая нагрузка — можно считать."""
    if ANYTIME:
        return True
    now = datetime.now(MSK)
    a, b = WEEKEND if now.weekday() >= 5 else WEEKDAY
    if not a <= now.hour < b:
        return False
    try:
        return os.getloadavg()[0] / (os.cpu_count() or 1) < MAX_LOAD
    except OSError:
        return True


class Depth:
    def __init__(self, data_dir, real_file, model):
        """real_file(vpath) -> Path | None — реальный файл картинки (fs или общие папки); model — путь к .onnx."""
        self.dir = Path(data_dir) / "depth"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.real_file = real_file
        self.model = Path(model)
        self.qfile = self.dir / "queue.json"
        try:
            self.queue = [p for p in json.loads(self.qfile.read_text("utf-8")) if isinstance(p, str)][:QUEUE_MAX]
        except (OSError, ValueError):
            self.queue = []
        self.session = None
        self.task = None

    # ---------- доступность ----------
    def available(self):
        if not self.model.is_file():
            return False
        try:
            import numpy  # noqa: F401
            import onnxruntime  # noqa: F401
            from PIL import Image  # noqa: F401
        except ImportError:
            return False
        return True

    def cache_of(self, vpath, real):
        st = real.stat()
        h = hashlib.sha1(f"{vpath}|{st.st_mtime_ns}|{st.st_size}".encode()).hexdigest()
        return self.dir / (h + ".png")

    def save_queue(self):
        tmp = self.qfile.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.queue, ensure_ascii=False), "utf-8")
        os.replace(tmp, self.qfile)

    # ---------- расчёт ----------
    def compute(self, real, out):
        import numpy as np
        import onnxruntime as ort
        from PIL import Image

        if self.session is None:
            so = ort.SessionOptions()
            so.intra_op_num_threads = 1      # один поток — сервер не захлёбывается
            so.inter_op_num_threads = 1
            self.session = ort.InferenceSession(str(self.model), so, providers=["CPUExecutionProvider"])
        s = self.session
        with Image.open(real) as im:
            im = im.convert("RGB")
            W0, H0 = im.size
            k = min(1.0, 518 / max(W0, H0))
            w, h = max(14, round(W0 * k / 14) * 14), max(14, round(H0 * k / 14) * 14)
            x = np.asarray(im.resize((w, h), Image.BICUBIC), dtype=np.float32) / 255.0
        x = ((x - np.array(MEAN, np.float32)) / np.array(STD, np.float32)).transpose(2, 0, 1)[None]
        d = s.run(None, {s.get_inputs()[0].name: x.astype(np.float32)})[0]
        d = d.reshape(d.shape[-2], d.shape[-1])
        d = (d - d.min()) / max(1e-6, float(d.max() - d.min()))
        k2 = min(1.0, 1024 / max(W0, H0))
        img = Image.fromarray((d * 255).round().astype(np.uint8), "L").resize((round(W0 * k2), round(H0 * k2)), Image.BILINEAR)
        tmp = out.with_suffix(".tmp")
        img.save(tmp, "PNG")
        os.replace(tmp, out)

    async def worker(self):
        """Раз в 2 минуты: есть очередь и тихо — считаем по одной; очередь кончилась — выгружаем модель."""
        try:
            while True:
                await asyncio.sleep(5 if ANYTIME else 120)
                while self.queue and quiet_now() and self.available():
                    vpath = self.queue[0]
                    real = self.real_file(vpath)
                    try:
                        if real and real.is_file():
                            out = self.cache_of(vpath, real)
                            if not out.exists():
                                t0 = time.monotonic()
                                await asyncio.to_thread(self.compute, real, out)
                                log.info("depth: %s за %.1f с", vpath, time.monotonic() - t0)
                    except Exception as e:      # битая картинка — выкидываем из очереди, не зацикливаемся
                        log.warning("depth: %s не посчиталась: %s", vpath, e)
                    self.queue.pop(0)
                    self.save_queue()
                    await asyncio.sleep(1)
                if not self.queue and self.session is not None:
                    self.session = None       # отдать память
        except asyncio.CancelledError:
            raise

    # ---------- HTTP ----------
    async def api_depth(self, request):
        vpath = "/" + request.query.get("path", "").strip("/")
        if Path(vpath).suffix.lower() not in IMAGE_EXT:
            return jres({"error": "Это не картинка"}, 400)
        real = self.real_file(vpath)
        if not real or not real.is_file():
            return jres({"error": "Нет такой картинки"}, 404)
        out = self.cache_of(vpath, real)
        if out.exists():
            return web.FileResponse(out, headers={"Content-Type": "image/png", "Cache-Control": "no-cache"})
        if not self.available():
            return jres({"error": "Сервер не считает глубину (нет модели или onnxruntime)"}, 404)
        if real.stat().st_size > MAX_BYTES:
            return jres({"error": "Картинка слишком большая"}, 413)
        if vpath not in self.queue:
            if len(self.queue) >= QUEUE_MAX:
                return jres({"error": "Очередь сервера полна — посчитай в браузере"}, 503)
            self.queue.append(vpath)
            self.save_queue()
        return jres({"queued": True, "position": self.queue.index(vpath) + 1}, 202)

    async def on_startup(self, app):
        self.task = asyncio.create_task(self.worker())

    async def on_cleanup(self, app):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    def routes(self, app):
        app.router.add_get("/api/depth", self.api_depth)
        app.on_startup.append(self.on_startup)
        app.on_cleanup.append(self.on_cleanup)
