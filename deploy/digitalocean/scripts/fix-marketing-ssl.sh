#!/usr/bin/env bash
# Ensure Let's Encrypt cert covers MARKETING_DOMAIN (www) and ROOT_DOMAIN (apex).
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${API_DOMAIN:?}"
: "${MARKETING_DOMAIN:?}"

if [[ -z "${ROOT_DOMAIN:-}" ]]; then
  ROOT_DOMAIN="${MARKETING_DOMAIN#www.}"
fi

cert_text() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T nginx \
    cat "/etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem" 2>/dev/null || true
}

needs_expand=false
if ! cert_text | openssl x509 -noout -text 2>/dev/null | grep -q "DNS:${MARKETING_DOMAIN}"; then
  echo "Certificate missing $MARKETING_DOMAIN"
  needs_expand=true
fi
if ! cert_text | openssl x509 -noout -text 2>/dev/null | grep -q "DNS:${ROOT_DOMAIN}"; then
  echo "Certificate missing $ROOT_DOMAIN"
  needs_expand=true
fi

if [[ "$needs_expand" == "false" ]]; then
  echo "Certificate already includes $MARKETING_DOMAIN and $ROOT_DOMAIN — no change needed."
  exit 0
fi

echo "Expanding Let's Encrypt certificate for www + apex..."
bash "$ROOT/deploy/digitalocean/scripts/expand-ssl-app-domain.sh"

echo ""
echo "Done. Verify:"
echo "  curl -I https://$ROOT_DOMAIN"
echo "  curl -fsS https://$MARKETING_DOMAIN/health"
