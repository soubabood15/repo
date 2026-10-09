[CmdletBinding()]
param([string]$ProjectPath = "C:\Users\NewTel\Desktop\Newtel-UCM-Connector")
$ErrorActionPreference = "Stop"
$backfill = Join-Path $ProjectPath "connector\windows\Invoke-UcmCdrBackfill.ps1"
if (-not (Test-Path -LiteralPath $backfill -PathType Leaf)) { throw "Connector project not found." }
$updateDirectory = Join-Path $env:TEMP ("Newtel-CdrFix-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $updateDirectory | Out-Null
$base = "https://raw.githubusercontent.com/soubabood15/repo/71e913a70dce5d4ba091de0d1eba1f9b0a6fd3f0/connector"
$files = @(
    @{ Name = "ucm-api.mjs"; Hash = "6F626B61E8AF578ECBEEFB9D493A3B3AA6D3BAE7E69A127E34227B037F287B84" },
    @{ Name = "ucm-cdr-format.mjs"; Hash = "B5EC4304B01E33D20D6EBB3162B968FBBD15864F7854FF6F239514CCB3D44422" }
)
foreach ($file in $files) {
    $download = Join-Path $updateDirectory $file.Name
    Invoke-WebRequest -UseBasicParsing ($base + "/" + $file.Name) -OutFile $download
    if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $file.Hash) { throw "CDR update verification failed." }
}
foreach ($file in $files) {
    $target = Join-Path (Join-Path $ProjectPath "connector") $file.Name
    if (Test-Path -LiteralPath $target -PathType Leaf) { Copy-Item -LiteralPath $target -Destination (Join-Path $updateDirectory ($file.Name + ".before-update")) }
    Copy-Item -LiteralPath (Join-Path $updateDirectory $file.Name) -Destination $target -Force
}
Write-Host "CDR reader updated. Credentials and the running Queue Connector were not changed."
$from = Get-Date -Day 1 -Hour 0 -Minute 0 -Second 0 -Millisecond 0
$to = Get-Date
& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $backfill -ProjectPath $ProjectPath -From ($from.ToString("yyyy-MM-ddTHH:mm:ss")) -To ($to.ToString("yyyy-MM-ddTHH:mm:ss"))
exit $LASTEXITCODE
