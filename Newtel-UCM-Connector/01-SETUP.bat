@echo off
net session >nul 2>&1
if not %errorlevel%==0 (
  echo Right-click this file and choose Run as administrator.
  pause
  exit /b 1
)
if not exist "C:\ProgramData\Newtel\UcmConnector" mkdir "C:\ProgramData\Newtel\UcmConnector"
if not exist "C:\ProgramData\Newtel\UcmConnector\ucm.env" copy "%~dp0connector\windows\ucm.env.example" "C:\ProgramData\Newtel\UcmConnector\ucm.env" >nul
notepad "C:\ProgramData\Newtel\UcmConnector\ucm.env"
echo Fill the local settings, save the file, then run 02-INSTALL.bat.
pause
