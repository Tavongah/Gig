#!/usr/bin/env bash
# Build and deploy the Astro marketing site to MARKETING_DOMAIN (www.gigflow.ink).
# Run on the DigitalOcean droplet after DNS for MARKETING_DOMAIN points to this server.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/digitalocean/.env.production.example"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${MARKETING_DOMAIN:?Set MARKETING_DOMAIN in $ENV_FILE (e.g. www.gigflow.ink)}"
: "${PUBLIC_SITE_URL:?Set PUBLIC_SITE_URL in $ENV_FILE (e.g. https://www.gigflow.ink)}"
: "${PUBLIC_APP_URL:?Set PUBLIC_APP_URL in $ENV_FILE (e.g. https://app.gigflow.ink)}"

if ! getent hosts "$MARKETING_DOMAIN" >/dev/null 2>&1; then
  echo "Warning: $MARKETING_DOMAIN does not resolve yet. Add DNS before expecting HTTPS to work."
fi

echo "==> Ensuring SSL certificate includes $MARKETING_DOMAIN..."
bash "$ROOT/deploy/digitalocean/scripts/fix-marketing-ssl.sh"

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"
bash "$ROOT/deploy/digitalocean/scripts/deploy.sh"

echo ""
echo "Verify marketing site:"
echo "  curl -fsS \"https://$MARKETING_DOMAIN/health\""
echo "  curl -fsS \"https://$MARKETING_DOMAIN/\" | head"
