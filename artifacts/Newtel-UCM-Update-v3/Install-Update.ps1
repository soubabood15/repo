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
    @{Name="ucm-api.mjs"; Hash="15F8802A2BCCDB134DB1B8B6350B99A411DD8607C7FFD186121ED952436B1401"},
    @{Name="ucm-queue-connector.mjs"; Hash="6E65E169F7B2E7119371EFD03CA9ED458F118E1C7F04E3A54EB0518041076FCB"},
    @{Name="ucm-queue-runtime.mjs"; Hash="D88990DE4BE53E4B3EEFE378FD07569D794F08C631FDF93043C69C911CD30B4A"},
    @{Name="ucm-cdr-format.mjs"; Hash="D97858D2F1AA60888802051DABA3189A77446DD7C53032A37FCCA60206E35E18"},
    @{Name="ucm-outbox.mjs"; Hash="6B860FB5A3BB5F7AE343281FD2F0766FD68835C5F567D2F53481D46657225267"},
    @{Name="ucm-tls.mjs"; Hash="BC6F0EFF17119E49C2FBCC3F8026C8D5295CCF778E82CE37F1DE380663CFB7EC"},
    @{Name="ucm-day-summary.mjs"; Hash="3DAA9919625F891C5B2D009F0EBC80883DF70BF549C5E83D56C763AA533DC93A"},
    @{Name="ucm-day-sync.mjs"; Hash="525406106344C8432F73966CA1A23A2030BAAA246E952AAF670EF926525BFA8E"},
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
Write-Host "Call reader v3: inbound, outbound, internal and overlapping queue calls."
Write-Host "Shared 15-minute cache requires the matching website/Worker release."
Write-Host "Compact pagination, reusable extension lookup and paced CDR reads reduce unnecessary processing."
Write-Host "Credentials, certificate pin, employee mappings and pending events were not changed."
Write-Host "No connection tests or historical call imports were run by this installer."
Write-Host "New HR/KPI screens and day requests require the matching website/Worker release."
Write-Host "Backup: $backup"
