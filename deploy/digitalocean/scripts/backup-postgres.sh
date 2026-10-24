#!/usr/bin/env bash
# Daily PostgreSQL backup.
# Cron must invoke this with bash. The executable bit is not required.
# A valid local gzip dump is mandatory. Spaces upload is optional and never
# removes the local file.
set -euo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if [[ -n "${GIGFLOW_BACKUP_EXTRA_PATH:-}" ]]; then
  PATH="${GIGFLOW_BACKUP_EXTRA_PATH}:${SAFE_PATH}"
else
  PATH="$SAFE_PATH"
fi
export PATH

ROOT="${GIGFLOW_ROOT:-/opt/gigflow}"
ENV_FILE="${GIGFLOW_ENV_FILE:-$ROOT/.env.production}"
COMPOSE_FILE="$ROOT/deploy/digitalocean/docker-compose.prod.yml"
BACKUP_DIR="${GIGFLOW_BACKUP_DIR:-$ROOT/deploy/digitalocean/backups}"
STATE_DIR="${GIGFLOW_BACKUP_STATE_DIR:-/home/deploy/.gigflow}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
LOG_FILE="$STATE_DIR/backup.log"
STATUS_FILE="$STATE_DIR/backup.status"
LOCK_FILE="$STATE_DIR/backup.lock"
LOG_MAX_BYTES="${GIGFLOW_BACKUP_LOG_MAX_BYTES:-1048576}"
STATUS_WRITTEN=no
LOCK_HELD=no
FILE=""

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  RETENTION_DAYS=14
fi

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
chmod 700 "$STATE_DIR" || true
[[ -f "$LOG_FILE" ]] && chmod 600 "$LOG_FILE" || true

rotate_log() {
  [[ -f "$LOG_FILE" ]] || return 0
  local bytes
  bytes="$(stat -c%s "$LOG_FILE" 2>/dev/null || wc -c < "$LOG_FILE" | tr -d '[:space:]')"
  if [[ "$bytes" -gt "$LOG_MAX_BYTES" ]]; then
    tail -n 400 "$LOG_FILE" > "$LOG_FILE.rotating"
    mv "$LOG_FILE.rotating" "$LOG_FILE"
    chmod 600 "$LOG_FILE" || true
  fi
}

log_line() {
  rotate_log || true
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
  chmod 600 "$LOG_FILE" || true
}

write_status() {
  local result="$1" name="$2" bytes="$3" offsite="$4" detail="$5" tmp
  tmp="$(mktemp "$STATE_DIR/backup.status.XXXXXX")"
  {
    printf 'time=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'result=%s\n' "$result"
    printf 'file=%s\n' "$name"
    printf 'bytes=%s\n' "$bytes"
    printf 'offsite=%s\n' "$offsite"
    printf 'offsite_detail=%s\n' "$detail"
  } > "$tmp"
  chmod 600 "$tmp" || true
  mv "$tmp" "$STATUS_FILE"
  STATUS_WRITTEN=yes
}

fail_local() {
  local reason="$1"
  [[ -n "$FILE" ]] && rm -f "$FILE"
  log_line "result=failure file= bytes=0 offsite=not-attempted detail=${reason}"
  write_status failure "" 0 "not-attempted" "$reason"
  exit 1
}

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ "$rc" -ne 0 && "$STATUS_WRITTEN" != "yes" && "$LOCK_HELD" == "yes" ]]; then
    [[ -n "$FILE" ]] && rm -f "$FILE"
    log_line "result=failure file= bytes=0 offsite=not-attempted detail=exit-${rc}" || true
    write_status failure "" 0 "not-attempted" "exit-${rc}" || true
  fi
}
trap cleanup EXIT

if ! command -v flock >/dev/null 2>&1; then
  log_line "result=failure file= bytes=0 offsite=not-attempted detail=flock-missing"
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log_line "result=failure file= bytes=0 offsite=not-attempted detail=backup-already-running"
  exit 1
fi
LOCK_HELD=yes

cd "$ROOT"
# shellcheck disable=SC1090
source "$ENV_FILE"
PATH="${GIGFLOW_BACKUP_EXTRA_PATH:+$GIGFLOW_BACKUP_EXTRA_PATH:}${SAFE_PATH}"
export PATH

STAMP="$(date -u +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/gigflow_${STAMP}.sql.gz"

if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-gigflow}" -d "${POSTGRES_DB:-gigflow}" --no-owner --clean \
  | gzip > "$FILE"; then
  fail_local "pg_dump-or-gzip-failed"
fi

if ! gzip -t "$FILE"; then
  fail_local "gzip-integrity-failed"
fi

bytes="$(stat -c%s "$FILE" 2>/dev/null || wc -c < "$FILE" | tr -d '[:space:]')"
if [[ "$bytes" -le 0 ]]; then
  fail_local "backup-empty"
fi

if ! gzip -dc "$FILE" | awk '
  $0 == "-- PostgreSQL database dump" { header = 1 }
  $0 == "-- PostgreSQL database dump complete" { complete = 1 }
  END { exit !(header && complete) }
'; then
  fail_local "invalid-postgres-dump"
fi

chmod 600 "$FILE" || true

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' \
  ! -name "$(basename "$FILE")" -mtime +"$RETENTION_DAYS" -delete

offsite="disabled"
detail="spaces-not-configured"
if [[ -n "${SPACES_BUCKET:-}" && -n "${SPACES_ACCESS_KEY_ID:-}" && -n "${SPACES_SECRET_ACCESS_KEY:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    offsite="skipped"
    detail="aws-cli-missing"
    log_line "Spaces upload skipped: aws CLI is not installed; local backup kept"
  else
    ENDPOINT="${SPACES_ENDPOINT:-https://nyc3.digitaloceanspaces.com}"
    REGION="${SPACES_REGION:-nyc3}"
    KEY="backups/postgres/$(basename "$FILE")"
    if AWS_ACCESS_KEY_ID="$SPACES_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$SPACES_SECRET_ACCESS_KEY" \
      aws s3 cp "$FILE" "s3://${SPACES_BUCKET}/${KEY}" \
      --endpoint-url "$ENDPOINT" --region "$REGION" >/dev/null 2>&1; then
      offsite="uploaded"
      detail="ok"
      log_line "Spaces upload succeeded for $(basename "$FILE"); local backup kept"
    else
      offsite="failed"
      detail="upload-failed"
      log_line "Spaces upload failed for $(basename "$FILE"); local backup kept"
    fi
  fi
fi

log_line "result=success file=$(basename "$FILE") bytes=${bytes} offsite=${offsite} detail=${detail}"
write_status success "$(basename "$FILE")" "$bytes" "$offsite" "$detail"
echo "Backup saved: $FILE"
