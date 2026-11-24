"""Сцена из одной фотографии: карта глубины → точки → воксели (.nvx).

Два режима:
  photo     — любая картинка. Глубина у нейросети относительная, поэтому «диапазон» задаёт, во сколько раз
              дальнее дальше ближнего (по умолчанию 8). Размер вокселя — из «разрешения» (вокселей поперёк кадра).
  minecraft — скриншот Minecraft. Мир из кубов, поэтому: 1) по нормалям находим три главных направления
              (оси мира) и «верх»; 2) по тому, как плоскости ложатся на сетку, находим размер блока;
              3) диапазон глубины подбирается сам — тот, при котором блоки лучше всего садятся на сетку.
              Всё это можно задать руками, если автомат ошибся (FOV, диапазон, размер блока).

«Дозаполнить скрытое» (fill):
  photo     — за краями ближних предметов (где фон перекрыт) дорисовывается слой фона: глубина фона берётся
              из окрестности, цвет — инпейнтом. Только внутри кадра: снаружи сцены ничего не появляется.
  minecraft — блоки под видимыми верхушками досыпаются вниз до уровня земли соседних столбцов (мир сплошной).

Формат .nvx описан в public/js/apps/photo/nvx.js (там же его читает сайт).
"""
import json
import math
import struct

import numpy as np

try:
    import cv2
except ImportError:      # без OpenCV — без инпейнта (дозаполнение берёт цвет соседей)
    cv2 = None


# ======================= общее: камера, точки =======================

def rays(w, h, fov_v):
    """Лучи через центры пикселей (камера смотрит в −Z, Y вверх), длина по Z = 1."""
    f = (h / 2) / math.tan(math.radians(fov_v) / 2)
    u = (np.arange(w) + 0.5 - w / 2) / f
    v = -(np.arange(h) + 0.5 - h / 2) / f
    X, Y = np.meshgrid(u, v)
    return X, Y, f


def disparity_to_z(D, k_range):
    """D 0..1 (1 — близко) → расстояние z от 1 до k_range."""
    k_range = max(1.01, float(k_range))
    disp = 1.0 / k_range + (1.0 - 1.0 / k_range) * np.clip(D, 0, 1)
    return 1.0 / disp


def points(D, fov_v, k_range):
    h, w = D.shape
    X, Y, f = rays(w, h, fov_v)
    z = disparity_to_z(D, k_range)
    return np.stack([X * z, Y * z, -z], -1), z, f


def resize(a, w, h, nearest=False):
    if cv2 is not None:
        return cv2.resize(a, (w, h), interpolation=cv2.INTER_NEAREST if nearest else cv2.INTER_AREA)
    from PIL import Image
    if a.dtype != np.uint8:
        im = Image.fromarray(a.astype(np.float32), "F")
        return np.asarray(im.resize((w, h), Image.NEAREST if nearest else Image.BILINEAR), dtype=np.float32)
    im = Image.fromarray(a)
    return np.asarray(im.resize((w, h), Image.NEAREST if nearest else Image.BILINEAR))


def fit(rgb, D, max_side):
    h, w = D.shape
    k = min(1.0, max_side / max(w, h))
    W, H = max(8, round(w * k)), max(8, round(h * k))
    return resize(rgb, W, H), resize(D.astype(np.float32), W, H)


def voxelize(P, C, size, origin=(0, 0, 0), min_pts=1):
    """Точки → уникальные воксели со средним цветом. Возвращает (idx int32 N×3, rgb uint8 N×3, сколько точек в каждом)."""
    idx = np.floor((P - np.asarray(origin)) / size).astype(np.int64)
    lo = idx.min(0)
    rel = idx - lo
    span = rel.max(0) + 1
    key = (rel[:, 0] * span[1] + rel[:, 1]) * span[2] + rel[:, 2]
    uk, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    col = np.zeros((len(uk), 3))
    np.add.at(col, inv, C.astype(np.float64))
    col /= cnt[:, None]
    z = uk % span[2]; y = (uk // span[2]) % span[1]; x = uk // (span[1] * span[2])
    vox = np.stack([x, y, z], -1) + lo
    keep = cnt >= min_pts
    return vox[keep].astype(np.int32), np.clip(col[keep], 0, 255).astype(np.uint8), cnt[keep]


# ======================= режим «фото» =======================

def photo_scene(rgb, D, fov=60.0, k_range=8.0, res=256, fill=True, sky=0.02, max_side=720):
    rgb, D = fit(rgb, D, max_side)
    h, w = D.shape
    P, z, f = points(D, fov, k_range)
    z_med = float(np.median(z))
    size = (w / f) * z_med / res                      # ширина кадра на средней глубине / разрешение
    keep = D > sky                                    # почти нулевая глубина — небо, его не строим
    samples_P, samples_C = [], []

    def add(P0, z0, C0, mask):
        """Пиксель покрывает (z/f)² — если это больше вокселя, рассыпаем его на k×k точек (без дыр вдали)."""
        k = np.clip(np.ceil((z0 / f) / size), 1, 6).astype(int)
        for kk in np.unique(k[mask]):
            m = mask & (k == kk)
            if not m.any():
                continue
            ys, xs = np.nonzero(m)
            if kk == 1:
                samples_P.append(P0[m]); samples_C.append(C0[m]); continue
            off = (np.arange(kk) + 0.5) / kk - 0.5
            for oy in off:
                for ox in off:
                    zz = z0[m]
                    px = ((xs + 0.5 + ox) - w / 2) / f * zz
                    py = -((ys + 0.5 + oy) - h / 2) / f * zz
                    samples_P.append(np.stack([px, py, -zz], -1)); samples_C.append(C0[m])

    add(P, z, rgb.reshape(h, w, 3), keep)
    vox, col, _ = voxelize(np.concatenate(samples_P), np.concatenate(samples_C), size)
    filled = 0
    if fill:
        fv, fc = photo_fill(rgb, D, fov, k_range, size, f, keep)
        if len(fv):
            have = {tuple(v) for v in vox.tolist()}
            new = np.array([i for i, v in enumerate(fv.tolist()) if tuple(v) not in have], dtype=np.int64)
            if len(new):
                vox = np.concatenate([vox, fv[new]]); col = np.concatenate([col, fc[new]]); filled = len(new)
    head = {"v": 1, "kind": "photo", "size": size, "origin": [0, 0, 0],
            "cam": {"pos": [0, 0, 0], "quat": [0, 0, 0, 1], "fov": fov, "aspect": w / h},
            "ground": None, "filled": int(filled), "params": {"fov": fov, "range": k_range, "res": res}}
    return head, vox, col


def photo_fill(rgb, D, fov, k_range, size, f, keep):
    """Слой фона за краями ближних предметов: где рядом есть что-то заметно дальше — значит, за этим пикселем
    фон перекрыт. Глубина фона — минимум по окрестности, цвет — инпейнт поверх ближнего предмета."""
    h, w = D.shape
    r = max(3, round(max(w, h) * 0.03))
    ker = np.ones((2 * r + 1, 2 * r + 1), np.uint8)
    if cv2 is not None:
        bg = cv2.erode(D.astype(np.float32), ker)
    else:
        from scipy.ndimage import grey_erosion   # запасной путь
        bg = grey_erosion(D, size=(2 * r + 1, 2 * r + 1))
    band = ((D - bg) > 0.08) & keep & (bg > 0.0)
    if not band.any():
        return np.zeros((0, 3), np.int32), np.zeros((0, 3), np.uint8)
    if cv2 is not None:
        fg = (D - bg > 0.08).astype(np.uint8) * 255
        col = cv2.inpaint(np.ascontiguousarray(rgb), cv2.dilate(fg, np.ones((3, 3), np.uint8)), 7, cv2.INPAINT_TELEA)
    else:
        col = rgb
    Pb, zb, _ = points(bg, fov, k_range)
    return voxelize(Pb[band], col[band].reshape(-1, 3), size)[:2]


# ======================= режим «Minecraft» =======================

def normals(P):
    """Нормали из соседних точек (картинка → крестик градиентов), к камере."""
    dx = np.zeros_like(P); dy = np.zeros_like(P)
    dx[:, 1:-1] = P[:, 2:] - P[:, :-2]
    dy[1:-1] = P[2:] - P[:-2]
    n = np.cross(dx, dy)
    ln = np.linalg.norm(n, axis=-1, keepdims=True)
    n = n / np.maximum(ln, 1e-12)
    flip = (n * P).sum(-1) > 0                  # нормаль смотрит на камеру (камера в нуле)
    n[flip] *= -1
    ok = (ln[..., 0] > 0) & np.isfinite(n).all(-1)
    # на изломах (рёбра блоков, края) нормали врут — берём только гладкие места
    ok[1:-1, 1:-1] &= (n[1:-1, 1:-1] * n[1:-1, 2:]).sum(-1) > 0.95
    ok[1:-1, 1:-1] &= (n[1:-1, 1:-1] * n[2:, 1:-1]).sum(-1) > 0.95
    ok[[0, -1]] = False; ok[:, [0, -1]] = False
    return n, ok


def dominant_axis(N, exclude=None):
    """Самое частое направление (±n одно и то же) — голосованием по сфере, затем уточнение."""
    if exclude is not None:
        N = N[np.abs(N @ exclude) < 0.25]
    if len(N) < 50:
        return None
    rng = np.random.default_rng(1)
    cand = N[rng.choice(len(N), min(400, len(N)), replace=False)]
    sub = N[rng.choice(len(N), min(20000, len(N)), replace=False)]
    score = (np.abs(cand @ sub.T) > 0.97).sum(1)
    a = cand[score.argmax()]
    for _ in range(3):   # среднее по близким (с учётом знака)
        m = np.abs(sub @ a) > 0.95
        s = np.sign(sub[m] @ a)[:, None]
        a = (sub[m] * s).mean(0); a /= np.linalg.norm(a)
    return a


def manhattan(N):
    """Оси мира: три взаимно перпендикулярных главных направления; «верх» — ближайшее к верху камеры.
    Возвращает R (3×3): строки — оси X, Y(верх), Z мира в координатах камеры. Мир = R @ камера."""
    a1 = dominant_axis(N)
    if a1 is None:
        return np.eye(3)
    a2 = dominant_axis(N, exclude=a1)
    if a2 is None:
        a2 = np.cross(a1, [0, 0, 1.0]) if abs(a1[2]) < 0.9 else np.cross(a1, [1.0, 0, 0])
    a2 = a2 - a1 * (a2 @ a1); a2 /= np.linalg.norm(a2)
    a3 = np.cross(a1, a2)
    axes = [a1, a2, a3]
    up_i = int(np.argmax([abs(a[1]) for a in axes]))
    up = axes[up_i] * np.sign(axes[up_i][1])
    rest = [axes[i] for i in range(3) if i != up_i]
    # X мира — ближайшая к «вправо» камеры, Z = X × Y (правая тройка)
    xi = int(np.argmax([abs(a[0]) for a in rest]))
    x = rest[xi] * np.sign(rest[xi][0] or 1)
    z = np.cross(x, up)
    return np.stack([x, up, z])


def grid_fit(Wp, Wn, w8, s_lo, s_hi, n=500):
    """Размер блока и сдвиг сетки: координаты плоскостей, перпендикулярных оси, должны ложиться на k·s + o.
    Берём самый КРУПНЫЙ шаг с почти лучшей оценкой (у шага s/2, s/3… оценка такая же — это ловушка)."""
    S = np.exp(np.linspace(math.log(s_lo), math.log(s_hi), n))
    per_axis = []
    for ax in range(3):
        m = np.abs(Wn[:, ax]) > 0.9
        if m.sum() < 30:
            per_axis.append(None); continue
        c, wt = Wp[m, ax], w8[m]
        ph = np.exp(2j * np.pi * c[None, :] / S[:, None])
        R = np.abs((ph * wt).sum(1)) / wt.sum()
        per_axis.append((R, np.sqrt(m.sum()), c, wt))
    used = [x for x in per_axis if x is not None]
    if not used:
        return None, 0.0, [0, 0, 0]
    tot = sum(x[0] * x[1] for x in used) / sum(x[1] for x in used)
    best = tot.max()
    i = max(np.nonzero(tot >= best * 0.9)[0])
    s = float(S[i])
    offs = []
    for x in per_axis:
        if x is None:
            offs.append(0.0); continue
        _, _, c, wt = x
        ang = np.angle((np.exp(2j * np.pi * c / s) * wt).sum())
        offs.append(float(ang / (2 * np.pi) * s))
    return s, float(tot[i]), offs


def quat_from_matrix(M):
    """Кватернион (x, y, z, w) из матрицы поворота."""
    t = np.trace(M)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return [(M[2, 1] - M[1, 2]) / s, (M[0, 2] - M[2, 0]) / s, (M[1, 0] - M[0, 1]) / s, 0.25 * s]
    i = int(np.argmax(np.diag(M)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = math.sqrt(1.0 + M[i, i] - M[j, j] - M[k, k]) * 2
    q = [0.0, 0.0, 0.0, 0.0]
    q[i] = 0.25 * s
    q[j] = (M[j, i] + M[i, j]) / s
    q[k] = (M[k, i] + M[i, k]) / s
    q[3] = (M[k, j] - M[j, k]) / s
    return q


def mc_try(D, fov, k_range):
    P, z, f = points(D, fov, k_range)
    n, ok = normals(P)
    sky = D > 0.02
    m = ok & sky
    if m.sum() < 200:
        return None
    R = manhattan(n[m])
    sel = np.nonzero(m.ravel())[0]
    if len(sel) > 15000:            # для оценки сетки хватит выборки — так в разы быстрее
        sel = np.random.default_rng(7).choice(sel, 15000, replace=False)
    Pf, nf, zf = P.reshape(-1, 3)[sel], n.reshape(-1, 3)[sel], z.ravel()[sel]
    Wp = Pf @ R.T
    Wn = nf @ R.T
    w8 = 1.0 / zf                   # ближнее точнее — весит больше
    zm = float(np.median(z[sky]))
    s, score, offs = grid_fit(Wp, Wn, w8, zm / 400, zm / 2)
    return {"R": R, "s": s, "score": score, "offs": offs, "P": P, "n": n, "z": z, "f": f}


def minecraft_scene(rgb, D, fov=70.0, k_range=None, blocks=None, fill=True, max_side=640, min_pts=2):
    """blocks — сколько блоков от камеры до середины кадра (если автомат ошибся с размером блока)."""
    rgb, D = fit(rgb, D, max_side)
    h, w = D.shape
    best = None

    def attempt(K):
        nonlocal best
        t = mc_try(D, fov, K)
        if t and (best is None or t["score"] > best["score"]):
            best = {**t, "K": float(K)}
    if k_range:
        attempt(k_range)
    else:
        # оценка сетки резко лучше при верном диапазоне: грубо по степеням, потом дважды уточняем вокруг лучшего
        for K in [2, 3, 4, 5, 7, 10, 14, 20, 28, 40, 56, 80, 120]:
            attempt(K)
        for width in (0.35, 0.12, 0.04):
            if best is None:
                break
            for k in np.exp(np.linspace(-width, width, 9)) * best["K"]:
                attempt(max(1.05, float(k)))
    if best is None:
        raise ValueError("На картинке не нашлось плоскостей — это точно скриншот Minecraft?")
    R, P, n, z = best["R"], best["P"], best["n"], best["z"]
    s, offs = best["s"], best["offs"]
    if blocks:
        zc = float(np.median(z[h * 2 // 5:h * 3 // 5, w * 2 // 5:w * 3 // 5]))
        s = zc / float(blocks)
        sky = D > 0.02
        _, _, offs = grid_fit(P[sky] @ R.T, n[sky] @ R.T, 1 / z[sky], s * 0.999, s * 1.001, n=3)
    if not s:
        raise ValueError("Не получилось найти размер блока — задай «блоков до центра» руками")
    keep = D > 0.02
    W = P[keep] @ R.T
    Nw = n[keep] @ R.T
    W_in = W - Nw * s * 0.5                      # точка на грани → внутрь блока
    vox, col, cnt = voxelize(W_in, rgb.reshape(h, w, 3)[keep], s, origin=offs, min_pts=min_pts)
    # в единицах блока: 1 блок = 1 (как метр в игре)
    filled = 0
    if fill and len(vox):
        fv, fc = mc_fill(vox, col)
        if len(fv):
            vox = np.concatenate([vox, fv]); col = np.concatenate([col, fc]); filled = len(fv)
    ground = ground_level(vox)
    origin = [o / s for o in offs]
    head = {"v": 1, "kind": "minecraft", "size": 1.0, "origin": origin,
            "cam": {"pos": [0, 0, 0], "quat": quat_from_matrix(R), "fov": fov, "aspect": w / h},
            "ground": origin[1] + ground if ground is not None else None, "filled": int(filled),
            "params": {"fov": fov, "range": best["K"], "block": s, "fit": round(best["score"], 3)}}
    return head, vox, col


def mc_fill(vox, col, max_depth=48):
    """Досыпать столбцы вниз: под каждой видимой верхушкой — до земли соседних столбцов (5×5)."""
    have = {tuple(v) for v in vox.tolist()}
    cols = {}
    for (x, y, z) in vox.tolist():
        cols.setdefault((x, z), []).append(y)
    low = {k: min(v) for k, v in cols.items()}
    out_v, out_c = [], []
    for i, (x, y, z) in enumerate(vox.tolist()):
        if (x, y + 1, z) in have:           # не верхушка
            continue
        floor = min(low.get((x + dx, z + dz), y) for dx in range(-2, 3) for dz in range(-2, 3))
        c = (col[i].astype(np.float32) * 0.7).astype(np.uint8)
        for yy in range(y - 1, max(floor, y - max_depth) - 1, -1):
            if (x, yy, z) in have:
                break
            have.add((x, yy, z)); out_v.append((x, yy, z)); out_c.append(c)
    if not out_v:
        return np.zeros((0, 3), np.int32), np.zeros((0, 3), np.uint8)
    return np.array(out_v, np.int32), np.array(out_c, np.uint8)


def ground_level(vox):
    """Уровень земли: самая частая высота верхушек (верх блока = y + 1)."""
    if not len(vox):
        return None
    have = {tuple(v) for v in vox.tolist()}
    tops = [y + 1 for (x, y, z) in vox.tolist() if (x, y + 1, z) not in have]
    if not tops:
        return None
    vals, cnt = np.unique(tops, return_counts=True)
    return float(vals[cnt.argmax()])


# ======================= .nvx =======================

def write_nvx(path, head, vox, col):
    vox = np.asarray(vox, np.int64)
    if len(vox) and (vox.min() < -32000 or vox.max() > 32000):
        raise ValueError("сцена слишком большая для .nvx (координаты вне int16) — уменьши разрешение")
    head = {**head, "count": int(len(vox))}
    hb = json.dumps(head, ensure_ascii=False).encode()
    hb += b" " * ((-len(hb)) % 4)
    tmp = str(path) + ".tmp"
    with open(tmp, "wb") as f:
        f.write(b"NVX1" + struct.pack("<I", len(hb)) + hb)
        f.write(vox.astype("<i2").tobytes())
        f.write(np.asarray(col, np.uint8).tobytes())
    import os
    os.replace(tmp, path)
    return head


def read_nvx(path):
    b = open(path, "rb").read()
    assert b[:4] == b"NVX1"
    H = struct.unpack("<I", b[4:8])[0]
    head = json.loads(b[8:8 + H])
    n = head["count"]
    o = 8 + H
    vox = np.frombuffer(b[o:o + n * 6], "<i2").reshape(n, 3)
    col = np.frombuffer(b[o + n * 6:o + n * 9], np.uint8).reshape(n, 3)
    return head, vox, col
