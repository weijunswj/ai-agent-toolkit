@echo off
setlocal

set "STACK_DIR=%USERPROFILE%\.n8n-production-cloudflare"

if not exist "%STACK_DIR%\_n8n-production-cloudflare.cmd" (
  echo Could not find the n8n production Cloudflare launcher.
  echo.
  echo Expected:
  echo %STACK_DIR%\_n8n-production-cloudflare.cmd
  echo.
  echo Copy the production Cloudflare stack templates into %STACK_DIR% first.
  echo Then run this shortcut again.
  echo.
  pause
  exit /b 1
)

cd /d "%STACK_DIR%"
call "%STACK_DIR%\_n8n-production-cloudflare.cmd"
exit /b %ERRORLEVEL%
