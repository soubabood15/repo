[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$taskName = "NewtelUcmQueueConnector"
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Host "The secure environment file and logs were retained in ProgramData."
Write-Host "$taskName is stopped and uninstalled."
