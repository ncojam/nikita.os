#!/usr/bin/env python3
"""
Пользовательские папки nikita.os — общий серверный слой /ufs (user file system).

Папки создаются реальными каталогами под UFS_ROOT по тому же пути, что видят приложения
(напр. виртуальная «/home/nikita/Котики» -> UFS_ROOT/home/nikita/Котики). Сервер сшивает
/fs (канон, read-only) и /ufs в один вид — приложениям разницы нет (см. server.py).

Правила (общий слой):
  • ≤ MAX_PER_USER папок на пользователя во всей ФС
  • ≤ MAX_SUB пользовательских подпапок внутри любой папки
  • глубина пути ≤ MAX_DEPTH
  • удаляет только автор; удаление уносит ВСЁ внутри (включая чужие записи и подпапки)
  • перемещать нельзя (в общем слое перемещения вообще нет в этой фазе)

Владение — в UFS_ROOT/folders.json: {виртуальный путь: {uid, nick, created}}.
"""
import json
import os
import re
import shutil
import time
from pathlib import Path

MAX_PER_USER = int(os.environ.get("NOS_UFS_MAX_FOLDERS", "2"))
MAX_DEPTH = int(os.environ.get("NOS_UFS_MAX_DEPTH", "5"))
MAX_SUB = int(os.environ.get("NOS_UFS_MAX_SUB", "1"))

_BAD = re.compile(r"[/\\\x00]")


def clean_name(s):
    s = _BAD.sub("", str(s or "").strip()).lstrip(".").strip()
    return s[:48].strip()


def norm(v):
    return "/" + str(v or "/").strip("/")


def depth_of(v):
    return len([p for p in v.split("/") if p])


class Folders:
    """user_of(request) -> (uid, nick) | None. purge_dir(vprefix) сносит записи внутри (из posts)."""

    def __init__(self, ufs_root, user_of, purge_dir=None):
        self.root = Path(ufs_root)           # каталоги папок — здесь (отдаются в веб)
        self.user_of = user_of
        self.purge_dir = purge_dir           # колбэк: удалить записи в поддереве
        self.meta = self.root / ".meta"      # индекс владения — в закрытом .meta
        self.path = self.meta / "folders.json"
        self.map = {}                        # vpath -> {uid, nick, created}
        self._migrate()                      # забрать folders.json из прежнего (отдававшегося) места
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            self.map = {k: v for k, v in raw.items() if isinstance(v, dict) and "uid" in v}
        except (OSError, ValueError):
            pass

    def _migrate(self):
        old = self.root / "folders.json"
        try:
            self.meta.mkdir(parents=True, exist_ok=True)
            if old.is_file() and not self.path.exists():
                shutil.move(str(old), str(self.path))
        except OSError:
            pass

    # ---------- диск ----------
    def save(self):
        try:
            self.meta.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.map, ensure_ascii=False, indent=1), encoding="utf-8")
            os.replace(tmp, self.path)
        except OSError:
            pass

    def real(self, v):
        """Путь на диске под UFS_ROOT. None — попытка выйти наружу или скрытый сегмент."""
        rel = norm(v).strip("/")
        if "\x00" in rel:
            return None
        p = (self.root / rel).resolve() if rel else self.root
        if p != self.root and self.root not in p.parents:
            return None
        if any(part.startswith(".") for part in p.relative_to(self.root).parts):
            return None
        return p

    # ---------- чтение ----------
    def is_user_folder(self, v):
        return norm(v) in self.map

    def owner(self, v):
        e = self.map.get(norm(v))
        return e["uid"] if e else None

    def children_names(self, vdir):
        """Имена пользовательских папок, физически лежащих прямо в vdir (для union-листинга)."""
        p = self.real(vdir)
        out = []
        if p and p.is_dir():
            try:
                for c in p.iterdir():
                    if c.is_dir() and not c.name.startswith("."):
                        out.append(c.name)
            except OSError:
                pass
        return out

    def dir_exists(self, v):
        p = self.real(v)
        return bool(p and p.is_dir())

    def entry_exists(self, v):
        p = self.real(v)
        return bool(p and p.exists())

    def _count_user(self, uid):
        return sum(1 for e in self.map.values() if e["uid"] == uid)

    def _sub_user_count(self, vdir):
        pref = norm(vdir).rstrip("/") + "/"
        return sum(1 for p in self.map if p.startswith(pref) and "/" not in p[len(pref):])

    # ---------- запись ----------
    def create(self, request, parent, name, parent_exists, name_taken):
        """parent_exists/name_taken считает server (он знает оба корня)."""
        u = self.user_of(request)
        if not u:
            return None, "нужно войти в чат"
        uid, nick = u
        parent = norm(parent)
        if not parent_exists:
            return None, "папки-родителя нет"
        nm = clean_name(name)
        if not nm:
            return None, "недопустимое имя"
        v = norm(parent.rstrip("/") + "/" + nm)
        if depth_of(v) > MAX_DEPTH:
            return None, f"слишком глубоко — не глубже {MAX_DEPTH} уровней"
        if name_taken or v in self.map:
            return None, "здесь уже есть такое имя"
        if self._sub_user_count(parent) >= MAX_SUB:
            return None, "в этой папке уже есть пользовательская подпапка"
        if self._count_user(uid) >= MAX_PER_USER:
            return None, f"лимит — {MAX_PER_USER} папки на пользователя"
        p = self.real(v)
        if p is None:
            return None, "недопустимый путь"
        try:
            p.mkdir(parents=True, exist_ok=False)
        except FileExistsError:
            return None, "здесь уже есть такое имя"
        except OSError:
            return None, "не удалось создать папку"
        self.map[v] = {"uid": uid, "nick": nick, "created": int(time.time())}
        self.save()
        return v, None

    def delete(self, request, v):
        u = self.user_of(request)
        v = norm(v)
        e = self.map.get(v)
        if not e:
            return "это не пользовательская папка"
        if not u or u[0] != e["uid"]:
            return "удалить может только автор папки"
        # сносим записи во всём поддереве (колбэк в posts), затем сам каталог и записи владения
        if self.purge_dir:
            try:
                self.purge_dir(v)
            except Exception:
                pass
        p = self.real(v)
        if p and p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        pref = v.rstrip("/") + "/"
        for key in [k for k in self.map if k == v or k.startswith(pref)]:
            self.map.pop(key, None)
        self.save()
        return None

    def admin_list(self):
        return sorted(({"path": k, **v} for k, v in self.map.items()), key=lambda r: r["path"])
