import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';
import { AppError } from '../services/errors.ts';
import type { AuditRecord } from './postgresAuthRepository.ts';

export class PostgresRestaurantRepository {
  constructor(private readonly db: Knex = getKnex()) {}

  async getDashboardMetrics(rid: string) {
    const [revenueRow, pendingRow, tablesStats, revenueSeries, topItems, lowStocks,
      paymentBreakdown, recentOrders, staffActivity, expensesRow, collectedRow] = await Promise.all([
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
    ]);
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
    description: string; priceXof: number; costPriceXof: number; optionsJson: string }) {
    const id = generateId('itm');
    await this.db('menu_items').insert({ id, restaurant_id: params.rid,
      category_id: params.categoryId, name: params.name, description: params.description,
      price_xof: params.priceXof, cost_price_xof: params.costPriceXof,
      image_url: null, available: 1, sort_order: 99, options_json: params.optionsJson,
      created_at: new Date().toISOString() });
    return id;
  }

  findMenuItemById(itemId: string, rid: string) {
    return this.db('menu_items').select('id').where({ id: itemId, restaurant_id: rid }).first();
  }

  async updateMenuItem(itemId: string, rid: string, updates: {
    available?: boolean; priceXof?: number; name?: string; description?: string;
  }) {
    const patch: Record<string, unknown> = {};
    if (typeof updates.available === 'boolean') patch.available = updates.available ? 1 : 0;
    if (updates.priceXof !== undefined) patch.price_xof = updates.priceXof;
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
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
      const remaining = Number(order.total_xof) - Number(order.paid_xof);
      if (remaining <= 0) throw new AppError(409, 'Cette commande est déjà intégralement payée.');
      if (params.amountXof > remaining) throw new AppError(400, 'Le montant dépasse le solde restant dû.');
      const newPaid = Number(order.paid_xof) + params.amountXof;
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
