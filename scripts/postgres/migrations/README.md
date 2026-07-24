# PostgreSQL application migrations

Each application-schema change gets the next immutable `NNNN-description.sql`
file. Never edit a migration that may have been applied. Regenerate
`scripts/postgres/schema.sql` with `npm run db:pg:schema:generate`, then add
fresh-install and upgrade tests before release.

Better Auth owns its own PostgreSQL tables and migrations; do not add them here.
