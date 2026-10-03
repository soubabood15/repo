@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0connector\windows\Get-UcmQueueConnectorStatus.ps1"
pause
