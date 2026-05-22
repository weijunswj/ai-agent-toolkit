@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
call :status Cyan "== n8n local setup template generation =="
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-templates.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  call :status Red "Template generation failed with exit code %EXIT_CODE%."
  exit /b %EXIT_CODE%
)

call :status Green "Template generation complete."
pause
endlocal
exit /b 0

:status
set "AAT_STATUS_COLOR=%~1"
set "AAT_STATUS_MESSAGE=%~2"
powershell -NoProfile -Command "Write-Host $env:AAT_STATUS_MESSAGE -ForegroundColor $env:AAT_STATUS_COLOR"
exit /b 0
