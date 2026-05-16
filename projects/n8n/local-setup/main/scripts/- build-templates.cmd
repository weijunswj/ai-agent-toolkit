@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-templates.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo Template generation failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo Template generation complete.
pause
endlocal
