# Render + Neon production initialization checklist

## Target architecture

- Production database: a new, independent Neon project in Frankfurt (`aws-eu-central-1`), with a fresh default branch and no Supabase import.
- Runtime traffic: Neon pooled connection in `DATABASE_URL`.
- Schema migrations: Neon direct connection in `DATABASE_MIGRATION_URL`.
- Application hosting: a separate Render production web service, independent from `restomax-prime-test`.
- Keep the existing Neon test project and Render test service unchanged.

## Required Render environment

- `NODE_ENV=production`
- `DATABASE_CLIENT=pg`
- `RESTOMAX_POSTGRES_CUTOVER=true`
- `DATABASE_SSL=true`
- `DATABASE_URL`: Neon pooled endpoint (host includes `-pooler`)
- `DATABASE_MIGRATION_URL`: Neon direct endpoint (host must not include `-pooler`)
- `DB_POOL_MIN=0`
- `DB_POOL_MAX=5` (adjust only after observing production connection use)
- `JWT_SECRET`: unique, high-entropy production secret; never reuse test or development secrets
- `PAYMENT_MODE=TEST` for initial smoke tests; switch to `LIVE` only after explicit payment validation
- Neon Object Storage credentials and bucket endpoint for production media, separate from test
- Production payment-provider and SMTP credentials only when their respective flows are enabled

Do not configure `SUPABASE_DB_URL` for this deployment. Production startup fails closed if PostgreSQL is not selected or `DATABASE_URL` is missing. If `DATABASE_MIGRATION_URL` is supplied, startup rejects a pooled endpoint for migrations.

## Fresh database initialization

1. Create a new Neon project, not a branch cloned from the test project.
2. Create/confirm its default database and owner role; retain the direct and pooled connection strings securely.
3. Configure Render environment variables without placing secrets in Git.
4. Run `npm run migrate:latest` against the direct URL, or let the production startup migration runner apply pending Knex migrations.
5. Confirm the `knex_migrations` history contains every migration in the repository.
6. Confirm expected tables, foreign keys, indexes, unique constraints, PostgreSQL functions and append-only audit trigger.
7. Confirm the database contains no imported tenants, restaurants, users, orders, payments or test fixtures.
8. Confirm the standard plan catalogue is seeded by the repository migration; no restaurant or owner account is created automatically.
9. Create the first owner and restaurant through the supported onboarding flow, then verify tenant isolation and permissions.
10. Create a production-only Object Storage bucket and credentials; never reuse the test bucket or credentials.

## Validation before accepting real customers

- CI: TypeScript, production build, all unit and repository tests.
- Runtime: `/api/health`, registration, login, session revocation, tenant isolation and role boundaries.
- Restaurant flows: menu, tables, QR ordering, POS, Kitchen/Bar KDS, stock, partial/full payments, refunds, expenses and owner-only reports/audit.
- Files: upload and retrieve menu images and restaurant logo from production storage; verify receipt printing at 58 mm and 80 mm.
- Payments: use test mode until callbacks, signatures, idempotency and refunds are verified end to end.
- Operations: check Render logs, Neon connection saturation, query latency and storage permissions.

## Data policy

This production environment is intentionally initialized empty. Do not run Supabase exports, restores, seed imports or copy test records into it. Only version-controlled schema migrations and the standard subscription-plan catalogue may populate it during initialization.

## Rollback

Do not point a live production service back to Supabase or the test database after production writes begin. Prefer forward fixes. If rollback is unavoidable, stop writes and use a verified Neon restore or a separately planned reconciliation procedure.
