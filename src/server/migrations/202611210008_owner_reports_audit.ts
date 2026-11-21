import type { Knex } from 'knex';

/**
 * Owner financial reporting and audit hardening.
 * Audit records are append-only at database level; application routes expose
 * read access to owners only.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('payments', 'refunded_at'))) {
    await knex.schema.alterTable('payments', (t) => {
      t.string('refunded_at').nullable();
    });
  }
  for (const [column, type] of [
    ['created_by_user_id', 'string'],
    ['created_by_email', 'string'],
    ['created_by_role', 'string'],
  ] as const) {
    if (!(await knex.schema.hasColumn('expenses', column))) {
      await knex.schema.alterTable('expenses', (t) => {
        if (type === 'string') t.string(column).nullable();
      });
    }
  }
  await knex.raw('CREATE INDEX IF NOT EXISTS audit_logs_restaurant_created_idx ON audit_logs (restaurant_id, created_at DESC)');
  await knex.raw('CREATE INDEX IF NOT EXISTS payments_restaurant_created_idx ON payments (restaurant_id, created_at DESC)');
  const client = String((knex.client.config as { client?: string }).client || '');
  if (client.includes('pg')) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION restomax_reject_audit_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw('DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs');
    await knex.raw(`
      CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION restomax_reject_audit_mutation()
    `);
  } else if (client.includes('sqlite')) {
    await knex.raw(`CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
      BEFORE UPDATE ON audit_logs BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only');
    END`);
    await knex.raw(`CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
      BEFORE DELETE ON audit_logs BEGIN
      SELECT RAISE(ABORT, 'audit_logs is append-only');
    END`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const client = String((knex.client.config as { client?: string }).client || '');
  if (client.includes('pg')) {
    await knex.raw('DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs');
    await knex.raw('DROP FUNCTION IF EXISTS restomax_reject_audit_mutation()');
  } else if (client.includes('sqlite')) {
    await knex.raw('DROP TRIGGER IF EXISTS audit_logs_no_update');
    await knex.raw('DROP TRIGGER IF EXISTS audit_logs_no_delete');
  }
  await knex.raw('DROP INDEX IF EXISTS audit_logs_restaurant_created_idx');
  await knex.raw('DROP INDEX IF EXISTS payments_restaurant_created_idx');
  for (const column of ['created_by_user_id', 'created_by_email', 'created_by_role']) {
    if (await knex.schema.hasColumn('expenses', column)) {
      await knex.schema.alterTable('expenses', (t) => t.dropColumn(column));
    }
  }
  if (await knex.schema.hasColumn('payments', 'refunded_at')) {
    await knex.schema.alterTable('payments', (t) => t.dropColumn('refunded_at'));
  }
}
