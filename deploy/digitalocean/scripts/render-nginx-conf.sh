#!/usr/bin/env bash
# Render nginx site config from template. Run on the server after setting domains in .env.production.
set -euo pipefail

ROOT="${GIGFLOW_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
ENV_FILE="${GIGFLOW_ENV_FILE:-/opt/gigflow/.env.production}"
TEMPLATE="$ROOT/deploy/nginx/conf.d/gigflow.conf.template"
OUTPUT="$ROOT/deploy/nginx/conf.d/gigflow.conf"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

: "${API_DOMAIN:?Set API_DOMAIN in $ENV_FILE}"
: "${ADMIN_DOMAIN:?Set ADMIN_DOMAIN in $ENV_FILE}"
: "${APP_DOMAIN:?Set APP_DOMAIN in $ENV_FILE (e.g. app.gigflow.ink)}"
: "${MARKETING_DOMAIN:?Set MARKETING_DOMAIN in $ENV_FILE (e.g. www.gigflow.ink)}"

export API_DOMAIN ADMIN_DOMAIN APP_DOMAIN MARKETING_DOMAIN
envsubst '${API_DOMAIN} ${ADMIN_DOMAIN} ${APP_DOMAIN} ${MARKETING_DOMAIN}' < "$TEMPLATE" > "$OUTPUT"
echo "Wrote $OUTPUT for API=$API_DOMAIN ADMIN=$ADMIN_DOMAIN APP=$APP_DOMAIN MARKETING=$MARKETING_DOMAIN"
