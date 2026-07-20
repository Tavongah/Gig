#!/usr/bin/env bash
# Obtain Let's Encrypt certificates (first run). Requires DNS pointing to this server.
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

mkdir -p "$ROOT/deploy/nginx/conf.d"

# Temporary HTTP-only nginx for ACME
cat > "$ROOT/deploy/nginx/conf.d/gigflow.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $API_DOMAIN $ADMIN_DOMAIN $APP_DOMAIN $MARKETING_DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'GigFlow SSL setup\n'; add_header Content-Type text/plain; }
}
EOF

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nginx

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" --profile tools run --rm certbot-once \
  certonly --webroot -w /var/www/certbot \
  --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email \
  --cert-name "$API_DOMAIN" \
  -d "$API_DOMAIN" -d "$ADMIN_DOMAIN" -d "$APP_DOMAIN" -d "$MARKETING_DOMAIN"

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d nginx

echo "Certificates issued. Enable certbot renewal profile:"
echo "  docker compose --env-file $ENV_FILE -f $COMPOSE_FILE --profile certbot up -d certbot"
