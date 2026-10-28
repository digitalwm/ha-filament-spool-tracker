#!/bin/bash
# Run SpoolTracker as a standalone app with a direct printer connection.

set -e

export NODE_ENV=production
export PORT="${PORT:-3000}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export ADDON_VERSION="${ADDON_VERSION:-0.0.0}"
export APP_ROOT="${APP_ROOT:-/app}"
export SERVER_PATH="${SERVER_PATH:-/app/server}"
export CLIENT_PATH="${CLIENT_PATH:-/app/client}"
export DATABASE_URL="${DATABASE_URL:-file:/data/app.db}"

cd "$APP_ROOT"

echo "Starting SpoolTracker v${ADDON_VERSION} (standalone)..."
echo "Port: $PORT | Database: $DATABASE_URL"

# Prisma migrate deploy applies pending migrations in order. Databases created before we used
# Migrate (e.g. only db push) already have tables but often no _prisma_migrations history; the
# first deploy then fails with P3005 ("schema is not empty"). Baseline: mark the initial
# migration as already applied so only real deltas (archived_at, etc.) run. Without this
# fallback, those installs keep failing deploy until someone runs migrate resolve manually.
echo "Applying Prisma migrations..."
if ! pnpm --filter @ha-addon/server db:migrate:deploy; then
  echo "Prisma migrate deploy failed — attempting baseline for existing database..."
  pnpm --filter @ha-addon/server exec prisma migrate resolve --applied 20260325204348_init_baseline || true
  pnpm --filter @ha-addon/server db:migrate:deploy || echo "Schema migration failed — continuing without database"
fi

echo "Starting application on port $PORT..."
exec pnpm start
