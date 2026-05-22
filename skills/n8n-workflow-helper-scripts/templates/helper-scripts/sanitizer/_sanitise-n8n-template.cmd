@echo off
setlocal EnableExtensions

:run_sanitise
call :status Cyan "== n8n template sanitise =="
powershell -ExecutionPolicy Bypass -File "%~dp0sanitise-n8n-template.ps1" %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "Template sanitise finished successfully."
) else (
  call :status Red "Template sanitise stopped with exit code %LAST_EXIT%."
)
choice /C RE /N /M "Press R to run again or E to exit: "
if errorlevel 2 exit /b %LAST_EXIT%
echo.
goto run_sanitise

:status
set "AAT_STATUS_COLOR=%~1"
set "AAT_STATUS_MESSAGE=%~2"
powershell -NoProfile -Command "Write-Host $env:AAT_STATUS_MESSAGE -ForegroundColor $env:AAT_STATUS_COLOR"
exit /b 0
