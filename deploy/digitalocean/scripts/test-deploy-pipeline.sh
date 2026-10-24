#!/usr/bin/env bash
# Non-production checks for deploy rollback, release metadata, and secret preflight.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEPLOY_SH="$REPO_ROOT/deploy/digitalocean/scripts/deploy.sh"
PREFLIGHT_SH="$REPO_ROOT/deploy/digitalocean/scripts/require-deploy-secrets.sh"
WORKFLOW="$REPO_ROOT/.github/workflows/deploy-digitalocean.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

bash -n "$DEPLOY_SH"
pass "deploy.sh syntax"

bash -n "$PREFLIGHT_SH"
pass "require-deploy-secrets.sh syntax"

python - "$WORKFLOW" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
try:
    import yaml
except ImportError:
    yaml = None
if yaml is not None:
    yaml.safe_load(text)
else:
    # Structural check when PyYAML is unavailable.
    if text.count("jobs:") != 1 or "appleboy/ssh-action" not in text:
        raise SystemExit("workflow structure missing jobs or ssh step")
pre = text.find("require-deploy-secrets.sh")
ssh = text.find("appleboy/ssh-action")
if pre < 0 or ssh < 0 or pre > ssh:
    raise SystemExit("secret preflight must run before SSH")
for name in ("DO_HOST", "DO_SSH_USER", "DO_SSH_KEY", "API_DOMAIN", "MARKETING_DOMAIN"):
    if f"{name}:" not in text and f"{name} " not in text:
        raise SystemExit(f"workflow does not reference {name}")
print("workflow yaml checked")
PY
pass "workflow syntax and preflight order"

capture_line="$(grep -n 'rev-parse HEAD' "$DEPLOY_SH" | head -n 1 | cut -d: -f1)"
fetch_line="$(grep -n 'fetch origin main' "$DEPLOY_SH" | head -n 1 | cut -d: -f1)"
reset_line="$(grep -n 'reset --hard origin/main' "$DEPLOY_SH" | head -n 1 | cut -d: -f1)"
[[ -n "$capture_line" && -n "$fetch_line" && -n "$reset_line" ]] || fail "could not find rollback ordering lines"
[[ "$capture_line" -lt "$fetch_line" && "$fetch_line" -lt "$reset_line" ]] || fail "PREVIOUS_COMMIT is not captured before fetch/reset"
pass "previous HEAD is captured before fetch and reset"

if grep -q 'restore-postgres.sh' "$DEPLOY_SH"; then
  fail "deploy.sh must not invoke restore-postgres.sh"
fi
pass "database restore is not automatic"

run_preflight() {
  local missing="$1"
  local out
  out="$(mktemp)"
  set +e
  env \
    DO_HOST="host-value-should-not-print" \
    DO_SSH_USER="user-value-should-not-print" \
    DO_SSH_KEY="key-value-should-not-print" \
    API_DOMAIN="api-value-should-not-print" \
    MARKETING_DOMAIN="marketing-value-should-not-print" \
    bash -c "unset ${missing}; bash \"$PREFLIGHT_SH\"" >"$out" 2>&1
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || fail "preflight succeeded while ${missing} was missing"
  grep -qx "Missing required deployment secret: ${missing}" "$out" || fail "preflight message for ${missing} was $(cat "$out")"
  if grep -q 'should-not-print' "$out"; then
    fail "preflight printed a secret value while checking ${missing}"
  fi
  rm -f "$out"
  pass "missing ${missing}"
}

run_preflight DO_HOST
run_preflight DO_SSH_USER
run_preflight DO_SSH_KEY
run_preflight API_DOMAIN
run_preflight MARKETING_DOMAIN

present_out="$(mktemp)"
env \
  DO_HOST="host-value-should-not-print" \
  DO_SSH_USER="user-value-should-not-print" \
  DO_SSH_KEY="key-value-should-not-print" \
  API_DOMAIN="api-value-should-not-print" \
  MARKETING_DOMAIN="marketing-value-should-not-print" \
  bash "$PREFLIGHT_SH" >"$present_out"
[[ ! -s "$present_out" ]] || fail "preflight printed output when secrets were present"
rm -f "$present_out"
pass "preflight accepts all required secrets without printing them"

if grep -q '/home/deploy' "$REPO_ROOT/deploy/digitalocean/docker-compose.prod.yml"; then
  fail "release directory must not be a container mount"
fi
pass "release path is outside container rebuild mounts"

make_repo() {
  local origin="$1"
  local work="$2"
  git init --bare "$origin" >/dev/null
  git init "$work" >/dev/null
  git -C "$work" checkout -B main >/dev/null
  echo a > "$work/a.txt"
  git -C "$work" add a.txt
  git -C "$work" -c user.email="test@example.com" -c user.name="test" commit -m A >/dev/null
  git -C "$work" remote add origin "$origin"
  git -C "$work" push -u origin main >/dev/null 2>&1
  echo b > "$work/b.txt"
  git -C "$work" add b.txt
  git -C "$work" -c user.email="test@example.com" -c user.name="test" commit -m B >/dev/null
  git -C "$work" push origin main >/dev/null 2>&1
  git -C "$work" reset --hard HEAD~1 >/dev/null
  mkdir -p "$work/deploy/digitalocean/scripts" "$work/deploy/nginx/conf.d"
  printf 'name: gigflow\n' > "$work/deploy/digitalocean/docker-compose.prod.yml"
  printf 'API_DOMAIN=api.example.test\nMARKETING_DOMAIN=www.example.test\n' > "$work/.env.production"
}

prepare_fakes() {
  local work="$1"
  local bin="$2"
  local health_ok="$3"
  mkdir -p "$bin"
  cat > "$work/deploy/digitalocean/scripts/render-nginx-conf.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
if [[ "\${RENDER_SHOULD_FAIL:-}" == "yes" ]]; then
  exit 1
fi
echo rendered
EOF
  cat > "$bin/docker" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "\${DOCKER_LOG:?}"
if [[ "\$*" == *exec* ]]; then
  if [[ "${health_ok}" == "yes" ]]; then
    printf '%s\n' '{"ok":true}'
    exit 0
  fi
  exit 1
fi
exit 0
EOF
  chmod +x "$bin/docker" "$work/deploy/digitalocean/scripts/render-nginx-conf.sh"
}

simulate() {
  local mode="$1"
  local tmp
  tmp="$(mktemp -d)"
  local origin="$tmp/origin.git"
  local work="$tmp/work"
  local bin="$tmp/bin"
  local release="$tmp/state/RELEASE_SHA"
  local docker_log="$tmp/docker.log"
  make_repo "$origin" "$work"
  local sha_a sha_b
  sha_a="$(git -C "$work" rev-parse HEAD)"
  sha_b="$(git -C "$origin" rev-parse main)"
  [[ "$sha_a" != "$sha_b" ]] || fail "fixture commits were not distinct"
  mkdir -p "$(dirname "$release")"
  printf '%s\n' "$sha_a" > "$release"
  if [[ "$mode" == "success" ]]; then
    prepare_fakes "$work" "$bin" yes
  else
    prepare_fakes "$work" "$bin" no
  fi
  set +e
  PATH="$bin:$PATH" \
    GIGFLOW_ROOT="$work" \
    GIGFLOW_ENV_FILE="$work/.env.production" \
    GIGFLOW_RELEASE_SHA_FILE="$release" \
    GIGFLOW_HEALTH_ATTEMPTS=1 \
    GIGFLOW_HEALTH_SLEEP_SECONDS=0 \
    DOCKER_LOG="$docker_log" \
    bash "$DEPLOY_SH" >"$tmp/deploy.out" 2>&1
  local rc=$?
  set -e
  local head recorded
  head="$(git -C "$work" rev-parse HEAD)"
  recorded="$(tr -d '[:space:]' < "$release")"
  if [[ "$mode" == "success" ]]; then
    [[ "$rc" -eq 0 ]] || fail "successful deploy exited ${rc}: $(cat "$tmp/deploy.out")"
    [[ "$head" == "$sha_b" ]] || fail "successful deploy HEAD ${head} was not target ${sha_b}"
    [[ "$recorded" == "$sha_b" ]] || fail "successful release file recorded ${recorded} instead of ${sha_b}"
    git -C "$work" reset --hard HEAD >/dev/null
    [[ "$(tr -d '[:space:]' < "$release")" == "$sha_b" ]] || fail "git reset removed the release file"
  else
    [[ "$rc" -ne 0 ]] || fail "failed deploy exited 0"
    [[ "$head" == "$sha_a" ]] || fail "rollback HEAD ${head} was not previous ${sha_a}"
    [[ "$head" != "$sha_b" ]] || fail "rollback selected the new commit"
    [[ "$recorded" == "$sha_a" ]] || fail "failed deploy release file recorded ${recorded} instead of previous ${sha_a}"
    [[ "$recorded" != "$sha_b" ]] || fail "failed deploy recorded the new commit"
  fi
  rm -rf "$tmp"
  printf '%s %s\n' "$sha_a" "$sha_b"
}

simulate failure >/dev/null
pass "rollback simulation restores previous HEAD and release SHA"

simulate success >/dev/null
pass "successful deploy records the new release SHA"

echo "ALL_PIPELINE_TESTS=PASS"
