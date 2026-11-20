# PostgreSQL cutover checklist

## Current safety state

- The application continues using the legacy SQLite runtime unless `RESTOMAX_POSTGRES_CUTOVER=true`.
- PostgreSQL repositories and asynchronous controller paths are implemented on `migration/postgres-native`.
- When cutover is enabled, API startup requires `DATABASE_CLIENT=pg` (or `postgres` / `postgresql`) and a Supabase database URL, runs Knex migrations, and does not fall back to SQLite.
- `getDb()` throws after cutover so missed SQLite access cannot silently create a second data store.
- Keep the cutover flag disabled in Production until the isolated PostgreSQL validation is complete.

## Required environment

For an isolated Preview environment only:

- `DATABASE_CLIENT=pg`
- `RESTOMAX_POSTGRES_CUTOVER=true`
- `SUPABASE_DB_URL` or `DATABASE_URL` set to the isolated Supabase branch's transaction-pooler connection string
- `DATABASE_SSL=true`
- `DB_POOL_MAX=1`
- `JWT_SECRET` set to a strong, unique secret for the target environment (never rely on a development fallback).

Keep Preview and Production JWT secrets separate. Rotating the Production `JWT_SECRET` invalidates existing application JWT sessions, so schedule that change and communicate the required re-login before the Production deployment.

Do not point Preview at the production database for migration or end-to-end testing.

## Validation sequence

1. Create an isolated Supabase database branch and record its schema state.
2. Run `npm run migrate:latest` / API startup migrations against that branch.
3. Verify the Knex migration history and all expected columns, constraints, triggers, and indexes.
4. Exercise registration, login, session revocation, multi-tenant isolation, menu/recipe operations, POS and QR orders, stock deductions, partial/full payments, refunds, inventory alerts, staff, customers, reservations, finance, support, and Superadmin.
5. Run concurrency tests for duplicate order/payment idempotency keys and concurrent stock deductions.
6. Run Supabase Security and Performance Advisors again. Migration 0005 pins the three flagged function search paths and adds indexes for the currently unindexed foreign keys.
7. Deploy and smoke-test the same commit in Vercel Preview with the isolated branch.
8. Only after all checks pass, schedule production cutover and take a database backup.

## Rollback warning

Do not simply turn `RESTOMAX_POSTGRES_CUTOVER` off after PostgreSQL has accepted writes. That would send later requests back to SQLite and split the data again. A post-cutover rollback requires a planned database restore or a verified reverse data migration. Prefer forward fixes unless no production writes have occurred.
