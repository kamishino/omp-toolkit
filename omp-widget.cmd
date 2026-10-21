@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo OMP Toolkit: Bun is required. Install it from https://bun.sh/docs/installation
  pause
  exit /b 1
)

bun run desktop:preview
set "code=%errorlevel%"
if not "%code%"=="0" (
  echo.
  pause
)
exit /b %code%
