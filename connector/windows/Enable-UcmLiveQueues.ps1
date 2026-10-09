#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$ProjectPath = "C:\Users\NewTel\Desktop\Newtel-UCM-Connector")
$ErrorActionPreference = "Stop"
$taskName = "NewtelUcmQueueConnector"
$null = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$targetDirectory = Join-Path $ProjectPath "connector"
if (-not (Test-Path -LiteralPath (Join-Path $targetDirectory "ucm-queue-connector.mjs") -PathType Leaf)) { throw "Connector project not found." }
$updateDirectory = Join-Path $env:TEMP ("Newtel-LiveQueues-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $updateDirectory | Out-Null
$base = "https://raw.githubusercontent.com/soubabood15/repo/ca8c93647d2ea44a31cad13fc7cfeb3ec1cc4103/connector/"
$files = @(
    @{ Name = "ucm-api.mjs"; Hash = "27D4161F12CEAF170CA5EEF4B7773CA801D401E1D048409F442D842D2A03CFAC" },
    @{ Name = "ucm-queue-connector.mjs"; Hash = "4C8DE633380880A82677F1663006780509ACF3FE7D19ED5E3B7F6CF8445A5052" },
    @{ Name = "ucm-cdr-sync.mjs"; Hash = "E461A5022171885EF0532B3278712E997274EA43CF7EF9219BD240362E44C424" },
    @{ Name = "ucm-cdr-format.mjs"; Hash = "B5EC4304B01E33D20D6EBB3162B968FBBD15864F7854FF6F239514CCB3D44422" },
    @{ Name = "ucm-queue-runtime.mjs"; Hash = "D5197A3B1188D1CEC416D4CDF302CE5F4C600BBCD61B6F00A555C8DFBEE7D42B" },
    @{ Name = "ucm-outbox.mjs"; Hash = "6B860FB5A3BB5F7AE343281FD2F0766FD68835C5F567D2F53481D46657225267" }
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
    # Archive pending events before the updated connector discards non-attendance events.
    $pendingPath = "C:\ProgramData\Newtel\UcmConnector\state\queue-outbox.json"
    if (Test-Path -LiteralPath $pendingPath -PathType Leaf) { Copy-Item -LiteralPath $pendingPath -Destination (Join-Path $updateDirectory "queue-outbox.before-update.json") }
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $updateDirectory $file.Name) -Destination (Join-Path $targetDirectory $file.Name) -Force }
} catch {
    foreach ($file in $files) {
        $backup = Join-Path $updateDirectory ($file.Name + ".before-update")
        if (Test-Path -LiteralPath $backup -PathType Leaf) { Copy-Item -LiteralPath $backup -Destination (Join-Path $targetDirectory $file.Name) -Force }
    }
    throw
} finally { Start-ScheduledTask -TaskName $taskName }
Write-Host "Live UCM queue status and automatic attendance enabled. Credentials, certificate pin and queued events were preserved."
Write-Host "Open Admin > UCM operations to view extensions and queues. Map additional employees using their actual UCM extension."
Write-Host "Current queue snapshots are sent on changes with one heartbeat every 90 seconds. Calls, pause history and CDR synchronization remain disabled."
Write-Host "Receiver quota errors pause retries. Pending events remain saved locally."
Start-Sleep -Seconds 10
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $targetDirectory "windows\Get-UcmQueueConnectorStatus.ps1") -LogLines 15
