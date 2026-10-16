#!/usr/bin/env python3
"""
Записи («твиты») nikita.os — общий серверный слой поверх файловой системы.

Каждая запись — это виртуальный файл «Имя.запись» в какой-то папке fs: на диске его нет,
сервер подмешивает его в /api/ls и отдаёт его JSON по /fs/<путь>. Картинка к записи
(одна, уже сжатая браузером) лежит отдельным файлом и отдаётся по /media/<id>.

Хранилище — в NOS_DATA (писучий том), рядом со счётчиками:
  posts.json      — индекс записей {id: {...}}
  media/<id>.jpg  — сжатые картинки

Авторство: создавать может любой вошедший в чат; править текст и менять картинку —
только автор; удалять запись — только автор. Перемещения и ярлыки — это Фаза 2.

Защита: картинку валидируем, не декодируя (магия JPEG + потолок размера + размеры из
заголовка SOF ≤ 256×256). Есть общий потолок хранилища (GC по старшинству) и потолок
записей на пользователя, плюс анти-спам по частоте создания.
"""
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path

# ---- лимиты (можно переопределить переменными окружения) ----
TEXT_MAX = int(os.environ.get("NOS_POST_TEXT_MAX", "560"))          # длина текста записи
IMG_MAX_BYTES = int(os.environ.get("NOS_POST_IMG_MAX", str(64 * 1024)))  # потолок размера картинки
IMG_MAX_DIM = int(os.environ.get("NOS_POST_IMG_DIM", "256"))        # сторона картинки, px
STORE_CAP = int(os.environ.get("NOS_POST_STORE_CAP", str(200 * 1024 * 1024)))  # весь склад картинок
PER_USER_MAX = int(os.environ.get("NOS_POST_PER_USER", "60"))       # записей на пользователя
CREATE_EVERY = float(os.environ.get("NOS_POST_CREATE_EVERY", "5"))  # не чаще раза в N секунд на пользователя
REPORT_HIDE = int(os.environ.get("NOS_POST_REPORT_HIDE", "2"))      # сколько РАЗНЫХ жалобщиков прячут картинку
NAME_SUFFIX = ".запись"

_BAD = re.compile(r"[/\\\x00]")
# тот же набор управляющих/невидимых символов, что чистит чат
_CTRL = re.compile(r"[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁯﻿]")


def clean_text(s):
    s = _CTRL.sub("", str(s or "").replace("\r\n", "\n").replace("\r", "\n"))
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[:TEXT_MAX]


def clean_name(s):
    """Имя файла записи без расширения: без слэшей, нулей, ведущей точки."""
    s = _BAD.sub("", str(s or "").strip()).lstrip(".").strip()
    s = s[:80].strip() or "Запись"
    return s


def jpeg_dims(data):
    """Ширина и высота JPEG из заголовка (маркер SOF), без декодирования. None — не JPEG/битый."""
    n = len(data)
    if n < 4 or data[0] != 0xFF or data[1] != 0xD8:
        return None
    i = 2
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        # маркеры без длины: padding (FF), RSTn, SOI/EOI, TEM
        if marker in (0xFF, 0x01) or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        if i + 3 >= n:
            break
        seglen = (data[i + 2] << 8) | data[i + 3]
        if seglen < 2:
            return None
        # SOF0..SOF15, кроме DHT(C4)/JPG(C8)/DAC(CC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if i + 9 >= n:
                return None
            h = (data[i + 5] << 8) | data[i + 6]
            w = (data[i + 7] << 8) | data[i + 8]
            return (w, h)
        i += 2 + seglen
    return None


def validate_jpeg(data):
    """Возвращает None если ок, иначе строку-причину отказа."""
    if len(data) > IMG_MAX_BYTES:
        return f"картинка больше {IMG_MAX_BYTES // 1024} КБ — сожмите сильнее"
    if data[:3] != b"\xff\xd8\xff":
        return "это не JPEG"
    dims = jpeg_dims(data)
    if not dims:
        return "битый JPEG"
    w, h = dims
    if w < 1 or h < 1 or w > IMG_MAX_DIM or h > IMG_MAX_DIM:
        return f"картинка должна быть не больше {IMG_MAX_DIM}×{IMG_MAX_DIM}"
    return None


class Posts:
    """Хранилище записей. user_of(request) -> (uid, nick) | None (берём из chat.user_by_token)."""

    def __init__(self, data_dir, user_of, client_ip=None):
        self.data_dir = Path(data_dir)
        self.media = self.data_dir / "media"
        self.path = self.data_dir / "posts.json"
        self.user_of = user_of
        self.client_ip = client_ip     # request -> ip (из server.client_ip)
        self.posts = {}
        self.rate = {}   # uid -> время последнего создания
        self.dirty = False
        self.salt = self._load_salt()  # для хэша IP при модерации — переживает перезапуск
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.posts = {k: v for k, v in raw.get("posts", {}).items() if isinstance(v, dict)}
        except (FileNotFoundError, ValueError, OSError):
            pass

    def _load_salt(self):
        sp = self.data_dir / "mod_salt"
        try:
            salt = bytes.fromhex(sp.read_text().strip())
            if len(salt) == 16:
                return salt
        except (OSError, ValueError):
            pass
        salt = secrets.token_bytes(16)
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            sp.write_text(salt.hex())
        except OSError:
            pass
        return salt

    def iphash(self, request):
        """Солёный хэш адреса загрузившего — для модерации, без хранения самого IP."""
        if not self.client_ip:
            return ""
        try:
            return hashlib.blake2s(self.client_ip(request).encode(), key=self.salt, digest_size=12).hexdigest()
        except Exception:
            return ""

    # ---------- диск ----------
    def save(self):
        if not self.dirty:
            return
        self.dirty = False
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"posts": self.posts}, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            self.dirty = True

    def media_path(self, pid):
        return self.media / (pid + ".jpg")

    def store_size(self):
        total = 0
        try:
            for f in self.media.glob("*.jpg"):
                try:
                    total += f.stat().st_size
                except OSError:
                    pass
        except OSError:
            pass
        return total

    # ---------- чтение ----------
    def vpath(self, p):
        d = p["dir"].rstrip("/")
        return (d + "/" + p["name"]) if d else "/" + p["name"]

    def public(self, pid, p):
        return {"id": pid, "author": p["nick"], "text": p.get("text", ""),
                "img": bool(p.get("img")), "img_hidden": bool(p.get("hidden")),
                "created": p.get("created", 0), "edited": p.get("edited", 0)}

    def in_dir(self, vdir):
        """Записи в папке vdir -> список entry для /api/ls."""
        vdir = "/" + vdir.strip("/")
        out = []
        for pid, p in self.posts.items():
            if ("/" + p["dir"].strip("/")) == vdir:
                out.append({"name": p["name"], "type": "file", "size": self._size(pid, p),
                            "mtime": p.get("edited") or p.get("created", 0), "post": True})
        return out

    def by_vpath(self, vpath):
        """Найти (id, post) по виртуальному пути файла записи, или (None, None)."""
        vpath = "/" + vpath.strip("/")
        for pid, p in self.posts.items():
            if self.vpath(p) == vpath:
                return pid, p
        return None, None

    def _size(self, pid, p):
        # «размер файла» записи — длина её JSON-представления, чтобы в свойствах было осмысленно
        return len(json.dumps(self.public(pid, p), ensure_ascii=False).encode())

    def file_json(self, pid, p):
        """Содержимое виртуального файла .запись (его читает приложение-карточка)."""
        return json.dumps(self.public(pid, p), ensure_ascii=False).encode()

    # ---------- запись ----------
    def _taken_names(self, vdir):
        vdir = "/" + vdir.strip("/")
        return {p["name"] for p in self.posts.values() if ("/" + p["dir"].strip("/")) == vdir}

    def _free_name(self, vdir, base):
        name = base + NAME_SUFFIX
        taken = self._taken_names(vdir)
        if name not in taken:
            return name
        for i in range(2, 10000):
            cand = f"{base} ({i}){NAME_SUFFIX}"
            if cand not in taken:
                return cand
        return base + "-" + secrets.token_hex(3) + NAME_SUFFIX

    def create(self, request, vdir, base, text):
        u = self.user_of(request)
        if not u:
            return None, "нужно войти в чат"
        uid, nick = u
        now = time.time()
        last = self.rate.get(uid, 0)
        if now - last < CREATE_EVERY:
            return None, "слишком часто — подождите пару секунд"
        vdir = "/" + str(vdir or "/").strip("/")
        name = self._free_name(vdir, clean_name(base))
        pid = secrets.token_urlsafe(9)
        self.posts[pid] = {"dir": vdir, "name": name, "uid": uid, "nick": nick,
                           "text": clean_text(text), "img": False,
                           "created": int(now), "edited": int(now)}
        self.rate[uid] = now
        self.dirty = True
        self._enforce_user_cap(uid)
        self.save()
        return pid, None

    def edit(self, request, pid, text):
        u = self.user_of(request)
        p = self.posts.get(pid)
        if not p:
            return "запись не найдена"
        if not u or u[0] != p["uid"]:
            return "менять текст может только автор"
        p["text"] = clean_text(text)
        p["edited"] = int(time.time())
        self.dirty = True
        self.save()
        return None

    def set_image(self, request, pid, data):
        u = self.user_of(request)
        p = self.posts.get(pid)
        if not p:
            return "запись не найдена"
        if not u or u[0] != p["uid"]:
            return "менять картинку может только автор"
        err = validate_jpeg(data)
        if err:
            return err
        try:
            self.media.mkdir(parents=True, exist_ok=True)
            tmp = self.media_path(pid).with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, self.media_path(pid))
        except OSError:
            return "не удалось сохранить картинку"
        p["img"] = True
        p["iphash"] = self.iphash(request)   # для модерации: чей это адрес (хэш)
        p["edited"] = int(time.time())
        self.dirty = True
        self._enforce_store_cap()
        self.save()
        return None

    def drop_image(self, request, pid):
        u = self.user_of(request)
        p = self.posts.get(pid)
        if not p:
            return "запись не найдена"
        if not u or u[0] != p["uid"]:
            return "только автор"
        self._rm_media(pid)
        p["img"] = False
        p["edited"] = int(time.time())
        self.dirty = True
        self.save()
        return None

    def delete(self, request, pid):
        u = self.user_of(request)
        p = self.posts.get(pid)
        if not p:
            return "запись не найдена"
        if not u or u[0] != p["uid"]:
            return "удалить может только автор"
        self._rm_media(pid)
        del self.posts[pid]
        self.dirty = True
        self.save()
        return None

    # ---------- модерация ----------
    def _report_count(self, p):
        # число РАЗНЫХ жалобщиков, кроме самого автора (чтобы нельзя было накрутить на себе)
        return len([u for u in p.get("reports", {}) if u != str(p["uid"])])

    def is_hidden(self, pid):
        p = self.posts.get(pid)
        return bool(p and p.get("hidden"))

    def report(self, request, pid):
        u = self.user_of(request)
        if not u:
            return None, "войдите в чат, чтобы пожаловаться"
        p = self.posts.get(pid)
        if not p or not p.get("img"):
            return None, "жаловаться не на что"
        uid = u[0]
        if uid != p["uid"]:   # на свою запись жаловаться бессмысленно — просто игнорируем
            p.setdefault("reports", {})[str(uid)] = int(time.time())
        cnt = self._report_count(p)
        if cnt >= REPORT_HIDE and not p.get("hidden"):
            p["hidden"] = True   # прячем картинку до решения админа
        self.dirty = True
        self.save()
        return {"hidden": bool(p.get("hidden")), "count": cnt}, None

    def admin_list(self):
        """Записи с жалобами — для ревью. Сначала самые «горячие»."""
        out = []
        for pid, p in self.posts.items():
            reps = p.get("reports")
            if not reps:
                continue
            out.append({"id": pid, "dir": p["dir"], "name": p["name"],
                        "author": p["nick"], "uid": p["uid"], "iphash": p.get("iphash", ""),
                        "text": p.get("text", ""), "img": bool(p.get("img")),
                        "hidden": bool(p.get("hidden")), "count": self._report_count(p),
                        "reported_at": sorted(int(t) for t in reps.values()),
                        "created": p.get("created", 0)})
        out.sort(key=lambda r: (-r["count"], -r["created"]))
        return out

    def admin_set_hidden(self, pid, hidden):
        """Админ: вернуть картинку или оставить скрытой. Жалобы не трогаем."""
        p = self.posts.get(pid)
        if not p:
            return "нет такой записи"
        p["hidden"] = bool(hidden)
        self.dirty = True
        self.save()
        return None

    # ---------- уборка ----------
    def _rm_media(self, pid):
        try:
            self.media_path(pid).unlink()
        except OSError:
            pass

    def _enforce_user_cap(self, uid):
        mine = sorted((p.get("created", 0), pid) for pid, p in self.posts.items() if p["uid"] == uid)
        while len(mine) > PER_USER_MAX:
            _, pid = mine.pop(0)
            self._rm_media(pid)
            self.posts.pop(pid, None)

    def _enforce_store_cap(self):
        # пока склад картинок больше потолка — сносим самые старые записты с картинками
        if self.store_size() <= STORE_CAP:
            return
        with_img = sorted((p.get("created", 0), pid) for pid, p in self.posts.items() if p.get("img"))
        for _, pid in with_img:
            if self.store_size() <= STORE_CAP:
                break
            self._rm_media(pid)
            self.posts.pop(pid, None)
            self.dirty = True
