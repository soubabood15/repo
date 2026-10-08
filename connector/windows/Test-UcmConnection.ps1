[CmdletBinding()]
param(
    [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$EnvironmentFile = "$env:ProgramData\Newtel\UcmConnector\ucm.env",
    [string]$NodePath = "C:\Program Files\nodejs\node.exe"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Node executable not found." }
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Environment file not found." }
foreach ($name in @("UCM_WS_URL","UCM_WS_ORIGIN","UCM_TLS_FINGERPRINT_SHA256","NODE_EXTRA_CA_CERTS")) {
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
}
foreach ($line in Get-Content -LiteralPath $EnvironmentFile) {
    $parts = $line.Trim().Split("=", 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -in @("UCM_WS_URL","UCM_WS_ORIGIN","UCM_TLS_FINGERPRINT_SHA256","NODE_EXTRA_CA_CERTS")) {
        [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
    }
}
$probe = Join-Path $ProjectPath "connector\ucm-check-connection.mjs"
if (-not (Test-Path -LiteralPath $probe -PathType Leaf)) { throw "Connection probe not found." }
$ErrorActionPreference = "Continue"
& $NodePath $probe
exit $LASTEXITCODE
