@echo off
net session >nul 2>&1
if not %errorlevel%==0 (
  echo Right-click this file and choose Run as administrator.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0connector\windows\Uninstall-UcmQueueConnector.ps1"
pause
