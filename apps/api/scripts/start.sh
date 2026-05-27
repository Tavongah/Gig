#!/bin/sh
set -e

echo "Waiting for database..."
attempt=1
max_attempts=30
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Database migration failed after ${max_attempts} attempts."
    exit 1
  fi
  echo "Migration attempt ${attempt} failed, retrying in 5s..."
  attempt=$((attempt + 1))
  sleep 5
done

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Seeding database..."
  npx tsx prisma/seed.ts || echo "Seed skipped or failed (non-fatal on redeploy)."
fi

echo "Starting API server on port ${PORT:-4000}..."
exec node dist/server.js
