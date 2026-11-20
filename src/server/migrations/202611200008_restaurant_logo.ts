import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('restaurants')) {
    const hasLogoUrl = await knex.schema.hasColumn('restaurants', 'logo_url');
    if (!hasLogoUrl) {
      await knex.schema.alterTable('restaurants', (table) => {
        table.text('logo_url').nullable();
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('restaurants') && await knex.schema.hasColumn('restaurants', 'logo_url')) {
    await knex.schema.alterTable('restaurants', (table) => {
      table.dropColumn('logo_url');
    });
  }
}
