#!/usr/bin/env python3
"""Download the pinned browser-only Open JTalk assets. No npm install or build."""
import base64
import hashlib
import pathlib
import shutil
import sys
import tarfile
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
DEST = ROOT / "public" / "vendor" / "openjtalk-v1"
PACKAGE = "https://registry.npmjs.org/@keanu-thakalath/openjtalkjs/-/openjtalkjs-0.1.0.tgz"
PACKAGE_SHA512 = "Mud5msXc83++jes/DDDz4huDuo/KH5TeTwy4LhLKdSahdAwwCZ9CVu8KL2Kp7MOJBNR755R4vW4mpFaFEfUgKg=="
DIC = "open_jtalk_dic_utf_8-1.11.tar.gz"
DIC_URL = "https://downloads.sourceforge.net/project/open-jtalk/Dictionary/open_jtalk_dic-1.11/" + DIC
DIC_SHA256 = "33e9cd251bc41aa2bd7ca36f57abbf61eae3543ca25ca892ae345e394cb10549"
VOICE_URL = "https://raw.githubusercontent.com/r9y9/pyopenjtalk/9029fbc9c4ba323f113343d893d72ed76a67d77c/pyopenjtalk/htsvoice/mei_normal.htsvoice"
VOICE_SHA256 = "f3be49a6838904a6c218790b64e07c3e83c1886e995dca284b413caab19184de"
WRAPPER = "openjtalk-wasm-wrapper-D6E3BSJO.js"
RUNTIME = ("browser.js", "browser/worker.js", WRAPPER, "openjtalk-wasm.wasm")
REQUIRED = (*RUNTIME, DIC, "mei_normal.htsvoice", "LICENSE.openjtalkjs", "LICENSE.dictionary", "NOTICE.txt")


def download(url, target, algorithm, expected):
    print("  Open JTalk: " + target.name, flush=True)
    h = hashlib.new(algorithm)
    req = urllib.request.Request(url, headers={"User-Agent": "nikita.os-kana/1"})
    with urllib.request.urlopen(req, timeout=30) as response, target.open("wb") as out:
        total = 0
        while chunk := response.read(256 * 1024):
            total += len(chunk)
            if total > 150 * 1024 * 1024:
                raise ValueError("Unexpectedly large download: " + target.name)
            h.update(chunk)
            out.write(chunk)
    actual = base64.b64encode(h.digest()).decode() if algorithm == "sha512" else h.hexdigest()
    if actual != expected:
        raise ValueError("Checksum mismatch: " + target.name)


def copy_member(archive, member, dest):
    if not member.isfile():
        raise ValueError("Not a regular file: " + member.name)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with archive.extractfile(member) as src, dest.open("wb") as out:
        shutil.copyfileobj(src, out)


def install():
    if (DEST / ".ready").is_file() and all((DEST / name).is_file() and (DEST / name).stat().st_size for name in REQUIRED):
        return
    DEST.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="kana-tts-", dir=ROOT) as temp:
        temp = pathlib.Path(temp)
        stage = temp / "assets"
        stage.mkdir()
        package = temp / "openjtalkjs.tgz"
        download(PACKAGE, package, "sha512", PACKAGE_SHA512)
        with tarfile.open(package, "r:gz") as archive:
            members = {m.name: m for m in archive.getmembers() if m.isfile()}
            prefixes = [name[:-len(WRAPPER)] for name in members if name.endswith("/" + WRAPPER)]
            valid = [p for p in prefixes if all(p + name in members for name in RUNTIME)]
            if len(valid) != 1:
                raise ValueError("Browser build not found in pinned npm package")
            for name in RUNTIME:
                copy_member(archive, members[valid[0] + name], stage / name)
            license_files = [m for name, m in members.items()
                             if name.lower() in ("package/license", "package/license.md", "package/license.txt")]
            if len(license_files) != 1:
                raise ValueError("Package license not found")
            copy_member(archive, license_files[0], stage / "LICENSE.openjtalkjs")
            # Preserve other bundled third-party notices when present.
            for index, (name, m) in enumerate(members.items()):
                if name != license_files[0].name and pathlib.PurePosixPath(name).name.lower().startswith(("license", "copying", "notice", "third_party", "third-party")):
                    copy_member(archive, m, stage / "licenses" / (str(index) + "-" + pathlib.PurePosixPath(name).name))
        download(DIC_URL, stage / DIC, "sha256", DIC_SHA256)
        with tarfile.open(stage / DIC, "r:gz") as archive:
            licenses = [m for m in archive.getmembers() if m.isfile() and pathlib.PurePosixPath(m.name).name == "COPYING"]
            if len(licenses) != 1:
                raise ValueError("Dictionary COPYING not found")
            copy_member(archive, licenses[0], stage / "LICENSE.dictionary")
        download(VOICE_URL, stage / "mei_normal.htsvoice", "sha256", VOICE_SHA256)
        (stage / "NOTICE.txt").write_text(
            "Open JTalk browser runtime: @keanu-thakalath/openjtalkjs 0.1.0 (BSD-3-Clause).\n"
            "https://www.npmjs.com/package/@keanu-thakalath/openjtalkjs\n"
            "Open JTalk dictionary 1.11: see LICENSE.dictionary.\n"
            "https://open-jtalk.sourceforge.net/\n"
            "Mei normal HTS voice (unmodified), Copyright (c) 2009-2013 Nagoya Institute of Technology / MMDAgent Project.\n"
            "Creative Commons Attribution 3.0: https://creativecommons.org/licenses/by/3.0/\n"
            "http://www.mmdagent.jp/\n"
            "Source: " + VOICE_URL + "\n", encoding="utf-8")
        (stage / ".ready").write_text("v1\n", encoding="utf-8")
        if DEST.exists():
            shutil.rmtree(DEST)
        stage.rename(DEST)
    print("  Open JTalk: browser assets ready", flush=True)


if __name__ == "__main__":
    try:
        install()
    except Exception as exc:
        print("Open JTalk: " + str(exc), file=sys.stderr)
        sys.exit(1)
