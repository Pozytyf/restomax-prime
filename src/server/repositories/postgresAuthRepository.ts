import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';

export interface AuditRecord {
  actorUserId: string | null;
  actorEmail: string;
  actorRole: string;
  restaurantId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
}

export class PostgresAuthRepository {
  constructor(private readonly db: Knex = getKnex()) {}

  async findUserByEmail(email: string) {
    return this.db('users')
      .select('id', 'email', 'password_hash', 'full_name', 'phone', 'global_role', 'status')
      .whereRaw('LOWER(email) = LOWER(?)', [email])
      .first();
  }

  async findPrimaryMembershipForUser(userId: string) {
    return this.db('restaurant_members as rm')
      .join('restaurants as r', 'r.id', 'rm.restaurant_id')
      .select(
        'rm.restaurant_id', 'rm.role', 'rm.custom_permissions_json',
        { member_status: 'rm.status' },
        { restaurant_name: 'r.name' },
        { restaurant_slug: 'r.slug' },
        { restaurant_status: 'r.status' },
        'r.deleted_at',
      )
      .where('rm.user_id', userId)
      .orderBy('rm.created_at', 'asc')
      .first();
  }

  async findPlanForRegistration(planCode: string) {
    const selected = await this.db('plans')
      .select('id', 'trial_days')
      .where({ code: planCode, active: 1 })
      .first();
    if (selected) return selected;
    const fallback = await this.db('plans')
      .select('id', 'trial_days')
      .where({ active: 1 })
      .orderBy('created_at', 'asc')
      .first();
    if (!fallback) throw new Error('Aucune formule active disponible.');
    return fallback;
  }

  async createSession(params: {
    sessionId: string; userId: string; restaurantId: string | null;
    expiresAt: string; userAgent: string; now: string;
  }) {
    await this.db('sessions').insert({
      id: params.sessionId, user_id: params.userId,
      restaurant_id: params.restaurantId, expires_at: params.expiresAt,
      user_agent: params.userAgent, created_at: params.now,
    });
  }

  async updateLastLogin(userId: string, now: string) {
    await this.db('users').where({ id: userId }).update({ last_login_at: now });
  }

  async revokeSession(sessionId: string) {
    await this.db('sessions').where({ id: sessionId }).update({
      revoked_at: new Date().toISOString(),
    });
  }

  async findUserPasswordHash(userId: string) {
    return this.db('users').select('password_hash').where({ id: userId }).first();
  }

  async updateUserPasswordHash(userId: string, passwordHash: string) {
    await this.db('users').where({ id: userId }).update({
      password_hash: passwordHash, updated_at: new Date().toISOString(),
      token_version: this.db.raw('token_version + 1'),
    });
    // Revoke all existing sessions after a password change.
    await this.db('sessions').where({ user_id: userId }).whereNull('revoked_at')
      .update({ revoked_at: new Date().toISOString() });
  }

  async recordAudit(params: AuditRecord, trx: Knex | Knex.Transaction = this.db) {
    await trx('audit_logs').insert({
      id: generateId('aud'), actor_user_id: params.actorUserId,
      actor_email: params.actorEmail, actor_role: params.actorRole,
      restaurant_id: params.restaurantId, action: params.action,
      target_type: params.targetType, target_id: params.targetId,
      details: params.details || '', created_at: new Date().toISOString(),
    });
  }

  async createRestaurantWithOwnerAndStarterData(params: {
    restaurantId: string; restaurantName: string; slug: string; email: string;
    phone: string; city: string; userId: string; ownerName: string;
    passwordHash: string; memberId: string; subId: string; planId: string;
    trialEndsAt: string; sessionId: string; sessionExpiresAt: string;
    userAgent: string; now: string;
  }) {
    return this.db.transaction(async (trx) => {
      const restaurant = {
        id: params.restaurantId, name: params.restaurantName, slug: params.slug,
        email: params.email, phone: params.phone, city: params.city,
        country: "Côte d'Ivoire", currency: 'XOF', timezone: 'Africa/Abidjan',
        status: 'TRIAL', created_at: params.now,
      };
      // tenants and restaurants are intentionally kept in sync: users reference tenants,
      // while the existing restaurant-facing schema uses restaurants.
      await trx('tenants').insert({ ...restaurant });
      await trx('restaurants').insert({ ...restaurant });
      await trx('users').insert({
        id: params.userId, tenant_id: params.restaurantId, email: params.email,
        password_hash: params.passwordHash, full_name: params.ownerName,
        phone: params.phone, role: 'OWNER', global_role: 'USER',
        permissions_json: '[]', status: 'ACTIVE', token_version: 1,
        created_at: params.now,
      });
      await trx('restaurant_members').insert({
        id: params.memberId, restaurant_id: params.restaurantId,
        user_id: params.userId, role: 'OWNER',
        custom_permissions_json: '[]', status: 'ACTIVE', created_at: params.now,
      });
      await trx('subscriptions').insert({
        id: params.subId, restaurant_id: params.restaurantId, plan_id: params.planId,
        billing_cycle: 'MONTHLY', status: 'TRIAL', trial_ends_at: params.trialEndsAt,
        current_period_start: params.now, current_period_end: params.trialEndsAt,
        created_at: params.now,
      });
      const categories = [
        { id: generateId('cat'), restaurant_id: params.restaurantId, name: 'Plats Principaux', station: 'KITCHEN', sort_order: 1, active: 1 },
        { id: generateId('cat'), restaurant_id: params.restaurantId, name: 'Boissons & Bar', station: 'BAR', sort_order: 2, active: 1 },
      ];
      await trx('menu_categories').insert(categories);
      for (let i = 1; i <= 4; i += 1) {
        const tableId = generateId('tbl');
        await trx('dining_tables').insert({
          id: tableId, restaurant_id: params.restaurantId,
          zone: 'Salle principale', label: `Table 0${i}`,
          capacity: 4, status: 'AVAILABLE',
        });
        await trx('qr_codes').insert({
          id: generateId('qr'), restaurant_id: params.restaurantId,
          table_id: tableId, token: `${params.slug}-t${i}-v1`,
          version: 1, status: 'ACTIVE', created_at: params.now,
        });
      }
      await trx('sessions').insert({
        id: params.sessionId, user_id: params.userId,
        restaurant_id: params.restaurantId, expires_at: params.sessionExpiresAt,
        user_agent: params.userAgent, created_at: params.now,
      });
      await this.recordAudit({
        actorUserId: params.userId, actorEmail: params.email, actorRole: 'OWNER',
        restaurantId: params.restaurantId, action: 'RESTAURANT_REGISTERED',
        targetType: 'RESTAURANT', targetId: params.restaurantId,
        details: `Création restaurant ${params.restaurantName} (essai)`,
      }, trx);
    });
  }
}

export const postgresAuthRepository = new PostgresAuthRepository();
