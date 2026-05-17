@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

:run_export
powershell -ExecutionPolicy Bypass -File scripts\export-n8n-workflows-live.ps1 %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
choice /C RE /N /M "Export finished with exit code %LAST_EXIT%. Press R to run again or E to exit: "
if errorlevel 2 exit /b %LAST_EXIT%
goto run_export
