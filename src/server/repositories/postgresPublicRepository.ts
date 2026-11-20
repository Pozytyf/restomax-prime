import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';

export class PostgresPublicRepository {
  constructor(private readonly db: Knex = getKnex()) {}

  findActivePlans() {
    return this.db('plans').select(
      'id', 'code', 'name', 'tagline', 'price_monthly_xof', 'price_yearly_xof',
      'trial_days', 'max_tables', 'max_staff', 'max_menu_items',
      'is_demo_pricing', 'is_featured', 'features_json', 'active',
    ).where({ active: 1 }).orderBy('price_monthly_xof', 'asc');
  }

  findAllPlatformSettings() {
    return this.db('platform_settings').select('key', 'value');
  }

  async createLead(params: {
    leadType: 'CONTACT' | 'DEMO_REQUEST'; fullName: string; email: string;
    phone: string; restaurantName: string; city: string; message: string;
  }) {
    const id = generateId(params.leadType === 'CONTACT' ? 'lead' : 'demo');
    await this.db('contact_leads').insert({
      id, lead_type: params.leadType, full_name: params.fullName,
      email: params.email, phone: params.phone, restaurant_name: params.restaurantName,
      city: params.city, message: params.message, created_at: new Date().toISOString(),
    });
    return id;
  }

  findQrContextByToken(token: string) {
    return this.db('qr_codes as q')
      .join('dining_tables as t', 't.id', 'q.table_id')
      .join('restaurants as r', 'r.id', 'q.restaurant_id')
      .select(
        { qr_id: 'q.id' }, 'q.token', 'q.version',
        { qr_status: 'q.status' }, { table_id: 't.id' },
        { table_label: 't.label' }, { table_zone: 't.zone' },
        { restaurant_id: 'r.id' }, { restaurant_name: 'r.name' },
        'r.city', 'r.currency', 'r.tax_rate_percent', 'r.opening_hours',
        { restaurant_status: 'r.status' }, 'r.deleted_at',
      ).where('q.token', token).first();
  }

  async createQrTableSession(params: {
    restaurantId: string; tableId: string; qrToken: string; expiresAt: string;
  }) {
    const sessionId = generateId('qrs');
    await this.db('qr_table_sessions').insert({
      id: sessionId, restaurant_id: params.restaurantId, table_id: params.tableId,
      qr_token: params.qrToken, expires_at: params.expiresAt,
      created_at: new Date().toISOString(),
    });
    return sessionId;
  }

  findQrTableSession(sessionId: string) {
    return this.db('qr_table_sessions')
      .select('id', 'restaurant_id', 'table_id', 'expires_at')
      .where({ id: sessionId }).first();
  }

  findActiveCategories(restaurantId: string) {
    return this.db('menu_categories')
      .select('id', 'name', 'station', 'sort_order')
      .where({ restaurant_id: restaurantId, active: 1 })
      .orderBy('sort_order', 'asc');
  }

  findAvailableMenuItems(restaurantId: string) {
    return this.db('menu_items as m')
      .join('menu_categories as c', 'c.id', 'm.category_id')
      .select(
        'm.id', 'm.category_id', 'm.name', 'm.description', 'm.price_xof',
        'm.image_url', 'm.options_json', { station: 'c.station' },
      )
      .where('m.restaurant_id', restaurantId)
      .andWhere('m.available', 1).andWhere('c.active', 1)
      .orderBy('c.sort_order', 'asc').orderBy('m.sort_order', 'asc').orderBy('m.name', 'asc');
  }

  findOrderByIdempotencyKey(restaurantId: string, idempotencyKey: string) {
    return this.db('orders').select('id', 'order_number', 'total_xof', 'status')
      .where({ restaurant_id: restaurantId, idempotency_key: idempotencyKey }).first();
  }

  async countOrdersForRestaurant(restaurantId: string) {
    const row = await this.db('orders').where({ restaurant_id: restaurantId }).count({ count: '*' }).first();
    return Number(row?.count || 0);
  }

  findMenuItemWithStation(menuItemId: string, restaurantId: string) {
    return this.db('menu_items as m')
      .join('menu_categories as c', 'c.id', 'm.category_id')
      .select(
        'm.id', 'm.name', 'm.price_xof', 'm.available', 'm.options_json',
        { station: 'c.station' }, { category_active: 'c.active' },
      )
      .where('m.id', menuItemId).andWhere('m.restaurant_id', restaurantId).first();
  }

  async insertQrOrderTransaction(params: {
    orderId: string; restaurantId: string; orderNumber: string; tableId: string;
    customerName: string; subtotalHtXof: number; taxXof: number; totalXof: number;
    notes: string; idempotencyKey: string | null; now: string;
    lines: Array<{ id: string; menuItemId: string; name: string; station: string;
      unitPriceXof: number; optionsSummary: string; optionsDeltaXof: number;
      quantity: number; lineTotalXof: number; notes: string }>;
  }) {
    return this.db.transaction(async trx => {
      await trx('orders').insert({
        id: params.orderId, restaurant_id: params.restaurantId,
        order_number: params.orderNumber, order_type: 'QR_TABLE', table_id: params.tableId,
        customer_name: params.customerName, status: 'PENDING',
        subtotal_xof: params.subtotalHtXof, discount_xof: 0, tax_xof: params.taxXof,
        total_xof: params.totalXof, paid_xof: 0, notes: params.notes,
        idempotency_key: params.idempotencyKey, created_by_user_id: null,
        created_at: params.now, updated_at: params.now,
      });
      if (params.lines.length) {
        await trx('order_items').insert(params.lines.map(line => ({
          id: line.id, order_id: params.orderId, menu_item_id: line.menuItemId,
          name: line.name, station: line.station, unit_price_xof: line.unitPriceXof,
          options_summary: line.optionsSummary, options_delta_xof: line.optionsDeltaXof,
          quantity: line.quantity, line_total_xof: line.lineTotalXof,
          notes: line.notes, prep_status: 'PENDING',
        })));
      }
      await trx('dining_tables').where({ id: params.tableId, restaurant_id: params.restaurantId })
        .update({ status: 'OCCUPIED' });

      // Apply recipe-based stock deductions in the same transaction as order creation.
      const qtyByMenuItem = new Map<string, number>();
      for (const line of params.lines) qtyByMenuItem.set(
        line.menuItemId, (qtyByMenuItem.get(line.menuItemId) || 0) + line.quantity,
      );
      const deductions = new Map<string, number>();
      for (const [menuItemId, orderedQty] of qtyByMenuItem) {
        const recipes = await trx('menu_item_recipes')
          .select('stock_id', 'quantity_per_unit')
          .where({ restaurant_id: params.restaurantId, menu_item_id: menuItemId });
        for (const recipe of recipes) {
          const amount = Number(recipe.quantity_per_unit) * orderedQty;
          if (amount > 0) deductions.set(recipe.stock_id, (deductions.get(recipe.stock_id) || 0) + amount);
        }
      }
      const lowStocksTriggered: Array<{ id: string; name: string; quantity: number;
        minThreshold: number; unit: string; supplierName: string }> = [];
      for (const [stockId, rawDeduct] of deductions) {
        const stock = await trx('stocks').where({ id: stockId, restaurant_id: params.restaurantId })
          .forUpdate().first();
        if (!stock) continue;
        const deduct = Math.round(rawDeduct * 1000) / 1000;
        const oldQty = Number(stock.quantity);
        const nextQty = Math.max(0, Math.round((oldQty - deduct) * 1000) / 1000);
        await trx('stocks').where({ id: stockId, restaurant_id: params.restaurantId })
          .update({ quantity: nextQty, updated_at: params.now });
        await trx('stock_movements').insert({
          id: generateId('smv'), restaurant_id: params.restaurantId, stock_id: stockId,
          movement_type: 'AUTO_ORDER', quantity_delta: -deduct,
          reason: `Déduction auto · ${params.orderNumber}`,
          created_by_user_id: null, created_at: params.now,
        });
        if (nextQty <= Number(stock.min_threshold) && nextQty !== oldQty) {
          lowStocksTriggered.push({ id: stock.id, name: stock.name, quantity: nextQty,
            minThreshold: Number(stock.min_threshold), unit: stock.unit,
            supplierName: stock.supplier_name });
        }
      }
      return { deductedCount: deductions.size, lowStocksTriggered };
    });
  }

  async findTrackedQrOrder(token: string, orderId: string) {
    const order = await this.db('orders as o')
      .join('qr_codes as q', function() {
        this.on('q.table_id', '=', 'o.table_id').andOn('q.restaurant_id', '=', 'o.restaurant_id');
      })
      .join('dining_tables as t', 't.id', 'o.table_id')
      .join('restaurants as r', 'r.id', 'o.restaurant_id')
      .select(
        'o.id', 'o.order_number', 'o.status', 'o.total_xof', 'o.paid_xof',
        'o.notes', 'o.customer_name', 'o.created_at', 'o.updated_at',
        { table_label: 't.label' }, { restaurant_name: 'r.name' },
      ).where('q.token', token).andWhere('o.id', orderId).first();
    if (!order) return null;
    const items = await this.db('order_items')
      .select('id', 'name', 'station', 'quantity', 'options_summary', 'line_total_xof', 'notes', 'prep_status')
      .where({ order_id: orderId });
    return { order, items };
  }
}

export const postgresPublicRepository = new PostgresPublicRepository();
