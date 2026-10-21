$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 LTS or newer from https://nodejs.org then run Setup.cmd again.' }
$nodeVersion = & node --version
$nodeExitCode = $LASTEXITCODE
$nodeVersion = ([string]$nodeVersion).Trim()
$nodeVersionMatch = [regex]::Match($nodeVersion, '^v?(\d+)\.\d+\.\d+(?:[-+].*)?$')
if ($nodeExitCode -ne 0 -or -not $nodeVersionMatch.Success) { throw 'Could not read Node.js version. Run node --version and try again.' }
if ([int]$nodeVersionMatch.Groups[1].Value -lt 22) { throw 'Node.js 22 or newer is required.' }
Write-Host "Using Node.js $nodeVersion"
$private = Join-Path (Get-Location) 'private'
New-Item -ItemType Directory -Path $private -Force | Out-Null
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $private /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the connector session folder.' }
$configPath = Join-Path $private 'config.json'
if (-not (Test-Path $configPath)) {
  $portal = Read-Host 'Portal backend URL [https://trainer-kb.alisoub60.workers.dev]'
  if (-not $portal) { $portal = 'https://trainer-kb.alisoub60.workers.dev' }
  if (-not ($portal -match '^https://[^/]+/?$')) { throw 'Enter only the HTTPS origin of the portal backend.' }
  $code = (Read-Host 'Pairing code from ICON7 page (administrator)').Trim()
  if (-not ($code -match '^[a-f0-9]{32}$')) { throw 'Create a fresh 10-minute pairing code in the ICON7 page.' }
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $secret = [Convert]::ToBase64String($bytes)
  $body = @{code=$code;secret=$secret} | ConvertTo-Json
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-RestMethod -Uri ($portal.TrimEnd('/') + '/integrations/icon7-padel/pair') -Method Post -ContentType 'application/json' -Body $body | Out-Null
  @{portal=$portal;secret=$secret;booking_enabled=$true} | ConvertTo-Json | Set-Content -Encoding UTF8 $configPath
  $secret = $null
  $body = $null
}
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed.' }
Write-Host 'Setup complete. Run Login.cmd, then Check.cmd, then Start.cmd.'
