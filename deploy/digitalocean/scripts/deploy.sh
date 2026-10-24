#!/usr/bin/env bash
# Production deploy — run on DigitalOcean droplet as deploy user.
# Application rollback does not reverse Prisma migrations or restore backups.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"
RELEASE_SHA_FILE="${GIGFLOW_RELEASE_SHA_FILE:-/home/deploy/.gigflow/RELEASE_SHA}"
HEALTH_ATTEMPTS="${GIGFLOW_HEALTH_ATTEMPTS:-40}"
HEALTH_SLEEP_SECONDS="${GIGFLOW_HEALTH_SLEEP_SECONDS:-5}"
PREVIOUS_COMMIT=""

cd "$ROOT"
export GIGFLOW_ENV_FILE="$ENV_FILE"

record_release_sha() {
  local sha="$1"
  local dir
  dir="$(dirname "$RELEASE_SHA_FILE")"
  mkdir -p "$dir"
  chmod 700 "$dir"
  printf '%s\n' "$sha" > "$RELEASE_SHA_FILE"
  chmod 600 "$RELEASE_SHA_FILE"
}

# Capture the running commit before fetch/reset. A later failure must
# restore this commit, not the commit that was just checked out.
if [[ -d .git ]]; then
  PREVIOUS_COMMIT="$(git -c safe.directory="$ROOT" rev-parse HEAD)"
  git -c safe.directory="$ROOT" fetch origin main
  git -c safe.directory="$ROOT" reset --hard origin/main
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/digitalocean/.env.production.example"
  if [[ -n "$PREVIOUS_COMMIT" && -d .git ]]; then
    git -c safe.directory="$ROOT" checkout --force "$PREVIOUS_COMMIT"
  fi
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

rollback() {
  trap - ERR
  echo "Deploy failed — rolling back application to ${PREVIOUS_COMMIT:-unknown}"
  if [[ -n "$PREVIOUS_COMMIT" && -d .git ]]; then
    git -c safe.directory="$ROOT" checkout --force "$PREVIOUS_COMMIT"
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans
  if [[ -n "$PREVIOUS_COMMIT" ]]; then
    record_release_sha "$PREVIOUS_COMMIT"
  fi
}
trap rollback ERR

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"

echo "Building images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull

echo "Starting stack..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

echo "Waiting for API health..."
for i in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api wget -q -O - http://127.0.0.1:4000/health | grep -q '"ok":true'; then
    echo "API healthy"
    if [[ -d .git ]]; then
      record_release_sha "$(git -c safe.directory="$ROOT" rev-parse HEAD)"
    fi
    trap - ERR
    exit 0
  fi
  sleep "$HEALTH_SLEEP_SECONDS"
done

echo "API health check timed out"
rollback
exit 1
