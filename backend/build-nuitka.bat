@echo off
echo [nuitka] Building app.exe with 12 jobs...
echo.
cd /d "%~dp0"

python -m nuitka ^
    --standalone --mingw64 --jobs=12 ^
    --windows-console-mode=disable ^
    --include-package=app ^
    --include-package=polars ^
    --include-package=pyarrow ^
    --output-dir=dist\app ^
    --output-filename=app.exe ^
    --product-name="CS2 Insight Agent" ^
    --product-version="2.1.1" ^
    --nofollow-import-to=matplotlib ^
    --nofollow-import-to=PIL ^
    --nofollow-import-to=pip ^
    --nofollow-import-to=setuptools ^
    --nofollow-import-to=tkinter ^
    --nofollow-import-to=test ^
    --nofollow-import-to=unittest ^
    --nofollow-import-to=idlelib ^
    --assume-yes-for-downloads ^
    app\run_server.py

if errorlevel 1 (
    echo [nuitka] app.exe build failed!
    pause
    exit /b 1
)

echo.
echo [nuitka] Done!
for %%F in (dist\app\app.exe) do echo   %%~zxF -> %%~nxF
pause
