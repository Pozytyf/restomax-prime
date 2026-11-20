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

  await knex.raw(
    'REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated',
  );

  for (const table of backendOnlyTables) {
    await knex.raw(
      `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon, authenticated`,
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  if (knex.client.config.client !== 'pg') return;

  // Restore the previous broad grants if this migration is rolled back.
  await knex.raw(
    'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated',
  );
};
