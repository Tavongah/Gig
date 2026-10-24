#!/usr/bin/env bash
# Fail before SSH when a deployment secret is missing. Prints names only.
set -euo pipefail

missing=0
for name in DO_HOST DO_SSH_USER DO_SSH_KEY API_DOMAIN MARKETING_DOMAIN; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required deployment secret: ${name}"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi
