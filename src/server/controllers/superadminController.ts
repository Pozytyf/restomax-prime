import type { Request, Response } from 'express';
import { superadminService } from '../services/superadminService.ts';
import { handleControllerError } from '../services/errors.ts';

export const superadminController = {
  async getDashboard(_req: Request, res: Response) {
    try {
      const data = await superadminService.getDashboard();
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement dashboard plateforme.');
    }
  },

  async listRestaurants(_req: Request, res: Response) {
    try {
      const restaurants = superadminService.listRestaurants();
      res.json({ restaurants });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement restaurants.');
    }
  },

  async createRestaurant(req: Request, res: Response) {
    try {
      const id = superadminService.createRestaurant(req.auth!, req.body || {});
      res.status(201).json({ id });
    } catch (err) {
      handleControllerError(res, err, 'Erreur création restaurant.');
    }
  },

  async updateRestaurantStatus(req: Request, res: Response) {
    try {
      await superadminService.updateRestaurantStatus(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour statut restaurant.');
    }
  },

  async listPlans(_req: Request, res: Response) {
    try {
      const plans = superadminService.listPlans();
      res.json({ plans });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement plans.');
    }
  },

  async updatePlan(req: Request, res: Response) {
    try {
      superadminService.updatePlan(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour plan.');
    }
  },

  async listSubscriptions(_req: Request, res: Response) {
    try {
      const subscriptions = superadminService.listSubscriptions();
      res.json({ subscriptions });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement abonnements.');
    }
  },

  async listInvoices(_req: Request, res: Response) {
    try {
      const invoices = superadminService.listInvoices();
      res.json({ invoices });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement facturation.');
    }
  },

  async markInvoicePaid(req: Request, res: Response) {
    try {
      superadminService.markInvoicePaid(req.auth!, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur validation facture.');
    }
  },

  async listUsers(_req: Request, res: Response) {
    try {
      const users = superadminService.listUsers();
      res.json({ users });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement utilisateurs.');
    }
  },

  async updateUserStatus(req: Request, res: Response) {
    try {
      superadminService.updateUserStatus(
        req.auth!,
        String(req.params.id),
        req.body?.status,
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour utilisateur.');
    }
  },

  async listTickets(_req: Request, res: Response) {
    try {
      const data = superadminService.listTicketsAndLeads();
      res.json(data);
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement support.');
    }
  },

  async replyToTicket(req: Request, res: Response) {
    try {
      superadminService.replyToTicket(
        req.auth!,
        String(req.params.id),
        req.body || {},
      );
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur réponse ticket.');
    }
  },

  async listAuditLogs(_req: Request, res: Response) {
    try {
      const logs = superadminService.listAuditLogs();
      res.json({ logs });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement journal audit.');
    }
  },

  async getSettings(_req: Request, res: Response) {
    try {
      const settings = superadminService.getPlatformSettings();
      res.json({ settings });
    } catch (err) {
      handleControllerError(res, err, 'Erreur chargement paramètres.');
    }
  },

  async updateSettings(req: Request, res: Response) {
    try {
      superadminService.updatePlatformSettings(req.auth!, req.body || {});
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur mise à jour paramètres.');
    }
  },
};
