@echo off
echo [nuitka] Building app.exe and parse_worker.exe with 8 jobs...
echo.
cd /d "%~dp0"

python -m nuitka ^
    --standalone --onefile --mingw64 --jobs=8 ^
    --windows-disable-console ^
    --include-package=app ^
    --output-dir=dist\app ^
    --output-filename=app.exe ^
    --product-name="CS2 Insight Agent" ^
    --nofollow-import-to=matplotlib ^
    --nofollow-import-to=polars ^
    --nofollow-import-to=pyarrow ^
    --nofollow-import-to=PIL ^
    --nofollow-import-to=pip ^
    --nofollow-import-to=setuptools ^
    --nofollow-import-to=tkinter ^
    --nofollow-import-to=test ^
    --nofollow-import-to=unittest ^
    --nofollow-import-to=idlelib ^
    --remove-output ^
    --assume-yes-for-downloads ^
    app\run_server.py

if errorlevel 1 (
    echo [nuitka] app.exe build failed!
    pause
    exit /b 1
)

echo.
echo [nuitka] Building parse_worker.exe...
echo.

python -m nuitka ^
    --standalone --onefile --mingw64 --jobs=8 ^
    --windows-disable-console ^
    --include-package=app ^
    --output-dir=dist\app ^
    --output-filename=parse_worker.exe ^
    --nofollow-import-to=matplotlib ^
    --nofollow-import-to=polars ^
    --nofollow-import-to=pyarrow ^
    --nofollow-import-to=PIL ^
    --nofollow-import-to=pip ^
    --nofollow-import-to=setuptools ^
    --nofollow-import-to=tkinter ^
    --nofollow-import-to=test ^
    --nofollow-import-to=unittest ^
    --nofollow-import-to=idlelib ^
    --remove-output ^
    --assume-yes-for-downloads ^
    app\parse_worker.py

if errorlevel 1 (
    echo [nuitka] parse_worker.exe build failed!
    pause
    exit /b 1
)

echo.
echo [nuitka] Done!
for %%F in (dist\app\app.exe dist\app\parse_worker.exe) do echo   %%~zxF -> %%~nxF
pause
