@echo off
setlocal EnableExtensions

:run_sanitise
call :banner "n8n template sanitiser" "Runs sanitise-n8n-template.ps1 from this helper folder."
powershell -ExecutionPolicy Bypass -File "%~dp0sanitise-n8n-template.ps1" %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "DONE  Template sanitise finished successfully."
) else (
  call :status Red "FAIL  Template sanitise stopped with exit code %LAST_EXIT%."
)
call :prompt "Press R to run again or E to exit."
choice /C RE /N /M "> "
if errorlevel 2 exit /b %LAST_EXIT%
cls
goto run_sanitise

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
