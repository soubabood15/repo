NEW TEL - EXISTING WINDOWS CONNECTOR UPDATE

1. Download and extract the ZIP completely (Extract All).
2. Open the extracted folder and double-click Update.cmd.
3. Approve the Windows Administrator prompt.

This package updates an EXISTING installation at:
C:\Users\NewTel\Desktop\Newtel-UCM-Connector

It preserves ucm.env, passwords, certificate pin, pending events and task settings.
It contains no credentials. A backup of replaced modules is saved under
the existing project\update-backups directory.

The installer does not test UCM or request historical call data.
The restarted connector resumes normal live queue monitoring. It also checks
for shared day-import jobs; call records are read only when a day job is requested.
New HR/KPI displays and day jobs require the matching Worker/site release,
which has not yet been deployed with this package.

Different existing project path: open PowerShell as Administrator and run:
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Install-Update.ps1" -ProjectPath "YOUR EXISTING PROJECT PATH"

This is a local update package, not a fresh connector installation.
No practical tests were run for this release at the user's request.
