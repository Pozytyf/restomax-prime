import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Knex } from 'knex';
import { createKnexInstance } from '../server/knex.ts';
import { PostgresSuperadminRepository } from '../server/repositories/postgresSuperadminRepository.ts';

let db: Knex;
let repository: PostgresSuperadminRepository;

before(async () => {
  db = createKnexInstance(':memory:');
  await db.schema.createTable('tenants', t => { t.string('id').primary(); t.string('name'); t.string('slug').unique(); t.string('email'); t.string('phone'); t.string('city'); t.string('country'); t.string('currency'); t.string('timezone'); t.string('status'); t.string('deleted_at'); t.string('created_at'); });
  await db.schema.createTable('restaurants', t => { t.string('id').primary(); t.string('name'); t.string('slug').unique(); t.string('email'); t.string('phone'); t.string('city'); t.string('country'); t.string('currency'); t.string('timezone'); t.string('status'); t.string('deleted_at'); t.string('created_at'); });
  await db.schema.createTable('users', t => { t.string('id').primary(); t.string('tenant_id'); t.string('email').unique(); t.string('password_hash'); t.string('full_name'); t.string('phone'); t.string('role'); t.string('global_role'); t.text('permissions_json'); t.string('status'); t.string('created_at'); });
  await db.schema.createTable('restaurant_members', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('user_id'); t.string('role'); t.text('custom_permissions_json'); t.string('status'); t.string('created_at'); });
  await db.schema.createTable('subscriptions', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('plan_id'); t.string('billing_cycle'); t.string('status'); t.string('current_period_start'); t.string('current_period_end'); t.string('created_at'); });
  await db.schema.createTable('audit_logs', t => { t.string('id').primary(); t.string('actor_user_id'); t.string('actor_email'); t.string('actor_role'); t.string('restaurant_id'); t.string('action'); t.string('target_type'); t.string('target_id'); t.text('details'); t.string('created_at'); });
  await db.schema.createTable('sessions', t => { t.string('id').primary(); t.string('restaurant_id'); t.string('user_id'); t.string('revoked_at'); });
  repository = new PostgresSuperadminRepository(db);
});

after(async () => { await db.destroy(); });

test('admin-created restaurant, owner, membership, subscription and audit are atomic', async () => {
  await repository.createRestaurantAdmin({
    rid: 'rest_admin', uid: 'user_admin', name: 'Restaurant Admin',
    slug: 'restaurant-admin-101', cleanEmail: 'owner@admin.ci', phone: '+2250700000000',
    city: 'Abidjan', ownerName: 'Owner Admin', passwordHash: 'hash',
    planId: 'plan_pro', now: '2026-11-20T00:00:00.000Z',
    periodEnd: '2026-12-20T00:00:00.000Z',
    actorUserId: 'super_admin', actorEmail: 'admin@restomax.ci',
  });
  assert.equal(await db('tenants').where({ id: 'rest_admin' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('restaurants').where({ id: 'rest_admin' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('users').where({ id: 'user_admin' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('restaurant_members').where({ user_id: 'user_admin' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('subscriptions').where({ restaurant_id: 'rest_admin' }).count('* as n').first().then(x => Number(x?.n)), 1);
  assert.equal(await db('audit_logs').where({ action: 'RESTAURANT_CREATED_BY_ADMIN' }).count('* as n').first().then(x => Number(x?.n)), 1);
});

test('restaurant suspension synchronizes tenant status and revokes active sessions', async () => {
  await db('sessions').insert({ id: 'session_admin', user_id: 'user_admin', restaurant_id: 'rest_admin', revoked_at: null });
  await repository.updateRestaurantStatus('rest_admin', 'SUSPENDED');
  assert.equal((await db('restaurants').where({ id: 'rest_admin' }).first())?.status, 'SUSPENDED');
  assert.equal((await db('tenants').where({ id: 'rest_admin' }).first())?.status, 'SUSPENDED');
  assert.ok((await db('sessions').where({ id: 'session_admin' }).first())?.revoked_at);
});
