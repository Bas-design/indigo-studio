@echo off
REM ===================================================================
REM  Indigo Studio — double-click this to start.
REM  Everything runs on this computer. Nothing is published until you
REM  press the Publish button inside the Studio.
REM ===================================================================
setlocal
cd /d "%~dp0"
title Indigo Studio

echo.
echo   Indigo Studio
echo   =============
echo.

REM --- Is Docker installed? -------------------------------------------
where docker >nul 2>&1
if errorlevel 1 (
  echo   Docker Desktop does not seem to be installed.
  echo.
  echo   Install it once from:  https://www.docker.com/products/docker-desktop
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)

REM --- Is Docker actually running? ------------------------------------
docker info >nul 2>&1
if errorlevel 1 (
  echo   Starting Docker Desktop...
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" >nul 2>&1
  echo   Waiting for it to be ready. This can take a minute the first time.
  echo.
  set /a tries=0
  :waitdocker
  timeout /t 3 /nobreak >nul
  docker info >nul 2>&1
  if not errorlevel 1 goto dockerready
  set /a tries+=1
  if %tries% lss 40 (
    echo   ... still waiting
    goto waitdocker
  )
  echo.
  echo   Docker did not start. Open Docker Desktop yourself, wait until it
  echo   says "Engine running", then run this file again.
  echo.
  pause
  exit /b 1
)
:dockerready

echo   Starting the Studio...
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo   The Studio could not start. Please send Brandon the text above.
  echo.
  pause
  exit /b 1
)

REM --- Wait until the server answers, then open the browser ------------
echo.
echo   Almost ready...
set /a waits=0
:waitapp
timeout /t 2 /nobreak >nul
curl -s -o nul -m 3 http://localhost:4100/api/health
if not errorlevel 1 goto appready
set /a waits+=1
if %waits% lss 45 goto waitapp
echo.
echo   The Studio is taking longer than expected. Opening it anyway --
echo   if the page does not load, wait a few seconds and refresh.
echo.
:appready

start "" http://localhost:4100/studio

echo.
echo   Indigo Studio is running.
echo.
echo     Editor:    http://localhost:4100/studio
echo     Your site: http://localhost:4100/
echo.
echo   You can close this black window -- the Studio keeps running.
echo   To stop it, double-click "Stop Indigo Studio.bat".
echo.
timeout /t 12 /nobreak >nul
endlocal
