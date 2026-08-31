@echo off
setlocal
set "PROJECT_DIR=%~dp0"
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_DIR%scripts\start-public-map.ps1"
if errorlevel 1 (
  echo.
  echo Start failed. See the message above.
  pause
)
