#!/usr/bin/env bash
# Production deploy — run on DigitalOcean droplet as deploy user.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"
PREVIOUS_COMMIT=""

cd "$ROOT"
export GIGFLOW_ENV_FILE="$ENV_FILE"

if [[ -d .git ]]; then
  git -c safe.directory="$ROOT" fetch origin main
  git -c safe.directory="$ROOT" reset --hard origin/main
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy deploy/digitalocean/.env.production.example"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

PREVIOUS_COMMIT=""
if [[ -d .git ]]; then
  PREVIOUS_COMMIT="$(git -c safe.directory="$ROOT" rev-parse HEAD)"
fi

rollback() {
  echo "Deploy failed — rolling back to $PREVIOUS_COMMIT"
  if [[ -n "$PREVIOUS_COMMIT" && -d .git ]]; then
    git -c safe.directory="$ROOT" checkout --force "$PREVIOUS_COMMIT"
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build --remove-orphans
}
trap rollback ERR

bash "$ROOT/deploy/digitalocean/scripts/render-nginx-conf.sh"

echo "Building images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --pull

echo "Starting stack..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans

echo "Waiting for API health..."
for i in $(seq 1 40); do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api wget -q -O - http://127.0.0.1:4000/health | grep -q '"ok":true'; then
    echo "API healthy"
    trap - ERR
    exit 0
  fi
  sleep 5
done

echo "API health check timed out"
exit 1
