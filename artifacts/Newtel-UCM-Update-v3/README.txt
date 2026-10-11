NEW TEL - EXISTING WINDOWS CONNECTOR UPDATE V3

Extract All, open the extracted folder, and double-click Update.cmd.
Approve the Windows Administrator prompt.

Existing installation:
C:\Users\NewTel\Desktop\Newtel-UCM-Connector

What changes:
- Inbound, outbound, internal and unclassified CDR leg counts.
- Queue calls overlap direction totals; they must not be added again.
- Queue routing survives detailed CDR legs.
- Reusable extension lookup, compact pagination hashes and short page pauses.
- Check requested jobs every 15 seconds; no automatic historical imports.
- Matching Worker shares each employee day read in a private 15-minute cache.
  Each employee receives only their own metrics. No daily KPI archive is saved.

Existing passwords, ucm.env, certificate pin, queued events, employee mappings
and task settings are preserved. Replaced modules are backed up locally.
This package has no credentials and does not run any practical UCM tests.
The connector resumes normal queue monitoring after the update.

Old cached results do not gain new fields. After their 15-minute expiry,
request the day again. Missing classifications appear as a dash, not zero.
Directions use only UCM direction, trunk or route metadata; ambiguous records
stay unclassified. Totals count employee call legs, so a transferred conversation
can contain several legs.

Different project folder: run PowerShell as Administrator:
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Install-Update.ps1" -ProjectPath "YOUR EXISTING PROJECT PATH"
