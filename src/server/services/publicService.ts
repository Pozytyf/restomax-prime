import QRCode from 'qrcode';
import { getDb, generateId } from '../db.ts';
import {
  PublicRepository,
  publicRepository,
} from '../repositories/publicRepository.ts';
import { restaurantRepository } from '../repositories/restaurantRepository.ts';
import { restaurantService } from './restaurantService.ts';
import { broadcastRestaurantEvent } from '../ws.ts';
import { BaseService } from './BaseService.ts';
import { AppError } from './errors.ts';
import { postgresPublicRepository } from '../repositories/postgresPublicRepository.ts';

const isPostgresMode = () => ['pg', 'postgres', 'postgresql'].includes((process.env.DATABASE_CLIENT || 'sqlite').toLowerCase()) && process.env.RESTOMAX_POSTGRES_CUTOVER === 'true' && Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);

export class PublicService extends BaseService<PublicRepository> {
  constructor(repo = publicRepository) {
    super(repo);
  }

  async getActivePlans() {
    if (isPostgresMode()) {
      const rows = await postgresPublicRepository.findActivePlans();
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, tagline: r.tagline,
        priceMonthlyXof: Number(r.price_monthly_xof), priceYearlyXof: Number(r.price_yearly_xof),
        trialDays: Number(r.trial_days), maxTables: Number(r.max_tables), maxStaff: Number(r.max_staff),
        maxMenuItems: Number(r.max_menu_items), isDemoPricing: Boolean(r.is_demo_pricing),
        isFeatured: Boolean(r.is_featured), features: JSON.parse(String(r.features_json || '[]')),
        active: Boolean(r.active) }));
    }
    const rows = publicRepository.findActivePlans();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      tagline: r.tagline,
      priceMonthlyXof: Number(r.price_monthly_xof),
      priceYearlyXof: Number(r.price_yearly_xof),
      trialDays: Number(r.trial_days),
      maxTables: Number(r.max_tables),
      maxStaff: Number(r.max_staff),
      maxMenuItems: Number(r.max_menu_items),
      isDemoPricing: Boolean(r.is_demo_pricing),
      isFeatured: Boolean(r.is_featured),
      features: JSON.parse(String(r.features_json || '[]')),
      active: Boolean(r.active),
    }));
  }

  async getPlatformSettings(): Promise<Record<string, string>> {
    if (isPostgresMode()) {
      const rows = await postgresPublicRepository.findAllPlatformSettings();
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    }
    const rows = publicRepository.findAllPlatformSettings();
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }

  async submitContactLead(body: Record<string, unknown>) {
    if (isPostgresMode()) return this.submitLeadPostgres(body, 'CONTACT');
    const { fullName, email, phone, restaurantName, city, message, website } =
      body || {};
    if (website) {
      return { ok: true, honeypot: true };
    }
    if (
      typeof fullName !== 'string' ||
      fullName.trim().length < 2 ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof message !== 'string' ||
      message.trim().length < 5
    ) {
      throw new AppError(
        400,
        'Veuillez renseigner votre nom, un email valide et un message.',
      );
    }

    const id = publicRepository.createLead({
      leadType: 'CONTACT',
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: String(phone || '').trim(),
      restaurantName: String(restaurantName || '').trim(),
      city: String(city || '').trim(),
      message: message.trim(),
    });

    return {
      ok: true,
      id,
      message:
        'Votre message a bien été enregistré. Notre équipe vous répondra rapidement.',
    };
  }

  async submitDemoRequest(body: Record<string, unknown>) {
    if (isPostgresMode()) return this.submitLeadPostgres(body, 'DEMO_REQUEST');
    const { fullName, email, phone, restaurantName, city, message, website } =
      body || {};
    if (website) {
      return { ok: true, honeypot: true };
    }
    if (
      typeof fullName !== 'string' ||
      fullName.trim().length < 2 ||
      typeof email !== 'string' ||
      !email.includes('@') ||
      typeof restaurantName !== 'string' ||
      restaurantName.trim().length < 2
    ) {
      throw new AppError(
        400,
        'Veuillez renseigner votre nom, email et le nom du restaurant.',
      );
    }

    const id = publicRepository.createLead({
      leadType: 'DEMO_REQUEST',
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: String(phone || '').trim(),
      restaurantName: restaurantName.trim(),
      city: String(city || 'Abidjan').trim(),
      message: String(message || 'Demande de démonstration guidée').trim(),
    });

    return {
      ok: true,
      id,
      message: 'Demande de démonstration enregistrée avec succès.',
    };
  }

  async generateQrSvg(token: string, baseUrl: string): Promise<string> {
    const qrRow = isPostgresMode()
      ? await postgresPublicRepository.findQrContextByToken(token)
      : publicRepository.findQrContextByToken(token);
    if (!qrRow) {
      throw new AppError(404, 'QR code introuvable ou invalide.');
    }
    if (qrRow.qr_status !== 'ACTIVE') {
      throw new AppError(410, 'Ce QR code a été révoqué.');
    }

    try {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const targetUrl = `${cleanBase}/q/${encodeURIComponent(token)}`;
      return await QRCode.toString(targetUrl, {
        type: 'svg',
        margin: 2,
        color: { dark: '#182333', light: '#FFFFFF' },
      });
    } catch {
      throw new AppError(500, 'Impossible de générer le QR code.');
    }
  }

  async getQrMenuContext(token: string) {
    if (isPostgresMode()) return this.getQrMenuContextPostgres(token);
    const qrRow = publicRepository.findQrContextByToken(token);
    if (!qrRow) {
      throw new AppError(404, 'QR code introuvable ou invalide.');
    }
    if (qrRow.qr_status !== 'ACTIVE') {
      throw new AppError(
        410,
        'Ce QR code a été révoqué. Veuillez demander le nouveau QR code de votre table.',
      );
    }
    if (
      qrRow.deleted_at ||
      qrRow.restaurant_status === 'SUSPENDED' ||
      qrRow.restaurant_status === 'DELETED'
    ) {
      throw new AppError(
        403,
        'Cet établissement n’accepte pas de commandes en ligne actuellement.',
      );
    }

    const restaurantId = String(qrRow.restaurant_id);
    const tableId = String(qrRow.table_id);
    const expiresAt = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    const sessionId = publicRepository.createQrTableSession({
      restaurantId,
      tableId,
      qrToken: token,
      expiresAt,
    });

    const categories = publicRepository.findActiveCategories(restaurantId);
    const itemsRaw = publicRepository.findAvailableMenuItems(restaurantId);
    const items = itemsRaw.map((it) => ({
      id: it.id,
      categoryId: it.category_id,
      name: it.name,
      description: it.description,
      priceXof: Number(it.price_xof),
      imageUrl: it.image_url,
      station: it.station || 'KITCHEN',
      options: JSON.parse(String(it.options_json || '[]')),
    }));

    return {
      sessionId,
      restaurant: {
        id: restaurantId,
        name: qrRow.restaurant_name,
        city: qrRow.city,
        currency: qrRow.currency,
        taxRatePercent: Number(qrRow.tax_rate_percent),
        openingHours: qrRow.opening_hours,
      },
      table: {
        id: tableId,
        label: qrRow.table_label,
        zone: qrRow.table_zone,
      },
      categories,
      items,
    };
  }

  async submitQrOrder(token: string, body: Record<string, unknown>) {
    if (isPostgresMode()) return this.submitQrOrderPostgres(token, body);
    const { sessionId, customerName, notes, items, idempotencyKey } = body || {};

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'Votre panier est vide.');
    }

    const qrRow = publicRepository.findQrContextByToken(token);
    if (!qrRow || qrRow.qr_status !== 'ACTIVE') {
      throw new AppError(410, 'QR code révoqué ou invalide.');
    }
    if (
      qrRow.deleted_at ||
      qrRow.restaurant_status === 'SUSPENDED' ||
      qrRow.restaurant_status === 'DELETED'
    ) {
      throw new AppError(403, 'Restaurant indisponible.');
    }

    const restaurantId = String(qrRow.restaurant_id);
    const tableId = String(qrRow.table_id);

    if (sessionId) {
      const sess = publicRepository.findQrTableSession(String(sessionId));
      if (
        !sess ||
        sess.restaurant_id !== restaurantId ||
        sess.table_id !== tableId ||
        new Date(String(sess.expires_at)).getTime() < Date.now()
      ) {
        throw new AppError(
          403,
          'Session de table invalide ou expirée. Veuillez rescanner le QR code.',
        );
      }
    }

    if (idempotencyKey) {
      const existing = publicRepository.findOrderByIdempotencyKey(
        restaurantId,
        String(idempotencyKey),
      );
      if (existing) {
        return {
          deduplicated: true,
          order: {
            id: existing.id,
            orderNumber: existing.order_number,
            totalXof: Number(existing.total_xof),
            status: existing.status,
          },
        };
      }
    }

    const db = getDb();
    const now = new Date().toISOString();
    const orderId = generateId('ord');
    const orderCount = publicRepository.countOrdersForRestaurant(restaurantId);
    const orderNumber = `CMD-${1001 + orderCount}`;

    let deductionResult: {
      deductedCount: number;
      lowStocksTriggered: Array<{
        id: string;
        name: string;
        quantity: number;
        minThreshold: number;
        unit: string;
        supplierName: string;
      }>;
    } = { deductedCount: 0, lowStocksTriggered: [] };
    let createdTotalXof = 0;
    let createdLines: Array<{
      id: string;
      menuItemId: string;
      name: string;
      station: string;
      unitPriceXof: number;
      optionsSummary: string;
      optionsDeltaXof: number;
      quantity: number;
      lineTotalXof: number;
      notes: string;
    }> = [];

    try {
      db.exec('BEGIN IMMEDIATE');

      let subtotalXof = 0;
      const preparedLines: typeof createdLines = [];

      for (const rawLine of items) {
        const line = rawLine as {
          menuItemId?: unknown;
          quantity?: unknown;
          optionIds?: unknown;
          notes?: unknown;
        };
        const parsedQty = Number(line.quantity ?? 1);
        if (!Number.isFinite(parsedQty) || parsedQty < 1) {
          throw new AppError(400, 'Quantité d’article invalide.');
        }
        const qty = Math.max(1, Math.min(50, Math.floor(parsedQty)));
        const menuItem = publicRepository.findMenuItemWithStation(
          String(line.menuItemId),
          restaurantId,
        );

        if (!menuItem || !menuItem.available || !menuItem.category_active) {
          throw new AppError(
            400,
            'Un ou plusieurs articles sélectionnés ne sont plus disponibles.',
          );
        }

        const dbOptions = JSON.parse(
          String(menuItem.options_json || '[]'),
        ) as Array<{ id: string; label: string; priceDeltaXof: number }>;

        const selectedOptionIds: string[] = Array.isArray(line.optionIds)
          ? line.optionIds.map(String)
          : [];
        const matchedOptions = dbOptions.filter((o) =>
          selectedOptionIds.includes(o.id),
        );
        const optionsDeltaXof = matchedOptions.reduce(
          (acc, o) => acc + Number(o.priceDeltaXof || 0),
          0,
        );
        const optionsSummary = matchedOptions.map((o) => o.label).join(', ');
        const unitPriceXof = Number(menuItem.price_xof);
        const lineTotalXof = (unitPriceXof + optionsDeltaXof) * qty;
        subtotalXof += lineTotalXof;

        preparedLines.push({
          id: generateId('oi'),
          menuItemId: String(menuItem.id),
          name: String(menuItem.name),
          station: String(menuItem.station || 'KITCHEN'),
          unitPriceXof,
          optionsSummary,
          optionsDeltaXof,
          quantity: qty,
          lineTotalXof,
          notes: String(line.notes || '').slice(0, 200),
        });
      }

      const totalXof = subtotalXof;
      const taxRate = Number(qrRow.tax_rate_percent || 18);
      const ht = Math.round(totalXof / (1 + taxRate / 100));
      const taxXof = totalXof - ht;

      publicRepository.insertQrOrderTransaction({
        orderId,
        restaurantId,
        orderNumber,
        tableId,
        customerName: String(
          customerName || `${qrRow.table_label} (Client QR)`,
        ).slice(0, 80),
        subtotalHtXof: ht,
        taxXof,
        totalXof,
        notes: String(notes || '').slice(0, 300),
        idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
        now,
        lines: preparedLines,
      });

      deductionResult = restaurantRepository.deductStocksForOrderItems({
        rid: restaurantId,
        orderNumber,
        items: preparedLines.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
        })),
        userId: null,
        now,
      });

      db.exec('COMMIT');
      createdTotalXof = totalXof;
      createdLines = preparedLines;
    } catch (err) {
      db.exec('ROLLBACK');
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(500, 'Erreur lors de l’envoi de la commande.');
    }

    if (deductionResult.deductedCount > 0) {
      broadcastRestaurantEvent(restaurantId, 'stock:updated', {
        orderId,
        orderNumber,
        deductedCount: deductionResult.deductedCount,
      });
      for (const low of deductionResult.lowStocksTriggered) {
        await restaurantService.dispatchCriticalStockAlert({
          restaurantId,
          stockId: low.id,
          stockName: low.name,
          quantity: low.quantity,
          minThreshold: low.minThreshold,
          unit: low.unit,
          supplierName: low.supplierName,
        });
      }
    }

    broadcastRestaurantEvent(restaurantId, 'order:created', {
      orderId,
      orderNumber,
      orderType: 'QR_TABLE',
      tableId,
      totalXof: createdTotalXof,
    });
    broadcastRestaurantEvent(restaurantId, 'table:updated', {
      tableId,
      status: 'OCCUPIED',
    });

    return {
      deduplicated: false,
      order: {
        id: orderId,
        orderNumber,
        tableLabel: qrRow.table_label,
        totalXof: createdTotalXof,
        status: 'PENDING',
        createdAt: now,
        items: createdLines,
      },
    };
  }

  async trackQrOrder(token: string, orderId: string) {
    if (isPostgresMode()) {
      const result = await postgresPublicRepository.findTrackedQrOrder(token, orderId);
      if (!result) throw new AppError(404, 'Commande introuvable pour cette table.');
      const { order, items } = result;
      return { id: order.id, orderNumber: order.order_number, status: order.status,
        totalXof: Number(order.total_xof), paidXof: Number(order.paid_xof),
        customerName: String(order.customer_name || ''), notes: String(order.notes || ''),
        tableLabel: order.table_label, restaurantName: order.restaurant_name,
        createdAt: order.created_at, updatedAt: order.updated_at, items };
    }
    const result = publicRepository.findTrackedQrOrder(token, orderId);
    if (!result) {
      throw new AppError(404, 'Commande introuvable pour cette table.');
    }
    const { order, items } = result;
    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      totalXof: Number(order.total_xof),
      paidXof: Number(order.paid_xof),
      customerName: String(order.customer_name || ''),
      notes: String(order.notes || ''),
      tableLabel: order.table_label,
      restaurantName: order.restaurant_name,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items,
    };
  }
  private async submitLeadPostgres(body: Record<string, unknown>, leadType: 'CONTACT' | 'DEMO_REQUEST') {
    const { fullName, email, phone, restaurantName, city, message, website } = body || {};
    if (website) return { ok: true, honeypot: true };
    if (typeof fullName !== 'string' || fullName.trim().length < 2 ||
        typeof email !== 'string' || !email.includes('@') ||
        (leadType === 'CONTACT' && (typeof message !== 'string' || message.trim().length < 5)) ||
        (leadType === 'DEMO_REQUEST' && (typeof restaurantName !== 'string' || restaurantName.trim().length < 2))) {
      throw new AppError(400, leadType === 'CONTACT'
        ? 'Veuillez renseigner votre nom, un email valide et un message.'
        : 'Veuillez renseigner votre nom, email et le nom du restaurant.');
    }
    const id = await postgresPublicRepository.createLead({
      leadType, fullName: fullName.trim(), email: email.trim().toLowerCase(),
      phone: String(phone || '').trim(), restaurantName: String(restaurantName || '').trim(),
      city: String(city || (leadType === 'DEMO_REQUEST' ? 'Abidjan' : '')).trim(),
      message: String(message || 'Demande de démonstration guidée').trim(),
    });
    return { ok: true, id, message: leadType === 'CONTACT'
      ? 'Votre message a bien été enregistré. Notre équipe vous répondra rapidement.'
      : 'Demande de démonstration enregistrée avec succès.' };
  }

  private async getQrMenuContextPostgres(token: string) {
    const qrRow = await postgresPublicRepository.findQrContextByToken(token);
    if (!qrRow) throw new AppError(404, 'QR code introuvable ou invalide.');
    if (qrRow.qr_status !== 'ACTIVE') throw new AppError(410, 'Ce QR code a été révoqué. Veuillez demander le nouveau QR code de votre table.');
    if (qrRow.deleted_at || ['SUSPENDED', 'DELETED'].includes(qrRow.restaurant_status)) {
      throw new AppError(403, 'Cet établissement n’accepte pas de commandes en ligne actuellement.');
    }
    const restaurantId = String(qrRow.restaurant_id);
    const tableId = String(qrRow.table_id);
    const sessionId = await postgresPublicRepository.createQrTableSession({
      restaurantId, tableId, qrToken: token,
      expiresAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    });
    const [categories, itemsRaw] = await Promise.all([
      postgresPublicRepository.findActiveCategories(restaurantId),
      postgresPublicRepository.findAvailableMenuItems(restaurantId),
    ]);
    const items = itemsRaw.map(it => ({ id: it.id, categoryId: it.category_id,
      name: it.name, description: it.description, priceXof: Number(it.price_xof),
      imageUrl: it.image_url, station: it.station || 'KITCHEN',
      options: JSON.parse(String(it.options_json || '[]')) }));
    return { sessionId,
      restaurant: { id: restaurantId, name: qrRow.restaurant_name, city: qrRow.city,
        currency: qrRow.currency, taxRatePercent: Number(qrRow.tax_rate_percent),
        openingHours: qrRow.opening_hours },
      table: { id: tableId, label: qrRow.table_label, zone: qrRow.table_zone },
      categories, items };
  }

  private async submitQrOrderPostgres(token: string, body: Record<string, unknown>) {
    const { sessionId, customerName, notes, items, idempotencyKey } = body || {};
    if (!Array.isArray(items) || items.length === 0) throw new AppError(400, 'Votre panier est vide.');
    const qrRow = await postgresPublicRepository.findQrContextByToken(token);
    if (!qrRow || qrRow.qr_status !== 'ACTIVE') throw new AppError(410, 'QR code révoqué ou invalide.');
    if (qrRow.deleted_at || ['SUSPENDED', 'DELETED'].includes(qrRow.restaurant_status)) throw new AppError(403, 'Restaurant indisponible.');
    const restaurantId = String(qrRow.restaurant_id);
    const tableId = String(qrRow.table_id);
    if (sessionId) {
      const sess = await postgresPublicRepository.findQrTableSession(String(sessionId));
      if (!sess || sess.restaurant_id !== restaurantId || sess.table_id !== tableId ||
          new Date(String(sess.expires_at)).getTime() < Date.now()) {
        throw new AppError(403, 'Session de table invalide ou expirée. Veuillez rescanner le QR code.');
      }
    }
    if (idempotencyKey) {
      const existing = await postgresPublicRepository.findOrderByIdempotencyKey(restaurantId, String(idempotencyKey));
      if (existing) return { deduplicated: true, order: { id: existing.id,
        orderNumber: existing.order_number, totalXof: Number(existing.total_xof), status: existing.status } };
    }
    const now = new Date().toISOString();
    const orderId = generateId('ord');
    const orderCount = await postgresPublicRepository.countOrdersForRestaurant(restaurantId);
    const orderNumber = `CMD-${1001 + orderCount}`;
    let subtotalXof = 0;
    const preparedLines: Array<{ id: string; menuItemId: string; name: string; station: string;
      unitPriceXof: number; optionsSummary: string; optionsDeltaXof: number;
      quantity: number; lineTotalXof: number; notes: string }> = [];
    for (const rawLine of items) {
      const line = rawLine as { menuItemId?: unknown; quantity?: unknown; optionIds?: unknown; notes?: unknown };
      const parsedQty = Number(line.quantity ?? 1);
      if (!Number.isFinite(parsedQty) || parsedQty < 1) throw new AppError(400, 'Quantité d’article invalide.');
      const quantity = Math.max(1, Math.min(50, Math.floor(parsedQty)));
      const item = await postgresPublicRepository.findMenuItemWithStation(String(line.menuItemId), restaurantId);
      if (!item || !item.available || !item.category_active) throw new AppError(400, 'Un ou plusieurs articles sélectionnés ne sont plus disponibles.');
      const options = JSON.parse(String(item.options_json || '[]')) as Array<{ id: string; label: string; priceDeltaXof: number }>;
      const selectedIds = Array.isArray(line.optionIds) ? line.optionIds.map(String) : [];
      const selected = options.filter(o => selectedIds.includes(o.id));
      const optionsDeltaXof = selected.reduce((sum, option) => sum + Number(option.priceDeltaXof || 0), 0);
      const unitPriceXof = Number(item.price_xof);
      const lineTotalXof = (unitPriceXof + optionsDeltaXof) * quantity;
      subtotalXof += lineTotalXof;
      preparedLines.push({ id: generateId('oi'), menuItemId: String(item.id),
        name: String(item.name), station: String(item.station || 'KITCHEN'),
        unitPriceXof, optionsSummary: selected.map(o => o.label).join(', '),
        optionsDeltaXof, quantity, lineTotalXof, notes: String(line.notes || '').slice(0, 200) });
    }
    const totalXof = subtotalXof;
    const taxRate = Number(qrRow.tax_rate_percent || 18);
    const subtotalHtXof = Math.round(totalXof / (1 + taxRate / 100));
    const taxXof = totalXof - subtotalHtXof;
    let deduction: { deductedCount: number; lowStocksTriggered: Array<{ id: string; name: string;
      quantity: number; minThreshold: number; unit: string; supplierName: string }> };
    try {
      deduction = await postgresPublicRepository.insertQrOrderTransaction({
        orderId, restaurantId, orderNumber, tableId,
        customerName: String(customerName || `${qrRow.table_label} (Client QR)`).slice(0, 80),
        subtotalHtXof, taxXof, totalXof, notes: String(notes || '').slice(0, 300),
        idempotencyKey: idempotencyKey ? String(idempotencyKey) : null, now, lines: preparedLines,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505' && idempotencyKey) {
        const existing = await postgresPublicRepository.findOrderByIdempotencyKey(restaurantId, String(idempotencyKey));
        if (existing) return { deduplicated: true, order: { id: existing.id,
          orderNumber: existing.order_number, totalXof: Number(existing.total_xof), status: existing.status } };
      }
      throw new AppError(500, 'Erreur lors de l’envoi de la commande.');
    }
    if (deduction.deductedCount > 0) broadcastRestaurantEvent(restaurantId, 'stock:updated', { orderId, orderNumber, deductedCount: deduction.deductedCount });
    broadcastRestaurantEvent(restaurantId, 'order:created', { orderId, orderNumber, orderType: 'QR_TABLE', tableId, totalXof });
    broadcastRestaurantEvent(restaurantId, 'table:updated', { tableId, status: 'OCCUPIED' });
    return { deduplicated: false, order: { id: orderId, orderNumber,
      tableLabel: qrRow.table_label, totalXof, status: 'PENDING', createdAt: now, items: preparedLines } };
  }
}

export const publicService = new PublicService();
