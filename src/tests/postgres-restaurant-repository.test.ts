import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Knex } from 'knex';
import { createKnexInstance } from '../server/knex.ts';
import { PostgresRestaurantRepository } from '../server/repositories/postgresRestaurantRepository.ts';

let db: Knex;
let repository: PostgresRestaurantRepository;

before(async () => {
  db = createKnexInstance(':memory:');
  await db.schema.createTable('restaurants', t => { t.string('id').primary(); t.float('tax_rate_percent'); t.string('paydunya_mode'); });
  await db.schema.createTable('dining_tables', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('zone'); t.string('label'); t.integer('capacity'); t.string('status'); });
  await db.schema.createTable('orders', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('order_number');
    t.string('order_type'); t.string('table_id'); t.string('customer_name'); t.string('status');
    t.integer('subtotal_xof'); t.integer('discount_xof'); t.integer('tax_xof');
    t.integer('total_xof'); t.integer('paid_xof'); t.text('notes'); t.string('idempotency_key');
    t.string('created_by_user_id'); t.string('created_at'); t.string('updated_at');
    t.unique(['restaurant_id', 'idempotency_key']);
  });
  await db.schema.createTable('qr_codes', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('table_id');
    t.string('token').unique(); t.integer('version'); t.string('status');
    t.string('created_at'); t.string('revoked_at');
  });
  await db.schema.createTable('order_items', t => {
    t.string('id').primary(); t.string('order_id'); t.string('menu_item_id');
    t.string('name'); t.string('station'); t.integer('unit_price_xof');
    t.text('options_summary'); t.integer('options_delta_xof'); t.integer('quantity');
    t.integer('line_total_xof'); t.text('notes'); t.string('prep_status');
  });
  await db.schema.createTable('menu_item_recipes', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('menu_item_id');
    t.string('stock_id'); t.float('quantity_per_unit');
  });
  await db.schema.createTable('stocks', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('name');
    t.float('quantity'); t.float('min_threshold'); t.string('unit'); t.string('supplier_name');
    t.string('updated_at');
  });
  await db.schema.createTable('stock_movements', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('stock_id');
    t.string('movement_type'); t.float('quantity_delta'); t.string('reason');
    t.string('created_by_user_id'); t.string('created_at');
  });
  await db.schema.createTable('payments', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('order_id');
    t.integer('amount_xof'); t.string('method'); t.string('status'); t.string('mode');
    t.string('reference'); t.string('idempotency_key'); t.string('created_by_user_id');
    t.string('created_at'); t.unique(['restaurant_id', 'idempotency_key']);
  });
  await db.schema.createTable('audit_logs', t => {
    t.string('id').primary(); t.string('actor_user_id'); t.string('actor_email');
    t.string('actor_role'); t.string('restaurant_id'); t.string('action');
    t.string('target_type'); t.string('target_id'); t.text('details'); t.string('created_at');
  });
  await db('restaurants').insert({ id: 'rest_1', tax_rate_percent: 18, paydunya_mode: 'TEST' });
  await db('dining_tables').insert({ id: 'table_1', restaurant_id: 'rest_1', zone: 'Salle', label: 'Table 1', capacity: 4, status: 'AVAILABLE' });
  await db('qr_codes').insert({ id: 'qr_1', restaurant_id: 'rest_1', table_id: 'table_1', token: 'table-1-v1', version: 1, status: 'ACTIVE', created_at: '2026-11-20T00:00:00.000Z' });
  await db('stocks').insert({ id: 'stock_1', restaurant_id: 'rest_1', name: 'Riz', quantity: 5, min_threshold: 2, unit: 'kg', supplier_name: 'Fournisseur', updated_at: '2026-11-20T00:00:00.000Z' });
  await db('menu_item_recipes').insert({ id: 'recipe_1', restaurant_id: 'rest_1', menu_item_id: 'menu_1', stock_id: 'stock_1', quantity_per_unit: 0.5 });
  repository = new PostgresRestaurantRepository(db);
});

after(async () => { await db.destroy(); });

test('POS order and recipe stock deduction commit atomically', async () => {
  const result = await repository.createPosOrderTransaction({
    orderId: 'order_1', rid: 'rest_1', orderNumber: 'CMD-1001',
    orderType: 'DINE_IN', tableId: 'table_1', customerName: 'Client',
    subtotalXof: 100, discountXof: 0, taxXof: 0, totalXof: 100,
    notes: '', idempotencyKey: 'pos-1', userId: 'user_1',
    now: '2026-11-20T00:00:00.000Z',
    lines: [{ id: 'line_1', menuItemId: 'menu_1', name: 'Riz sauce',
      station: 'KITCHEN', unitPriceXof: 50, optionsSummary: '',
      optionsDeltaXof: 0, quantity: 2, lineTotalXof: 100, notes: '' }],
  });
  assert.equal(result.deductedCount, 1);
  assert.equal(Number((await db('stocks').where({ id: 'stock_1' }).first())?.quantity), 4);
  assert.equal((await db('dining_tables').where({ id: 'table_1' }).first())?.status, 'OCCUPIED');
  assert.equal(await db('order_items').where({ order_id: 'order_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('stock_movements').where({ stock_id: 'stock_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
});

test('a duplicate POS idempotency key rolls back order and stock changes', async () => {
  await assert.rejects(repository.createPosOrderTransaction({
    orderId: 'order_duplicate', rid: 'rest_1', orderNumber: 'CMD-1002',
    orderType: 'DINE_IN', tableId: 'table_1', customerName: 'Duplicate',
    subtotalXof: 100, discountXof: 0, taxXof: 0, totalXof: 100,
    notes: '', idempotencyKey: 'pos-1', userId: 'user_1',
    now: '2026-11-20T00:03:00.000Z',
    lines: [{ id: 'line_duplicate', menuItemId: 'menu_1', name: 'Riz sauce',
      station: 'KITCHEN', unitPriceXof: 50, optionsSummary: '',
      optionsDeltaXof: 0, quantity: 2, lineTotalXof: 100, notes: '' }],
  }));
  assert.equal(await db('orders').where({ id: 'order_duplicate' }).count('* as n').first().then(x => Number(x?.n)), 0);
  assert.equal(Number((await db('stocks').where({ id: 'stock_1' }).first())?.quantity), 4);
  assert.equal(await db('stock_movements').where({ stock_id: 'stock_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
});

test('several successive installments settle the invoice only on the final payment', async () => {
  const base = { rid: 'rest_1', orderId: 'order_1', paymentId: 'pay_1',
    amountXof: 25, method: 'CASH', mode: 'TEST', reference: 'TEST-CASH-100001',
    idempotencyKey: 'payment-1', userId: 'user_1', actorEmail: 'owner@example.ci',
    actorRole: 'OWNER', now: '2026-11-20T00:01:00.000Z' };
  const first = await repository.recordPaymentTransaction(base);
  assert.equal(first.deduplicated, false);
  assert.equal(first.payment.fullyPaid, false);
  assert.equal((await db('orders').where({ id: 'order_1' }).first())?.status, 'PENDING');
  assert.equal(Number((await db('orders').where({ id: 'order_1' }).first())?.paid_xof), 25);
  assert.equal((await db('dining_tables').where({ id: 'table_1' }).first())?.status, 'OCCUPIED');

  const duplicate = await repository.recordPaymentTransaction({ ...base, paymentId: 'pay_dup' });
  assert.equal(duplicate.deduplicated, true);
  await assert.rejects(repository.recordPaymentTransaction({ ...base, paymentId: 'pay_too_much',
    amountXof: 100, idempotencyKey: 'payment-too-much' }));

  const second = await repository.recordPaymentTransaction({ ...base, paymentId: 'pay_2',
    amountXof: 35, idempotencyKey: 'payment-2', now: '2026-11-20T00:02:00.000Z' });
  assert.equal(second.deduplicated, false);
  assert.equal(second.payment.fullyPaid, false);
  assert.equal((await db('orders').where({ id: 'order_1' }).first())?.status, 'PENDING');
  assert.equal(Number((await db('orders').where({ id: 'order_1' }).first())?.paid_xof), 60);

  const final = await repository.recordPaymentTransaction({ ...base, paymentId: 'pay_3',
    amountXof: 40, idempotencyKey: 'payment-3', now: '2026-11-20T00:03:00.000Z' });
  assert.equal(final.deduplicated, false);
  assert.equal(final.payment.fullyPaid, true);
  assert.equal(final.payment.orderStatus, 'PAID');
  assert.equal((await db('orders').where({ id: 'order_1' }).first())?.status, 'PAID');
  assert.equal(Number((await db('orders').where({ id: 'order_1' }).first())?.paid_xof), 100);
  assert.equal(Number(await db('payments').where({ order_id: 'order_1', status: 'PAID' }).sum('amount_xof as total').first().then(x => x?.total)), 100);
  assert.equal((await db('dining_tables').where({ id: 'table_1' }).first())?.status, 'AVAILABLE');
  assert.equal(await db('audit_logs').where({ action: 'PAYMENT_RECORDED' }).count('* as n').first().then(x => Number(x?.n)), 3);
});

test('payment settlement reconciles a stale paid_xof counter from the payment ledger', async () => {
  await db('orders').where({ id: 'order_1' }).update({ paid_xof: 0, status: 'SERVED' });
  await db('dining_tables').where({ id: 'table_1' }).update({ status: 'OCCUPIED' });
  await db('payments').insert({ id: 'legacy_payment', restaurant_id: 'rest_1', order_id: 'order_1',
    amount_xof: 60, method: 'CASH', status: 'PAID', mode: 'TEST', reference: 'LEGACY-60',
    idempotency_key: 'legacy-payment', created_by_user_id: 'user_1', created_at: '2026-11-20T00:00:30.000Z' });
  const result = await repository.recordPaymentTransaction({
    rid: 'rest_1', orderId: 'order_1', paymentId: 'pay_reconcile', amountXof: 40,
    method: 'CASH', mode: 'TEST', reference: 'TEST-CASH-100002', idempotencyKey: 'payment-reconcile',
    userId: 'user_1', actorEmail: 'owner@example.ci', actorRole: 'OWNER', now: '2026-11-20T00:04:00.000Z',
  });
  assert.equal(result.payment.fullyPaid, true);
  assert.equal((await db('orders').where({ id: 'order_1' }).first())?.status, 'PAID');
  assert.equal(Number((await db('orders').where({ id: 'order_1' }).first())?.paid_xof), 100);
  assert.equal((await db('dining_tables').where({ id: 'table_1' }).first())?.status, 'AVAILABLE');
});

test('table listing joins only active QR codes and regeneration revokes the previous token', async () => {
  const tables = await repository.findTablesWithQrAndActiveOrder('rest_1');
  assert.equal(tables.length, 1);
  assert.equal(tables[0].qrToken, 'table-1-v1');
  const regenerated = await repository.regenerateTableQr('table_1', 'rest_1');
  assert.equal(regenerated.version, 2);
  assert.notEqual(regenerated.token, 'table-1-v1');
  assert.equal((await db('qr_codes').where({ id: 'qr_1' }).first())?.status, 'REVOKED');
  assert.equal(await db('qr_codes').where({ table_id: 'table_1', status: 'ACTIVE' }).count('* as n').first().then(x => Number(x?.n)), 1);
});
