import type { Knex } from 'knex';

/**
 * Restrict Supabase API roles to the intended RLS surface.
 *
 * RLS does not protect TRUNCATE, so remove that privilege from anon and
 * authenticated on every public table. Tables intentionally reserved for
 * backend access and lacking RLS policies receive no direct table grants.
 * The application server connects with its backend database role and is not
 * affected by these grants.
 */
const backendOnlyTables = [
  'audit_logs',
  'contact_leads',
  'order_items',
  'platform_invoices',
  'platform_settings',
  'qr_table_sessions',
  'restaurants',
  'schema_migrations',
  'sessions',
  'subscriptions',
  'tenants',
  'ticket_messages',
  'users',
] as const;

export async function up(knex: Knex): Promise<void> {
  if (knex.client.config.client !== 'pg') return;

  // Supabase API roles are not created by Neon. Preserve the hardening when
  // those roles exist, but make a clean standalone PostgreSQL install valid.
  const roleResult = await knex.raw(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname",
  );
  const roles = (roleResult.rows || []).map((row: { rolname: string }) => row.rolname);
  if (roles.length === 0) return;
  const roleSql = roles.join(', ');

  await knex.raw(
    `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${roleSql}`,
  );
  await knex.raw(
    `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${roleSql}`,
  );
  await knex.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${roleSql}`,
  );
  await knex.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${roleSql}`,
  );

  for (const table of backendOnlyTables) {
    const exists = await knex.raw('SELECT to_regclass(?) AS relation', [`public.${table}`]);
    if (exists.rows?.[0]?.relation) {
      await knex.raw(
        `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${roleSql}`,
      );
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (knex.client.config.client !== 'pg') return;

  // Restore only the grants this migration changed.
  await knex.raw(
    'GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated',
  );
  await knex.raw(
    'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated',
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated',
  );
  for (const table of backendOnlyTables) {
    await knex.raw(
      `GRANT ALL PRIVILEGES ON TABLE public.${table} TO anon, authenticated`,
    );
  }
};
