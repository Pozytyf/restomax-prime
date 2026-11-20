import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';

export class PostgresSuperadminRepository {
  constructor(private readonly db: Knex = getKnex()) {}

  async getPlatformDashboardData() {
    const [counts, activeSubs, platformRev, openTickets, usersCount, leadsCount,
      recentRestaurants, recentAudit, monthlyPlatformSeries] = await Promise.all([
      this.db('restaurants').whereNull('deleted_at').select(
        this.db.raw('COUNT(*)::int as total'),
        this.db.raw("COUNT(*) FILTER (WHERE status = 'ACTIVE')::int as active"),
        this.db.raw("COUNT(*) FILTER (WHERE status = 'TRIAL')::int as trial"),
        this.db.raw("COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int as suspended"),
      ).first(),
      this.db('subscriptions').whereIn('status', ['ACTIVE', 'TRIAL']).count({ c: '*' }).first(),
      this.db('platform_invoices').select(
        this.db.raw("COALESCE(SUM(amount_xof) FILTER (WHERE status = 'PAID'), 0) as paid_xof"),
        this.db.raw("COALESCE(SUM(amount_xof) FILTER (WHERE status = 'PENDING'), 0) as pending_xof"),
      ).first(),
      this.db('support_tickets').whereIn('status', ['OPEN', 'IN_PROGRESS']).count({ c: '*' }).first(),
      this.db('users').where({ status: 'ACTIVE' }).count({ c: '*' }).first(),
      this.db('contact_leads').count({ c: '*' }).first(),
      this.db('restaurants as r').leftJoin('subscriptions as s', 's.restaurant_id', 'r.id')
        .leftJoin('plans as p', 'p.id', 's.plan_id')
        .whereNull('r.deleted_at').select('r.id', 'r.name', 'r.city', 'r.status',
          { createdAt: 'r.created_at' }, { planName: 'p.name' },
          { subscriptionStatus: 's.status' }).orderBy('r.created_at', 'desc').limit(6),
      this.db('audit_logs').select('id', { actorEmail: 'actor_email' },
        { actorRole: 'actor_role' }, 'action', { targetType: 'target_type' },
        'details', { createdAt: 'created_at' }).orderBy('created_at', 'desc').limit(8),
      this.db('platform_invoices').where({ status: 'PAID' })
        .select(this.db.raw("TO_CHAR(created_at::timestamp, 'YYYY-MM') as month"),
          this.db.raw('COALESCE(SUM(amount_xof), 0) as revenue_xof'),
          this.db.raw('COUNT(*)::int as invoices'))
        .groupByRaw("TO_CHAR(created_at::timestamp, 'YYYY-MM')")
        .orderBy('month', 'asc'),
    ]);
    return { counts, activeSubs, platformRev, openTickets, usersCount, leadsCount,
      recentRestaurants, recentAudit, monthlyPlatformSeries };
  }

  async findAllRestaurants() {
    return this.db('restaurants as r')
      .leftJoin('subscriptions as s', 's.restaurant_id', 'r.id')
      .leftJoin('plans as p', 'p.id', 's.plan_id')
      .select('r.id', 'r.name', 'r.slug', 'r.email', 'r.phone', 'r.city', 'r.country', 'r.status',
        { paydunyaMode: 'r.paydunya_mode' }, { createdAt: 'r.created_at' }, { deletedAt: 'r.deleted_at' },
        { planName: 'p.name' }, { subscriptionStatus: 's.status' })
      .select(this.db.raw("(SELECT u.full_name FROM restaurant_members rm JOIN users u ON u.id = rm.user_id WHERE rm.restaurant_id = r.id AND rm.role = 'OWNER' ORDER BY rm.created_at ASC LIMIT 1) as \"ownerName\""))
      .select(this.db.raw("(SELECT u.email FROM restaurant_members rm JOIN users u ON u.id = rm.user_id WHERE rm.restaurant_id = r.id AND rm.role = 'OWNER' ORDER BY rm.created_at ASC LIMIT 1) as \"ownerEmail\""))
      .select(this.db.raw('(SELECT COUNT(*)::int FROM orders o WHERE o.restaurant_id = r.id) as "ordersCount"'))
      .orderBy('r.created_at', 'desc');
  }

  findUserByEmail(email: string) {
    return this.db('users').select('id').whereRaw('LOWER(email) = LOWER(?)', [email]).first();
  }

  async findPlanByCodeOrDefault(planCode: string) {
    return (await this.db('plans').select('id', 'trial_days').where({ code: planCode }).first())
      || this.db('plans').select('id', 'trial_days').orderBy('created_at', 'asc').first();
  }

  async createRestaurantAdmin(params: {
    rid: string; uid: string; name: string; slug: string; cleanEmail: string;
    phone: string; city: string; ownerName: string; passwordHash: string;
    planId: string; now: string; periodEnd: string;
    actorUserId: string; actorEmail: string;
  }) {
    return this.db.transaction(async trx => {
      const row = { id: params.rid, name: params.name, slug: params.slug,
        email: params.cleanEmail, phone: params.phone, city: params.city,
        status: 'ACTIVE', created_at: params.now };
      await trx('tenants').insert({ ...row, country: "Côte d'Ivoire", currency: 'XOF', timezone: 'Africa/Abidjan' });
      await trx('restaurants').insert({ ...row, country: "Côte d'Ivoire", currency: 'XOF', timezone: 'Africa/Abidjan' });
      await trx('users').insert({ id: params.uid, tenant_id: params.rid,
        email: params.cleanEmail, password_hash: params.passwordHash,
        full_name: params.ownerName, phone: params.phone, role: 'OWNER',
        global_role: 'USER', permissions_json: '[]', status: 'ACTIVE', created_at: params.now });
      await trx('restaurant_members').insert({ id: generateId('mem'),
        restaurant_id: params.rid, user_id: params.uid, role: 'OWNER',
        custom_permissions_json: '[]', status: 'ACTIVE', created_at: params.now });
      await trx('audit_logs').insert({ id: generateId('aud'), actor_user_id: params.actorUserId,
        actor_email: params.actorEmail, actor_role: 'SUPER_ADMIN', restaurant_id: params.rid,
        action: 'RESTAURANT_CREATED_BY_ADMIN', target_type: 'RESTAURANT', target_id: params.rid,
        details: params.name, created_at: params.now });
      await trx('subscriptions').insert({ id: generateId('sub'),
        restaurant_id: params.rid, plan_id: params.planId, billing_cycle: 'MONTHLY',
        status: 'ACTIVE', current_period_start: params.now,
        current_period_end: params.periodEnd, created_at: params.now });
    });
  }

  async updateRestaurantStatus(rid: string, status: string) {
    const now = new Date().toISOString();
    await this.db('restaurants').where({ id: rid }).update(status === 'DELETED'
      ? { status: 'DELETED', deleted_at: now }
      : { status, deleted_at: null });
    if (status === 'SUSPENDED' || status === 'DELETED') {
      await this.db('sessions').where({ restaurant_id: rid }).whereNull('revoked_at')
        .update({ revoked_at: now });
    }
  }

  findAllPlans() { return this.db('plans').select('*').orderBy('price_monthly_xof', 'asc'); }

  async updatePlan(planId: string, params: {
    name: string | null; tagline: string | null; priceMonthlyXof: number | null;
    priceYearlyXof: number | null; trialDays: number | null; maxTables: number | null;
    maxStaff: number | null; active: number | null;
  }) {
    const updates: Record<string, unknown> = {};
    const map: Record<string, keyof typeof params> = {
      name: 'name', tagline: 'tagline', price_monthly_xof: 'priceMonthlyXof',
      price_yearly_xof: 'priceYearlyXof', trial_days: 'trialDays',
      max_tables: 'maxTables', max_staff: 'maxStaff', active: 'active',
    };
    for (const [column, key] of Object.entries(map)) if (params[key] !== null) updates[column] = params[key];
    if (Object.keys(updates).length) await this.db('plans').where({ id: planId }).update(updates);
  }

  findAllSubscriptions() {
    return this.db('subscriptions as s').join('restaurants as r', 'r.id', 's.restaurant_id')
      .join('plans as p', 'p.id', 's.plan_id')
      .select('s.id', { restaurantId: 's.restaurant_id' }, { restaurantName: 'r.name' },
        { planName: 'p.name' }, { planCode: 'p.code' }, { priceMonthlyXof: 'p.price_monthly_xof' },
        { billingCycle: 's.billing_cycle' }, 's.status', { trialEndsAt: 's.trial_ends_at' },
        { currentPeriodEnd: 's.current_period_end' }).orderBy('s.created_at', 'desc');
  }

  findPlatformInvoices() {
    return this.db('platform_invoices as i').join('restaurants as r', 'r.id', 'i.restaurant_id')
      .select('i.id', { invoiceNumber: 'i.invoice_number' }, { restaurantId: 'i.restaurant_id' },
        { restaurantName: 'r.name' }, { amountXof: 'i.amount_xof' }, 'i.status',
        { paymentMethod: 'i.payment_method' }, 'i.mode', { paidAt: 'i.paid_at' },
        { createdAt: 'i.created_at' }).orderBy('i.created_at', 'desc');
  }

  async markInvoicePaid(invoiceId: string) {
    await this.db('platform_invoices').where({ id: invoiceId }).update({
      status: 'PAID', paid_at: new Date().toISOString(),
    });
  }

  findAllUsers() {
    return this.db('users as u').leftJoin('restaurant_members as rm', 'rm.user_id', 'u.id')
      .leftJoin('restaurants as r', 'r.id', 'rm.restaurant_id')
      .select('u.id', 'u.email', { fullName: 'u.full_name' }, 'u.phone',
        { globalRole: 'u.global_role' }, 'u.status', { createdAt: 'u.created_at' },
        { restaurantName: 'r.name' }, { restaurantRole: 'rm.role' })
      .orderBy('u.created_at', 'desc');
  }

  async updateUserStatus(userId: string, status: string) {
    await this.db('users').where({ id: userId }).update({ status });
    if (status !== 'ACTIVE') await this.db('sessions').where({ user_id: userId })
      .whereNull('revoked_at').update({ revoked_at: new Date().toISOString() });
  }

  async findAllTicketsAndLeads() {
    const tickets = await this.db('support_tickets as t').leftJoin('restaurants as r', 'r.id', 't.restaurant_id')
      .select('t.id', { restaurantId: 't.restaurant_id' }, { restaurantName: 'r.name' },
        { createdByEmail: 't.created_by_email' }, 't.subject', 't.category',
        't.priority', 't.status', { createdAt: 't.created_at' }).orderBy('t.created_at', 'desc');
    const ticketIds = tickets.map(t => t.id);
    const messages = ticketIds.length ? await this.db('ticket_messages')
      .select('id', 'ticket_id', 'author', 'role', 'body', { createdAt: 'created_at' })
      .whereIn('ticket_id', ticketIds).orderBy('created_at', 'asc') : [];
    const byTicket = new Map<string, typeof messages>();
    for (const message of messages) {
      const key = String(message.ticket_id);
      const rows = byTicket.get(key) || [];
      rows.push(message); byTicket.set(key, rows);
    }
    const leads = await this.db('contact_leads').select('*').orderBy('created_at', 'desc').limit(30);
    return { tickets: tickets.map(t => ({ ...t, messages: byTicket.get(String(t.id)) || [] })), leads };
  }

  async addTicketReply(ticketId: string, author: string, body?: string, status?: string) {
    const now = new Date().toISOString();
    await this.db.transaction(async trx => {
      if (body && body.trim()) await trx('ticket_messages').insert({
        id: generateId('tmsg'), ticket_id: ticketId, author,
        role: 'SUPER_ADMIN', body: body.trim(), created_at: now,
      });
      if (status && ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) {
        await trx('support_tickets').where({ id: ticketId }).update({ status });
      }
    });
  }

  findAuditLogs() {
    return this.db('audit_logs').select('id', { actorUserId: 'actor_user_id' },
      { actorEmail: 'actor_email' }, { actorRole: 'actor_role' },
      { restaurantId: 'restaurant_id' }, 'action', { targetType: 'target_type' },
      { targetId: 'target_id' }, 'details', { createdAt: 'created_at' })
      .orderBy('created_at', 'desc').limit(100);
  }

  async recordAudit(params: { actorUserId: string; actorEmail: string; actorRole: string;
    restaurantId: string | null; action: string; targetType: string; targetId: string; details?: string }) {
    await this.db('audit_logs').insert({ id: generateId('aud'),
      actor_user_id: params.actorUserId, actor_email: params.actorEmail,
      actor_role: params.actorRole, restaurant_id: params.restaurantId,
      action: params.action, target_type: params.targetType, target_id: params.targetId,
      details: params.details || '', created_at: new Date().toISOString() });
  }

  findPlatformSettings() { return this.db('platform_settings').select('key', 'value'); }

  async upsertPlatformSettings(entries: Array<[string, string]>) {
    const now = new Date().toISOString();
    if (!entries.length) return;
    await this.db('platform_settings').insert(entries.map(([key, value]) => ({
      key, value, updated_at: now,
    })).map(row => row)).onConflict('key').merge(['value', 'updated_at']);
  }
}

export const postgresSuperadminRepository = new PostgresSuperadminRepository();
