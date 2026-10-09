#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$ProjectPath = "C:\Users\NewTel\Desktop\Newtel-UCM-Connector")
$ErrorActionPreference = "Stop"
$taskName = "NewtelUcmQueueConnector"
$null = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$targetDirectory = Join-Path $ProjectPath "connector"
if (-not (Test-Path -LiteralPath (Join-Path $targetDirectory "ucm-queue-connector.mjs") -PathType Leaf)) { throw "Connector project not found." }
$updateDirectory = Join-Path $env:TEMP ("Newtel-DailySync-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $updateDirectory | Out-Null
$base = "https://raw.githubusercontent.com/soubabood15/repo/75c07bcfe7b1428c98fd785ed74f9a73bbf915c3/connector/"
$files = @(
    @{ Name = "ucm-api.mjs"; Hash = "0820FCFFC56281357CA39D144FD62227796B06EEE6323DBEE564673C2F7EA4A7" },
    @{ Name = "ucm-queue-connector.mjs"; Hash = "559E65B4591F4C20378229AAD18D1BC98A835462243E2730D5B70EA3392F07EB" },
    @{ Name = "ucm-cdr-sync.mjs"; Hash = "359DABC2132373E018A26137C9C40A1790DC6A74C563B3079F3E03C48F7127B4" },
    @{ Name = "ucm-cdr-format.mjs"; Hash = "B5EC4304B01E33D20D6EBB3162B968FBBD15864F7854FF6F239514CCB3D44422" }
)
foreach ($file in $files) {
    $download = Join-Path $updateDirectory $file.Name
    Invoke-WebRequest -UseBasicParsing ($base + $file.Name) -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $file.Hash) { throw "Automatic sync update verification failed." }
    $target = Join-Path $targetDirectory $file.Name
    if (Test-Path -LiteralPath $target -PathType Leaf) { Copy-Item -LiteralPath $target -Destination (Join-Path $updateDirectory ($file.Name + ".before-update")) }
}
Stop-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
try {
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $updateDirectory $file.Name) -Destination (Join-Path $targetDirectory $file.Name) -Force }
} catch {
    foreach ($file in $files) {
        $backup = Join-Path $updateDirectory ($file.Name + ".before-update")
        if (Test-Path -LiteralPath $backup -PathType Leaf) { Copy-Item -LiteralPath $backup -Destination (Join-Path $targetDirectory $file.Name) -Force }
    }
    throw
} finally { Start-ScheduledTask -TaskName $taskName }
Write-Host "Daily UCM call sync enabled. Credentials, certificate pin and queued events were preserved."
Write-Host "Calls sync once daily. The previous month is fully imported and saved. Older months rotate out only after successful delivery."
Start-Sleep -Seconds 10
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $targetDirectory "windows\Get-UcmQueueConnectorStatus.ps1") -LogLines 15
