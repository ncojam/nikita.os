"""Общий счётчик посещений приложений nikita.os."""
import hashlib
import json
import os
from pathlib import Path


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


VISITS_UNIQ_MAX = int(os.environ.get("NOS_VISITS_UNIQ_MAX", "200000"))
VISITS_APPS_MAX = 64   # разных app в счётчике


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
        if app not in self.data and len(self.data) >= VISITS_APPS_MAX:
            return self.get(app)
        d = self.data.setdefault(app, {"total": 0, "uniq": set()})
        d["total"] += 1
        if vid and len(d["uniq"]) < VISITS_UNIQ_MAX:   # потолок, чтобы файл не раздували случайными id
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
