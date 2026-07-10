@echo off
setlocal

set "STACK_DIR=%~dp0"
set "RELAUNCH_EXIT_CODE=75"
set "MAX_RELAUNCHES=1"
if not defined N8N_LAUNCHER_RELAUNCH_COUNT set "N8N_LAUNCHER_RELAUNCH_COUNT=0"

pushd "%STACK_DIR%" >nul
if errorlevel 1 (
  echo Failed to open n8n local stack folder: %STACK_DIR%
  pause
  exit /b 1
)

:run_menu
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STACK_DIR%scripts\n8n-local-menu.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" goto done
if "%EXIT_CODE%"=="%RELAUNCH_EXIT_CODE%" goto intentional_relaunch
goto unexpected_failure

:intentional_relaunch
if %N8N_LAUNCHER_RELAUNCH_COUNT% GEQ %MAX_RELAUNCHES% goto relaunch_limit
set /a N8N_LAUNCHER_RELAUNCH_COUNT+=1 >nul
call :refresh_path
popd >nul
echo.
echo Restarting the launcher with refreshed Windows PATH...
start "" /b /wait cmd.exe /d /s /c ""%~f0" %*"
exit /b %ERRORLEVEL%

:refresh_path
for /f "delims=" %%P in ('powershell.exe -NoProfile -NonInteractive -Command "$machine = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::Machine); $user = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User); [Console]::Out.Write([Environment]::ExpandEnvironmentVariables(($machine + ';' + $user).Trim(';')))"') do set "PATH=%%P"
exit /b 0

:relaunch_limit
echo.
echo Docker Desktop installation completed, but Docker is still unavailable after one controlled launcher restart.
echo Sign out or reboot Windows, or refresh PATH manually, then run this launcher again.
pause
popd >nul
exit /b 1

:unexpected_failure
echo.
echo The n8n local menu stopped unexpectedly with exit code %EXIT_CODE%.
echo Press any key to reopen the menu, or close this window to stop.
pause >nul
goto run_menu

:done
popd >nul
exit /b 0
