"""Карта глубины по одной картинке: Depth Anything V2 (ONNX) через onnxruntime.

Модели качаются один раз в ~/.cache/nos-photo3d/models/:
  small (~100 МБ) — быстро; base (~390 МБ) — по умолчанию, заметно аккуратнее; large (~1.3 ГБ) — лучшая, медленная.
Считает на видеокарте, если onnxruntime её видит (ROCm/MIGraphX — для AMD, CUDA, DirectML), иначе на процессоре.

Результат — 16-битный PNG в оттенках серого, белое — близко (обратная глубина, растянутая на весь диапазон),
не больше 1024 по большей стороне. Тот же формат понимают сайт (просмотрщик) и scene.py.

Ещё здесь «📦 Подготовить сайт»: лёгкая модель (квантованная small, ~27 МБ) и onnxruntime-web кладутся в
<репозиторий>/fs/usr/share/depth/ — оттуда сайт считает глубину в браузере, а сервер — ночью (depth.py).
"""
import io
import os
import shutil
import tarfile
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "nos-photo3d"
HF = "https://huggingface.co/onnx-community/depth-anything-v2-{size}/resolve/main/onnx/{file}"
SIZES = ("small", "base", "large")
ORT_WEB = "1.31.1"     # версия onnxruntime-web для сайта (файлы ниже есть именно в ней)
ORT_FILES = ("ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm")
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def download(url, dst, say=print):
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "nos-photo3d"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got, last = 0, -1
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            got += len(b)
            pct = int(got * 100 / total) if total else -1
            if pct != last and (pct % 5 == 0 or pct < 0):
                last = pct
                say(f"⬇ {dst.name}: {got >> 20} МБ" + (f" / {total >> 20} МБ ({pct}%)" if total else ""))
    os.replace(tmp, dst)
    return dst


def model_path(size):
    return CACHE / "models" / f"depth-anything-v2-{size}.onnx"


def ensure_model(size, say=print):
    if size not in SIZES:
        raise ValueError("модель: " + ", ".join(SIZES))
    p = model_path(size)
    if not p.is_file():
        say(f"Качаю модель {size} (один раз)…")
        download(HF.format(size=size, file="model.onnx"), p, say)
    return p


_sessions = {}


def providers():
    import onnxruntime as ort
    have = ort.get_available_providers()
    pref = ["MIGraphXExecutionProvider", "ROCMExecutionProvider", "CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    return [p for p in pref if p in have] or ["CPUExecutionProvider"]


def session(size, say=print):
    import onnxruntime as ort
    if size not in _sessions:
        p = ensure_model(size, say)
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _sessions[size] = ort.InferenceSession(str(p), so, providers=providers())
        say("Модель: " + size + " · " + ", ".join(_sessions[size].get_providers()))
    return _sessions[size]


def infer(img, size="base", res=518, say=print):
    """img — PIL.Image; res — сторона, до которой ужимать для сети (кратно 14). Возвращает float32 0..1 (1 — близко)."""
    s = session(size, say)
    im = img.convert("RGB")
    W0, H0 = im.size
    k = min(1.0, res / max(W0, H0))
    w, h = max(14, round(W0 * k / 14) * 14), max(14, round(H0 * k / 14) * 14)
    x = np.asarray(im.resize((w, h), Image.BICUBIC), np.float32) / 255.0
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    d = s.run(None, {s.get_inputs()[0].name: x})[0]
    d = d.reshape(d.shape[-2], d.shape[-1]).astype(np.float32)
    d = (d - d.min()) / max(1e-6, float(d.max() - d.min()))
    return d


def save_depth(d, size_wh, dst):
    """d 0..1 → 16-битный PNG размером с картинку (но ≤ 1024)."""
    W0, H0 = size_wh
    k = min(1.0, 1024 / max(W0, H0))
    im = Image.fromarray(d.astype(np.float32), "F").resize((round(W0 * k), round(H0 * k)), Image.BILINEAR)
    a = np.clip(np.asarray(im) * 65535, 0, 65535).astype(np.uint16)
    tmp = str(dst) + ".tmp.png"
    Image.fromarray(a, "I;16").save(tmp, "PNG")
    os.replace(tmp, dst)


def load_depth(path):
    """.depth.png (8 или 16 бит) → float32 0..1."""
    with Image.open(path) as im:
        a = np.asarray(im)
    if a.ndim == 3:
        a = a[..., 0]
    return a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 or a.max() > 255 else 255.0)


def depth_for(path, size="base", res=518, say=print):
    path = Path(path)
    with Image.open(path) as im:
        im.load()
        d = infer(im, size, res, say)
        dst = path.with_name(path.name + ".depth.png")
        save_depth(d, im.size, dst)
    return dst


def prepare_site(repo, say=print):
    """Модель и рантайм для сайта: <repo>/fs/usr/share/depth/{model.onnx, ort-*.mjs, *.wasm, LICENSE}."""
    out = Path(repo) / "fs" / "usr" / "share" / "depth"
    out.mkdir(parents=True, exist_ok=True)
    if not (out / "model.onnx").is_file():
        say("Качаю лёгкую модель для браузера (~27 МБ)…")
        download(HF.format(size="small", file="model_quantized.onnx"), out / "model.onnx", say)
    if not all((out / f).is_file() for f in ORT_FILES):
        say(f"Качаю onnxruntime-web {ORT_WEB} из npm…")
        url = f"https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-{ORT_WEB}.tgz"
        req = urllib.request.Request(url, headers={"User-Agent": "nos-photo3d"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            for f in ORT_FILES + ("LICENSE",):
                m = tf.getmember("package/dist/" + f if f != "LICENSE" else "package/LICENSE")
                with tf.extractfile(m) as src, open(out / f, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    say(f"✓ Готово: {out} — скопируй папку fs/usr/share/depth на сервер (как остальные файлы fs/)")
    return out
