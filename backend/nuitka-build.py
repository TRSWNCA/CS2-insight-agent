#!/usr/bin/env python
"""Build Nuitka standalone executables for the backend."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
DIST_DIR = BACKEND_DIR / "dist" / "app"

EXCLUDES = [
    "matplotlib",
    "polars",
    "polars-runtime-32",
    "pyarrow",
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
    "--onefile",
    "--mingw64",
    "--jobs=8",
    "--windows-disable-console",
    "--include-package=app",
    "--output-dir=" + str(DIST_DIR),
    "--remove-output",
    "--assume-yes-for-downloads",
]

for exc in EXCLUDES:
    COMMON_FLAGS.extend(["--nofollow-import-to", exc])


def build_app() -> None:
    """Build the main app.exe entry point."""
    cmd = [
        *COMMON_FLAGS,
        "--output-filename=app.exe",
        "--product-name=CS2 Insight Agent",
        str(BACKEND_DIR / "app" / "run_server.py"),
    ]
    print(f"[nuitka-build] Building app.exe ...")
    print(f"[nuitka-build] Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=BACKEND_DIR)
    if result.returncode != 0:
        sys.exit(f"[nuitka-build] app.exe build failed with code {result.returncode}")
    print(f"[nuitka-build] app.exe built successfully at {DIST_DIR / 'app.exe'}")


def build_worker() -> None:
    """Build the parse_worker.exe entry point."""
    cmd = [
        *COMMON_FLAGS,
        "--output-filename=parse_worker.exe",
        str(BACKEND_DIR / "app" / "parse_worker.py"),
    ]
    print(f"[nuitka-build] Building parse_worker.exe ...")
    print(f"[nuitka-build] Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=BACKEND_DIR)
    if result.returncode != 0:
        sys.exit(f"[nuitka-build] parse_worker.exe build failed with code {result.returncode}")
    print(f"[nuitka-build] parse_worker.exe built successfully at {DIST_DIR / 'parse_worker.exe'}")


def main() -> None:
    # Clean previous build
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR, ignore_errors=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    build_app()
    build_worker()

    app_size = (DIST_DIR / "app.exe").stat().st_size
    worker_size = (DIST_DIR / "parse_worker.exe").stat().st_size
    print(f"\n[nuitka-build] Done! app.exe: {app_size / (1024*1024):.1f} MB, "
          f"parse_worker.exe: {worker_size / (1024*1024):.1f} MB")


if __name__ == "__main__":
    main()
