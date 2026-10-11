@echo off
echo Updating the existing connector. Approve the Windows Administrator prompt.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$installer=Join-Path '%~dp0' 'Install-Update.ps1'; $process=Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',([string][char]34+$installer+[char]34)) -Wait -PassThru; exit $process.ExitCode"
if errorlevel 1 echo Update failed or was cancelled. Keep the error text; do not share ucm.env.
pause
