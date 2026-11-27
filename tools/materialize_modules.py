#!/usr/bin/env python3
"""Materialize pinned app checkouts at their original runtime paths.

Before migration, modules/.enabled does not exist and this is a no-op.
The source of truth after migration is modules/<app>, not generated copies.
"""
import fnmatch
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = json.loads((ROOT / "modules" / "layout.json").read_text(encoding="utf-8"))
REQUIRED = {
    "dawn.os": ("dawnstore.py", "public/js/apps/dawn/index.js", "public/js/apps/dawn/graph.js"),
    "kana.os": ("kana_progress.py", "prepare_kana_tts.py", "public/js/apps/kana.js"),
    "clown-dungeon.os": ("dungeon.py", "public/dungeon.html", "public/js/apps/dungeon/music.js"),
}


def owns(path, patterns):
    return any(path.startswith(p) if p.endswith("/") else fnmatch.fnmatchcase(path, p)
               for p in patterns)


def selected(root, patterns):
    """Enumerate only app-owned paths, never .git or Python bytecode."""
    result = {}
    for pattern in patterns:
        if pattern.endswith("/"):
            candidates = (root / pattern).rglob("*")
        elif "*" in pattern:
            candidates = root.glob(pattern)
        else:
            candidates = (root / pattern,)
        for p in candidates:
            rel = p.relative_to(root)
            if any(part in (".git", "__pycache__") for part in rel.parts) or p.suffix == ".pyc":
                continue
            if p.is_symlink() or any(parent.is_symlink() for parent in p.parents if parent != root and root in parent.parents):
                raise RuntimeError(f"Symlinks not supported in app files: {p}")
            if p.is_file():
                result[rel.as_posix()] = p
    return result


def materialize(root=ROOT):
    if not (root / "modules/.enabled").is_file():
        return False

    # Check every checkout before touching any existing runtime file.
    sources = {}
    for name, patterns in MODULES.items():
        checkout = root / "modules" / name
        entries = selected(checkout, patterns)
        missing = set(REQUIRED[name]) - entries.keys()
        if missing:
            raise RuntimeError(f"{name}: missing {', '.join(sorted(missing))}; "
                               "run git submodule update --init --recursive")
        overlap = sources.keys() & entries.keys()
        if overlap:
            raise RuntimeError(f"Overlapping app files: {overlap}")
        sources.update(entries)

    old = {}
    for patterns in MODULES.values():
        old.update(selected(root, patterns))

    # Do not let a module delete unrelated OS files. Only its reserved paths
    # are generated, and all checkouts have already been validated.
    for rel, src in sorted(sources.items()):
        dest = root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.is_symlink() or any(p.is_symlink() for p in dest.parents if p != root and root in p.parents):
            raise RuntimeError(f"Unsafe runtime path: {dest}")
        shutil.copy2(src, dest)
    for rel in old.keys() - sources.keys():
        old[rel].unlink()
    return True


if __name__ == "__main__":
    if materialize():
        print("App modules materialized")
