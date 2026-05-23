@echo off
setlocal EnableExtensions

call :resolve_powershell
if errorlevel 1 exit /b 1

:run_import
call :banner "n8n workflow import" "Runs import-n8n-workflows-live.ps1 from this helper folder."
call :configure_restart %*
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-n8n-workflows-live.ps1" %* %RESTART_ARG%
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "DONE  Import finished successfully."
) else (
  call :status Red "FAIL  Import stopped with exit code %LAST_EXIT%."
)
call :prompt "Press R to run again or E to exit."
choice /C RE /N /M "> "
if errorlevel 2 exit /b %LAST_EXIT%
cls
goto run_import

:configure_restart
set "RESTART_ARG="
set "HAS_RESTART_ARG="
if not "%~1"=="" (
  for %%A in (%*) do (
    if /I "%%~A"=="-RestartContainerAfterImport" set "HAS_RESTART_ARG=1"
  )
)
if defined HAS_RESTART_ARG (
  call :status Green "INFO  Restart warning mode: auto-restart when needed (argument provided)."
  exit /b 0
)
call :prompt "Auto-restart n8n container if restart warning is true?"
choice /C YN /N /M "[Y/N] > "
if errorlevel 2 (
  call :status Yellow "INFO  Restart warning mode: warn only."
) else (
  set "RESTART_ARG=-RestartContainerAfterImport"
  call :status Green "INFO  Restart warning mode: auto-restart when needed."
)
exit /b 0

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
"%POWERSHELL_EXE%" -NoProfile -Command "Write-Host $env:AAT_STATUS_MESSAGE -ForegroundColor $env:AAT_STATUS_COLOR"
exit /b 0

:resolve_powershell
if not defined SystemRoot (
  echo ERROR Trusted Windows PowerShell could not be resolved because SystemRoot is not defined.
  exit /b 1
)
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" exit /b 0
echo ERROR Trusted Windows PowerShell executable not found: "%POWERSHELL_EXE%"
exit /b 1
