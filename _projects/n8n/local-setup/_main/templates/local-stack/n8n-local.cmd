@echo off
setlocal

set "STACK_DIR=%~dp0"
pushd "%STACK_DIR%" >nul
if errorlevel 1 (
  echo Failed to open local stack folder: %STACK_DIR%
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STACK_DIR%scripts\n8n-local-menu.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

popd >nul
exit /b %EXIT_CODE%
