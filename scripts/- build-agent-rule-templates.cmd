@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%build-agent-rule-templates.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo Agent rule template generation failed with exit code %EXIT_CODE%.
  exit /b %EXIT_CODE%
)

echo Agent rule template generation complete.
pause
endlocal

