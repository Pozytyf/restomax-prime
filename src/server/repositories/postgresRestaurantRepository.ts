import type { Knex } from 'knex';
import { getKnex } from '../knex.ts';
import { generateId } from '../db.ts';
import { AppError } from '../services/errors.ts';
import type { AuditRecord } from './postgresAuthRepository.ts';

export class PostgresRestaurantRepository {
  constructor(private readonly db: Knex = getKnex()) {}

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
    userId: string; now: string;
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
        actorUserId: params.userId, actorEmail: '', actorRole: 'SYSTEM',
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
