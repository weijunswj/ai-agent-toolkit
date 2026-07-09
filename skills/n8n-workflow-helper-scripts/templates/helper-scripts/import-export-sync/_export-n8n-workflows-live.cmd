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
call :read_rerun_choice
if errorlevel 1 exit /b %LAST_EXIT%
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

:read_rerun_choice
"%POWERSHELL_EXE%" -NoProfile -Command "$ErrorActionPreference='Stop'; function Read-ConLine { $fs=[System.IO.File]::Open('CONIN$', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); try { $reader=[System.IO.StreamReader]::new($fs); while ($true) { Write-Host -NoNewline '> ' -ForegroundColor Yellow; $line=$reader.ReadLine(); if ($null -eq $line) { Start-Sleep -Milliseconds 250; continue }; $value=$line.Trim(); if ($value.Length -eq 0) { continue }; $choice=$value.Substring(0,1).ToUpperInvariant(); if ($choice -eq 'R') { exit 0 }; if ($choice -eq 'E') { exit 1 }; Write-Host 'Invalid choice. Press R to run again or E to exit.' -ForegroundColor Red } } finally { if ($reader) { $reader.Dispose() } else { $fs.Dispose() } } }; try { Read-ConLine } catch { Write-Host 'Console input unavailable; leaving this window open for review. Close it manually and rerun from an interactive Command Prompt.' -ForegroundColor Red; Start-Sleep -Seconds 86400; exit 1 }"
exit /b %ERRORLEVEL%

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
