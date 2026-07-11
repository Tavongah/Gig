# Render env checklist from apps/api/.env - shows SET/MISSING only (no secret values).
# Usage: .\scripts\print-render-env.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root "apps\api\.env"

if (-not (Test-Path $envPath)) {
  throw "Missing apps/api/.env - copy from .env.example first."
}

$vars = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $idx = $_.IndexOf('=')
  if ($idx -lt 1) { return }
  $key = $_.Substring(0, $idx).Trim()
  $val = $_.Substring($idx + 1).Trim()
  $vars[$key] = $val
}

function Show-Status($label, $key) {
  $v = $vars[$key]
  if ([string]::IsNullOrWhiteSpace($v)) {
    Write-Host "  [MISSING] $label ($key)" -ForegroundColor Yellow
  } else {
    Write-Host "  [SET]     $label ($key)" -ForegroundColor Green
  }
}

$apiUrl = "https://gigflow-api.onrender.com"
$adminUrl = "https://gigflow-admin.onrender.com"

Write-Host ""
Write-Host "=== gigflow-api - copy values from apps/api/.env into Render ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  API_PUBLIC_URL              = $apiUrl"
Write-Host "  MOBILE_PUBLIC_URL           = $adminUrl"
Write-Host "  CORS_ORIGINS                = $adminUrl,http://localhost:8081,http://localhost:5173,http://localhost:19006"
Write-Host "  LOG_VERIFICATION_TO_CONSOLE = true"
Write-Host ""
Show-Status "Admin seed password" "ADMIN_SEED_PASSWORD"
Show-Status "Firebase project" "FIREBASE_PROJECT_ID"
Show-Status "Firebase service account email" "FIREBASE_CLIENT_EMAIL"
Show-Status "Firebase private key" "FIREBASE_PRIVATE_KEY"
Show-Status "Stripe secret key" "STRIPE_SECRET_KEY"
Show-Status "Stripe publishable key" "STRIPE_PUBLISHABLE_KEY"
Write-Host "  [MANUAL]  STRIPE_WEBHOOK_SECRET - create webhook at $apiUrl/v1/payments/webhook"
Write-Host "  [OPTIONAL] STRIPE_CONNECT_CLIENT_ID"
Write-Host ""
Write-Host "=== gigflow-admin ===" -ForegroundColor Cyan
Write-Host "  VITE_API_URL = $apiUrl/v1"
Write-Host "  Then: Manual Deploy, Clear build cache, deploy"
Write-Host ""
Write-Host "Verify after deploy:" -ForegroundColor Cyan
Write-Host "  $apiUrl/health"
Write-Host "  $apiUrl/ready"
Write-Host "  $apiUrl/v1/auth/config"
Write-Host ""
