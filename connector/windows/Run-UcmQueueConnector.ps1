[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [Parameter(Mandatory = $true)][string]$EnvironmentFile,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [string]$LogDirectory = "$env:ProgramData\Newtel\UcmConnector\logs"
)

$ErrorActionPreference = "Stop"
$connector = Join-Path $ProjectPath "connector\ucm-queue-connector.mjs"
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found." }
if (-not (Test-Path -LiteralPath $connector -PathType Leaf)) { throw "Queue connector not found in the project path." }
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Secure environment file not found." }

$required = @(
    "UCM_WS_URL", "UCM_API_USERNAME", "UCM_API_PASSWORD",
    "CLOUDFLARE_QUEUE_ENDPOINT", "UCM_INGEST_USERNAME", "UCM_INGEST_PASSWORD"
)
$loaded = @{}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Count -ne 2 -or -not $parts[0].Trim()) { throw "Invalid environment-file line." }
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    $loaded[$name] = $true
}
foreach ($name in $required) {
    if (-not $loaded.ContainsKey($name) -or -not [Environment]::GetEnvironmentVariable($name, "Process")) {
        throw "Required setting is missing: $name"
    }
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$stamp = Get-Date -Format "yyyy-MM-dd"
$stdout = Join-Path $LogDirectory "connector-$stamp.log"
$stderr = Join-Path $LogDirectory "connector-$stamp.error.log"
Set-Location -LiteralPath $ProjectPath
& $NodePath $connector 1>> $stdout 2>> $stderr
exit $LASTEXITCODE
