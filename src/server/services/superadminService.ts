import bcrypt from 'bcryptjs';
import { getDb, generateId } from '../db.ts';
import { type AuthContext, recordAudit } from '../auth.ts';
import { broadcastSuperAdminEvent } from '../ws.ts';
import {
  SuperadminRepository,
  superadminRepository,
} from '../repositories/superadminRepository.ts';
import { postgresSuperadminRepository } from '../repositories/postgresSuperadminRepository.ts';
import { BaseService } from './BaseService.ts';
import { AppError } from './errors.ts';

const isPostgresMode = () => ['pg', 'postgres', 'postgresql'].includes((process.env.DATABASE_CLIENT || 'sqlite').toLowerCase()) && process.env.RESTOMAX_POSTGRES_CUTOVER === 'true' && Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

export class SuperadminService extends BaseService<SuperadminRepository> {
  constructor(repo = superadminRepository) {
    super(repo);
  }

  async getDashboard() {
    if (isPostgresMode()) {
      const { counts, activeSubs, platformRev, openTickets, usersCount, leadsCount, recentRestaurants, recentAudit, monthlyPlatformSeries } = await postgresSuperadminRepository.getPlatformDashboardData();
      return { kpis: { totalRestaurants: Number(counts.total || 0), activeRestaurants: Number(counts.active || 0), trialRestaurants: Number(counts.trial || 0), suspendedRestaurants: Number(counts.suspended || 0), activeSubscriptions: Number(activeSubs.c || 0), platformRevenueXof: Number(platformRev.paid_xof || 0), pendingPaymentsXof: Number(platformRev.pending_xof || 0), openTicketsCount: Number(openTickets.c || 0), activeUsersCount: Number(usersCount.c || 0), leadsCount: Number(leadsCount.c || 0) }, recentRestaurants, recentAudit, monthlyPlatformSeries };
    }
    const {
      counts,
      activeSubs,
      platformRev,
      openTickets,
      usersCount,
      leadsCount,
      recentRestaurants,
      recentAudit,
      monthlyPlatformSeries,
    } = superadminRepository.getPlatformDashboardData();

    return {
      kpis: {
        totalRestaurants: Number(counts.total || 0),
        activeRestaurants: Number(counts.active || 0),
        trialRestaurants: Number(counts.trial || 0),
        suspendedRestaurants: Number(counts.suspended || 0),
        activeSubscriptions: Number(activeSubs.c || 0),
        platformRevenueXof: Number(platformRev.paid_xof || 0),
        pendingPaymentsXof: Number(platformRev.pending_xof || 0),
        openTicketsCount: Number(openTickets.c || 0),
        activeUsersCount: Number(usersCount.c || 0),
        leadsCount: Number(leadsCount.c || 0),
      },
      recentRestaurants,
      recentAudit,
      monthlyPlatformSeries,
    };
  }

  async listRestaurants() {
    if (isPostgresMode()) return postgresSuperadminRepository.findAllRestaurants();
    return superadminRepository.findAllRestaurants();
  }

  async createRestaurant(auth: AuthContext, body: Record<string, unknown>) {
    if (isPostgresMode()) return this.createRestaurantPostgres(auth, body);
    const { name, city, ownerName, ownerEmail, phone, planCode } = body || {};
    if (
      typeof name !== 'string' ||
      typeof ownerName !== 'string' ||
      typeof ownerEmail !== 'string'
    ) {
      throw new AppError(400, 'Nom, propriétaire et email requis.');
    }

    const cleanEmail = ownerEmail.trim().toLowerCase();
    const existing = superadminRepository.findUserByEmail(cleanEmail);
    if (existing) {
      throw new AppError(409, 'Email propriétaire déjà utilisé.');
    }

    const plan = superadminRepository.findPlanByCodeOrDefault(
      String(planCode || 'ESSENTIEL').toUpperCase(),
    );
    const now = new Date().toISOString();
    const rid = generateId('rest');
    const uid = generateId('usr');
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.floor(100 + Math.random() * 900)}`;

    const db = getDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      superadminRepository.createRestaurantAdmin({
        rid,
        uid,
        name: name.trim(),
        slug,
        cleanEmail,
        phone: String(phone || ''),
        city: String(city || 'Abidjan'),
        ownerName: ownerName.trim(),
        passwordHash: bcrypt.hashSync('RestoMax2026!', 10),
        planId: plan.id,
        now,
        periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      });

      recordAudit(db, {
        actorUserId: auth.userId,
        actorEmail: auth.email,
        actorRole: 'SUPER_ADMIN',
        restaurantId: rid,
        action: 'RESTAURANT_CREATED_BY_ADMIN',
        targetType: 'RESTAURANT',
        targetId: rid,
        details: name.trim(),
      });

      db.exec('COMMIT');
      return rid;
    } catch {
      db.exec('ROLLBACK');
      throw new AppError(500, 'Erreur création restaurant.');
    }
  }

  async updateRestaurantStatus(
    auth: AuthContext,
    rid: string,
    body: Record<string, unknown>,
  ) {
    if (isPostgresMode()) {
      const { status, reason } = body || {};
      if (!['ACTIVE', 'TRIAL', 'SUSPENDED', 'DELETED'].includes(String(status))) throw new AppError(400, 'Statut invalide.');
      await postgresSuperadminRepository.updateRestaurantStatus(rid, String(status));
      await postgresSuperadminRepository.recordAudit({ actorUserId: auth.userId, actorEmail: auth.email, actorRole: 'SUPER_ADMIN', restaurantId: rid, action: `RESTAURANT_${status}`, targetType: 'RESTAURANT', targetId: rid, details: String(reason || '') });
      broadcastSuperAdminEvent('restaurant:updated', { restaurantId: rid, status });
      return;
    }
    const { status, reason } = body || {};
    if (
      !['ACTIVE', 'TRIAL', 'SUSPENDED', 'DELETED'].includes(String(status))
    ) {
      throw new AppError(400, 'Statut invalide.');
    }

    superadminRepository.updateRestaurantStatus(rid, String(status));

    recordAudit(getDb(), {
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: 'SUPER_ADMIN',
      restaurantId: rid,
      action: `RESTAURANT_${status}`,
      targetType: 'RESTAURANT',
      targetId: rid,
      details: String(reason || ''),
    });

    broadcastSuperAdminEvent('restaurant:updated', {
      restaurantId: rid,
      status,
    });
  }

  async listPlans() {
    if (isPostgresMode()) {
      const plans = await postgresSuperadminRepository.findAllPlans();
      return plans.map((p) => ({ id: p.id, code: p.code, name: p.name, tagline: p.tagline,
        priceMonthlyXof: Number(p.price_monthly_xof), priceYearlyXof: Number(p.price_yearly_xof),
        trialDays: Number(p.trial_days), maxTables: Number(p.max_tables), maxStaff: Number(p.max_staff),
        maxMenuItems: Number(p.max_menu_items), isDemoPricing: Boolean(p.is_demo_pricing),
        isFeatured: Boolean(p.is_featured), features: JSON.parse(String(p.features_json || '[]')),
        active: Boolean(p.active) }));
    }
    const plans = superadminRepository.findAllPlans();
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      tagline: p.tagline,
      priceMonthlyXof: Number(p.price_monthly_xof),
      priceYearlyXof: Number(p.price_yearly_xof),
      trialDays: Number(p.trial_days),
      maxTables: Number(p.max_tables),
      maxStaff: Number(p.max_staff),
      maxMenuItems: Number(p.max_menu_items),
      isDemoPricing: Boolean(p.is_demo_pricing),
      isFeatured: Boolean(p.is_featured),
      features: JSON.parse(String(p.features_json || '[]')),
      active: Boolean(p.active),
    }));
  }

  async updatePlan(
    auth: AuthContext,
    planId: string,
    body: Record<string, unknown>,
  ) {
    const {
      name,
      tagline,
      priceMonthlyXof,
      priceYearlyXof,
      trialDays,
      maxTables,
      maxStaff,
      active,
    } = body || {};

    if (isPostgresMode()) {
      await postgresSuperadminRepository.updatePlan(planId, {
        name: name ? String(name).trim() : null, tagline: tagline ? String(tagline).trim() : null,
        priceMonthlyXof: Number.isFinite(Number(priceMonthlyXof)) ? Math.round(Number(priceMonthlyXof)) : null,
        priceYearlyXof: Number.isFinite(Number(priceYearlyXof)) ? Math.round(Number(priceYearlyXof)) : null,
        trialDays: Number.isFinite(Number(trialDays)) ? Math.round(Number(trialDays)) : null,
        maxTables: Number.isFinite(Number(maxTables)) ? Math.round(Number(maxTables)) : null,
        maxStaff: Number.isFinite(Number(maxStaff)) ? Math.round(Number(maxStaff)) : null,
        active: typeof active === 'boolean' ? (active ? 1 : 0) : null,
      });
      await postgresSuperadminRepository.recordAudit({ actorUserId: auth.userId, actorEmail: auth.email, actorRole: 'SUPER_ADMIN', restaurantId: null, action: 'PLAN_UPDATED', targetType: 'PLAN', targetId: planId, details: 'Mise à jour tarif/limites' });
      return;
    }
    superadminRepository.updatePlan(planId, {
      name: name ? String(name).trim() : null,
      tagline: tagline ? String(tagline).trim() : null,
      priceMonthlyXof: Number.isFinite(Number(priceMonthlyXof))
        ? Math.round(Number(priceMonthlyXof))
        : null,
      priceYearlyXof: Number.isFinite(Number(priceYearlyXof))
        ? Math.round(Number(priceYearlyXof))
        : null,
      trialDays: Number.isFinite(Number(trialDays))
        ? Math.round(Number(trialDays))
        : null,
      maxTables: Number.isFinite(Number(maxTables))
        ? Math.round(Number(maxTables))
        : null,
      maxStaff: Number.isFinite(Number(maxStaff))
        ? Math.round(Number(maxStaff))
        : null,
      active: typeof active === 'boolean' ? (active ? 1 : 0) : null,
    });

    recordAudit(getDb(), {
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: 'SUPER_ADMIN',
      restaurantId: null,
      action: 'PLAN_UPDATED',
      targetType: 'PLAN',
      targetId: planId,
      details: 'Mise à jour tarif/limites',
    });
  }

  async listSubscriptions() {
    if (isPostgresMode()) return postgresSuperadminRepository.findAllSubscriptions();
    return superadminRepository.findAllSubscriptions();
  }

  async listInvoices() {
    if (isPostgresMode()) return postgresSuperadminRepository.findPlatformInvoices();
    return superadminRepository.findPlatformInvoices();
  }

  async markInvoicePaid(auth: AuthContext, invoiceId: string) {
    if (isPostgresMode()) {
      await postgresSuperadminRepository.markInvoicePaid(invoiceId);
      await postgresSuperadminRepository.recordAudit({ actorUserId: auth.userId, actorEmail: auth.email, actorRole: 'SUPER_ADMIN', restaurantId: null, action: 'PLATFORM_INVOICE_PAID', targetType: 'INVOICE', targetId: invoiceId });
      return;
    }
    superadminRepository.markInvoicePaid(invoiceId);
    recordAudit(getDb(), {
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: 'SUPER_ADMIN',
      restaurantId: null,
      action: 'PLATFORM_INVOICE_PAID',
      targetType: 'INVOICE',
      targetId: invoiceId,
    });
  }

  async listUsers() {
    if (isPostgresMode()) return postgresSuperadminRepository.findAllUsers();
    return superadminRepository.findAllUsers();
  }

  async updateUserStatus(
    auth: AuthContext,
    targetUserId: string,
    status: unknown,
  ) {
    if (!['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(String(status))) {
      throw new AppError(400, 'Statut invalide.');
    }
    if (targetUserId === auth.userId) {
      throw new AppError(
        400,
        'Impossible de modifier votre propre compte actif.',
      );
    }

    if (isPostgresMode()) {
      await postgresSuperadminRepository.updateUserStatus(targetUserId, String(status));
      await postgresSuperadminRepository.recordAudit({ actorUserId: auth.userId, actorEmail: auth.email, actorRole: 'SUPER_ADMIN', restaurantId: null, action: `USER_${status}`, targetType: 'USER', targetId: targetUserId });
      return;
    }
    superadminRepository.updateUserStatus(targetUserId, String(status));
    recordAudit(getDb(), {
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: 'SUPER_ADMIN',
      restaurantId: null,
      action: `USER_${status}`,
      targetType: 'USER',
      targetId: targetUserId,
    });
  }

  async listTicketsAndLeads() {
    if (isPostgresMode()) return postgresSuperadminRepository.findAllTicketsAndLeads();
    return superadminRepository.findAllTicketsAndLeads();
  }

  async replyToTicket(
    auth: AuthContext,
    ticketId: string,
    body: Record<string, unknown>,
  ) {
    const { body: messageBody, status } = body || {};
    if (isPostgresMode()) {
      await postgresSuperadminRepository.addTicketReply(ticketId, auth.fullName,
        typeof messageBody === 'string' ? messageBody : undefined,
        status ? String(status) : undefined);
      return;
    }
    superadminRepository.addTicketReply(
      ticketId,
      auth.fullName,
      typeof messageBody === 'string' ? messageBody : undefined,
      status ? String(status) : undefined,
    );
  }

  async listAuditLogs() {
    if (isPostgresMode()) return postgresSuperadminRepository.findAuditLogs();
    return superadminRepository.findAuditLogs();
  }

  async getPlatformSettings(): Promise<Record<string, string>> {
    if (isPostgresMode()) {
      const rows = await postgresSuperadminRepository.findPlatformSettings();
      return Object.fromEntries(rows.map(row => [row.key, row.value]));
    }
    const rows = superadminRepository.findPlatformSettings();
    const settings: Record<string, string> = {};
    for (const r of rows) {
      settings[r.key] = r.value;
    }
    return settings;
  }

  async updatePlatformSettings(
    auth: AuthContext,
    updates: Record<string, unknown>,
  ) {
    const entries: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(updates || {})) {
      if (typeof v === 'string') {
        entries.push([k, v.trim()]);
      }
    }
    if (isPostgresMode()) {
      await postgresSuperadminRepository.upsertPlatformSettings(entries);
      await postgresSuperadminRepository.recordAudit({ actorUserId: auth.userId, actorEmail: auth.email, actorRole: 'SUPER_ADMIN', restaurantId: null, action: 'PLATFORM_SETTINGS_UPDATED', targetType: 'SETTINGS', targetId: 'global' });
      return;
    }
    superadminRepository.upsertPlatformSettings(entries);
    recordAudit(getDb(), {
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: 'SUPER_ADMIN',
      restaurantId: null,
      action: 'PLATFORM_SETTINGS_UPDATED',
      targetType: 'SETTINGS',
      targetId: 'global',
    });
  }
  private async createRestaurantPostgres(auth: AuthContext, body: Record<string, unknown>) {
    const { name, city, ownerName, ownerEmail, phone, planCode } = body || {};
    if (typeof name !== 'string' || name.trim().length < 2 ||
        typeof ownerName !== 'string' || ownerName.trim().length < 2 ||
        typeof ownerEmail !== 'string' || !ownerEmail.includes('@')) {
      throw new AppError(400, 'Nom, propriétaire et email requis.');
    }
    const cleanEmail = ownerEmail.trim().toLowerCase();
    if (await postgresSuperadminRepository.findUserByEmail(cleanEmail)) throw new AppError(409, 'Email propriétaire déjà utilisé.');
    const plan = await postgresSuperadminRepository.findPlanByCodeOrDefault(String(planCode || 'ESSENTIEL').toUpperCase());
    if (!plan) throw new AppError(500, 'Aucune formule disponible.');
    const now = new Date().toISOString();
    const rid = generateId('rest'); const uid = generateId('usr');
    const slug = `${name.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}-${Math.floor(100 + Math.random() * 900)}`;
    try {
      await postgresSuperadminRepository.createRestaurantAdmin({
        rid, uid, name: name.trim(), slug, cleanEmail, phone: String(phone || ''),
        city: String(city || 'Abidjan'), ownerName: ownerName.trim(),
        passwordHash: await bcrypt.hash('RestoMax2026!', 10), planId: plan.id,
        now, periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
        actorUserId: auth.userId, actorEmail: auth.email,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') throw new AppError(409, 'Email propriétaire ou identifiant établissement déjà utilisé.');
      throw new AppError(500, 'Erreur création restaurant.');
    }
    return rid;
  }

}

export const superadminService = new SuperadminService();
