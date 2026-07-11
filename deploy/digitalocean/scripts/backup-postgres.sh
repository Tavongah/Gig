#!/usr/bin/env bash
# Daily PostgreSQL backup. Optionally uploads to DigitalOcean Spaces when configured.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"
BACKUP_DIR="$ROOT/deploy/digitalocean/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/gigflow_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
# shellcheck disable=SC1090
source "$ENV_FILE"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-gigflow}" -d "${POSTGRES_DB:-gigflow}" --no-owner --clean \
  | gzip > "$FILE"

find "$BACKUP_DIR" -name 'gigflow_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

if [[ -n "${SPACES_BUCKET:-}" && -n "${SPACES_ACCESS_KEY_ID:-}" && -n "${SPACES_SECRET_ACCESS_KEY:-}" ]]; then
  ENDPOINT="${SPACES_ENDPOINT:-https://nyc3.digitaloceanspaces.com}"
  REGION="${SPACES_REGION:-nyc3}"
  KEY="backups/postgres/$(basename "$FILE")"
  AWS_ACCESS_KEY_ID="$SPACES_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$SPACES_SECRET_ACCESS_KEY" \
  aws s3 cp "$FILE" "s3://${SPACES_BUCKET}/${KEY}" --endpoint-url "$ENDPOINT" --region "$REGION" 2>/dev/null \
    || echo "Spaces upload skipped (install awscli on host for off-site backups)"
fi

echo "Backup saved: $FILE"
