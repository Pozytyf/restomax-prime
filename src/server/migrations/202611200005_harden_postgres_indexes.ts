import type { Knex } from 'knex';

/**
 * PostgreSQL hardening for the existing Supabase schema.
 * - Pin SECURITY DEFINER / JWT helper functions to a trusted search_path.
 * - Add indexes to uncovered foreign-key columns reported by Supabase Advisor.
 * SQLite test databases intentionally skip PostgreSQL-specific DDL.
 */
export async function up(knex: Knex): Promise<void> {
  if (knex.client.config.client !== 'pg') return;

  await knex.raw("ALTER FUNCTION public.current_tenant_id() SET search_path = ''");
  await knex.raw("ALTER FUNCTION public.is_superadmin() SET search_path = ''");
  await knex.raw("ALTER FUNCTION public.sync_restaurant_to_tenant() SET search_path = ''");

  const indexes: Array<[string, string, string]> = [
    ['customers', 'restaurant_id', 'idx_customers_restaurant_id'],
    ['dining_tables', 'restaurant_id', 'idx_dining_tables_restaurant_id'],
    ['expenses', 'restaurant_id', 'idx_expenses_restaurant_id'],
    ['menu_categories', 'restaurant_id', 'idx_menu_categories_restaurant_id'],
    ['menu_item_recipes', 'stock_id', 'idx_menu_item_recipes_stock_id'],
    ['menu_items', 'category_id', 'idx_menu_items_category_id'],
    ['notifications', 'stock_id', 'idx_notifications_stock_id'],
    ['order_items', 'menu_item_id', 'idx_order_items_menu_item_id'],
    ['orders', 'created_by_user_id', 'idx_orders_created_by_user_id'],
    ['orders', 'table_id', 'idx_orders_table_id'],
    ['payments', 'created_by_user_id', 'idx_payments_created_by_user_id'],
    ['payments', 'order_id', 'idx_payments_order_id'],
    ['platform_invoices', 'restaurant_id', 'idx_platform_invoices_restaurant_id'],
    ['platform_invoices', 'subscription_id', 'idx_platform_invoices_subscription_id'],
    ['qr_codes', 'restaurant_id', 'idx_qr_codes_restaurant_id'],
    ['qr_codes', 'table_id', 'idx_qr_codes_table_id'],
    ['qr_table_sessions', 'restaurant_id', 'idx_qr_table_sessions_restaurant_id'],
    ['qr_table_sessions', 'table_id', 'idx_qr_table_sessions_table_id'],
    ['reservations', 'restaurant_id', 'idx_reservations_restaurant_id'],
    ['reservations', 'table_id', 'idx_reservations_table_id'],
    ['restaurant_members', 'role', 'idx_restaurant_members_role'],
    ['restaurant_members', 'user_id', 'idx_restaurant_members_user_id'],
    ['sessions', 'restaurant_id', 'idx_sessions_restaurant_id'],
    ['sessions', 'user_id', 'idx_sessions_user_id'],
    ['stock_movements', 'created_by_user_id', 'idx_stock_movements_created_by_user_id'],
    ['stock_movements', 'restaurant_id', 'idx_stock_movements_restaurant_id'],
    ['stock_movements', 'stock_id', 'idx_stock_movements_stock_id'],
    ['subscriptions', 'plan_id', 'idx_subscriptions_plan_id'],
    ['subscriptions', 'restaurant_id', 'idx_subscriptions_restaurant_id'],
    ['support_tickets', 'restaurant_id', 'idx_support_tickets_restaurant_id'],
    ['ticket_messages', 'ticket_id', 'idx_ticket_messages_ticket_id'],
    ['users', 'role', 'idx_users_role'],
  ];

  for (const [table, column, index] of indexes) {
    await knex.raw(`CREATE INDEX IF NOT EXISTS ${index} ON public.${table} (${column})`);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (knex.client.config.client !== 'pg') return;
  const indexes = [
    'idx_customers_restaurant_id', 'idx_dining_tables_restaurant_id',
    'idx_expenses_restaurant_id', 'idx_menu_categories_restaurant_id',
    'idx_menu_item_recipes_stock_id', 'idx_menu_items_category_id',
    'idx_notifications_stock_id', 'idx_order_items_menu_item_id',
    'idx_orders_created_by_user_id', 'idx_orders_table_id',
    'idx_payments_created_by_user_id', 'idx_payments_order_id',
    'idx_platform_invoices_restaurant_id', 'idx_platform_invoices_subscription_id',
    'idx_qr_codes_restaurant_id', 'idx_qr_codes_table_id',
    'idx_qr_table_sessions_restaurant_id', 'idx_qr_table_sessions_table_id',
    'idx_reservations_restaurant_id', 'idx_reservations_table_id',
    'idx_restaurant_members_role', 'idx_restaurant_members_user_id',
    'idx_sessions_restaurant_id', 'idx_sessions_user_id',
    'idx_stock_movements_created_by_user_id', 'idx_stock_movements_restaurant_id',
    'idx_stock_movements_stock_id', 'idx_subscriptions_plan_id',
    'idx_subscriptions_restaurant_id', 'idx_support_tickets_restaurant_id',
    'idx_ticket_messages_ticket_id', 'idx_users_role',
  ];
  for (const index of indexes) await knex.raw(`DROP INDEX IF EXISTS public.${index}`);
  await knex.raw('ALTER FUNCTION public.current_tenant_id() RESET search_path');
  await knex.raw('ALTER FUNCTION public.is_superadmin() RESET search_path');
  await knex.raw('ALTER FUNCTION public.sync_restaurant_to_tenant() RESET search_path');
}
