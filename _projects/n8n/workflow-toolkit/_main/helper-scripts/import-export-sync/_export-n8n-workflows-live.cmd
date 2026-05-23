@echo off
setlocal EnableExtensions

:run_export
call :banner "n8n workflow export" "Runs export-n8n-workflows-live.ps1 from this helper folder."
powershell -ExecutionPolicy Bypass -File "%~dp0export-n8n-workflows-live.ps1" %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "DONE  Export finished successfully."
) else (
  call :status Red "FAIL  Export stopped with exit code %LAST_EXIT%."
)
call :prompt "Press R to run again or E to exit."
choice /C RE /N /M "> "
if errorlevel 2 exit /b %LAST_EXIT%
cls
goto run_export

:banner
call :status DarkCyan "------------------------------------------------------------"
call :status Cyan "%~1"
call :status DarkGray "%~2"
call :status DarkCyan "------------------------------------------------------------"
exit /b 0

:prompt
call :status Yellow "%~1"
exit /b 0

:status
set "AAT_STATUS_COLOR=%~1"
set "AAT_STATUS_MESSAGE=%~2"
powershell -NoProfile -Command "Write-Host $env:AAT_STATUS_MESSAGE -ForegroundColor $env:AAT_STATUS_COLOR"
exit /b 0
