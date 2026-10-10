#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$ProjectPath = "C:\Users\NewTel\Desktop\Newtel-UCM-Connector")
$ErrorActionPreference = "Stop"
$taskName = "NewtelUcmQueueConnector"
$payload = Join-Path $PSScriptRoot "connector"
$target = Join-Path $ProjectPath "connector"
$null = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $target "ucm-queue-connector.mjs") -PathType Leaf)) { throw "Existing connector not found. No files were changed." }
$files = @(
    @{Name="ucm-api.mjs"; Hash="50763FB61F04CB45696A8EA84683664FAEE3C3F4BF68BEE095EE5B333634D7BF"},
    @{Name="ucm-queue-connector.mjs"; Hash="6E65E169F7B2E7119371EFD03CA9ED458F118E1C7F04E3A54EB0518041076FCB"},
    @{Name="ucm-queue-runtime.mjs"; Hash="D88990DE4BE53E4B3EEFE378FD07569D794F08C631FDF93043C69C911CD30B4A"},
    @{Name="ucm-cdr-format.mjs"; Hash="B5EC4304B01E33D20D6EBB3162B968FBBD15864F7854FF6F239514CCB3D44422"},
    @{Name="ucm-outbox.mjs"; Hash="6B860FB5A3BB5F7AE343281FD2F0766FD68835C5F567D2F53481D46657225267"},
    @{Name="ucm-tls.mjs"; Hash="BC6F0EFF17119E49C2FBCC3F8026C8D5295CCF778E82CE37F1DE380663CFB7EC"},
    @{Name="ucm-day-summary.mjs"; Hash="543D8B95AA883FA4EF11FB3508913E5E979012A43E233486E53BE4AC8D9A897D"},
    @{Name="ucm-day-sync.mjs"; Hash="F748552619CFE2FD12811BC5448DE2520605459F211B791A327555AB49CAF355"},
    @{Name="ucm-pause-tracker.mjs"; Hash="B628F0A573CC590863BA4E2BB5D9B6F9F33766F127066D851D1527DD06F8A838"}
)
foreach ($file in $files) {
    $source = Join-Path $payload $file.Name
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.Hash) { throw "Update package is incomplete or changed. No files were changed." }
}
$backup = Join-Path $ProjectPath ("update-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($file in $files) {
    $previous = Join-Path $target $file.Name
    if (Test-Path -LiteralPath $previous -PathType Leaf) { Copy-Item -LiteralPath $previous -Destination (Join-Path $backup $file.Name) }
}
Stop-ScheduledTask -TaskName $taskName
try {
    for ($attempt=0; $attempt -lt 10; $attempt++) {
        if ((Get-ScheduledTask -TaskName $taskName).State -ne "Running") { break }
        Start-Sleep -Seconds 1
    }
    if ((Get-ScheduledTask -TaskName $taskName).State -eq "Running") { throw "Connector did not stop. No update was installed." }
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $payload $file.Name) -Destination (Join-Path $target $file.Name) -Force }
} catch {
    foreach ($file in $files) {
        $previous = Join-Path $backup $file.Name
        if (Test-Path -LiteralPath $previous -PathType Leaf) { Copy-Item -LiteralPath $previous -Destination (Join-Path $target $file.Name) -Force }
    }
    throw
} finally { Start-ScheduledTask -TaskName $taskName }
Write-Host "Connector files updated and the existing task restarted."
Write-Host "Call reader v2: initiating AND receiving employee extensions are included."
Write-Host "Credentials, certificate pin, employee mappings and pending events were not changed."
Write-Host "No connection tests or historical call imports were run by this installer."
Write-Host "New HR/KPI screens and day requests require the matching website/Worker release."
Write-Host "Backup: $backup"
