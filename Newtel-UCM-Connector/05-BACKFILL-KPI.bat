@echo off
set /p FROM_DATE=Start date YYYY-MM-DD: 
set /p TO_DATE=End date YYYY-MM-DD: 
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0connector\windows\Invoke-UcmCdrBackfill.ps1" -From "%FROM_DATE%" -To "%TO_DATE%" -ProjectPath "%~dp0."
pause
