#!/usr/bin/env python3
"""One-time, opt-in extraction of the app repositories with Git history.

Run from a clean main branch after the preparation PR is merged.
Requires git, git-filter-repo, and authenticated GitHub CLI (gh).
Never force-pushes, merges, deploys or modifies user data.
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

from materialize_modules import MODULES, ROOT, materialize, owns

OWNER = "ncojam"
BRANCH = "refactor/split-os-apps"


def cmd(*args, cwd=ROOT, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def git(*args, cwd=ROOT, capture=False):
    return cmd("git", *args, cwd=cwd, capture=capture)


def snapshot(cwd, ref="HEAD"):
    # Compare mode and blob SHA as well as path, including binary assets.
    return dict((path, meta) for meta, path in
                (entry.split("\t", 1) for entry in
                 git("ls-tree", "-r", "-z", ref, cwd=cwd, capture=True).split("\0") if entry))


def extract(name, patterns, source, temp, original):
    target = temp / name
    git("clone", "--no-local", "--single-branch", "--branch", "main",
        str(ROOT), str(target))
    if git("rev-parse", "HEAD", cwd=target, capture=True).strip() != source:
        raise RuntimeError("Source main changed during extraction")
    args = []
    for p in patterns:
        args.extend(("--path-glob" if "*" in p else "--path", p))
    git("filter-repo", "--force", *args, cwd=target)
    expected = {p: m for p, m in original.items() if owns(p, patterns)}
    if not expected or snapshot(target) != expected:
        raise RuntimeError(f"Filtered tree differs from original app files: {name}")
    return target, git("rev-parse", "HEAD", cwd=target, capture=True).strip()


def publish(name, target, sha):
    full = f"{OWNER}/{name}"
    url = f"https://github.com/{full}.git"
    check = subprocess.run(["gh", "repo", "view", full, "--json", "name"],
                           cwd=ROOT, stdout=subprocess.DEVNULL)
    if check.returncode:
        # The source repository is public; do not make a private repo public.
        cmd("gh", "repo", "create", full, "--public")
    refs = git("ls-remote", "--refs", url, capture=True).splitlines()
    if refs:
        if refs != [f"{sha}\trefs/heads/main"]:
            raise RuntimeError(f"{full} is not empty and does not match the extracted commit")
    else:
        git("push", url, "HEAD:refs/heads/main", cwd=target)
    return url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true",
                        help="create/push app repositories and stage a new integration branch")
    args = parser.parse_args()
    if git("status", "--porcelain", capture=True).strip():
        raise RuntimeError("Start with a clean working tree")
    if git("branch", "--show-current", capture=True).strip() != "main":
        raise RuntimeError("Run from main after merging the preparation PR")
    if (ROOT / "modules/.enabled").exists():
        raise RuntimeError("Modules already enabled")
    source = git("rev-parse", "HEAD", capture=True).strip()
    original = snapshot(ROOT)
    if args.publish:
        cmd("gh", "auth", "status")
        if subprocess.run(["git", "show-ref", "--verify", "--quiet",
                           f"refs/heads/{BRANCH}"], cwd=ROOT).returncode == 0:
            raise RuntimeError(f"Branch {BRANCH} already exists; inspect it first")
    with tempfile.TemporaryDirectory(prefix="nos-extract-") as tmp:
        extracted = {name: extract(name, patterns, source, Path(tmp), original)
                     for name, patterns in MODULES.items()}
        for name, (_, sha) in extracted.items():
            print(f"{name}: {sha}")
        if not args.publish:
            print("Dry run: filtered trees verified; no repositories or branches changed")
            return

        urls = {name: publish(name, target, sha)
                for name, (target, sha) in extracted.items()}
        git("switch", "-c", BRANCH)
        for name, patterns in MODULES.items():
            owned = [p for p in original if owns(p, patterns)]
            git("rm", "--", *owned)
            module = f"modules/{name}"
            git("submodule", "add", "--name", name, urls[name], module)
            git("checkout", "--detach", extracted[name][1], cwd=ROOT / module)
            git("add", module)
        with (ROOT / ".gitignore").open("a", encoding="utf-8") as f:
            f.write("\n# Generated app runtime files (source: modules/)\n")
            for patterns in MODULES.values():
                for p in patterns:
                    f.write("/" + p + "\n")
        (ROOT / "modules/.enabled").write_text("1\n", encoding="utf-8")
        git("add", ".gitignore", ".gitmodules", "modules/.enabled")
        materialize()
        # Verify the generated runtime files are byte-for-byte identical.
        for name, patterns in MODULES.items():
            for p, meta in original.items():
                if owns(p, patterns):
                    actual = git("hash-object", "--no-filters", p, capture=True).strip()
                    if actual != meta.split()[-1]:
                        raise RuntimeError(f"Generated file mismatch: {p}")
        git("diff", "--cached", "--stat")
        print("Integration staged; review, test, commit and open a PR. No deployment performed.")


if __name__ == "__main__":
    main()
