# Publish a firmware build for production OTA rollout
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ModuleType = "",
  [int]$RolloutPct = 100,
  [string]$ApiBase = "http://localhost:4000",
  [string]$BinPath = "..\firmware\.pio\build\esp32dev\firmware.bin"
)

$destName = "firmware-$Version.bin"
$destDir = Join-Path $PSScriptRoot "..\backend\firmware"
$destPath = Join-Path $destDir $destName
$resolvedBin = Resolve-Path -LiteralPath $BinPath -ErrorAction SilentlyContinue

if (-not $resolvedBin) {
  Write-Error "Build not found: $BinPath. Run: cd firmware; python -m platformio run -e esp32dev"
  exit 1
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item $resolvedBin $destPath -Force
Write-Host "Copied to $destPath"

$body = @{
  version    = $Version
  rolloutPct = $RolloutPct
  fileName   = $destName
}
if ($ModuleType) {
  $body.moduleType = $ModuleType
}

$json = $body | ConvertTo-Json
$result = Invoke-RestMethod -Method POST -Uri "$ApiBase/v1/admin/ota/releases" `
  -ContentType "application/json" -Body $json

Write-Host "Registered release:"
$result | ConvertTo-Json -Depth 4
