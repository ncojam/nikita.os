#!/usr/bin/env python3
"""
DAWN на сервере: общие проекты зарегистрированных пользователей и счётчик посещений.

Проекты — настоящие файлы <имя>.dawn в общем слое /ufs (UFS_ROOT/<папка>/<имя>.dawn), поэтому листинг
и /fs отдают их без особого кода. Владение — в UFS_ROOT/.meta/projects.json: {виртуальный путь: {uid, nick, size, t}}.
Правила:
  • сохранять может только вошедший через чат
  • ≤ MAX_PROJECTS проектов на пользователя, каждый ≤ MAX_BYTES
  • папка — любая существующая (канон /fs или пользовательская /ufs)
  • перезаписать или удалить можно только свой проект; имя, занятое чужим или каноном, — нельзя

Счётчик — DATA_DIR/visits.json: {app: {total, uniq: [хэши id посетителя]}}; id — случайная строка из браузера,
на сервере хранится только хэш.
"""
import hashlib
import json
import os
import re
import time
from pathlib import Path

MAX_PROJECTS = int(os.environ.get("NOS_DAWN_MAX_PROJECTS", "10"))
MAX_BYTES = int(os.environ.get("NOS_DAWN_MAX_BYTES", str(2 * 1024 * 1024)))
_BAD = re.compile(r"[/\\\x00]")


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class Projects:
    """real(v) — путь в /ufs (из Folders), dir_ok(v) / canon_has(v) считает server: он знает оба корня."""

    def __init__(self, ufs_root, user_of, real, dir_ok, canon_has):
        self.root = Path(ufs_root)
        self.user_of, self.real, self.dir_ok, self.canon_has = user_of, real, dir_ok, canon_has
        self.path = self.root / ".meta" / "projects.json"
        try:
            self.map = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.map = {}

    def mine(self, uid):
        return sorted(((v, e) for v, e in self.map.items() if e["uid"] == uid), key=lambda x: -x[1].get("t", 0))

    def save(self, request, vdir, name, data):
        u = self.user_of(request)
        if not u:
            return None, "login"
        uid, nick = u
        vdir = "/" + str(vdir or "").strip("/")
        name = _BAD.sub("", str(name or "")).strip().lstrip(".")[:64].strip()
        if not name:
            return None, "недопустимое имя"
        if not name.lower().endswith(".dawn"):
            name += ".dawn"
        raw = data.encode("utf-8") if isinstance(data, str) else b""
        if len(raw) > MAX_BYTES:
            return None, f"проект больше {MAX_BYTES // (1024 * 1024)} МБ"
        try:
            if json.loads(raw).get("format") != "dawn/2":
                return None, "это не проект DAWN"
        except (ValueError, AttributeError):
            return None, "это не проект DAWN"
        if not self.dir_ok(vdir):
            return None, "такой папки нет"
        v = (vdir.rstrip("/") + "/" + name)
        if self.canon_has(v):
            return None, "здесь уже есть такой файл"
        own = self.map.get(v)
        p = self.real(v)
        if p is None:
            return None, "недопустимый путь"
        if own and own["uid"] != uid:
            return None, "это имя занято чужим проектом"
        if not own and p.exists():
            return None, "здесь уже есть такой файл"
        if not own and len(self.mine(uid)) >= MAX_PROJECTS:
            return None, f"лимит — {MAX_PROJECTS} проектов; удали старый"
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name("." + p.name + ".tmp")
            tmp.write_bytes(raw)
            os.replace(tmp, p)
        except OSError:
            return None, "не удалось сохранить"
        self.map[v] = {"uid": uid, "nick": nick, "size": len(raw), "t": int(time.time())}
        _write_json(self.path, self.map)
        return v, None

    def delete(self, request, v):
        u = self.user_of(request)
        e = self.map.get(v)
        if not e:
            return "это не общий проект"
        if not u or u[0] != e["uid"]:
            return "удалить может только автор"
        p = self.real(v)
        try:
            if p and p.is_file():
                p.unlink()
        except OSError:
            return "не удалось удалить"
        self.map.pop(v, None)
        _write_json(self.path, self.map)
        return None


class Visits:
    def __init__(self, path):
        self.path = Path(path)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = {}
        self.data = {k: {"total": int(v.get("total", 0)), "uniq": set(v.get("uniq", []))} for k, v in raw.items()}
        self.dirty = False

    def hit(self, app, vid):
        d = self.data.setdefault(app, {"total": 0, "uniq": set()})
        d["total"] += 1
        if vid:
            d["uniq"].add(hashlib.sha256(("nos:" + vid).encode()).hexdigest()[:16])
        self.dirty = True
        return self.get(app)

    def get(self, app):
        d = self.data.get(app) or {"total": 0, "uniq": set()}
        return {"total": d["total"], "unique": len(d["uniq"])}

    def flush(self):
        if not self.dirty:
            return
        try:
            _write_json(self.path, {k: {"total": v["total"], "uniq": sorted(v["uniq"])} for k, v in self.data.items()})
            self.dirty = False
        except OSError:
            pass
