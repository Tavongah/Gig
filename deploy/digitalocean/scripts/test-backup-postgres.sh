#!/usr/bin/env bash
# Non-production checks for the daily Postgres backup script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SH="$SCRIPT_DIR/backup-postgres.sh"
BOOTSTRAP_SH="$SCRIPT_DIR/server-bootstrap.sh"
RESTORE_SH="$SCRIPT_DIR/restore-postgres.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

bash -n "$BACKUP_SH"
pass "backup script syntax"

bash -n "$BOOTSTRAP_SH"
pass "bootstrap syntax"

cron_line="$(grep -F '/usr/bin/bash $APP_DIR/deploy/digitalocean/scripts/backup-postgres.sh' "$BOOTSTRAP_SH")"
[[ "$cron_line" == *"15 3 * * * \$DEPLOY_USER /usr/bin/bash \$APP_DIR/deploy/digitalocean/scripts/backup-postgres.sh >> /home/\$DEPLOY_USER/.gigflow/backup.log 2>&1" ]] \
  || fail "cron command is not an explicit bash invocation as the deploy user"
if grep -F '/var/log/gigflow-backup.log' "$BOOTSTRAP_SH" >/dev/null; then
  fail "bootstrap still logs backups to /var/log"
fi
pass "cron command"

if ! grep -F 'gunzip -c "$BACKUP"' "$RESTORE_SH" >/dev/null; then
  fail "restore script does not read a gzipped SQL dump"
fi
if grep -E 'pg_restore|custom format' "$RESTORE_SH" >/dev/null; then
  fail "restore script expects a different dump format"
fi
pass "restore compatibility by inspection"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

write_env() {
  local path="$1"
  shift
  : > "$path"
  local line
  for line in "$@"; do
    printf '%s\n' "$line" >> "$path"
  done
}

install_flock_stub() {
  local bin="$1"
  mkdir -p "$bin"
  cat > "$bin/flock" <<'EOF'
#!/usr/bin/env bash
held="${GIGFLOW_BACKUP_STATE_DIR:-}/backup.lock.held"
if [[ -n "${GIGFLOW_BACKUP_STATE_DIR:-}" && -f "$held" ]]; then
  exit 1
fi
exit 0
EOF
  chmod 700 "$bin/flock"
}

make_docker() {
  local bin="$1" mode="$2"
  mkdir -p "$bin"
  install_flock_stub "$bin"
  if [[ "$mode" == "ok" ]]; then
    cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == *pg_dump* ]] || exit 2
printf '%s\n' "-- PostgreSQL database dump" "-- PostgreSQL database dump complete"
EOF
  elif [[ "$mode" == "fail" ]]; then
    cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "pg_dump failed" >&2
exit 1
EOF
  elif [[ "$mode" == "invalid" ]]; then
    cat > "$bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "not a database dump"
EOF
  else
    fail "unknown docker mode $mode"
  fi
  chmod 700 "$bin/docker"
}

make_aws() {
  local bin="$1" code="$2"
  cat > "$bin/aws" <<EOF
#!/usr/bin/env bash
if [[ "\${AWS_SECRET_ACCESS_KEY:-}" != "spaces-secret-do-not-log" ]]; then
  exit 3
fi
exit $code
EOF
  chmod 700 "$bin/aws"
}

run_backup() {
  local extra="$1" env_file="$2" backup_dir="$3" state_dir="$4" retention="${5:-14}"
  local cwd="$WORK/cwd-$RANDOM"
  mkdir -p "$cwd" "$state_dir"
  (
    cd "$cwd"
    /usr/bin/env -i \
      PATH="/usr/bin:/bin" \
      HOME="${HOME:-/tmp}" \
      GIGFLOW_ROOT="$WORK/root" \
      GIGFLOW_ENV_FILE="$env_file" \
      GIGFLOW_BACKUP_DIR="$backup_dir" \
      GIGFLOW_BACKUP_STATE_DIR="$state_dir" \
      GIGFLOW_BACKUP_EXTRA_PATH="$extra" \
      BACKUP_RETENTION_DAYS="$retention" \
      /usr/bin/bash "$BACKUP_SH"
  )
}

seed_unrelated() {
  local backup_dir="$1"
  mkdir -p "$backup_dir"
  printf 'keep\n' > "$backup_dir/.gitkeep"
  printf 'notes\n' > "$backup_dir/notes.txt"
  printf '#!/bin/sh\n' > "$backup_dir/restore-postgres.sh"
  printf 'old\n' | gzip > "$backup_dir/gigflow_old.sql.gz"
  touch -d "20 days ago" "$backup_dir/gigflow_old.sql.gz"
  printf 'recent\n' | gzip > "$backup_dir/gigflow_recent.sql.gz"
  touch -d "1 day ago" "$backup_dir/gigflow_recent.sql.gz"
}

assert_kept_unrelated() {
  local backup_dir="$1"
  [[ -f "$backup_dir/.gitkeep" ]] || fail "retention removed .gitkeep"
  [[ -f "$backup_dir/notes.txt" ]] || fail "retention removed unrelated notes"
  [[ -f "$backup_dir/restore-postgres.sh" ]] || fail "retention removed restore script"
}

mkdir -p "$WORK/root"
write_env "$WORK/plain.env" "POSTGRES_USER=gigflow" "POSTGRES_DB=gigflow"

# Successful local backup, retention, and no Spaces claim.
ok_bin="$WORK/bin-ok"
ok_dir="$WORK/backups-ok"
ok_state="$WORK/state-ok"
make_docker "$ok_bin" ok
seed_unrelated "$ok_dir"
run_backup "$ok_bin" "$WORK/plain.env" "$ok_dir" "$ok_state" 14
[[ -f "$ok_dir/gigflow_old.sql.gz" ]] && fail "old backup was kept past 14 days"
[[ -f "$ok_dir/gigflow_recent.sql.gz" ]] || fail "recent backup was deleted"
new_count="$(find "$ok_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' | wc -l | tr -d '[:space:]')"
[[ "$new_count" -eq 2 ]] || fail "expected the recent backup plus the new backup, found $new_count"
assert_kept_unrelated "$ok_dir"
new_file="$(find "$ok_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' ! -name 'gigflow_recent.sql.gz' -print -quit)"
[[ -n "$new_file" ]] || fail "new backup missing"
[[ -s "$new_file" ]] || fail "new backup is empty"
gzip -t "$new_file"
gzip -dc "$new_file" | awk '
  $0 == "-- PostgreSQL database dump" { header = 1 }
  $0 == "-- PostgreSQL database dump complete" { complete = 1 }
  END { exit !(header && complete) }
'
grep -q '^result=success$' "$ok_state/backup.status"
grep -q '^offsite=disabled$' "$ok_state/backup.status"
pass "local backup, gzip, dump structure, retention"

# pg_dump failure must fail and must not delete the previous backup.
fail_bin="$WORK/bin-fail"
fail_dir="$WORK/backups-fail"
fail_state="$WORK/state-fail"
make_docker "$fail_bin" fail
seed_unrelated "$fail_dir"
set +e
run_backup "$fail_bin" "$WORK/plain.env" "$fail_dir" "$fail_state" 14
fail_rc=$?
set -e
[[ "$fail_rc" -ne 0 ]] || fail "pg_dump failure returned success"
[[ -f "$fail_dir/gigflow_old.sql.gz" ]] || fail "failed backup deleted the previous dump"
grep -q '^result=failure$' "$fail_state/backup.status"
grep -q 'pg_dump-or-gzip-failed' "$fail_state/backup.status"
pass "pg_dump failure"

# Invalid dump contents must fail and remove the bad archive.
bad_bin="$WORK/bin-bad"
bad_dir="$WORK/backups-bad"
bad_state="$WORK/state-bad"
make_docker "$bad_bin" invalid
seed_unrelated "$bad_dir"
set +e
run_backup "$bad_bin" "$WORK/plain.env" "$bad_dir" "$bad_state" 14
bad_rc=$?
set -e
[[ "$bad_rc" -ne 0 ]] || fail "invalid dump returned success"
bad_new="$(find "$bad_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' ! -name 'gigflow_old.sql.gz' ! -name 'gigflow_recent.sql.gz' | wc -l | tr -d '[:space:]')"
[[ "$bad_new" -eq 0 ]] || fail "invalid dump was kept"
[[ -f "$bad_dir/gigflow_recent.sql.gz" ]] || fail "invalid run removed a valid backup"
grep -q 'invalid-postgres-dump' "$bad_state/backup.status"
pass "invalid dump failure"

# gzip failure must fail the job.
gzip_bin="$WORK/bin-gzip"
gzip_dir="$WORK/backups-gzip"
gzip_state="$WORK/state-gzip"
make_docker "$gzip_bin" ok
cat > "$gzip_bin/gzip" <<'EOF'
#!/usr/bin/env bash
echo "gzip failed" >&2
exit 1
EOF
chmod 700 "$gzip_bin/gzip"
set +e
run_backup "$gzip_bin" "$WORK/plain.env" "$gzip_dir" "$gzip_state" 14
gzip_rc=$?
set -e
[[ "$gzip_rc" -ne 0 ]] || fail "gzip failure returned success"
kept="$(find "$gzip_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' 2>/dev/null | wc -l | tr -d '[:space:]')"
[[ "$kept" -eq 0 ]] || fail "gzip failure left a backup file"
grep -q 'pg_dump-or-gzip-failed' "$gzip_state/backup.status"
pass "gzip failure"

# Spaces failure is logged and does not delete the local backup.
secret="spaces-secret-do-not-log"
write_env "$WORK/spaces.env" \
  "POSTGRES_USER=gigflow" \
  "POSTGRES_DB=gigflow" \
  "SPACES_BUCKET=test-bucket" \
  "SPACES_ACCESS_KEY_ID=test-access-key" \
  "SPACES_SECRET_ACCESS_KEY=$secret" \
  "SPACES_ENDPOINT=https://example.invalid" \
  "SPACES_REGION=nyc3"
spaces_bin="$WORK/bin-spaces"
spaces_dir="$WORK/backups-spaces"
spaces_state="$WORK/state-spaces"
make_docker "$spaces_bin" ok
make_aws "$spaces_bin" 1
run_backup "$spaces_bin" "$WORK/spaces.env" "$spaces_dir" "$spaces_state" 14
[[ -s "$(find "$spaces_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -print -quit)" ]] \
  || fail "local backup missing after Spaces failure"
grep -q '^result=success$' "$spaces_state/backup.status"
grep -q '^offsite=failed$' "$spaces_state/backup.status"
grep -q 'upload-failed' "$spaces_state/backup.status"
if grep -R -F "$secret" "$spaces_state" "$spaces_dir" >/dev/null 2>&1; then
  fail "Spaces secret was written to backup state"
fi
pass "Spaces failure keeps local backup"

# Missing aws CLI skips upload and still succeeds.
skip_bin="$WORK/bin-skip"
skip_dir="$WORK/backups-skip"
skip_state="$WORK/state-skip"
make_docker "$skip_bin" ok
run_backup "$skip_bin" "$WORK/spaces.env" "$skip_dir" "$skip_state" 14
grep -q '^offsite=skipped$' "$skip_state/backup.status"
grep -q 'aws-cli-missing' "$skip_state/backup.status"
[[ -s "$(find "$skip_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -print -quit)" ]] \
  || fail "local backup missing when aws CLI is absent"
if grep -R -F "$secret" "$skip_state" >/dev/null 2>&1; then
  fail "Spaces secret was written while reporting aws CLI missing"
fi
pass "missing aws CLI does not fail local backup"

# Successful upload must not delete the local file.
up_bin="$WORK/bin-up"
up_dir="$WORK/backups-up"
up_state="$WORK/state-up"
make_docker "$up_bin" ok
make_aws "$up_bin" 0
run_backup "$up_bin" "$WORK/spaces.env" "$up_dir" "$up_state" 14
grep -q '^offsite=uploaded$' "$up_state/backup.status"
[[ -s "$(find "$up_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -print -quit)" ]] \
  || fail "local backup deleted after upload"
pass "Spaces upload keeps local backup"

# A second run while the lock is held must not start another dump.
# The stub reports the lock as busy. Production uses /usr/bin/flock on the fd.
lock_dir="$WORK/backups-lock"
lock_state="$WORK/state-lock"
lock_bin="$WORK/bin-lock"
make_docker "$lock_bin" ok
mkdir -p "$lock_state" "$lock_dir"
printf 'held\n' > "$lock_state/backup.lock.held"
set +e
run_backup "$lock_bin" "$WORK/plain.env" "$lock_dir" "$lock_state" 14
lock_rc=$?
set -e
[[ "$lock_rc" -ne 0 ]] || fail "overlapping backup returned success"
[[ ! -e "$lock_state/backup.status" ]] || fail "overlapping backup replaced the status file"
locked_files="$(find "$lock_dir" -maxdepth 1 -type f -name 'gigflow_*.sql.gz' 2>/dev/null | wc -l | tr -d '[:space:]')"
[[ "$locked_files" -eq 0 ]] || fail "overlapping backup created a dump"
grep -q 'backup-already-running' "$lock_state/backup.log"
pass "overlap protection"

echo "ALL_BACKUP_TESTS=PASS"
