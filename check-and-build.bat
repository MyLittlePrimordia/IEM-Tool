@echo off
setlocal EnableExtensions
title "IEM-Tool Check + Build"

rem ------------------------------------------------------------------
rem  One-click check + rebuild for IEM-Tool.
rem  Location independent: it changes to its own folder first, so it
rem  works no matter where you drop the app folder.
rem  Runs:  npm run check:js  ->  npm run check:reach  ->  npm run build:js
rem ------------------------------------------------------------------

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH. Install Node.js first.
    pause
    exit /b 1
)

echo ============================================================
echo   IEM-Tool: syntax check, reachability check, bundle rebuild
echo   Folder: %CD%
echo ============================================================
echo.

echo [1/3] Syntax check...
call npm run check:js
if errorlevel 1 goto :fail

echo.
echo [2/3] Reachability check...
call npm run check:reach
if errorlevel 1 goto :fail

echo.
echo [3/3] Rebuilding bundle...
call npm run build:js
if errorlevel 1 goto :fail

echo.
echo Verifying rebuilt bundle parses...
node --check js\app.bundle.js
if errorlevel 1 goto :fail
node --check js\app.bundle.min.js
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo   ALL CHECKS PASSED - bundle rebuilt successfully.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo [FAILED] One of the steps errored - see output above.
pause
exit /b 1