@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM n8n + ngrok local launcher for Windows
REM ============================================================
REM Local development only.
REM Do not use this for VPS, production, Hostinger, Coolify,
REM or Docker Compose deployments.
REM
REM What this script does:
REM 1. Pulls the latest n8n stable Docker image first.
REM 2. Creates the local n8n Docker volume if missing.
REM 3. Starts ngrok for local n8n.
REM 4. Reads the public HTTPS ngrok URL.
REM 5. Recreates the n8n container with WEBHOOK_URL set.
REM
REM You normally only edit the CONFIG section.
REM ============================================================

REM =========================
REM CONFIG
REM =========================

REM Put ngrok.exe in C:\ngrok, or change this path to wherever you saved it.
set "NGROK_PATH=C:\ngrok\ngrok.exe"

REM Optional: Set your ngrok authtoken here. Do not commit a real token.
set "NGROK_AUTHTOKEN="

set "CONTAINER_NAME=n8n"
set "LOCAL_PORT=5678"
set "CONTAINER_PORT=5678"
set "TZ=Asia/Singapore"
set "VOLUME_NAME=n8n_data"
set "IMAGE=docker.n8n.io/n8nio/n8n:stable"

REM If true, kills existing ngrok.exe first so you do not accidentally reuse an old tunnel.
REM Set to false if you run other ngrok tunnels at the same time.
set "KILL_EXISTING_NGROK=true"

REM =========================

echo.
echo ============================================================
echo n8n + ngrok launcher
echo ============================================================
echo.

echo [1/9] Checking ngrok path...
if not exist "%NGROK_PATH%" (
  echo [ERROR] ngrok.exe not found at:
  echo %NGROK_PATH%
  echo.
  pause
  exit /b 1
)

echo [2/9] Checking Docker is available...
docker --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker command not found.
  echo Make sure Docker Desktop is installed and running.
  echo.
  pause
  exit /b 1
)

echo [3/9] Optional ngrok authtoken setup...
if defined NGROK_AUTHTOKEN (
  echo Setting ngrok authtoken...
  "%NGROK_PATH%" config add-authtoken "%NGROK_AUTHTOKEN%"
  if errorlevel 1 (
    echo [ERROR] Failed to set ngrok authtoken.
    echo.
    pause
    exit /b 1
  )
) else (
  echo Skipping ngrok authtoken setup.
)

echo [4/9] Pulling latest n8n image before starting ngrok...
docker pull "%IMAGE%"
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to pull latest n8n image.
  echo ngrok was not started.
  echo Check Docker Desktop and internet connection.
  echo.
  pause
  exit /b 1
)

echo [5/9] Creating Docker volume if missing...
docker volume create "%VOLUME_NAME%" >nul 2>&1

echo [6/9] Starting ngrok tunnel...

if /I "%KILL_EXISTING_NGROK%"=="true" (
  taskkill /IM ngrok.exe /F >nul 2>&1
  timeout /t 1 /nobreak >nul
)

start "ngrok n8n tunnel" "%NGROK_PATH%" http %LOCAL_PORT%

echo Waiting for ngrok API to become ready...

set "WEBHOOK_URL="
for /L %%A in (1,1,20) do (
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { ((Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels').tunnels | Where-Object { $_.public_url -like 'https://*' } | Select-Object -ExpandProperty public_url -First 1) } catch { '' }"`) do (
    set "WEBHOOK_URL=%%i"
  )

  if defined WEBHOOK_URL (
    goto :GotWebhookUrl
  )

  timeout /t 1 /nobreak >nul
)

:GotWebhookUrl

if not defined WEBHOOK_URL (
  echo.
  echo [ERROR] Could not get ngrok HTTPS URL.
  echo Check that ngrok is running:
  echo http://127.0.0.1:4040
  echo.
  pause
  exit /b 1
)

if not "!WEBHOOK_URL:~-1!"=="/" set "WEBHOOK_URL=!WEBHOOK_URL!/"

echo.
echo [7/9] Public webhook URL found:
echo !WEBHOOK_URL!
echo.

echo [8/9] Recreating n8n container with updated image and webhook URL...
docker rm -f "%CONTAINER_NAME%" >nul 2>&1

docker run -d --name "%CONTAINER_NAME%" ^
  -p %LOCAL_PORT%:%CONTAINER_PORT% ^
  -e GENERIC_TIMEZONE="%TZ%" ^
  -e TZ="%TZ%" ^
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true ^
  -e N8N_RUNNERS_ENABLED=true ^
  -e WEBHOOK_URL="!WEBHOOK_URL!" ^
  -e N8N_PROXY_HOPS=1 ^
  -v "%VOLUME_NAME%:/home/node/.n8n" ^
  "%IMAGE%"

if errorlevel 1 (
  echo.
  echo [ERROR] Failed to start n8n container.
  echo.
  docker logs "%CONTAINER_NAME%"
  echo.
  pause
  exit /b 1
)

echo [9/9] Done.
echo.
echo n8n local URL:
echo http://localhost:%LOCAL_PORT%
echo.
echo n8n webhook URL:
echo !WEBHOOK_URL!
echo.
echo Running container:
docker ps --filter "name=%CONTAINER_NAME%"

echo.
pause
endlocal
