@echo off
setlocal

set "STACK_DIR=%~dp0"
pushd "%STACK_DIR%" >nul
if errorlevel 1 (
  echo Failed to open local stack folder: %STACK_DIR%
  pause
  exit /b 1
)

:run_menu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STACK_DIR%scripts\n8n-local-menu.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" goto done

echo.
echo The n8n local menu stopped unexpectedly with exit code %EXIT_CODE%.
echo Press any key to reopen the menu, or close this window to stop.
pause >nul
goto run_menu

:done
popd >nul
exit /b 0
