#!/usr/bin/env bash
# Restore PostgreSQL from a gzipped pg_dump. Usage: ./restore-postgres.sh path/to/backup.sql.gz
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 path/to/backup.sql.gz"
  exit 1
fi

BACKUP="$1"
ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"

# shellcheck disable=SC1090
source "$ENV_FILE"

read -r -p "This will REPLACE the production database. Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || exit 1

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop api
gunzip -c "$BACKUP" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "${POSTGRES_USER:-gigflow}" -d "${POSTGRES_DB:-gigflow}"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d api
echo "Restore complete."
