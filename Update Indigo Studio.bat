@echo off
REM ===================================================================
REM  Updates Indigo Studio itself to the latest version.
REM
REM  Your work is never touched: the "site" folder (your projects and
REM  photos) and the "config" folder (your GitHub sign-in) are both
REM  excluded from the update.
REM
REM  Uses only tools already built into Windows 11 -- curl, tar and
REM  robocopy -- so there is nothing extra to install.
REM ===================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Update Indigo Studio

REM Where the Studio's own code lives. Must be a PUBLIC repo, because
REM this download happens before any sign-in.
set "STUDIO_REPO=https://github.com/Bas-design/indigo-studio"
set "BRANCH=main"

echo.
echo   Updating Indigo Studio
echo   ======================
echo.

where curl >nul 2>&1 || (echo   curl is missing -- this needs Windows 10 or later. & pause & exit /b 1)
where tar  >nul 2>&1 || (echo   tar is missing -- this needs Windows 10 or later.  & pause & exit /b 1)

set "TMPDIR=%TEMP%\indigo-studio-update"
if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
mkdir "%TMPDIR%" || (echo   Could not create a temporary folder. & pause & exit /b 1)

echo   Downloading the latest version...
curl -fsSL -o "%TMPDIR%\studio.zip" "%STUDIO_REPO%/archive/refs/heads/%BRANCH%.zip"
if errorlevel 1 (
  echo.
  echo   Could not download the update. Check your internet connection,
  echo   or ask Brandon whether the address below is still right:
  echo     %STUDIO_REPO%
  echo.
  rmdir /s /q "%TMPDIR%" 2>nul
  pause
  exit /b 1
)

echo   Unpacking...
tar -xf "%TMPDIR%\studio.zip" -C "%TMPDIR%"
if errorlevel 1 (echo   The download was damaged. Try again. & rmdir /s /q "%TMPDIR%" 2>nul & pause & exit /b 1)

REM GitHub zips extract into a folder named <repo>-<branch>.
set "SRC="
for /d %%D in ("%TMPDIR%\*") do set "SRC=%%D"
if not defined SRC (echo   The update did not contain what was expected. & rmdir /s /q "%TMPDIR%" 2>nul & pause & exit /b 1)

echo   Stopping the Studio while files are replaced...
docker compose down >nul 2>&1

echo   Installing...
REM /E      include subfolders, even empty ones
REM /XD     never touch her projects or her saved sign-in
REM /NFL /NDL /NJH /NJS  keep the output quiet
robocopy "%SRC%" "%CD%" /E /XD site config .git /NFL /NDL /NJH /NJS >nul
REM robocopy uses 0-7 for success; 8 and above is a real failure.
if %ERRORLEVEL% GEQ 8 (
  echo.
  echo   The update could not be installed. Nothing has been changed.
  echo   Please send Brandon this message.
  echo.
  rmdir /s /q "%TMPDIR%" 2>nul
  pause
  exit /b 1
)

rmdir /s /q "%TMPDIR%" 2>nul

echo   Rebuilding...
docker compose build >nul 2>&1
if errorlevel 1 (
  echo.
  echo   The update installed but the rebuild failed. Try starting the
  echo   Studio normally -- if it will not start, send Brandon this message.
  echo.
  pause
  exit /b 1
)

echo.
echo   Indigo Studio is up to date.
echo   Your projects and your sign-in were left exactly as they were.
echo.
echo   Start it again with "Start Indigo Studio.bat".
echo.
>nul ping -n 11 127.0.0.1
endlocal
