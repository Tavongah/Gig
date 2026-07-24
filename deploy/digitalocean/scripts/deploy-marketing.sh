#!/usr/bin/env bash
# Build and deploy the Astro marketing site to MARKETING_DOMAIN (www.duts.tech).
# Also ensures apex ROOT_DOMAIN redirects to www and is on the SSL cert.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/digitalocean/.env.production.example"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${MARKETING_DOMAIN:?Set MARKETING_DOMAIN in $ENV_FILE (e.g. www.duts.tech)}"
: "${PUBLIC_SITE_URL:?Set PUBLIC_SITE_URL in $ENV_FILE (e.g. https://www.duts.tech)}"
: "${PUBLIC_APP_URL:?Set PUBLIC_APP_URL in $ENV_FILE (e.g. https://app.duts.tech)}"

if [[ -z "${ROOT_DOMAIN:-}" ]]; then
  ROOT_DOMAIN="${MARKETING_DOMAIN#www.}"
fi

if ! getent hosts "$MARKETING_DOMAIN" >/dev/null 2>&1; then
  echo "Warning: $MARKETING_DOMAIN does not resolve yet. Add DNS before expecting HTTPS to work."
fi
if ! getent hosts "$ROOT_DOMAIN" >/dev/null 2>&1; then
  echo "Warning: $ROOT_DOMAIN does not resolve yet. Add an A record for the apex (@) before apex→www redirect will work."
fi

echo "==> Ensuring SSL certificate includes $MARKETING_DOMAIN and $ROOT_DOMAIN..."
bash "$ROOT/deploy/digitalocean/scripts/fix-marketing-ssl.sh"

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"
bash "$ROOT/deploy/digitalocean/scripts/deploy.sh"

echo ""
echo "Verify marketing site:"
echo "  curl -fsS \"https://$MARKETING_DOMAIN/health\""
echo "  curl -I \"https://$ROOT_DOMAIN\"   # expect 301 → https://$MARKETING_DOMAIN/"
echo "  curl -fsSL \"https://$ROOT_DOMAIN/\" | head"
