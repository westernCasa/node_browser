#!/usr/bin/env python3
"""Checks that NODE's Chromium patches apply, without the full source tree.

Downloads only the Chromium files that browser/patches touches (at the
version in base.env), applies ungoogled-chromium's patches to those files
first, then NODE's patches in series order, the same way the real build does
(patch -p1 --ignore-whitespace --forward). Runs in a few seconds; use it after
changing a patch or moving base.env to a new Chromium version.

    python3 browser/check_patches.py            uses browser/work if present
    python3 browser/check_patches.py --keep DIR  leave the patched files in DIR
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = "https://raw.githubusercontent.com/chromium/chromium/{version}/{path}"


def read_env():
    env = {}
    for line in (HERE / "base.env").read_text().splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env


def touched(patch_text):
    return [m.group(1) for m in re.finditer(r"^\+\+\+ b/(\S+)", patch_text, re.M)]


def split_by_file(patch_text):
    parts = re.split(r"(?m)^(?=diff --git |--- a/)", patch_text)
    out = {}
    for part in parts:
        m = re.search(r"^\+\+\+ b/(\S+)", part, re.M)
        if m:
            out.setdefault(m.group(1), []).append(part)
    return out


def apply(text, tree, label):
    r = subprocess.run(["patch", "-p1", "--ignore-whitespace", "--forward", "--no-backup-if-mismatch", "-d", str(tree)],
                       input=text, text=True, capture_output=True)
    print(("ok   " if r.returncode == 0 else "FAIL ") + label)
    if r.returncode != 0:
        print(r.stdout + r.stderr)
    return r.returncode == 0


def ungoogled_checkout(env, scratch):
    local = HERE / "work" / "ungoogled-chromium-macos"
    if (local / "ungoogled-chromium" / "patches").is_dir():
        return local
    dest = scratch / "ungoogled-chromium-macos"
    subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", env["UNGOOGLED_MACOS_TAG"],
                    "--recurse-submodules", "--shallow-submodules",
                    "https://github.com/ungoogled-software/ungoogled-chromium-macos.git", str(dest)], check=True)
    return dest


def series(patch_dir):
    lines = (patch_dir / "series").read_text().splitlines()
    return [patch_dir / l.strip() for l in lines if l.strip() and not l.startswith("#")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=Path, help="folder to keep the patched files in")
    args = ap.parse_args()
    env = read_env()
    scratch = Path(tempfile.mkdtemp(prefix="node-patches-"))
    tree = args.keep or scratch / "src"
    if tree.exists():
        shutil.rmtree(tree)
    node_patches = series(HERE / "patches")
    files = sorted({f for p in node_patches for f in touched(p.read_text())})
    new_files = {f for p in node_patches for f in re.findall(r"^--- /dev/null\n\+\+\+ b/(\S+)", p.read_text(), re.M)}

    print(f"Chromium {env['CHROMIUM_VERSION']}: fetching {len(files)} files")
    for f in files:
        if f in new_files:
            continue
        dest = tree / f
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(RAW.format(version=env["CHROMIUM_VERSION"], path=f)) as r:
            dest.write_bytes(r.read())

    ugm = ungoogled_checkout(env, scratch)
    ok = True
    for patch_dir in (ugm / "ungoogled-chromium" / "patches", ugm / "patches"):
        for p in series(patch_dir):
            by_file = split_by_file(p.read_text(errors="replace"))
            relevant = [h for f in files for h in by_file.get(f, [])]
            if relevant:
                ok &= apply("".join(relevant), tree, f"ungoogled: {p.name} ({', '.join(f for f in files if f in by_file)})")
    for p in node_patches:
        ok &= apply(p.read_text(), tree, f"NODE: {p.name}")

    if not args.keep:
        shutil.rmtree(scratch, ignore_errors=True)
    print("All patches apply." if ok else "Some patches do not apply.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
