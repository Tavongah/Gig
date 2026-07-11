#!/bin/sh
set -e

SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

echo "Starting API server on port ${PORT:-4000} (before migrations for Render health checks)..."
node dist/server.js &
SERVER_PID=$!

echo "Waiting for database..."
attempt=1
max_attempts=30
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migration failed after ${max_attempts} attempts."
    cleanup
    exit 1
  fi
  echo "Migration attempt ${attempt} failed, retrying in 5s..."
  attempt=$((attempt + 1))
  sleep 5
done

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  npx prisma db seed || echo "Seed skipped or failed (non-fatal on redeploy)."
fi

echo "Migrations complete. API running (pid ${SERVER_PID})."
wait "$SERVER_PID"
