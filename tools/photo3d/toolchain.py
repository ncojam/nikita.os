# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9", "onnxruntime>=1.20", "numpy>=1.26", "pillow>=10", "opencv-python-headless>=4.9"]
# ///
"""Тулчейн фото → глубина и 3D для nikita.os. Запускается на своём компьютере, на сервер не едет.

    uv run tools/photo3d/toolchain.py               веб-интерфейс: http://127.0.0.1:8770 (откроется сам)
    uv run tools/photo3d/toolchain.py depth a.jpg b.png [--model base] [--res 518]
    uv run tools/photo3d/toolchain.py scene shot.png --mode minecraft [--fov 70] [--blocks 20] [--no-fill]
    uv run tools/photo3d/toolchain.py scene photo.jpg --mode photo [--fov 60] [--range 8] [--res 256]
    uv run tools/photo3d/toolchain.py site          модель и рантайм для глубины в браузере → fs/usr/share/depth

Всё складывается рядом с картинкой: <картинка>.depth.png и <картинка>.scene.nvx. Дальше — как обычно: файлы fs/
копируются на сервер, а просмотрщик фото на сайте подхватывает их сам.
"""
import argparse
import os
import queue
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

import depthmodel  # noqa: E402
import scene  # noqa: E402

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
PORT = int(os.environ.get("PHOTO3D_PORT", "8770"))


def is_image(p):
    n = p.name.lower()
    return p.suffix.lower() in IMAGE_EXT and not n.endswith(".depth.png")


# ======================= работа =======================

def run_depth(path, model="base", res=518, say=print):
    t0 = time.time()
    dst = depthmodel.depth_for(path, model, res, say)
    say(f"🌊 {Path(path).name} — {time.time() - t0:.1f} с")
    return str(dst)


def run_scene(path, mode="photo", fov=None, k_range=None, res=256, blocks=None, fill=True, model="base", say=print):
    from PIL import Image
    import numpy as np
    path = Path(path)
    dpath = path.with_name(path.name + ".depth.png")
    if not dpath.is_file():
        say("Глубины ещё нет — считаю…")
        run_depth(path, model, 518, say)
    with Image.open(path) as im:
        rgb = np.asarray(im.convert("RGB"))
    D = depthmodel.load_depth(dpath)
    h, w = rgb.shape[:2]
    if D.shape != (h, w):
        D = scene.resize(D, w, h)
    t0 = time.time()
    if mode == "minecraft":
        say("⛏ Ищу оси мира и размер блока…")
        head, vox, col = scene.minecraft_scene(rgb, D, fov=fov or 70, k_range=k_range, blocks=blocks, fill=fill)
    else:
        head, vox, col = scene.photo_scene(rgb, D, fov=fov or 60, k_range=k_range or 8, res=res, fill=fill)
    dst = path.with_name(path.name + ".scene.nvx")
    head = scene.write_nvx(dst, head, vox, col)
    p = head.get("params", {})
    extra = f" · блок найден, совпадение {p.get('fit')} · диапазон {p.get('range'):.1f}" if mode == "minecraft" else ""
    num = lambda x: f"{x:,}".replace(",", " ")
    say(f"🧊 {path.name}: {num(head['count'])} вокселей (дорисовано {num(head['filled'])}) за {time.time() - t0:.1f} с{extra}")
    return {"path": str(dst), "head": head}


# ======================= задачи (по одной, в фоне) =======================

class Jobs:
    @staticmethod
    def run_cli(args, say):
        p = subprocess.Popen([sys.executable, "-u", str(Path(__file__).resolve()), *args],
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        tail = []
        for line in p.stdout:
            line = line.rstrip()
            if not line:
                continue
            tail = (tail + [line])[-8:]
            if not line.startswith(("Traceback", "  ", "⚠")):
                say(line)
        code = p.wait()
        if code < 0:
            raise RuntimeError(f"процесс упал (сигнал {-code}) — скорее всего, не хватило памяти. Попробуй задать «Блоков до центра» или выключить дозаполнение")
        if code:
            last = next((l for l in reversed(tail) if l.strip() and not l.startswith(" ")), f"код {code}")
            raise RuntimeError(last.removeprefix("⚠ "))

    def __init__(self):
        self.q = queue.Queue()
        self.list = []
        self.seq = 0
        self.lock = threading.Lock()
        threading.Thread(target=self.loop, daemon=True).start()

    def add(self, kind, args):
        with self.lock:
            self.seq += 1
            j = {"id": self.seq, "kind": kind, "args": args, "state": "ждёт", "log": [], "result": None, "t": time.time()}
            self.list.append(j)
            self.list = self.list[-60:]
        self.q.put(j)
        return j

    def loop(self):
        while True:
            j = self.q.get()
            j["state"] = "идёт"

            def say(m, j=j):
                j["log"].append(m)
                del j["log"][:-40]
            try:
                a = j["args"]
                if j["kind"] == "model":
                    j["result"] = str(depthmodel.ensure_model(a.get("model", "base"), say))
                else:
                    # тяжёлое — отдельным процессом: если он упадёт (память, драйвер), интерфейс останется жив
                    self.run_cli(cli_args(j["kind"], a), say)
                j["state"] = "готово"
            except Exception as e:
                j["state"] = "ошибка"
                say("⚠ " + str(e))


def cli_args(kind, a):
    if kind == "depth":
        return ["depth", *a["paths"], "--model", a.get("model", "base"), "--res", str(int(a.get("res", 518)))]
    if kind == "site":
        return ["site"]
    if kind == "scene":
        r = ["scene", a["path"], "--mode", a.get("mode", "photo"), "--res", str(int(a.get("res") or 256)), "--model", a.get("model", "base")]
        for k in ("fov", "range", "blocks"):
            if a.get(k) is not None:
                r += ["--" + k, str(float(a[k]))]
        if not a.get("fill", True):
            r.append("--no-fill")
        return r
    raise ValueError("kind?")


# ======================= веб-интерфейс =======================

def web_app():
    from aiohttp import web
    jobs = Jobs()
    home = REPO / "fs" if (REPO / "fs").is_dir() else Path.home()

    def safe(p):
        p = Path(p).expanduser().resolve()
        if not (p == Path.home() or Path.home() in p.parents or p == REPO or REPO in p.parents):
            raise web.HTTPForbidden(text="только внутри домашней папки")
        return p

    async def state(_):
        site = REPO / "fs" / "usr" / "share" / "depth"
        try:
            prov = depthmodel.providers()
        except Exception:
            prov = []
        return web.json_response({"home": str(home), "repo": str(REPO),
                                  "models": {s: depthmodel.model_path(s).is_file() for s in depthmodel.SIZES},
                                  "site": {"dir": str(site), "ready": (site / "model.onnx").is_file() and all((site / f).is_file() for f in depthmodel.ORT_FILES)},
                                  "providers": prov})

    async def ls(req):
        d = safe(req.query.get("dir") or home)
        if not d.is_dir():
            raise web.HTTPNotFound(text="нет такой папки")
        dirs, imgs = [], []
        for p in sorted(d.iterdir(), key=lambda x: x.name.lower()):
            if p.name.startswith("."):
                continue
            if p.is_dir():
                dirs.append(p.name)
            elif is_image(p):
                imgs.append({"name": p.name, "path": str(p), "size": p.stat().st_size,
                             "depth": p.with_name(p.name + ".depth.png").is_file(),
                             "scene": p.with_name(p.name + ".scene.nvx").is_file()})
        return web.json_response({"dir": str(d), "parent": str(d.parent), "dirs": dirs, "images": imgs})

    async def file(req):
        p = safe(req.query["path"])
        if not p.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(p, headers={"Cache-Control": "no-store"})

    async def add_job(req):
        d = await req.json()
        kind = d.get("kind")
        if kind not in ("depth", "scene", "site", "model"):
            raise web.HTTPBadRequest(text="kind?")
        for p in d.get("paths", []) + ([d["path"]] if d.get("path") else []):
            safe(p)
        return web.json_response(jobs.add(kind, d))

    async def list_jobs(_):
        return web.json_response(jobs.list[::-1])

    async def index(_):
        return web.FileResponse(HERE / "web" / "index.html")

    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/state", state)
    app.router.add_get("/api/ls", ls)
    app.router.add_get("/api/file", file)
    app.router.add_post("/api/jobs", add_job)
    app.router.add_get("/api/jobs", list_jobs)
    app.router.add_static("/web/", HERE / "web")
    app.router.add_static("/site/", REPO / "public")      # three.js и читалка .nvx — те же, что у сайта

    async def headers(_, resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
    app.on_response_prepare.append(headers)
    return app


def main():
    ap = argparse.ArgumentParser(description="nikita.os: фото → глубина и 3D")
    sub = ap.add_subparsers(dest="cmd")
    a = sub.add_parser("depth"); a.add_argument("files", nargs="+"); a.add_argument("--model", default="base", choices=depthmodel.SIZES); a.add_argument("--res", type=int, default=518)
    b = sub.add_parser("scene"); b.add_argument("file"); b.add_argument("--mode", default="photo", choices=["photo", "minecraft"])
    b.add_argument("--fov", type=float); b.add_argument("--range", type=float); b.add_argument("--res", type=int, default=256)
    b.add_argument("--blocks", type=float); b.add_argument("--no-fill", action="store_true"); b.add_argument("--model", default="base", choices=depthmodel.SIZES)
    sub.add_parser("site")
    w = sub.add_parser("web"); w.add_argument("--no-browser", action="store_true")
    o = ap.parse_args()
    if o.cmd == "depth":
        for f in o.files:
            run_depth(f, o.model, o.res)
    elif o.cmd == "scene":
        run_scene(o.file, o.mode, o.fov, o.range, o.res, o.blocks, not o.no_fill, o.model)
    elif o.cmd == "site":
        depthmodel.prepare_site(REPO)
    else:
        from aiohttp import web
        url = f"http://127.0.0.1:{PORT}/"
        print(f"Тулчейн фото → 3D: {url}  (Ctrl+C — остановить)")
        if not getattr(o, "no_browser", False):
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        web.run_app(web_app(), host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:      # понятная строка вместо трейсбека (её же покажет интерфейс)
        print("⚠ " + str(e), flush=True)
        sys.exit(1)
