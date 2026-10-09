@echo off
echo Updating live UCM queues. Approve the Windows Administrator prompt.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $f=Join-Path $env:TEMP ('Newtel-LiveQueues-'+[Guid]::NewGuid().ToString('N')+'.ps1'); Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/soubabood15/repo/7eedd10ea375a51cfbf9f97b71197c52e975c5d0/connector/windows/Enable-UcmLiveQueues.ps1' -OutFile $f; if((Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash -ne '9B9E0F116DEBFC7CF9EE5F7ADABF10027EB66A9453E6391B52CD2839C69A8CE5'){throw 'Download verification failed'}; $p=Start-Process powershell.exe -Verb RunAs -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',([string][char]34+$f+[string][char]34)) -Wait -PassThru; exit $p.ExitCode"
if errorlevel 1 echo Update failed. Existing credentials were not changed. Send the error text, not your ucm.env file.
pause
