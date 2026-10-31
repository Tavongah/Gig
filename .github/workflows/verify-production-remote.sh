#!/usr/bin/env bash
# One-shot production verification. Read-only except the existing Postgres backup.
# Does not deploy, fetch, reset, migrate, or change application flags.
set -u

echo "===VERIFY_START==="
echo "DEPLOY_SH_EXECUTED=no"
echo "MIGRATIONS_APPLIED_BY_THIS_RUN=no"
echo "MAIN_UPDATED_BY_THIS_RUN=no"
echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "HOSTNAME=$(hostname 2>/dev/null || true)"
echo "HOSTNAME_FQDN=$(hostname -f 2>/dev/null || true)"
echo "USER=$(id -un 2>/dev/null || true)"
echo "ID=$(id 2>/dev/null || true)"
echo "DNS_TARGET_MATCH=${DNS_TARGET_MATCH:-unset}"

pub="$(curl -4 -fsS --max-time 8 https://ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
if [[ "$pub" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "SERVER_PUBLIC_IPV4=$pub"
else
  echo "SERVER_PUBLIC_IPV4=unavailable"
  pub=""
fi

echo "PUBLIC_IP_DNS_MATCH=no"
for name in api.duts.tech www.duts.tech admin.duts.tech app.duts.tech duts.tech; do
  ips="$(getent ahostsv4 "$name" 2>/dev/null | awk '{print $1}' | sort -u | awk 'BEGIN{c=""} {c=c (c?",":"") $1} END{print c}')"
  echo "SERVER_DNS $name ${ips:-none}"
  if [[ -n "$pub" ]] && getent ahostsv4 "$name" 2>/dev/null | awk '{print $1}' | grep -qx "$pub"; then
    echo "PUBLIC_IP_MATCHES $name"
    if [[ "$name" == "api.duts.tech" ]]; then
      echo "PUBLIC_IP_DNS_MATCH=yes"
    fi
  fi
done

echo "DEPLOY_DIR_EXISTS=$([[ -d /opt/gigflow ]] && echo yes || echo no)"
echo "DEPLOY_DIR_REALPATH=$(readlink -f /opt/gigflow 2>/dev/null || echo missing)"
echo "DEPLOY_GIT=$([[ -d /opt/gigflow/.git ]] && echo yes || echo no)"
echo "COMPOSE_PRESENT=$([[ -f /opt/gigflow/deploy/digitalocean/docker-compose.prod.yml ]] && echo yes || echo no)"
echo "ENV_PRESENT=$([[ -f /opt/gigflow/.env.production ]] && echo yes || echo no)"
echo "BACKUP_SCRIPT_PRESENT=$([[ -f /opt/gigflow/deploy/digitalocean/scripts/backup-postgres.sh ]] && echo yes || echo no)"
echo "RESTORE_SCRIPT_PRESENT=$([[ -f /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh ]] && echo yes || echo no)"

api_domain=""
marketing_domain=""
admin_domain=""
app_domain=""
root_domain=""
app_env=""
node_env=""
seller_flag="<unset>"
spaces_configured="no"
spaces_bucket_set="no"
spaces_access_key_set="no"
spaces_secret_set="no"
spaces_endpoint_set="no"
safe_assign() {
  local key="$1"
  local value="$2"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  if [[ ${#value} -gt 80 || "$value" == *"://"* || "$value" == *" "* || "$value" == *[Pp][Aa][Ss][Ss]* || "$value" == *[Ss][Ee][Cc][Rr][Ee][Tt]* ]]; then
    value="[redacted]"
  fi
  printf -v "$key" '%s' "$value"
}
if [[ -f /opt/gigflow/.env.production ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      API_DOMAIN) safe_assign api_domain "$value" ;;
      MARKETING_DOMAIN) safe_assign marketing_domain "$value" ;;
      ADMIN_DOMAIN) safe_assign admin_domain "$value" ;;
      APP_DOMAIN) safe_assign app_domain "$value" ;;
      ROOT_DOMAIN) safe_assign root_domain "$value" ;;
      APP_ENV) safe_assign app_env "$value" ;;
      NODE_ENV) safe_assign node_env "$value" ;;
      SELLER_MARKETPLACE_ENABLED) safe_assign seller_flag "$value" ;;
      SPACES_BUCKET) [[ -n "${value//[[:space:]\"\']/}" ]] && spaces_bucket_set="yes" ;;
      SPACES_ACCESS_KEY_ID) [[ -n "${value//[[:space:]\"\']/}" ]] && spaces_access_key_set="yes" ;;
      SPACES_SECRET_ACCESS_KEY) [[ -n "${value//[[:space:]\"\']/}" ]] && spaces_secret_set="yes" ;;
      SPACES_ENDPOINT) [[ -n "${value//[[:space:]\"\']/}" ]] && spaces_endpoint_set="yes" ;;
    esac
  done < /opt/gigflow/.env.production
  if [[ "$spaces_bucket_set" == "yes" && "$spaces_access_key_set" == "yes" && "$spaces_secret_set" == "yes" ]]; then
    spaces_configured="yes"
  fi
fi
echo "API_DOMAIN=${api_domain:-<unset>}"
echo "MARKETING_DOMAIN=${marketing_domain:-<unset>}"
echo "ADMIN_DOMAIN=${admin_domain:-<unset>}"
echo "APP_DOMAIN=${app_domain:-<unset>}"
echo "ROOT_DOMAIN=${root_domain:-<unset>}"
echo "APP_ENV=${app_env:-<unset>}"
echo "NODE_ENV=${node_env:-<unset>}"
echo "SELLER_MARKETPLACE_ENABLED=${seller_flag:-<unset>}"
echo "SPACES_BACKUP_CONFIGURED=${spaces_configured:-no}"
echo "SPACES_BUCKET_SET=${spaces_bucket_set:-no}"
echo "SPACES_ACCESS_KEY_SET=${spaces_access_key_set:-no}"
echo "SPACES_SECRET_SET=${spaces_secret_set:-no}"
echo "SPACES_ENDPOINT_SET=${spaces_endpoint_set:-no}"

if [[ -d /opt/gigflow/.git ]]; then
  cd /opt/gigflow
  echo "SERVER_HEAD=$(git -c safe.directory=/opt/gigflow rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "SERVER_BRANCH=$(git -c safe.directory=/opt/gigflow rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "SERVER_ORIGIN_MAIN=$(git -c safe.directory=/opt/gigflow rev-parse origin/main 2>/dev/null || echo unknown)"
  echo "SERVER_SUBJECT=$(git -c safe.directory=/opt/gigflow log -1 --format=%s 2>/dev/null || echo unknown)"
  echo "STATUS_SB_BEGIN"
  git -c safe.directory=/opt/gigflow status -sb --untracked-files=all 2>/dev/null | grep -v -E 'deploy/digitalocean/backups/gigflow_.*\.sql\.gz' | head -n 40 || true
  echo "STATUS_SB_END"
  echo "PORCELAIN_NON_BACKUP_BEGIN"
  git -c safe.directory=/opt/gigflow status --porcelain=v1 --untracked-files=all 2>/dev/null | grep -v -E 'deploy/digitalocean/backups/' | head -n 40 || true
  echo "PORCELAIN_NON_BACKUP_END"
  echo "BACKUP_UNTRACKED_COUNT=$(git -c safe.directory=/opt/gigflow status --porcelain=v1 --untracked-files=all 2>/dev/null | grep -c 'deploy/digitalocean/backups/' || true)"
  if git -c safe.directory=/opt/gigflow grep -I -n -q SELLER_MARKETPLACE_ENABLED -- . ':(exclude)*.lock' >/dev/null 2>&1; then
    echo "SELLER_CODE_IN_TREE=yes"
  else
    echo "SELLER_CODE_IN_TREE=no"
  fi
  echo "SELLER_MIGRATION_DIRS_BEGIN"
  find /opt/gigflow/apps/api/prisma/migrations -maxdepth 1 -type d -iname '*seller*' -print 2>/dev/null || true
  echo "SELLER_MIGRATION_DIRS_END"
else
  echo "SERVER_HEAD=missing"
  echo "SERVER_BRANCH=missing"
  echo "SELLER_CODE_IN_TREE=unknown"
fi

echo "DISK_BEGIN"
df -hP / /opt /var /opt/gigflow /opt/gigflow/deploy/digitalocean/backups 2>/dev/null || df -hP
echo "DISK_END"

echo "DOCKER_OK=no"
if docker info >/dev/null 2>&1; then
  echo "DOCKER_OK=yes"
  echo "DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)"
  echo "CONTAINER_NAMES_BEGIN"
  docker ps -a --format '{{.Names}}' 2>/dev/null || true
  echo "CONTAINER_NAMES_END"
  echo "CONTAINERS_BEGIN"
  docker ps -aq 2>/dev/null | while read -r cid; do
    [[ -n "$cid" ]] || continue
    docker inspect --format '{{.Name}}|svc={{index .Config.Labels "com.docker.compose.service"}}|project={{index .Config.Labels "com.docker.compose.project"}}|created={{.Created}}|status={{.State.Status}}|health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid" 2>/dev/null || true
  done
  echo "CONTAINERS_END"
  api_id="$(docker ps -aq --filter label=com.docker.compose.service=api --filter label=com.docker.compose.project=gigflow | head -n 1 || true)"
  if [[ -n "$api_id" ]]; then
    echo "API_HEALTH_HTTP_BEGIN"
    docker exec "$api_id" wget -q -O - http://127.0.0.1:4000/health 2>/dev/null | head -c 200 || echo "API_HEALTH_HTTP=unavailable"
    echo
    echo "API_HEALTH_HTTP_END"
  else
    echo "API_HEALTH_HTTP=no_container"
  fi
  pg_id="$(docker ps -aq --filter label=com.docker.compose.service=postgres --filter label=com.docker.compose.project=gigflow | head -n 1 || true)"
  if [[ -n "$pg_id" ]]; then
    db_name="$(docker exec "$pg_id" sh -c 'printf %s "$POSTGRES_DB"' 2>/dev/null || true)"
    db_user="$(docker exec "$pg_id" sh -c 'printf %s "$POSTGRES_USER"' 2>/dev/null || true)"
    echo "POSTGRES_DB_NAME=${db_name:-unknown}"
    echo "POSTGRES_DB_USER=${db_user:-unknown}"
    if [[ -n "$db_name" && -n "$db_user" ]]; then
      echo "SELLER_TABLES_BEGIN"
      docker exec "$pg_id" psql -U "$db_user" -d "$db_name" -Atc "select tablename from pg_tables where schemaname='public' and tablename ilike '%seller%' order by 1" 2>/dev/null || echo "SELLER_TABLES_QUERY=unavailable"
      echo "SELLER_TABLES_END"
      echo "MIGRATION_NAMES_BEGIN"
      docker exec "$pg_id" psql -U "$db_user" -d "$db_name" -Atc "select migration_name from _prisma_migrations order by finished_at" 2>/dev/null || echo "MIGRATION_QUERY=unavailable"
      echo "MIGRATION_NAMES_END"
    fi
  fi
else
  echo "DOCKER_INFO=failed"
fi

echo "LOCAL_HTTP_BEGIN"
if curl -fsS --max-time 15 --resolve api.duts.tech:443:127.0.0.1 https://api.duts.tech/health 2>/dev/null | head -c 200; then
  echo
else
  echo "API_LOCAL_HTTPS=unavailable"
fi
if curl -fsS --max-time 15 --resolve www.duts.tech:443:127.0.0.1 https://www.duts.tech/health 2>/dev/null | head -c 80; then
  echo
else
  echo "MARKETING_LOCAL_HTTPS=unavailable"
fi
echo "LOCAL_HTTP_END"

echo "CRON_FILE_EXISTS=$([[ -f /etc/cron.d/gigflow-backup ]] && echo yes || echo no)"
if [[ -r /etc/cron.d/gigflow-backup ]]; then
  echo "CRON_FILE_READABLE=yes"
  echo "CRON_CONTENT_BEGIN"
  grep -E 'backup-postgres|^#|^[[:space:]]*[0-9*]' /etc/cron.d/gigflow-backup || true
  echo "CRON_CONTENT_END"
elif [[ -f /etc/cron.d/gigflow-backup ]] && sudo -n test -r /etc/cron.d/gigflow-backup 2>/dev/null; then
  echo "CRON_FILE_READABLE=sudo"
  echo "CRON_CONTENT_BEGIN"
  sudo -n grep -E 'backup-postgres|^#|^[[:space:]]*[0-9*]' /etc/cron.d/gigflow-backup || true
  echo "CRON_CONTENT_END"
else
  echo "CRON_FILE_READABLE=no"
  ls -l /etc/cron.d/gigflow-backup 2>&1 | sed -E 's/(PASSWORD|SECRET|TOKEN)=[^ ]*/\1=[REDACTED]/Ig' || true
  echo "CRON_SEARCH_BEGIN"
  grep -l 'backup-postgres.sh' /etc/crontab /etc/cron.d/* /var/spool/cron/crontabs/* 2>/dev/null || echo "CRON_SEARCH=no-readable-match"
  echo "CRON_SEARCH_END"
fi
if [[ -r /var/log/gigflow-backup.log ]]; then
  echo "BACKUP_LOG_BEGIN"
  grep -E 'Backup saved|Spaces upload|error|Error|cannot|Cannot' /var/log/gigflow-backup.log | grep -viE 'password|secret|token|postgres://' | tail -n 15 || true
  echo "BACKUP_LOG_END"
elif sudo -n test -r /var/log/gigflow-backup.log 2>/dev/null; then
  echo "BACKUP_LOG_BEGIN"
  sudo -n grep -E 'Backup saved|Spaces upload|error|Error|cannot|Cannot' /var/log/gigflow-backup.log | grep -viE 'password|secret|token|postgres://' | tail -n 15 || true
  echo "BACKUP_LOG_END"
else
  echo "BACKUP_LOG=unreadable"
fi

echo "BACKUP_DIR_EXISTS=$([[ -d /opt/gigflow/deploy/digitalocean/backups ]] && echo yes || echo no)"
echo "BACKUP_DIR_LISTING_BEGIN"
if [[ -d /opt/gigflow/deploy/digitalocean/backups ]]; then
  find /opt/gigflow/deploy/digitalocean/backups -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -printf '%T@ %s %p\n' | sort -n || true
fi
echo "BACKUP_DIR_LISTING_END"

latest=""
latest_size=0
if [[ -d /opt/gigflow/deploy/digitalocean/backups ]]; then
  latest="$(find /opt/gigflow/deploy/digitalocean/backups -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2- || true)"
fi
if [[ -n "$latest" && -f "$latest" ]]; then
  latest_size="$(stat -c %s "$latest")"
  echo "EXISTING_BACKUP_NAME=$(basename "$latest")"
  echo "EXISTING_BACKUP_SIZE=$latest_size"
  echo "EXISTING_BACKUP_UTC=$(date -u -d "@$(stat -c %Y "$latest")" +%Y-%m-%dT%H:%M:%SZ)"
  echo "EXISTING_BACKUP_ET=$(TZ=America/New_York date -d "@$(stat -c %Y "$latest")" +%Y-%m-%dT%H:%M:%S%z)"
else
  echo "EXISTING_BACKUP_NAME=none"
  echo "EXISTING_BACKUP_SIZE=0"
fi

if [[ -f /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh ]]; then
  echo "RESTORE_EXECUTABLE=$([[ -x /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh ]] && echo yes || echo no)"
  echo "RESTORE_SHA256=$(sha256sum /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh | awk '{print $1}')"
  grep -q 'Type RESTORE' /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh && echo "RESTORE_REQUIRES_CONFIRMATION=yes" || echo "RESTORE_REQUIRES_CONFIRMATION=no"
  grep -q 'stop api' /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh && echo "RESTORE_STOPS_API=yes" || echo "RESTORE_STOPS_API=no"
  grep -q 'gunzip -c' /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh && echo "RESTORE_GUNZIP=yes" || echo "RESTORE_GUNZIP=no"
  grep -q 'up -d api' /opt/gigflow/deploy/digitalocean/scripts/restore-postgres.sh && echo "RESTORE_STARTS_API=yes" || echo "RESTORE_STARTS_API=no"
  echo "RESTORE_EXECUTED=no"
fi

if [[ -f /opt/gigflow/deploy/digitalocean/scripts/deploy.sh ]]; then
  echo "DEPLOY_SH_SHA256=$(sha256sum /opt/gigflow/deploy/digitalocean/scripts/deploy.sh | awk '{print $1}')"
  echo "DEPLOY_SH_EXCERPT_BEGIN"
  nl -ba /opt/gigflow/deploy/digitalocean/scripts/deploy.sh | sed -n '1,60p'
  echo "DEPLOY_SH_EXCERPT_END"
  awk '
    /git .*fetch origin main/ { if (!fetch) fetch=NR }
    /git .*reset --hard origin\/main/ { if (!reset) reset=NR }
    /rev-parse HEAD/ && /PREVIOUS_COMMIT/ { capture=NR }
    END {
      print "LINE_FETCH=" fetch+0
      print "LINE_RESET=" reset+0
      print "LINE_CAPTURE=" capture+0
      if (capture>reset && reset>0) print "ROLLBACK_DEFECT=confirmed"
      else print "ROLLBACK_DEFECT=not_confirmed"
    }
  ' /opt/gigflow/deploy/digitalocean/scripts/deploy.sh
else
  echo "ROLLBACK_DEFECT=not_confirmed"
  echo "DEPLOY_SH_MISSING=yes"
fi

echo "RELEASE_PATH=/var/lib/gigflow/RELEASE_SHA"
if [[ -d /var/lib/gigflow ]]; then
  echo "RELEASE_DIR_EXISTS=yes"
  stat -c 'RELEASE_DIR_META=%U:%G %a %F' /var/lib/gigflow
  [[ -w /var/lib/gigflow ]] && echo "RELEASE_DIR_WRITABLE=yes" || echo "RELEASE_DIR_WRITABLE=no"
else
  echo "RELEASE_DIR_EXISTS=no"
  echo "RELEASE_DIR_WRITABLE=no"
fi
if [[ -d /var/lib ]]; then
  stat -c 'VAR_LIB_META=%U:%G %a %F' /var/lib
  [[ -w /var/lib ]] && echo "VAR_LIB_WRITABLE=yes" || echo "VAR_LIB_WRITABLE=no"
fi
echo "RELEASE_MOUNT_BEGIN"
findmnt -T /var/lib -no TARGET,SOURCE,FSTYPE 2>/dev/null || true
echo "RELEASE_MOUNT_END"
if [[ -e /var/lib/gigflow/RELEASE_SHA ]]; then
  echo "RELEASE_SHA_EXISTS=yes"
  if [[ "$(stat -c %s /var/lib/gigflow/RELEASE_SHA 2>/dev/null || echo 999)" -lt 80 ]] && grep -Eq '^[0-9a-f]{40}[[:space:]]*$' /var/lib/gigflow/RELEASE_SHA; then
    echo "RELEASE_SHA_CURRENT=$(tr -d '[:space:]' < /var/lib/gigflow/RELEASE_SHA)"
  else
    echo "RELEASE_SHA_CURRENT=present_not_plain_sha"
  fi
else
  echo "RELEASE_SHA_EXISTS=no"
fi
sudo -n true >/dev/null 2>&1 && echo "SUDO_NOPASSWD=yes" || echo "SUDO_NOPASSWD=no"

identity="no"
if [[ "${DNS_TARGET_MATCH:-}" == "yes" && -d /opt/gigflow/.git && -f /opt/gigflow/deploy/digitalocean/docker-compose.prod.yml && "$api_domain" == "api.duts.tech" ]]; then
  identity="yes"
fi
echo "SERVER_IDENTITY=$identity"

if [[ "$identity" != "yes" ]]; then
  echo "FRESH_BACKUP=SKIPPED_IDENTITY"
  echo "===VERIFY_END==="
  exit 0
fi

avail_kb="$(df -Pk /opt/gigflow | awk 'NR==2{print $4}')"
echo "AVAIL_KB=$avail_kb"
reserve_kb=$((200 * 1024))
need_kb=$reserve_kb
if [[ "$latest_size" -gt 0 ]]; then
  need_kb=$(( reserve_kb + (latest_size / 1024 * 2) ))
fi
if [[ "${avail_kb:-0}" -lt "$need_kb" ]]; then
  echo "FRESH_BACKUP=SKIPPED_LOW_DISK"
  echo "DISK_NEED_KB=$need_kb"
  echo "===VERIFY_END==="
  exit 0
fi

echo "FRESH_BACKUP_COMMAND=backup-postgres.sh"
tmp_out="$(mktemp)"
tmp_err="$(mktemp)"
bash /opt/gigflow/deploy/digitalocean/scripts/backup-postgres.sh >"$tmp_out" 2>"$tmp_err"
backup_rc=$?
echo "BACKUP_EXIT=$backup_rc"
echo "BACKUP_STDOUT_BEGIN"
sed -E \
  -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED]#Ig' \
  -e 's#((PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY_ID|ACCESS_KEY)[=:][^[:space:]]*)#\2=[REDACTED]#Ig' \
  "$tmp_out" || true
echo "BACKUP_STDOUT_END"
echo "BACKUP_STDERR_BEGIN"
sed -E \
  -e 's#(postgres(ql)?://)[^[:space:]]+#\1[REDACTED]#Ig' \
  -e 's#((PASSWORD|SECRET|TOKEN|PRIVATE_KEY|ACCESS_KEY_ID|ACCESS_KEY)[=:][^[:space:]]*)#\2=[REDACTED]#Ig' \
  "$tmp_err" || true
echo "BACKUP_STDERR_END"
rm -f "$tmp_out" "$tmp_err"

fresh="$(find /opt/gigflow/deploy/digitalocean/backups -maxdepth 1 -type f -name 'gigflow_*.sql.gz' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2- || true)"
if [[ -z "$fresh" || ! -f "$fresh" ]]; then
  echo "FRESH_BACKUP=NO"
  echo "===VERIFY_END==="
  exit 0
fi
if [[ -n "$latest" && "$fresh" == "$latest" && "$backup_rc" -ne 0 ]]; then
  echo "FRESH_BACKUP=NO"
  echo "FRESH_BACKUP_NOTE=newest_file_is_previous_backup"
  echo "===VERIFY_END==="
  exit 0
fi

fresh_size="$(stat -c %s "$fresh")"
echo "FRESH_BACKUP=YES"
echo "FRESH_BACKUP_NAME=$(basename "$fresh")"
echo "FRESH_BACKUP_PATH=$fresh"
echo "FRESH_BACKUP_SIZE=$fresh_size"
echo "FRESH_BACKUP_UTC=$(date -u -d "@$(stat -c %Y "$fresh")" +%Y-%m-%dT%H:%M:%SZ)"
echo "FRESH_BACKUP_ET=$(TZ=America/New_York date -d "@$(stat -c %Y "$fresh")" +%Y-%m-%dT%H:%M:%S%z)"
echo "FRESH_BACKUP_REALPATH=$(readlink -f "$fresh")"
if [[ "$fresh_size" -gt 0 ]]; then
  echo "FRESH_NONZERO=yes"
else
  echo "FRESH_NONZERO=no"
fi

if gzip -t "$fresh"; then
  echo "GZIP_INTEGRITY=ok"
else
  echo "GZIP_INTEGRITY=fail"
fi

gzip -dc "$fresh" | awk '
  BEGIN { header=0; complete=0; lines=0 }
  {
    lines++
    if (lines<=12) {
      if ($0 ~ /^--/ || $0 ~ /^SET / || $0 ~ /^SELECT / || $0 ~ /^$/ || $0 ~ /^\\/) print "HEADER_LINE:" $0
      else print "HEADER_UNEXPECTED=yes"
    }
    if ($0 ~ /PostgreSQL database dump/) header=1
    if ($0 ~ /PostgreSQL database dump complete/) complete=1
  }
  END {
    print "PG_LINES=" lines+0
    print "PG_HEADER=" (header ? "yes" : "no")
    print "PG_COMPLETE=" (complete ? "yes" : "no")
  }
'
echo "BACKUP_MOUNT_BEGIN"
df -P "$fresh" || true
findmnt -T "$fresh" -no TARGET,SOURCE,FSTYPE || true
echo "BACKUP_MOUNT_END"
mount_src="$(findmnt -T "$fresh" -no SOURCE 2>/dev/null || true)"
echo "BACKUP_MOUNT_SOURCE=${mount_src:-unknown}"
case "$mount_src" in
  overlay*|*/docker/overlay2/*|*/containerd/*|tmpfs)
    echo "BACKUP_EPHEMERAL=yes"
    ;;
  *)
    echo "BACKUP_EPHEMERAL=no"
    ;;
esac
case "$fresh" in
  /opt/gigflow/deploy/digitalocean/backups/*)
    echo "BACKUP_OUTSIDE_CONTAINER_STORAGE=yes"
    ;;
  *)
    echo "BACKUP_OUTSIDE_CONTAINER_STORAGE=no"
    ;;
esac

echo "===VERIFY_END==="
exit 0
