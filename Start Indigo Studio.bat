@echo off
REM ===================================================================
REM  Indigo Studio - double-click this to start.
REM  Everything runs on this computer. Nothing is published until you
REM  press the Publish button inside the Studio.
REM ===================================================================
REM
REM  Batch note for whoever maintains this: every label here is at the
REM  top level and the wait loops are subroutines. cmd parses a whole
REM  parenthesised block before running any of it, so a %variable% read
REM  inside the same block that sets it expands to nothing at parse time
REM  and the script dies with "N was unexpected at this time" - even when
REM  that branch is never taken. Labels inside a block are just as bad.
REM  Keep loops in subroutines.
REM
REM  And no `timeout` either: it aborts with "Input redirection is not
REM  supported" whenever stdin is not a console, which turns every wait
REM  loop into an instant busy spin that gives up before anything has
REM  started. `ping -n` waits properly under any launch method.
REM ===================================================================
setlocal
cd /d "%~dp0"
title Indigo Studio

echo.
echo   Indigo Studio
echo   =============
echo.

where docker >nul 2>&1
if errorlevel 1 goto no_docker

docker info >nul 2>&1
if errorlevel 1 goto docker_asleep
goto docker_ready

:docker_asleep
echo   Starting Docker Desktop...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
echo   Waiting for it to be ready. This can take a minute the first time.
echo.
call :wait_for_docker
if errorlevel 1 goto docker_failed

:docker_ready
echo   Starting the Studio...
echo   The first time, this downloads and builds things - give it a few minutes.
echo.
docker compose up -d --build
if errorlevel 1 goto compose_failed

echo.
echo   Almost ready...
call :wait_for_app

start "" http://localhost:4100/studio

echo.
echo   Indigo Studio is running.
echo.
echo     Editor:    http://localhost:4100/studio
echo     Your site: http://localhost:4100/
echo.
echo   You can close this black window - the Studio keeps running.
echo   To stop it, double-click "Stop Indigo Studio.bat".
echo.
>nul ping -n 16 127.0.0.1
endlocal
exit /b 0


REM ------------------------------ subroutines ------------------------

:wait_for_docker
set /a dtries=0
:wait_docker_loop
>nul ping -n 4 127.0.0.1
docker info >nul 2>&1
if not errorlevel 1 exit /b 0
set /a dtries+=1
echo   ... still waiting for Docker
if %dtries% lss 40 goto wait_docker_loop
exit /b 1

:wait_for_app
set /a atries=0
:wait_app_loop
>nul ping -n 3 127.0.0.1
curl -s -o nul -m 3 http://localhost:4100/api/health
if not errorlevel 1 exit /b 0
set /a atries+=1
if %atries% lss 45 goto wait_app_loop
echo.
echo   The Studio is taking longer than expected. Opening it anyway -
echo   if the page does not load, wait a few seconds and refresh.
echo.
exit /b 0


REM ------------------------------- failures --------------------------

:no_docker
echo   Docker Desktop does not seem to be installed.
echo.
echo   Install it once from:  https://www.docker.com/products/docker-desktop
echo   Then run this file again.
echo.
pause
endlocal
exit /b 1

:docker_failed
echo.
echo   Docker did not start. Open Docker Desktop yourself, wait until it
echo   says "Engine running", then run this file again.
echo.
pause
endlocal
exit /b 1

:compose_failed
echo.
echo   The Studio could not start. Please send Brandon the text above.
echo.
pause
endlocal
exit /b 1
