@echo off
setlocal

set "STACK_DIR=%USERPROFILE%\.n8n-local"

if not exist "%STACK_DIR%\_n8n-local.cmd" (
  echo Could not find the n8n local launcher.
  echo.
  echo Expected:
  echo %STACK_DIR%\_n8n-local.cmd
  echo.
  echo Copy the local stack templates into %STACK_DIR% first.
  echo Then run this shortcut again.
  echo.
  pause
  exit /b 1
)

cd /d "%STACK_DIR%"
call "%STACK_DIR%\_n8n-local.cmd"
exit /b %ERRORLEVEL%
