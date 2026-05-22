@echo off
setlocal EnableExtensions

:run_import
call :status Cyan "== n8n workflow import =="
call :configure_restart %*
powershell -ExecutionPolicy Bypass -File "%~dp0import-n8n-workflows-live.ps1" %* %RESTART_ARG%
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "Import finished successfully."
) else (
  call :status Red "Import stopped with exit code %LAST_EXIT%."
)
choice /C RE /N /M "Press R to run again or E to exit: "
if errorlevel 2 exit /b %LAST_EXIT%
echo.
goto run_import

:configure_restart
set "RESTART_ARG="
set "HAS_RESTART_ARG="
if not "%~1"=="" (
  for %%A in (%*) do (
    if /I "%%~A"=="-RestartContainerAfterImport" set "HAS_RESTART_ARG=1"
  )
)
if defined HAS_RESTART_ARG (
  call :status Green "Restart warning mode: auto-restart when needed (argument provided)."
  exit /b 0
)
choice /C YN /N /M "Auto-restart n8n container if restart warning is true? [Y/N]: "
if errorlevel 2 (
  call :status Yellow "Restart warning mode: warn only."
) else (
  set "RESTART_ARG=-RestartContainerAfterImport"
  call :status Green "Restart warning mode: auto-restart when needed."
)
exit /b 0

:status
set "AAT_STATUS_COLOR=%~1"
set "AAT_STATUS_MESSAGE=%~2"
powershell -NoProfile -Command "Write-Host $env:AAT_STATUS_MESSAGE -ForegroundColor $env:AAT_STATUS_COLOR"
exit /b 0
