#!/usr/bin/env bash
# Drop and recreate the SDKWork shared dev PostgreSQL database, then install required extensions.
# Invoke with bash (not plain sh): bash recreate-dev-database.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
APP_ROOT="${APP_ROOT:-${WORKSPACE_ROOT}/sdkwork-cloudrouter}"
ENV_FILE="${ENV_FILE:-${APP_ROOT}/config/host/postgres.env}"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-postgres}"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source <(grep -E '^SDKWORK_DATABASE_(NAME|ADMIN_PASSWORD)=' "${ENV_FILE}" | sed 's/\r$//')
  set +a
  PGDATABASE_NAME="${SDKWORK_DATABASE_NAME:-sdkwork_ai_dev}"
  export PGPASSWORD="${PGPASSWORD:-${SDKWORK_DATABASE_ADMIN_PASSWORD:-postgres_admin_pass}}"
else
  PGDATABASE_NAME="${PGDATABASE_NAME:-sdkwork_ai_dev}"
  export PGPASSWORD="${PGPASSWORD:-postgres_admin_pass}"
fi

echo "[sdkwork-postgres] terminating connections to ${PGDATABASE_NAME}..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${PGDATABASE_NAME}' AND pid <> pg_backend_pid();" \
  >/dev/null || true

echo "[sdkwork-postgres] dropping database ${PGDATABASE_NAME}..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"${PGDATABASE_NAME}\";"

echo "[sdkwork-postgres] recreating role, database, schema, and extensions via node init..."
node "${SCRIPT_DIR}/postgres-db-cli.mjs" \
  --mode init \
  --config "${ENV_FILE}" \
  --app-root "${APP_ROOT}"

echo "[sdkwork-postgres] verifying extensions in ${PGDATABASE_NAME}..."
psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE_NAME}" -v ON_ERROR_STOP=1 -c \
  "SELECT extname, extversion FROM pg_extension ORDER BY extname;"

echo "[sdkwork-postgres] ${PGDATABASE_NAME} is ready."
