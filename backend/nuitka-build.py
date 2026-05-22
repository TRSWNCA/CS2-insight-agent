#!/usr/bin/env python
"""Build Nuitka standalone executable (directory mode) for the backend."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DIST_DIR = BACKEND_DIR / "dist" / "app"

# Packages to include as-is (.pyd) without Nuitka compilation
RUNTIME_ONLY_PACKAGES = ["polars", "pyarrow"]

EXCLUDES = [
    "matplotlib",
    "PIL",
    "pip",
    "setuptools",
    "tkinter",
    "test",
    "unittest",
    "idlelib",
    "ensurepip",
    "distutils",
]

COMMON_FLAGS = [
    sys.executable, "-m", "nuitka",
    "--standalone",
    "--mingw64",
    "--jobs=8",
    "--windows-console-mode=disable",
    "--include-package=app",
    "--output-dir=" + str(DIST_DIR),
    "--output-filename=app.exe",
    "--product-name=CS2 Insight Agent",
    "--assume-yes-for-downloads",
]

for pkg in RUNTIME_ONLY_PACKAGES:
    COMMON_FLAGS.extend(["--include-package", pkg])

for exc in EXCLUDES:
    COMMON_FLAGS.extend(["--nofollow-import-to", exc])


def build_app() -> None:
    cmd = [*COMMON_FLAGS, str(BACKEND_DIR / "app" / "run_server.py")]
    print(f"[nuitka-build] Building app.exe ...")
    print(f"[nuitka-build] Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=BACKEND_DIR)
    if result.returncode != 0:
        sys.exit(f"[nuitka-build] app.exe build failed with code {result.returncode}")
    # Nuitka --standalone outputs a directory named <script>.dist/
    out_dir = DIST_DIR / "run_server.dist"
    exe_path = out_dir / "app.exe"
    if not exe_path.is_file():
        sys.exit(f"[nuitka-build] app.exe not found at {exe_path}")
    print(f"[nuitka-build] app.exe built successfully at {exe_path}")


def main() -> None:
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    build_app()

    out_dir = DIST_DIR / "run_server.dist"
    total = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file())
    print(f"\n[nuitka-build] Done! {out_dir}: {total / (1024*1024):.1f} MB")


if __name__ == "__main__":
    main()
