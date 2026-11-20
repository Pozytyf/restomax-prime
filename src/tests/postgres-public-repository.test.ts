import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Knex } from 'knex';
import { createKnexInstance } from '../server/knex.ts';
import { PostgresPublicRepository } from '../server/repositories/postgresPublicRepository.ts';

let db: Knex;
let repository: PostgresPublicRepository;

before(async () => {
  db = createKnexInstance(':memory:');
  await db.schema.createTable('orders', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('order_number');
    t.string('order_type'); t.string('table_id'); t.string('customer_name'); t.string('status');
    t.integer('subtotal_xof'); t.integer('discount_xof'); t.integer('tax_xof');
    t.integer('total_xof'); t.integer('paid_xof'); t.text('notes'); t.string('idempotency_key');
    t.string('created_by_user_id'); t.string('created_at'); t.string('updated_at');
  });
  await db.schema.createTable('order_items', t => {
    t.string('id').primary(); t.string('order_id'); t.string('menu_item_id');
    t.string('name'); t.string('station'); t.integer('unit_price_xof');
    t.text('options_summary'); t.integer('options_delta_xof'); t.integer('quantity');
    t.integer('line_total_xof'); t.text('notes'); t.string('prep_status');
  });
  await db.schema.createTable('dining_tables', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('status'); });
  await db.schema.createTable('menu_item_recipes', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('menu_item_id'); t.string('stock_id'); t.float('quantity_per_unit'); });
  await db.schema.createTable('stocks', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('name'); t.float('quantity'); t.float('min_threshold'); t.string('unit'); t.string('supplier_name'); t.string('updated_at'); });
  await db.schema.createTable('stock_movements', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('stock_id'); t.string('movement_type'); t.float('quantity_delta'); t.string('reason'); t.string('created_by_user_id'); t.string('created_at'); });
  await db('dining_tables').insert({ id: 'table_qr', restaurant_id: 'rest_qr', status: 'AVAILABLE' });
  await db('stocks').insert({ id: 'stock_qr', restaurant_id: 'rest_qr', name: 'Poulet', quantity: 3, min_threshold: 1, unit: 'kg', supplier_name: 'Marché', updated_at: '2026-11-20T00:00:00.000Z' });
  await db('menu_item_recipes').insert({ id: 'recipe_qr', restaurant_id: 'rest_qr', menu_item_id: 'menu_qr', stock_id: 'stock_qr', quantity_per_unit: 0.25 });
  repository = new PostgresPublicRepository(db);
});

after(async () => { await db.destroy(); });

test('QR order creation and stock deductions are one transaction', async () => {
  const result = await repository.insertQrOrderTransaction({
    orderId: 'order_qr', restaurantId: 'rest_qr', orderNumber: 'CMD-1001',
    tableId: 'table_qr', customerName: 'Client QR', subtotalHtXof: 1000,
    taxXof: 180, totalXof: 1180, notes: '', idempotencyKey: 'qr-1',
    now: '2026-11-20T00:00:00.000Z',
    lines: [{ id: 'line_qr', menuItemId: 'menu_qr', name: 'Poulet braisé',
      station: 'KITCHEN', unitPriceXof: 1180, optionsSummary: '',
      optionsDeltaXof: 0, quantity: 2, lineTotalXof: 2360, notes: '' }],
  });
  assert.equal(result.deductedCount, 1);
  assert.equal(Number((await db('stocks').where({ id: 'stock_qr' }).first())?.quantity), 2.5);
  assert.equal((await db('dining_tables').where({ id: 'table_qr' }).first())?.status, 'OCCUPIED');
  assert.equal(await db('orders').where({ id: 'order_qr' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('order_items').where({ order_id: 'order_qr' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('stock_movements').where({ stock_id: 'stock_qr' }).count('* as n').first().then(x => Number(x?.n)), 1);
});
