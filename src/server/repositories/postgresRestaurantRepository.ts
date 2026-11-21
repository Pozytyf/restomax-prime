import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';
import { AppError } from '../services/errors.ts';
import type { AuditRecord } from './postgresAuthRepository.ts';

export class PostgresRestaurantRepository {
  constructor(private readonly db: Knex = getKnex()) {}

  async getDashboardMetrics(rid: string) {
    const [revenueRow, pendingRow, tablesStats, revenueSeries, topItems, lowStocks,
      paymentBreakdown, recentOrders, staffActivity, expensesRow, collectedRow] = (await Promise.all([
      this.db('orders').where({ restaurant_id: rid }).whereNot('status', 'CANCELLED')
        .select(this.db.raw('COALESCE(SUM(total_xof), 0) as total_revenue'),
          this.db.raw('COUNT(*)::int as orders_count'),
          this.db.raw('COALESCE(AVG(total_xof), 0) as avg_basket')).first(),
      this.db('orders').where({ restaurant_id: rid }).whereIn('status', ['PENDING', 'IN_PREPARATION', 'READY']).count({ c: '*' }).first(),
      this.db('dining_tables').where({ restaurant_id: rid }).select(
        this.db.raw('COUNT(*)::int as total'),
        this.db.raw("COUNT(*) FILTER (WHERE status = 'OCCUPIED')::int as occupied"),
        this.db.raw("COUNT(*) FILTER (WHERE status = 'RESERVED')::int as reserved")).first(),
      this.db('orders').where({ restaurant_id: rid }).whereNot('status', 'CANCELLED')
        .select(this.db.raw("TO_CHAR(created_at::timestamp, 'YYYY-MM-DD') as day"),
          this.db.raw('COALESCE(SUM(total_xof), 0) as revenue_xof'), this.db.raw('COUNT(*)::int as orders'))
        .groupByRaw("TO_CHAR(created_at::timestamp, 'YYYY-MM-DD')").orderBy('day', 'asc').limit(14),
      this.db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id')
        .where('o.restaurant_id', rid).whereNot('o.status', 'CANCELLED')
        .select('oi.name', this.db.raw('SUM(oi.quantity)::int as qty'),
          this.db.raw('SUM(oi.line_total_xof) as revenue_xof'))
        .groupBy('oi.name').orderBy('revenue_xof', 'desc').limit(5),
      this.db('stocks').where({ restaurant_id: rid }).whereRaw('quantity <= min_threshold')
        .select('id', 'name', 'unit', 'quantity', 'min_threshold', 'supplier_name')
        .orderByRaw('(quantity - min_threshold) ASC'),
      this.db('payments').where({ restaurant_id: rid, status: 'PAID' })
        .select('method', this.db.raw('COALESCE(SUM(amount_xof), 0) as total_xof'),
          this.db.raw('COUNT(*)::int as count')).groupBy('method'),
      this.db('orders as o').leftJoin('dining_tables as t', 't.id', 'o.table_id')
        .where('o.restaurant_id', rid).select('o.id', 'o.order_number', 'o.order_type',
          'o.customer_name', 'o.status', 'o.total_xof', 'o.paid_xof', 'o.created_at',
          { table_label: 't.label' }).orderBy('o.created_at', 'desc').limit(6),
      this.db('audit_logs').where({ restaurant_id: rid })
        .select('actor_email', 'actor_role', 'action', 'details', 'created_at')
        .orderBy('created_at', 'desc').limit(6),
      this.db('expenses').where({ restaurant_id: rid })
        .sum({ total_expenses: 'amount_xof' }).first(),
      this.db('payments').where({ restaurant_id: rid, status: 'PAID' })
        .sum({ total_paid: 'amount_xof' }).first(),
    ])) as any[];
    return { revenueRow, pendingRow, tablesStats, revenueSeries, topItems, lowStocks,
      paymentBreakdown, recentOrders, staffActivity, expensesRow, collectedRow };
  }

  findMenuCategories(rid: string) {
    return this.db('menu_categories').select('id', { restaurantId: 'restaurant_id' },
      'name', 'station', { sortOrder: 'sort_order' }, 'active')
      .where({ restaurant_id: rid }).orderBy('sort_order', 'asc');
  }

  findMenuItems(rid: string) {
    return this.db('menu_items as m').join('menu_categories as c', 'c.id', 'm.category_id')
      .select('m.id', { restaurantId: 'm.restaurant_id' }, { categoryId: 'm.category_id' },
        { categoryName: 'c.name' }, 'c.station', 'm.name', 'm.description',
        { priceXof: 'm.price_xof' }, { costPriceXof: 'm.cost_price_xof' },
        { imageUrl: 'm.image_url' }, 'm.available', { sortOrder: 'm.sort_order' }, 'm.options_json')
      .where('m.restaurant_id', rid).orderBy('m.sort_order', 'asc').orderBy('m.name', 'asc');
  }

  async countCategories(rid: string) {
    const row = await this.db('menu_categories').where({ restaurant_id: rid }).count({ count: '*' }).first();
    return Number(row?.count || 0);
  }

  async createCategory(rid: string, name: string, station: string, sortOrder: number) {
    const id = generateId('cat');
    await this.db('menu_categories').insert({ id, restaurant_id: rid, name, station, sort_order: sortOrder, active: 1 });
    return id;
  }

  findCategory(categoryId: string, rid: string) {
    return this.db('menu_categories').select('id').where({ id: categoryId, restaurant_id: rid }).first();
  }

  async createMenuItem(params: { rid: string; categoryId: string; name: string;
    description: string; priceXof: number; costPriceXof: number; optionsJson: string; imageUrl?: string | null }) {
    const id = generateId('itm');
    await this.db('menu_items').insert({ id, restaurant_id: params.rid,
      category_id: params.categoryId, name: params.name, description: params.description,
      price_xof: params.priceXof, cost_price_xof: params.costPriceXof,
      image_url: params.imageUrl || null, available: 1, sort_order: 99, options_json: params.optionsJson,
      created_at: new Date().toISOString() });
    return id;
  }

  findMenuItemById(itemId: string, rid: string) {
    return this.db('menu_items').select('id').where({ id: itemId, restaurant_id: rid }).first();
  }

  async updateMenuItem(itemId: string, rid: string, updates: {
    available?: boolean; priceXof?: number; name?: string; description?: string; imageUrl?: string;
  }) {
    const patch: Record<string, unknown> = {};
    if (typeof updates.available === 'boolean') patch.available = updates.available ? 1 : 0;
    if (updates.priceXof !== undefined) patch.price_xof = updates.priceXof;
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.imageUrl !== undefined) patch.image_url = updates.imageUrl;
    if (Object.keys(patch).length) await this.db('menu_items').where({ id: itemId, restaurant_id: rid }).update(patch);
  }

  async findMenuRecipes(rid: string, menuItemId?: string) {
    const query = this.db('menu_item_recipes as r').join('stocks as s', 's.id', 'r.stock_id')
      .select('r.id', { menuItemId: 'r.menu_item_id' }, { stockId: 'r.stock_id' },
        { quantityPerUnit: 'r.quantity_per_unit' }, { stockName: 's.name' }, 's.unit',
        { unitCostXof: 's.unit_cost_xof' }, { currentStockQty: 's.quantity' })
      .where('r.restaurant_id', rid);
    if (menuItemId) query.andWhere('r.menu_item_id', menuItemId);
    const rows = await query.orderBy('s.name', 'asc');
    return rows.map(row => ({ id: String(row.id), menuItemId: String(row.menuItemId),
      stockId: String(row.stockId), stockName: String(row.stockName), unit: String(row.unit),
      quantityPerUnit: Number(row.quantityPerUnit), unitCostXof: Number(row.unitCostXof || 0),
      currentStockQty: Number(row.currentStockQty || 0) }));
  }

  async findStockById(stockId: string, rid: string) {
    return this.db('stocks').where({ id: stockId, restaurant_id: rid }).first();
  }

  async replaceMenuItemRecipe(rid: string, menuItemId: string,
    lines: Array<{ stockId: string; quantityPerUnit: number }>) {
    const now = new Date().toISOString();
    return this.db.transaction(async trx => {
      await trx('menu_item_recipes').where({ restaurant_id: rid, menu_item_id: menuItemId }).del();
      let computedCost = 0;
      for (const line of lines) {
        const stock = await trx('stocks').where({ id: line.stockId, restaurant_id: rid }).first();
        if (!stock) continue;
        await trx('menu_item_recipes').insert({ id: generateId('rec'), restaurant_id: rid,
          menu_item_id: menuItemId, stock_id: line.stockId,
          quantity_per_unit: line.quantityPerUnit, created_at: now, updated_at: now });
        computedCost += Number(stock.unit_cost_xof || 0) * line.quantityPerUnit;
      }
      if (lines.length && computedCost > 0) await trx('menu_items')
        .where({ id: menuItemId, restaurant_id: rid }).update({ cost_price_xof: Math.round(computedCost) });
      const rows = await trx('menu_item_recipes as r').join('stocks as s', 's.id', 'r.stock_id')
        .select('r.id', { menuItemId: 'r.menu_item_id' }, { stockId: 'r.stock_id' },
          { quantityPerUnit: 'r.quantity_per_unit' }, { stockName: 's.name' }, 's.unit',
          { unitCostXof: 's.unit_cost_xof' }, { currentStockQty: 's.quantity' })
        .where({ 'r.restaurant_id': rid, 'r.menu_item_id': menuItemId }).orderBy('s.name', 'asc');
      return rows.map(row => ({ id: String(row.id), menuItemId: String(row.menuItemId),
        stockId: String(row.stockId), stockName: String(row.stockName), unit: String(row.unit),
        quantityPerUnit: Number(row.quantityPerUnit), unitCostXof: Number(row.unitCostXof || 0),
        currentStockQty: Number(row.currentStockQty || 0) }));
    });
  }

  async findOrdersWithItems(rid: string) {
    const orders = await this.db('orders as o').leftJoin('dining_tables as t', 't.id', 'o.table_id')
      .where('o.restaurant_id', rid).select('o.id', { restaurantId: 'o.restaurant_id' },
        { orderNumber: 'o.order_number' }, { orderType: 'o.order_type' },
        { tableId: 'o.table_id' }, { tableLabel: 't.label' }, { tableZone: 't.zone' },
        { customerName: 'o.customer_name' }, 'o.status', { subtotalXof: 'o.subtotal_xof' },
        { discountXof: 'o.discount_xof' }, { taxXof: 'o.tax_xof' }, { totalXof: 'o.total_xof' },
        { paidXof: 'o.paid_xof' }, 'o.notes', { createdByUserId: 'o.created_by_user_id' },
        { createdAt: 'o.created_at' }, { updatedAt: 'o.updated_at' })
      .orderBy('o.created_at', 'desc').limit(100);
    const ids = orders.map(o => o.id);
    const lines = ids.length ? await this.db('order_items').whereIn('order_id', ids)
      .select('id', { orderId: 'order_id' }, { menuItemId: 'menu_item_id' }, 'name', 'station',
        { unitPriceXof: 'unit_price_xof' }, { optionsSummary: 'options_summary' },
        { optionsDeltaXof: 'options_delta_xof' }, 'quantity', { lineTotalXof: 'line_total_xof' },
        'notes', { prepStatus: 'prep_status' }) : [];
    const byOrder = new Map<string, typeof lines>();
    for (const line of lines) { const key = String(line.orderId); const list = byOrder.get(key) || []; list.push(line); byOrder.set(key, list); }
    return orders.map(o => ({ ...o, items: byOrder.get(String(o.id)) || [] }));
  }

  async findPayments(rid: string) {
    return this.db('payments as p').join('orders as o', 'o.id', 'p.order_id')
      .where('p.restaurant_id', rid).select('p.id', { restaurantId: 'p.restaurant_id' },
        { orderId: 'p.order_id' }, { orderNumber: 'o.order_number' },
        { amountXof: 'p.amount_xof' }, 'p.method', 'p.status', 'p.mode',
        'p.reference', { createdAt: 'p.created_at' }).orderBy('p.created_at', 'desc').limit(100);
  }

  async findTablesWithQrAndActiveOrder(rid: string) {
    return this.db('dining_tables as t').leftJoin('qr_codes as q', function() {
      this.on('q.table_id', '=', 't.id').andOnVal('q.status', '=', 'ACTIVE');
    }).where('t.restaurant_id', rid).select('t.id', { restaurantId: 't.restaurant_id' },
      't.zone', 't.label', 't.capacity', 't.status', { qrToken: 'q.token' },
      { qrVersion: 'q.version' }, { qrStatus: 'q.status' })
      .select(this.db.raw("(SELECT id FROM orders o WHERE o.table_id = t.id AND o.restaurant_id = t.restaurant_id AND o.status NOT IN ('PAID', 'CANCELLED') ORDER BY o.created_at DESC LIMIT 1) as \"activeOrderId\""))
      .select(this.db.raw("(SELECT total_xof FROM orders o WHERE o.table_id = t.id AND o.restaurant_id = t.restaurant_id AND o.status NOT IN ('PAID', 'CANCELLED') ORDER BY o.created_at DESC LIMIT 1) as \"activeOrderTotalXof\""))
      .orderBy('t.zone', 'asc').orderBy('t.label', 'asc');
  }

  async createTableWithQr(rid: string, zone: string, label: string, capacity: number) {
    const tableId = generateId('tbl');
    const qrToken = `${rid.slice(-6)}-${generateId('q').slice(-8)}-v1`;
    const now = new Date().toISOString();
    await this.db.transaction(async trx => {
      await trx('dining_tables').insert({ id: tableId, restaurant_id: rid, zone, label, capacity, status: 'AVAILABLE' });
      await trx('qr_codes').insert({ id: generateId('qr'), restaurant_id: rid, table_id: tableId,
        token: qrToken, version: 1, status: 'ACTIVE', created_at: now });
    });
    return { tableId, qrToken };
  }

  async updateTableStatus(tableId: string, rid: string, status: string) {
    await this.db('dining_tables').where({ id: tableId, restaurant_id: rid }).update({ status });
  }

  async regenerateTableQr(tableId: string, rid: string) {
    return this.db.transaction(async trx => {
      const row = await trx('qr_codes').where({ table_id: tableId, restaurant_id: rid })
        .max({ version: 'version' }).first();
      const nextVersion = Number(row?.version || 0) + 1;
      const token = `${rid.slice(-6)}-${generateId('q').slice(-8)}-v${nextVersion}`;
      const now = new Date().toISOString();
      await trx('qr_codes').where({ table_id: tableId, restaurant_id: rid, status: 'ACTIVE' })
        .update({ status: 'REVOKED', revoked_at: now });
      await trx('qr_codes').insert({ id: generateId('qr'), restaurant_id: rid, table_id: tableId,
        token, version: nextVersion, status: 'ACTIVE', created_at: now });
      return { token, version: nextVersion };
    });
  }

  async findStocksAndMovements(rid: string) {
    const [stocks, movements] = await Promise.all([
      this.db('stocks as s').where('s.restaurant_id', rid)
        .select('s.id', { restaurantId: 's.restaurant_id' }, 's.name', 's.unit', 's.quantity',
          { minThreshold: 's.min_threshold' }, { unitCostXof: 's.unit_cost_xof' },
          { supplierName: 's.supplier_name' }, { updatedAt: 's.updated_at' })
        .select(this.db.raw('(SELECT COUNT(*)::int FROM menu_item_recipes r WHERE r.stock_id = s.id AND r.restaurant_id = s.restaurant_id) as "usedInRecipesCount"'))
        .orderBy('s.name', 'asc'),
      this.db('stock_movements as m').join('stocks as s', 's.id', 'm.stock_id')
        .where('m.restaurant_id', rid).select('m.id', { stockName: 's.name' },
          { movementType: 'm.movement_type' }, { quantityDelta: 'm.quantity_delta' },
          'm.reason', { createdAt: 'm.created_at' }).orderBy('m.created_at', 'desc').limit(40),
    ]);
    return { stocks, movements };
  }

  async createStockItem(params: { rid: string; name: string; unit: string; quantity: number;
    minThreshold: number; unitCostXof: number; supplierName: string }) {
    const id = generateId('stk');
    await this.db('stocks').insert({ id, restaurant_id: params.rid, name: params.name,
      unit: params.unit, quantity: params.quantity, min_threshold: params.minThreshold,
      unit_cost_xof: params.unitCostXof, supplier_name: params.supplierName,
      updated_at: new Date().toISOString() });
    return id;
  }

  async applyStockMovement(params: { rid: string; stockId: string; nextQty: number;
    movementType: string; delta: number; reason: string; userId: string }) {
    const now = new Date().toISOString();
    await this.db.transaction(async trx => {
      await trx('stocks').where({ id: params.stockId, restaurant_id: params.rid })
        .update({ quantity: params.nextQty, updated_at: now });
      await trx('stock_movements').insert({ id: generateId('smv'),
        restaurant_id: params.rid, stock_id: params.stockId, movement_type: params.movementType,
        quantity_delta: params.delta, reason: params.reason, created_by_user_id: params.userId,
        created_at: now });
    });
  }

  async findRestaurantNameById(rid: string) {
    const row = await this.db('restaurants').select('name').where({ id: rid }).first();
    return row?.name || 'Établissement Resto’MAX';
  }

  async findStockAlertSettings(rid: string) {
    const row = await this.db('stock_alert_settings').where({ restaurant_id: rid }).first();
    if (!row) return { restaurantId: rid, inAppEnabled: true, emailEnabled: true,
      recipientEmails: '', smtpHost: '', smtpPort: 587, smtpSecure: false,
      smtpUser: '', smtpPass: '', smtpFrom: '', updatedAt: new Date().toISOString() };
    return { restaurantId: rid, inAppEnabled: Boolean(row.in_app_enabled),
      emailEnabled: Boolean(row.email_enabled), recipientEmails: row.recipient_emails || '',
      smtpHost: row.smtp_host || '', smtpPort: Number(row.smtp_port || 587),
      smtpSecure: Boolean(row.smtp_secure), smtpUser: row.smtp_user || '',
      smtpPass: row.smtp_pass || '', smtpFrom: row.smtp_from || '', updatedAt: row.updated_at };
  }

  async upsertStockAlertSettings(params: { rid: string; inAppEnabled: boolean; emailEnabled: boolean;
    recipientEmails: string; smtpHost: string; smtpPort: number; smtpSecure: boolean;
    smtpUser: string; smtpPass?: string; smtpFrom: string }) {
    const current = await this.findStockAlertSettings(params.rid);
    const now = new Date().toISOString();
    await this.db('stock_alert_settings').insert({
      restaurant_id: params.rid, in_app_enabled: params.inAppEnabled ? 1 : 0,
      email_enabled: params.emailEnabled ? 1 : 0, recipient_emails: params.recipientEmails,
      smtp_host: params.smtpHost, smtp_port: params.smtpPort,
      smtp_secure: params.smtpSecure ? 1 : 0, smtp_user: params.smtpUser,
      smtp_pass: params.smtpPass?.trim() ? params.smtpPass : current.smtpPass,
      smtp_from: params.smtpFrom, updated_at: now,
    }).onConflict('restaurant_id').merge();
    return this.findStockAlertSettings(params.rid);
  }

  async findManagerEmailsForRestaurant(rid: string) {
    const rows = await this.db('restaurant_members as rm').join('users as u', 'u.id', 'rm.user_id')
      .distinct('u.email').where({ 'rm.restaurant_id': rid, 'rm.status': 'ACTIVE', 'u.status': 'ACTIVE' })
      .whereIn('rm.role', ['OWNER', 'MANAGER']);
    return rows.map(row => row.email);
  }

  async createNotification(params: { rid: string; type: string; title: string; message: string;
    stockId: string | null; emailDispatched: boolean; emailRecipients: string;
    emailStatus: 'SENT' | 'QUEUED_NO_SMTP' | 'SKIPPED' | 'FAILED' }) {
    const id = generateId('ntf'); const now = new Date().toISOString();
    await this.db('notifications').insert({ id, restaurant_id: params.rid, type: params.type,
      title: params.title, message: params.message, stock_id: params.stockId,
      email_dispatched: params.emailDispatched ? 1 : 0, email_recipients: params.emailRecipients,
      email_status: params.emailStatus, is_read: 0, created_at: now });
    return { id, restaurantId: params.rid, type: params.type, title: params.title,
      message: params.message, stockId: params.stockId, emailDispatched: params.emailDispatched,
      emailRecipients: params.emailRecipients, emailStatus: params.emailStatus,
      isRead: false, createdAt: now };
  }

  async findNotificationsForRestaurant(rid: string, limit = 30) {
    const rows = await this.db('notifications').where({ restaurant_id: rid })
      .select('id', { restaurantId: 'restaurant_id' }, 'type', 'title', 'message',
        { stockId: 'stock_id' }, { emailDispatched: 'email_dispatched' },
        { emailRecipients: 'email_recipients' }, { emailStatus: 'email_status' },
        { isRead: 'is_read' }, { createdAt: 'created_at' })
      .orderBy('created_at', 'desc').limit(limit);
    return rows.map(row => ({ ...row, stockId: row.stockId ? String(row.stockId) : null,
      emailDispatched: Boolean(row.emailDispatched), isRead: Boolean(row.isRead) }));
  }

  async markNotificationsRead(rid: string, notificationId?: string) {
    const query = this.db('notifications').where({ restaurant_id: rid });
    if (notificationId) query.andWhere({ id: notificationId });
    await query.update({ is_read: 1 });
  }

  async findRecentStockAlerts(rid: string, limit = 15) {
    return this.findNotificationsForRestaurant(rid, limit).then(rows => rows.filter(row => row.type === 'STOCK_CRITICAL'));
  }

  async findStaffMembers(rid: string) {
    return this.db('restaurant_members as rm').join('users as u', 'u.id', 'rm.user_id')
      .where('rm.restaurant_id', rid).select('rm.id', { userId: 'rm.user_id' },
        { fullName: 'u.full_name' }, 'u.email', 'u.phone', 'rm.role', 'rm.status',
        'rm.custom_permissions_json', { createdAt: 'rm.created_at' }).orderBy('rm.created_at', 'asc');
  }

  findUserByEmail(email: string) {
    return this.db('users').select('id').whereRaw('LOWER(email) = LOWER(?)', [email]).first();
  }

  async createStaffUserAndMember(params: { rid: string; email: string; passwordHash: string;
    fullName: string; phone: string | null; role: string; customPermissions: string[] }) {
    const userId = generateId('usr'); const memberId = generateId('mem');
    const now = new Date().toISOString();
    await this.db.transaction(async trx => {
      await trx('users').insert({ id: userId, tenant_id: params.rid, email: params.email,
        password_hash: params.passwordHash, full_name: params.fullName, phone: params.phone,
        role: params.role, global_role: 'USER', permissions_json: JSON.stringify(params.customPermissions),
        status: 'ACTIVE', created_at: now });
      await trx('restaurant_members').insert({ id: memberId, restaurant_id: params.rid,
        user_id: userId, role: params.role, custom_permissions_json: JSON.stringify(params.customPermissions),
        status: 'ACTIVE', created_at: now });
    });
    return { memberId, userId };
  }

  findMemberById(memberId: string, rid: string) {
    return this.db('restaurant_members').select('id', 'user_id', 'role')
      .where({ id: memberId, restaurant_id: rid }).first();
  }

  async updateStaffMember(memberId: string, rid: string, userId: string, updates: {
    status?: string; role?: string; customPermissions?: string[] }) {
    await this.db.transaction(async trx => {
      if (updates.status) {
        await trx('restaurant_members').where({ id: memberId, restaurant_id: rid }).update({ status: updates.status });
        if (updates.status !== 'ACTIVE') await trx('sessions').where({ user_id: userId })
          .whereNull('revoked_at').update({ revoked_at: new Date().toISOString() });
      }
      if (updates.role) await trx('restaurant_members').where({ id: memberId, restaurant_id: rid }).update({ role: updates.role });
      if (updates.customPermissions) await trx('restaurant_members').where({ id: memberId, restaurant_id: rid })
        .update({ custom_permissions_json: JSON.stringify(updates.customPermissions) });
    });
  }

  async findCustomers(rid: string) {
    return this.db('customers').where({ restaurant_id: rid })
      .select('id', { restaurantId: 'restaurant_id' }, { fullName: 'full_name' }, 'phone', 'email',
        { loyaltyPoints: 'loyalty_points' }, { totalSpentXof: 'total_spent_xof' },
        { visitsCount: 'visits_count' }, 'preferences', { createdAt: 'created_at' })
      .orderBy('total_spent_xof', 'desc');
  }

  async createCustomer(params: { rid: string; fullName: string; phone: string; email: string; preferences: string }) {
    const id = generateId('cust');
    await this.db('customers').insert({ id, restaurant_id: params.rid, full_name: params.fullName,
      phone: params.phone, email: params.email, loyalty_points: 0, total_spent_xof: 0,
      visits_count: 0, preferences: params.preferences, created_at: new Date().toISOString() });
    return id;
  }

  async findReservations(rid: string) {
    return this.db('reservations as r').leftJoin('dining_tables as t', 't.id', 'r.table_id')
      .where('r.restaurant_id', rid).select('r.id', { restaurantId: 'r.restaurant_id' },
        { customerName: 'r.customer_name' }, { customerPhone: 'r.customer_phone' },
        { partySize: 'r.party_size' }, { reservedAt: 'r.reserved_at' },
        { tableId: 'r.table_id' }, { tableLabel: 't.label' }, 'r.status', 'r.notes')
      .orderBy('r.reserved_at', 'asc');
  }

  async createReservation(params: { rid: string; customerName: string; customerPhone: string;
    partySize: number; reservedAt: string; tableId: string | null; notes: string }) {
    const id = generateId('res');
    await this.db('reservations').insert({ id, restaurant_id: params.rid,
      customer_name: params.customerName, customer_phone: params.customerPhone,
      party_size: params.partySize, reserved_at: params.reservedAt, table_id: params.tableId,
      status: 'CONFIRMED', notes: params.notes, created_at: new Date().toISOString() });
    return id;
  }

  async updateReservationStatus(id: string, rid: string, status: string) {
    await this.db('reservations').where({ id, restaurant_id: rid }).update({ status });
  }

  async findFinanceSummary(rid: string) {
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Abidjan' }).format(new Date());
    const start = `${todayDate}T00:00:00.000Z`;
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    const [sales, todaySales, todayPayments, cogsRow, expenses, byMethod] = await Promise.all([
      this.db('orders').where({ restaurant_id: rid }).whereNot('status', 'CANCELLED')
        .select(this.db.raw('COALESCE(SUM(total_xof), 0) as gross_sales'),
          this.db.raw('COALESCE(SUM(tax_xof), 0) as total_tax'),
          this.db.raw('COALESCE(SUM(paid_xof), 0) as collected')).first(),
      this.db('orders').where({ restaurant_id: rid }).whereNot('status', 'CANCELLED')
        .where('created_at', '>=', start).andWhere('created_at', '<', end)
        .select(this.db.raw('COALESCE(SUM(total_xof), 0) as revenue_xof'),
          this.db.raw('COUNT(*)::int as orders_count'),
          this.db.raw('COALESCE(AVG(total_xof), 0) as avg_basket')).first(),
      this.db('payments').where({ restaurant_id: rid, status: 'PAID' })
        .where('created_at', '>=', start).andWhere('created_at', '<', end)
        .sum({ collected_xof: 'amount_xof' }).first(),
      this.db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id')
        .join('menu_items as mi', 'mi.id', 'oi.menu_item_id')
        .where('o.restaurant_id', rid).whereNot('o.status', 'CANCELLED')
        .sum({ total_cogs: this.db.raw('oi.quantity * mi.cost_price_xof') }).first(),
      this.db('expenses').where({ restaurant_id: rid })
        .select('id', 'category', 'description', { amountXof: 'amount_xof' }, { expenseDate: 'expense_date' })
        .orderBy('expense_date', 'desc'),
      this.db('payments').where({ restaurant_id: rid, status: 'PAID' })
        .select('method', this.db.raw('COALESCE(SUM(amount_xof), 0) as "amountXof"'),
          this.db.raw('COUNT(*)::int as count')).groupBy('method'),
    ]);
    return { sales, todayDate, todaySales, todayPayments, cogsRow, expenses, byMethod };
  }

  async createExpense(params: { rid: string; category: string; description: string;
    amountXof: number; expenseDate?: string }) {
    const id = generateId('exp'); const now = new Date().toISOString();
    await this.db('expenses').insert({ id, restaurant_id: params.rid, category: params.category,
      description: params.description, amount_xof: params.amountXof,
      expense_date: params.expenseDate || now, created_at: now });
    return id;
  }

  async findOrdersForCsvExport(rid: string) {
    return this.db('orders').where({ restaurant_id: rid })
      .select('order_number', 'order_type', 'customer_name', 'status',
        'total_xof', 'paid_xof', 'created_at').orderBy('created_at', 'desc');
  }

  async findRestaurantSettings(rid: string) {
    const [resto, sub] = await Promise.all([
      this.db('restaurants').select('id', 'name', 'slug', 'email', 'phone', 'address', 'city',
        'country', 'currency', 'timezone', { taxRatePercent: 'tax_rate_percent' },
        { serviceFeePercent: 'service_fee_percent' }, { openingHours: 'opening_hours' }, { logoUrl: 'logo_url' },
        { paydunyaMode: 'paydunya_mode' }, 'paydunya_public_key', 'paydunya_private_key',
        'paydunya_token', { printerSettingsJson: 'printer_settings_json' }, 'status',
        { createdAt: 'created_at' }).where({ id: rid }).first(),
      this.db('subscriptions as s').join('plans as p', 'p.id', 's.plan_id')
        .select('s.id', 's.status', { billingCycle: 's.billing_cycle' },
          { trialEndsAt: 's.trial_ends_at' }, { currentPeriodEnd: 's.current_period_end' },
          { planName: 'p.name' }, { priceMonthlyXof: 'p.price_monthly_xof' })
        .where('s.restaurant_id', rid).orderBy('s.created_at', 'desc').first(),
    ]);
    return { resto, sub };
  }

  async updateRestaurantSettings(rid: string, params: {
    name: string | null; phone: string | null; address: string | null; city: string | null;
    openingHours: string | null; taxRatePercent: number | null; paydunyaMode: string | null; logoUrl?: string | null;
    paydunyaPublicKey?: string; paydunyaPrivateKey?: string; paydunyaToken?: string;
    printerSettingsJson?: string;
  }) {
    const patch: Record<string, unknown> = {};
    const map: Record<string, keyof typeof params> = { name: 'name', phone: 'phone',
      address: 'address', city: 'city', opening_hours: 'openingHours',
      tax_rate_percent: 'taxRatePercent', paydunya_mode: 'paydunyaMode',
      printer_settings_json: 'printerSettingsJson', logo_url: 'logoUrl' };
    for (const [column, key] of Object.entries(map)) if (params[key] !== null && params[key] !== undefined) patch[column] = params[key];
    if (params.paydunyaPublicKey) patch.paydunya_public_key = params.paydunyaPublicKey;
    if (params.paydunyaPrivateKey) patch.paydunya_private_key = params.paydunyaPrivateKey;
    if (params.paydunyaToken) patch.paydunya_token = params.paydunyaToken;
    if (Object.keys(patch).length) await this.db('restaurants').where({ id: rid }).update(patch);
  }

  async findTicketsForRestaurant(rid: string) {
    return this.db('support_tickets').where({ restaurant_id: rid })
      .select('id', 'subject', 'category', 'priority', 'status', { createdAt: 'created_at' })
      .orderBy('created_at', 'desc');
  }

  async createSupportTicket(params: { rid: string; email: string; fullName: string;
    role: string; subject: string; category: string; priority: string; message: string }) {
    const id = generateId('tkt'); const now = new Date().toISOString();
    await this.db.transaction(async trx => {
      await trx('support_tickets').insert({ id, restaurant_id: params.rid,
        created_by_email: params.email, subject: params.subject, category: params.category,
        priority: params.priority, status: 'OPEN', created_at: now });
      await trx('ticket_messages').insert({ id: generateId('tmsg'), ticket_id: id,
        author: params.fullName, role: params.role, body: params.message, created_at: now });
    });
    return id;
  }

  async findRestaurantTaxAndMode(rid: string) {
    return this.db('restaurants').select('tax_rate_percent', 'paydunya_mode').where({ id: rid }).first();
  }

  async findTableById(tableId: string, rid: string) {
    return this.db('dining_tables').select('id', 'label')
      .where({ id: tableId, restaurant_id: rid }).first();
  }

  async countOrders(rid: string) {
    const row = await this.db('orders').where({ restaurant_id: rid }).count({ count: '*' }).first();
    return Number(row?.count || 0);
  }

  async findMenuItemWithStation(menuItemId: string, rid: string) {
    return this.db('menu_items as m').join('menu_categories as c', 'c.id', 'm.category_id')
      .select('m.id', 'm.name', 'm.price_xof', 'm.available', 'm.options_json',
        { station: 'c.station' }, { category_active: 'c.active' })
      .where('m.id', menuItemId).andWhere('m.restaurant_id', rid).first();
  }

  async findPaymentByIdempotencyKey(rid: string, key: string) {
    return this.db('payments').select('id', 'reference', 'amount_xof')
      .where({ restaurant_id: rid, idempotency_key: key }).first();
  }

  async findOrderByIdempotencyKey(rid: string, key: string) {
    return this.db('orders').select('id', 'order_number', 'total_xof', 'status')
      .where({ restaurant_id: rid, idempotency_key: key }).first();
  }

  async createPosOrderTransaction(params: {
    orderId: string; rid: string; orderNumber: string; orderType: string;
    tableId: string | null; customerName: string; subtotalXof: number;
    discountXof: number; taxXof: number; totalXof: number; notes: string;
    idempotencyKey: string | null; userId: string; now: string;
    lines: Array<{ id: string; menuItemId: string; name: string; station: string;
      unitPriceXof: number; optionsSummary: string; optionsDeltaXof: number;
      quantity: number; lineTotalXof: number; notes: string }>;
  }) {
    return this.db.transaction(async trx => {
      await trx('orders').insert({
        id: params.orderId, restaurant_id: params.rid, order_number: params.orderNumber,
        order_type: params.orderType, table_id: params.tableId, customer_name: params.customerName,
        status: 'PENDING', subtotal_xof: params.subtotalXof, discount_xof: params.discountXof,
        tax_xof: params.taxXof, total_xof: params.totalXof, paid_xof: 0, notes: params.notes,
        idempotency_key: params.idempotencyKey, created_by_user_id: params.userId,
        created_at: params.now, updated_at: params.now,
      });
      if (params.lines.length) await trx('order_items').insert(params.lines.map(line => ({
        id: line.id, order_id: params.orderId, menu_item_id: line.menuItemId,
        name: line.name, station: line.station, unit_price_xof: line.unitPriceXof,
        options_summary: line.optionsSummary, options_delta_xof: line.optionsDeltaXof,
        quantity: line.quantity, line_total_xof: line.lineTotalXof,
        notes: line.notes, prep_status: 'PENDING',
      })));
      if (params.tableId) await trx('dining_tables')
        .where({ id: params.tableId, restaurant_id: params.rid }).update({ status: 'OCCUPIED' });

      const qtyByMenuItem = new Map<string, number>();
      for (const line of params.lines) qtyByMenuItem.set(
        line.menuItemId, (qtyByMenuItem.get(line.menuItemId) || 0) + line.quantity,
      );
      const deductions = new Map<string, number>();
      for (const [menuItemId, quantity] of qtyByMenuItem) {
        const recipes = await trx('menu_item_recipes').select('stock_id', 'quantity_per_unit')
          .where({ restaurant_id: params.rid, menu_item_id: menuItemId });
        for (const recipe of recipes) {
          const amount = Number(recipe.quantity_per_unit) * quantity;
          if (amount > 0) deductions.set(recipe.stock_id, (deductions.get(recipe.stock_id) || 0) + amount);
        }
      }
      const lowStocksTriggered: Array<{ id: string; name: string; quantity: number;
        minThreshold: number; unit: string; supplierName: string }> = [];
      for (const [stockId, rawDeduct] of deductions) {
        const stock = await trx('stocks').where({ id: stockId, restaurant_id: params.rid }).forUpdate().first();
        if (!stock) continue;
        const deduct = Math.round(rawDeduct * 1000) / 1000;
        const oldQty = Number(stock.quantity);
        const nextQty = Math.max(0, Math.round((oldQty - deduct) * 1000) / 1000);
        await trx('stocks').where({ id: stockId, restaurant_id: params.rid })
          .update({ quantity: nextQty, updated_at: params.now });
        await trx('stock_movements').insert({
          id: generateId('smv'), restaurant_id: params.rid, stock_id: stockId,
          movement_type: 'AUTO_ORDER', quantity_delta: -deduct,
          reason: `Déduction auto · ${params.orderNumber}`,
          created_by_user_id: params.userId, created_at: params.now,
        });
        if (nextQty <= Number(stock.min_threshold) && nextQty !== oldQty) lowStocksTriggered.push({
          id: stock.id, name: stock.name, quantity: nextQty,
          minThreshold: Number(stock.min_threshold), unit: stock.unit,
          supplierName: stock.supplier_name,
        });
      }
      return { deductedCount: deductions.size, lowStocksTriggered };
    });
  }

  async updateOrderItemPrepStatus(orderId: string, itemId: string, rid: string, status: string) {
    return this.db.transaction(async trx => {
      const item = await trx('order_items as oi')
        .join('orders as o', 'o.id', 'oi.order_id')
        .select('oi.id')
        .where({ 'oi.id': itemId, 'oi.order_id': orderId, 'o.restaurant_id': rid })
        .forUpdate()
        .first();
      if (!item) throw new AppError(404, 'Article de commande introuvable.');
      await trx('order_items').where({ id: itemId, order_id: orderId }).update({ prep_status: status });
      return { orderId, itemId, prepStatus: status };
    });
  }

  async updateOrderStatusTransaction(orderId: string, rid: string, status: string) {
    return this.db.transaction(async trx => {
      const order = await trx('orders').select('id', 'table_id')
        .where({ id: orderId, restaurant_id: rid }).forUpdate().first();
      if (!order) throw new AppError(404, 'Commande introuvable.');
      await trx('orders').where({ id: orderId, restaurant_id: rid })
        .update({ status, updated_at: new Date().toISOString() });
      if (status === 'IN_PREPARATION') await trx('order_items').where({ order_id: orderId, prep_status: 'PENDING' }).update({ prep_status: 'PREPARING' });
      else if (status === 'READY' || status === 'SERVED') await trx('order_items').where({ order_id: orderId }).update({ prep_status: status });
      else if (status === 'CANCELLED' && order.table_id) await trx('dining_tables')
        .where({ id: order.table_id, restaurant_id: rid }).update({ status: 'AVAILABLE' });
      return order;
    });
  }

  async recordPaymentTransaction(params: {
    rid: string; orderId: string; paymentId: string; amountXof: number;
    method: string; mode: string; reference: string; idempotencyKey: string | null;
    userId: string; actorEmail: string; actorRole: string; now: string;
  }) {
    return this.db.transaction(async trx => {
      if (params.idempotencyKey) {
        const duplicate = await trx('payments').select('id', 'reference', 'amount_xof')
          .where({ restaurant_id: params.rid, idempotency_key: params.idempotencyKey }).first();
        if (duplicate) return { deduplicated: true, payment: duplicate };
      }
      const order = await trx('orders').select('id', 'table_id', 'total_xof', 'paid_xof', 'status')
        .where({ id: params.orderId, restaurant_id: params.rid }).forUpdate().first();
      if (!order) throw new AppError(404, 'Commande introuvable.');
      if (order.status === 'CANCELLED') throw new AppError(400, 'Impossible d’encaisser une commande annulée.');
      // Derive the settled amount from the payment ledger, not only the denormalized
      // orders.paid_xof counter. This repairs stale counters while preserving the
      // row lock that serializes concurrent installments for the same order.
      const paidRow = await trx('payments')
        .where({ restaurant_id: params.rid, order_id: params.orderId, status: 'PAID' })
        .sum({ paidTotal: 'amount_xof' })
        .first();
      const paidBefore = Number(paidRow?.paidTotal || 0);
      const remaining = Math.max(0, Number(order.total_xof) - paidBefore);
      if (remaining <= 0) throw new AppError(409, 'Cette commande est déjà intégralement payée.');
      if (params.amountXof > remaining) throw new AppError(400, 'Le montant dépasse le solde restant dû.');
      const newPaid = paidBefore + params.amountXof;
      const fullyPaid = newPaid >= Number(order.total_xof);
      await trx('payments').insert({
        id: params.paymentId, restaurant_id: params.rid, order_id: params.orderId,
        amount_xof: params.amountXof, method: params.method, status: 'PAID',
        mode: params.mode, reference: params.reference, idempotency_key: params.idempotencyKey,
        created_by_user_id: params.userId, created_at: params.now,
      });
      await trx('orders').where({ id: params.orderId, restaurant_id: params.rid }).update({
        paid_xof: newPaid, status: fullyPaid ? 'PAID' : order.status, updated_at: params.now,
      });
      if (fullyPaid && order.table_id) await trx('dining_tables')
        .where({ id: order.table_id, restaurant_id: params.rid }).update({ status: 'AVAILABLE' });
      await this.recordAudit({
        actorUserId: params.userId, actorEmail: params.actorEmail, actorRole: params.actorRole,
        restaurantId: params.rid, action: 'PAYMENT_RECORDED',
        targetType: 'ORDER', targetId: params.orderId,
        details: `${params.amountXof} FCFA via ${params.method} (${params.mode})`,
      }, trx);
      return { deduplicated: false, payment: {
        id: params.paymentId, orderId: params.orderId, amountXof: params.amountXof,
        method: params.method, mode: params.mode, reference: params.reference, fullyPaid,
        orderStatus: fullyPaid ? 'PAID' : order.status,
      }};
    });
  }

  async refundPaymentTransaction(params: { paymentId: string; rid: string; userId: string; actorEmail: string; actorRole: string }) {
    return this.db.transaction(async trx => {
      const payment = await trx('payments').select('id', 'order_id', 'amount_xof', 'status')
        .where({ id: params.paymentId, restaurant_id: params.rid }).forUpdate().first();
      if (!payment) throw new AppError(404, 'Paiement introuvable.');
      if (payment.status === 'REFUNDED') throw new AppError(409, 'Ce paiement a déjà été remboursé.');
      await trx('payments').where({ id: params.paymentId, restaurant_id: params.rid }).update({ status: 'REFUNDED' });
      const order = await trx('orders').select('paid_xof').where({ id: payment.order_id, restaurant_id: params.rid }).forUpdate().first();
      if (order) await trx('orders').where({ id: payment.order_id, restaurant_id: params.rid }).update({
        paid_xof: Math.max(0, Number(order.paid_xof) - Number(payment.amount_xof)),
        status: 'SERVED', updated_at: new Date().toISOString(),
      });
      await this.recordAudit({
        actorUserId: params.userId, actorEmail: params.actorEmail, actorRole: params.actorRole,
        restaurantId: params.rid, action: 'PAYMENT_REFUNDED', targetType: 'PAYMENT',
        targetId: params.paymentId, details: `Remboursement de ${payment.amount_xof} FCFA`,
      }, trx);
      return payment;
    });
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
}

export const postgresRestaurantRepository = new PostgresRestaurantRepository();
