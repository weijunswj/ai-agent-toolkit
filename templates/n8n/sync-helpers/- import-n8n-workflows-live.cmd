@echo off
setlocal EnableExtensions

:run_import
powershell -ExecutionPolicy Bypass -File "%~dp0import-n8n-workflows-live.ps1" %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
choice /C RE /N /M "Import finished with exit code %LAST_EXIT%. Press R to run again or E to exit: "
if errorlevel 2 exit /b %LAST_EXIT%
goto run_import
