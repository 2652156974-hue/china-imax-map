@echo off
setlocal
set "PROJECT_DIR=%~dp0"
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\stop-public-map.ps1"
if errorlevel 1 (
  echo.
  echo Stop failed. See the message above.
  pause
)
