[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}')][string]$From,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}')][string]$To,
    [string]$ProjectPath,
    [string]$EnvironmentFile = "$env:ProgramData\Newtel\UcmConnector\ucm.env",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Stop"
if (-not $ProjectPath) { $ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
$backfill = Join-Path $ProjectPath "connector\ucm-cdr-backfill.mjs"
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found." }
if (-not (Test-Path -LiteralPath $backfill -PathType Leaf)) { throw "CDR backfill tool not found." }
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Secure environment file not found." }

foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2 -or -not $parts[0].Trim()) { throw "Invalid environment-file line." }
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
}

if (-not $env:UCM_API_BASE_URL -and $env:UCM_WS_URL) {
    $ucmUri = [Uri]$env:UCM_WS_URL
    $env:UCM_API_BASE_URL = "https://" + $ucmUri.Authority
}
if (-not $env:CLOUDFLARE_CDR_ENDPOINT -and $env:CLOUDFLARE_QUEUE_ENDPOINT) {
    $queueUri = [Uri]$env:CLOUDFLARE_QUEUE_ENDPOINT
    if ($queueUri.AbsolutePath -ne "/integrations/ucm/queue-events") { throw "CDR endpoint must be configured explicitly." }
    $env:CLOUDFLARE_CDR_ENDPOINT = "https://" + $queueUri.Authority + "/integrations/ucm/cdr"
}
if (-not $env:UCM_CDR_MODE) { $env:UCM_CDR_MODE = "session" }
$required = @("UCM_API_BASE_URL","UCM_API_USERNAME","UCM_API_PASSWORD","CLOUDFLARE_CDR_ENDPOINT","UCM_INGEST_USERNAME","UCM_INGEST_PASSWORD")
foreach ($name in $required) {
    if (-not [Environment]::GetEnvironmentVariable($name,"Process")) { throw "Required setting is missing: $name" }
}

Set-Location -LiteralPath $ProjectPath
$ErrorActionPreference = "Continue"
& $NodePath $backfill "--from=$From" "--to=$To"
exit $LASTEXITCODE
