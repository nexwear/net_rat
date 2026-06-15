# Clear operational Postgres data (cards, nodes, bundles, scans, sessions, alerts).
# Keeps: users, factory/line seed, sizes, contractors, garment_models, firmware_releases.
param(
  [switch]$Remote,
  [string]$SshHost = "15.206.16.137",
  [string]$SshUser = "ubuntu",
  [string]$RemotePath = "/opt/app"
)

$ErrorActionPreference = "Stop"
$sqlPath = Join-Path $PSScriptRoot "clear-db.sql"
$sql = Get-Content $sqlPath -Raw

if ($Remote) {
  Write-Host "Clearing DB on $SshHost via SSH..."
  $sql | ssh "${SshUser}@${SshHost}" @"
cd $RemotePath
docker compose exec -T postgres psql -U `"`${POSTGRES_USER:-netrat}`" -d `"`${POSTGRES_DB:-netrat}`" -v ON_ERROR_STOP=1
"@
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "Remote DB cleared."
  exit 0
}

Write-Host "Clearing local Docker Postgres..."
Push-Location (Join-Path $PSScriptRoot "..")
try {
  $sql | docker compose exec -T postgres psql -U netrat -d netrat -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Write-Host "Local DB cleared."
} finally {
  Pop-Location
}
