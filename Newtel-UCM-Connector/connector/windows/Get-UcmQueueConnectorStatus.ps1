[CmdletBinding()]
param(
    [int]$LogLines = 40,
    [string]$LogDirectory = "$env:ProgramData\Newtel\UcmConnector\logs"
)

$taskName = "NewtelUcmQueueConnector"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "$taskName is not installed."; exit 1 }
$task | Select-Object TaskName, State
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object LastRunTime, LastTaskResult, NextRunTime, NumberOfMissedRuns
if (Test-Path -LiteralPath $LogDirectory) {
    Get-ChildItem -LiteralPath $LogDirectory -File -Filter "connector-*.log" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 2 |
        ForEach-Object { Write-Host "--- $($_.Name) ---"; Get-Content -LiteralPath $_.FullName -Tail $LogLines }
}
