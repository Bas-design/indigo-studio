@echo off
REM Stops the Studio. Nothing is lost: your photos and text live in the
REM "site" folder next to this file, and stay there.
setlocal
cd /d "%~dp0"
title Stop Indigo Studio

echo.
echo   Stopping Indigo Studio...
echo.
docker compose down
echo.
echo   Stopped. Your work is safe in the "site" folder.
echo   Anything you had not published yet is still waiting for you
echo   next time you start the Studio.
echo.
timeout /t 6 /nobreak >nul
endlocal
