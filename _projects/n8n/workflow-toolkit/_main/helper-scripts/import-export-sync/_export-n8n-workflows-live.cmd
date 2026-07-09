@echo off
setlocal EnableExtensions

call :resolve_powershell
if errorlevel 1 exit /b 1

:run_export
call :banner "n8n workflow export" "Runs export-n8n-workflows-live.ps1 from this helper folder."
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0export-n8n-workflows-live.ps1" %*
set "LAST_EXIT=%ERRORLEVEL%"

echo.
if "%LAST_EXIT%"=="0" (
  call :status Green "DONE  Export finished successfully."
) else (
  call :status Red "FAIL  Export stopped with exit code %LAST_EXIT%."
)
call :prompt "Press R to run again or E to exit."
call :read_choice "> " "RE" "E"
if /I "%AAT_CHOICE%"=="E" exit /b %LAST_EXIT%
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

:read_choice
set "AAT_CHOICE="
set /p "AAT_CHOICE=%~1"
if "%AAT_CHOICE%"=="" set "AAT_CHOICE=%~3"
set "AAT_CHOICE=%AAT_CHOICE:~0,1%"
set "AAT_ALLOWED=%~2"

:read_choice_check
if "%AAT_ALLOWED%"=="" goto read_choice_invalid
if /I "%AAT_CHOICE%"=="%AAT_ALLOWED:~0,1%" exit /b 0
set "AAT_ALLOWED=%AAT_ALLOWED:~1%"
goto read_choice_check

:read_choice_invalid
call :status Red "Invalid choice. Use one of: %~2"
goto read_choice

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
