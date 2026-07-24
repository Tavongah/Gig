#!/usr/bin/env bash
# Expand existing Let's Encrypt cert to include APP, MARKETING (www), and ROOT (apex) domains.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${API_DOMAIN:?}"
: "${ADMIN_DOMAIN:?}"
: "${APP_DOMAIN:?}"
: "${MARKETING_DOMAIN:?}"
: "${LETSENCRYPT_EMAIL:?}"

if [[ -z "${ROOT_DOMAIN:-}" ]]; then
  ROOT_DOMAIN="${MARKETING_DOMAIN#www.}"
fi

echo "Expanding certificate for $API_DOMAIN to include $APP_DOMAIN, $MARKETING_DOMAIN, and $ROOT_DOMAIN..."

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile tools run --rm certbot-once \
  certonly --webroot -w /var/www/certbot \
  --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email \
  --cert-name "$API_DOMAIN" --expand \
  -d "$API_DOMAIN" -d "$ADMIN_DOMAIN" -d "$APP_DOMAIN" -d "$MARKETING_DOMAIN" -d "$ROOT_DOMAIN"

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nginx

echo "Done."
echo "  Canonical: https://$MARKETING_DOMAIN"
echo "  Apex redirect: https://$ROOT_DOMAIN → https://$MARKETING_DOMAIN"
echo "If the browser still shows Not secure, wait 1–2 minutes and hard-refresh (Ctrl+Shift+R)."
