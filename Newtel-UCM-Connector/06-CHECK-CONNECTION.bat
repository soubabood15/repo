@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0connector\windows\Test-UcmConnection.ps1"
pause
