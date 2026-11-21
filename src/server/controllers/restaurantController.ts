import type { Request, Response } from 'express';
import { restaurantService } from '../services/restaurantService.ts';
import { handleControllerError } from '../services/errors.ts';
import { createRestaurantImageUpload } from '../services/neonStorage.ts';

export const restaurantController = {
  async getDashboard(req: Request, res: Response) {
    try {
      const data = await restaurantService.getDashboard(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement dashboard.');
    }
  },

  async getMenu(req: Request, res: Response) {
    try {
      const menu = await restaurantService.getMenu(req.auth!.restaurantId!);
      res.json(menu);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement menu.');
    }
  },

  async createCategory(req: Request, res: Response) {
    try {
      const category = await restaurantService.createCategory(
        req.auth!.restaurantId!,
        req.body || {},
      );
      res.status(201).json({ category });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création catégorie.');
    }
  },

  async createImageUploadUrl(req: Request, res: Response) {
    try {
      const requiredPermission = req.body?.kind === 'logo' ? 'settings:write' : 'menu:write';
      if (!req.auth!.permissions.includes(requiredPermission)) {
        res.status(403).json({ error: 'Permission insuffisante.' });
        return;
      }
      const upload = createRestaurantImageUpload(
        req.auth!.restaurantId!,
        req.body?.kind,
        req.body?.contentType,
        req.body?.size,
      );
      res.json(upload);
    } catch (err) {
      handleControllerError(res, err, 'Erreur préparation upload image.');
    }
  },

  async createMenuItem(req: Request, res: Response) {
    try {
      const id = await restaurantService.createMenuItem(req.auth!, req.body || {});
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création article.');
    }
  },

  async updateMenuItem(req: Request, res: Response) {
    try {
      await restaurantService.updateMenuItem(
        req.auth!.restaurantId!,
        String(req.params.id),
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour article.');
    }
  },

  async getRecipes(req: Request, res: Response) {
    try {
      const menuItemId =
        typeof req.query.menuItemId === 'string' ? req.query.menuItemId : undefined;
      const recipes = await restaurantService.getRecipes(
        req.auth!.restaurantId!,
        menuItemId,
      );
      res.json({ recipes });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement fiches techniques.');
    }
  },

  async updateMenuItemRecipe(req: Request, res: Response) {
    try {
      const recipes = await restaurantService.updateMenuItemRecipe(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      res.json({ recipes });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour fiche technique.');
    }
  },

  async getOrders(req: Request, res: Response) {
    try {
      const orders = await restaurantService.getOrders(req.auth!.restaurantId!);
      res.json({ orders });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement commandes.');
    }
  },

  async createPosOrder(req: Request, res: Response) {
    try {
      const result = await restaurantService.createPosOrder(
        req.auth!,
        req.body || {},
      );
      if (result.deduplicated) {
        res.status(200).json({ order: result.order, deduplicated: true });
        return;
      }
      res.status(201).json({ order: result.order });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création commande.');
    }
  },

  async updateOrderItemPrepStatus(req: Request, res: Response) {
    try {
      await restaurantService.updateOrderItemPrepStatus(
        req.auth!,
        String(req.params.id),
        String(req.params.itemId),
        req.body?.prepStatus,
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour préparation article.');
    }
  },

  async updateOrderStatus(req: Request, res: Response) {
    try {
      await restaurantService.updateOrderStatus(
        req.auth!,
        String(req.params.id),
        req.body?.status,
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour commande.');
    }
  },

  async getPayments(req: Request, res: Response) {
    try {
      const payments = await restaurantService.getPayments(req.auth!.restaurantId!);
      res.json({ payments });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement paiements.');
    }
  },

  async payOrder(req: Request, res: Response) {
    try {
      const result = await restaurantService.payOrder(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      if (result.deduplicated) {
        res.status(200).json({ payment: result.payment, deduplicated: true });
        return;
      }
      res.status(201).json({ payment: result.payment });
    } catch (err) {
      handleControllerError(res, err, 'Erreur lors de l’encaissement.');
    }
  },

  async refundPayment(req: Request, res: Response) {
    try {
      await restaurantService.refundPayment(req.auth!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur remboursement.');
    }
  },

  async getTables(req: Request, res: Response) {
    try {
      const tables = await restaurantService.getTables(req.auth!.restaurantId!);
      res.json({ tables });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement tables.');
    }
  },

  async createTable(req: Request, res: Response) {
    try {
      const result = await restaurantService.createTable(
        req.auth!.restaurantId!,
        req.body || {},
      );
      res.status(201).json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur création table.');
    }
  },

  async updateTableStatus(req: Request, res: Response) {
    try {
      await restaurantService.updateTableStatus(
        req.auth!.restaurantId!,
        String(req.params.id),
        req.body?.status,
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour table.');
    }
  },

  async regenerateTableQr(req: Request, res: Response) {
    try {
      const result = await restaurantService.regenerateTableQr(
        req.auth!,
        String(req.params.id),
      );
      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur régénération QR.');
    }
  },

  async getStocks(req: Request, res: Response) {
    try {
      const data = await restaurantService.getStocks(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement stocks.');
    }
  },

  async createStockItem(req: Request, res: Response) {
    try {
      const id = await restaurantService.createStockItem(
        req.auth!,
        req.body || {},
      );
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur ajout ingrédient.');
    }
  },

  async moveStock(req: Request, res: Response) {
    try {
      const result = await restaurantService.moveStock(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur mouvement stock.');
    }
  },

  async getStockAlertConfig(req: Request, res: Response) {
    try {
      const data = await restaurantService.getStockAlertConfig(
        req.auth!.restaurantId!,
      );
      res.json(data);
    } catch (err) {
      handleControllerError(
        res,
        err,
        'Erreur chargement configuration alertes stock.',
      );
    }
  },

  async updateStockAlertConfig(req: Request, res: Response) {
    try {
      const settings = await restaurantService.updateStockAlertConfig(
        req.auth!,
        req.body || {},
      );
      res.json({ settings });
    } catch (err) {
      handleControllerError(
        res,
        err,
        'Erreur mise à jour configuration alertes stock.',
      );
    }
  },

  async triggerManualStockAlert(req: Request, res: Response) {
    try {
      const result = await restaurantService.triggerManualStockAlert(
        req.auth!,
        String(req.params.id),
      );
      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur envoi alerte stock.');
    }
  },

  async testStockAlertEmail(req: Request, res: Response) {
    try {
      const result = await restaurantService.testStockAlertEmail(req.auth!);
      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur test SMTP.');
    }
  },

  async getNotifications(req: Request, res: Response) {
    try {
      const data = await restaurantService.getNotifications(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement notifications.');
    }
  },

  async markNotificationsRead(req: Request, res: Response) {
    try {
      await restaurantService.markNotificationsRead(
        req.auth!.restaurantId!,
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour notifications.');
    }
  },

  async getStaff(req: Request, res: Response) {
    try {
      const data = await restaurantService.getStaff(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement équipe.');
    }
  },

  async createStaff(req: Request, res: Response) {
    try {
      const result = await restaurantService.createStaff(req.auth!, req.body || {});
      res.status(201).json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur création employé.');
    }
  },

  async updateStaff(req: Request, res: Response) {
    try {
      await restaurantService.updateStaff(
        req.auth!,
        String(req.params.memberId),
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour employé.');
    }
  },

  async getCustomers(req: Request, res: Response) {
    try {
      const customers = await restaurantService.getCustomers(req.auth!.restaurantId!);
      res.json({ customers });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement clients.');
    }
  },

  async createCustomer(req: Request, res: Response) {
    try {
      const id = await restaurantService.createCustomer(
        req.auth!.restaurantId!,
        req.body || {},
      );
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création client.');
    }
  },

  async getReservations(req: Request, res: Response) {
    try {
      const reservations = await restaurantService.getReservations(
        req.auth!.restaurantId!,
      );
      res.json({ reservations });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement réservations.');
    }
  },

  async createReservation(req: Request, res: Response) {
    try {
      const id = await restaurantService.createReservation(
        req.auth!.restaurantId!,
        req.body || {},
      );
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création réservation.');
    }
  },

  async updateReservationStatus(req: Request, res: Response) {
    try {
      await restaurantService.updateReservationStatus(
        req.auth!.restaurantId!,
        String(req.params.id),
        req.body?.status,
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour réservation.');
    }
  },

  async getOwnerReport(req: Request, res: Response) {
    try {
      const report = await restaurantService.getOwnerReport(
        req.auth!.restaurantId!, String(req.query.from || ''), String(req.query.to || ''),
      );
      res.json(report);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement du rapport propriétaire.');
    }
  },

  async getOwnerAuditLogs(req: Request, res: Response) {
    try {
      const logs = await restaurantService.getOwnerAuditLogs(
        req.auth!.restaurantId!, String(req.query.from || ''), String(req.query.to || ''), req.query.limit,
      );
      res.json({ logs });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement du journal d’activité.');
    }
  },

  async getFinance(req: Request, res: Response) {
    try {
      const data = await restaurantService.getFinanceSummary(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement finances.');
    }
  },

  async createExpense(req: Request, res: Response) {
    try {
      const id = await restaurantService.createExpense(
        req.auth!,
        req.body || {},
      );
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création dépense.');
    }
  },

  async exportOrdersCsv(req: Request, res: Response) {
    try {
      const csv = await restaurantService.exportOrdersCsv(req.auth!.restaurantId!);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="rapport-ventes-restomax.csv"',
      );
      res.send(csv);
    } catch (err) {
      handleControllerError(res, err, 'Erreur export CSV.');
    }
  },

  async getSettings(req: Request, res: Response) {
    try {
      const data = await restaurantService.getSettings(req.auth!.restaurantId!);
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement paramètres.');
    }
  },

  async updateSettings(req: Request, res: Response) {
    try {
      await restaurantService.updateSettings(req.auth!, req.body || {});
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour paramètres.');
    }
  },

  async printEscposTicket(req: Request, res: Response) {
    try {
      const result = await restaurantService.printEscposTicket(
        req.auth!,
        req.body || {},
      );
      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur impression thermique ESC/POS.');
    }
  },

  async getTickets(req: Request, res: Response) {
    try {
      const tickets = await restaurantService.getTickets(req.auth!.restaurantId!);
      res.json({ tickets });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement tickets.');
    }
  },

  async createTicket(req: Request, res: Response) {
    try {
      const id = await restaurantService.createTicket(req.auth!, req.body || {});
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création ticket.');
    }
  },
};
