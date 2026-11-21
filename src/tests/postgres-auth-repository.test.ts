import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Knex } from 'knex';
import { createKnexInstance } from '../server/knex.ts';
import { PostgresAuthRepository } from '../server/repositories/postgresAuthRepository.ts';

let db: Knex;
let repository: PostgresAuthRepository;

before(async () => {
  db = createKnexInstance(':memory:');
  await db.schema.createTable('tenants', t => {
    t.string('id').primary(); t.string('slug').unique(); t.string('name');
    t.string('email'); t.string('phone'); t.string('city'); t.string('country');
    t.string('currency'); t.string('timezone'); t.string('status'); t.string('created_at');
  });
  await db.schema.createTable('restaurants', t => {
    t.string('id').primary(); t.string('slug').unique(); t.string('name');
    t.string('email'); t.string('phone'); t.string('city'); t.string('country');
    t.string('currency'); t.string('timezone'); t.string('status');
    t.string('deleted_at'); t.string('created_at');
  });
  await db.schema.createTable('users', t => {
    t.string('id').primary(); t.string('tenant_id'); t.string('email').unique();
    t.string('password_hash'); t.string('full_name'); t.string('phone');
    t.string('role'); t.string('global_role'); t.text('permissions_json');
    t.string('status'); t.integer('token_version'); t.string('created_at');
    t.string('last_login_at'); t.string('updated_at');
  });
  await db.schema.createTable('restaurant_members', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('user_id');
    t.string('role'); t.text('custom_permissions_json'); t.string('status'); t.string('created_at');
  });
  await db.schema.createTable('sessions', t => {
    t.string('id').primary(); t.string('user_id'); t.string('restaurant_id');
    t.string('expires_at'); t.string('revoked_at'); t.string('user_agent'); t.string('created_at');
  });
  await db.schema.createTable('subscriptions', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('plan_id');
    t.string('billing_cycle'); t.string('status'); t.string('trial_ends_at');
    t.string('current_period_start'); t.string('current_period_end'); t.string('created_at');
  });
  await db.schema.createTable('menu_categories', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('name');
    t.string('station'); t.integer('sort_order'); t.integer('active');
  });
  await db.schema.createTable('dining_tables', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('zone');
    t.string('label'); t.integer('capacity'); t.string('status');
  });
  await db.schema.createTable('qr_codes', t => {
    t.string('id').primary(); t.string('restaurant_id'); t.string('table_id');
    t.string('token').unique(); t.integer('version'); t.string('status'); t.string('created_at');
  });
  await db.schema.createTable('audit_logs', t => {
    t.string('id').primary(); t.string('actor_user_id'); t.string('actor_email');
    t.string('actor_role'); t.string('restaurant_id'); t.string('action');
    t.string('target_type'); t.string('target_id'); t.text('details'); t.string('created_at');
  });
  await db.schema.createTable('plans', t => {
    t.string('id').primary(); t.string('code'); t.integer('trial_days');
    t.integer('active'); t.string('created_at');
  });
  await db('plans').insert({ id: 'plan_1', code: 'ESSENTIEL', trial_days: 14, active: 1, created_at: new Date().toISOString() });
  repository = new PostgresAuthRepository(db);
});

after(async () => { await db.destroy(); });

test('registration writes tenant, restaurant, owner, membership, subscription, starter tables, session and audit atomically', async () => {
  await repository.createRestaurantWithOwnerAndStarterData({
    restaurantId: 'rest_1', restaurantName: 'Chez Awa', slug: 'chez-awa-1001',
    email: 'awa@example.ci', phone: '+2250700000000', city: 'Abidjan',
    userId: 'usr_1', ownerName: 'Awa', passwordHash: 'hash',
    memberId: 'mem_1', subId: 'sub_1', planId: 'plan_1',
    trialEndsAt: '2026-12-04T00:00:00.000Z', sessionId: 'ses_1',
    sessionExpiresAt: '2026-11-27T00:00:00.000Z', userAgent: 'test-agent',
    now: '2026-11-20T00:00:00.000Z',
  });
  assert.equal(await db('tenants').where({ id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('restaurants').where({ id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('users').where({ id: 'usr_1', tenant_id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('restaurant_members').where({ user_id: 'usr_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('subscriptions').where({ restaurant_id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('dining_tables').where({ restaurant_id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 4);
  assert.equal(await db('qr_codes').where({ restaurant_id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 4);
  assert.equal(await db('sessions').where({ id: 'ses_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('audit_logs').where({ target_id: 'rest_1' }).count('* as n').first().then(x => Number(x?.n)), 1);
});

test('a uniqueness failure rolls back every registration write', async () => {
  await assert.rejects(repository.createRestaurantWithOwnerAndStarterData({
    restaurantId: 'rest_2', restaurantName: 'Duplicate slug', slug: 'chez-awa-1001',
    email: 'other@example.ci', phone: '', city: 'Abidjan',
    userId: 'usr_2', ownerName: 'Other', passwordHash: 'hash',
    memberId: 'mem_2', subId: 'sub_2', planId: 'plan_1',
    trialEndsAt: '2026-12-04T00:00:00.000Z', sessionId: 'ses_2',
    sessionExpiresAt: '2026-11-27T00:00:00.000Z', userAgent: 'test-agent',
    now: '2026-11-20T00:00:00.000Z',
  }));
  assert.equal(await db('tenants').where({ id: 'rest_2' }).count('* as n').first().then(x => Number(x?.n)), 0);
  assert.equal(await db('users').where({ id: 'usr_2' }).count('* as n').first().then(x => Number(x?.n)), 0);
  assert.equal(await db('sessions').where({ id: 'ses_2' }).count('* as n').first().then(x => Number(x?.n)), 0);
});
