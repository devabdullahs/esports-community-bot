#!/usr/bin/env bash
# Truncate all app tables in the local TEST Postgres between test runs so the
# async test suite (run with DB_DRIVER=postgres) starts clean — SQLite gets a
# fresh temp file per run, but the shared PG container accumulates rows.
# Usage: scripts/postgres/reset-test-db.sh   (targets the ecb-pg-test container)
set -euo pipefail
docker exec ecb-pg-test psql -U postgres -d ecb_test -c "
DO \$\$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END \$\$;"
