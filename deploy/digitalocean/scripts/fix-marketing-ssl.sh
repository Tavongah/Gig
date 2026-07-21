#!/usr/bin/env bash
# Fix "Not secure" on www — expand Let's Encrypt cert to include MARKETING_DOMAIN.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${API_DOMAIN:?}"
: "${MARKETING_DOMAIN:?}"

cert_text() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T nginx \
    cat "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" 2>/dev/null || true
}

if cert_text | openssl x509 -noout -text 2>/dev/null | grep -q "DNS:${MARKETING_DOMAIN}"; then
  echo "Certificate already includes $MARKETING_DOMAIN — no change needed."
  exit 0
fi

echo "Certificate missing $MARKETING_DOMAIN (browser will show Not secure)."
echo "Expanding Let's Encrypt certificate..."
bash "$ROOT/deploy/digitalocean/scripts/expand-ssl-app-domain.sh"

echo ""
echo "Done. Hard-refresh https://$MARKETING_DOMAIN — the padlock should appear."
