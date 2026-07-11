# Redeploy GIGFLOW on Render after CLI login: render login
$ErrorActionPreference = "Stop"
$cli = if ($env:RENDER_CLI) { $env:RENDER_CLI } else { "$env:TEMP\render-cli\cli_v2.15.1.exe" }

if (-not (Test-Path $cli)) {
  throw "Render CLI not found at $cli. Run: render login"
}

Write-Host "Fetching Render services..."
$services = & $cli services --output json --confirm | ConvertFrom-Json

$api = $services | Where-Object { $_.service.name -match "^gigflow-api" } | Select-Object -First 1
$admin = $services | Where-Object { $_.service.name -eq "gigflow-admin" } | Select-Object -First 1

if (-not $api) {
  Write-Host "No gigflow-api service found. Services:"
  $services | ForEach-Object { Write-Host " - $($_.service.name) [$($_.service.type)]" }
  throw "Create or resume gigflow-api in Render first."
}

Write-Host "Deploying API ($($api.service.name)) with cache clear..."
& $cli deploys create $api.service.id --clear-cache --confirm --output text

if ($admin) {
  Write-Host "Deploying admin ($($admin.service.name)) with cache clear..."
  & $cli deploys create $admin.service.id --clear-cache --confirm --output text
}

Write-Host "Done. Check: https://gigflow-api.onrender.com/health"
