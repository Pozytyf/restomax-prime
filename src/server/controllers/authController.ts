import type { Request, Response } from 'express';
import { extractToken } from '../auth.ts';
import { authService } from '../services/authService.ts';
import { handleControllerError } from '../services/errors.ts';

export const authController = {
  async login(req: Request, res: Response) {
    try {
      const userAgent = String(req.headers['user-agent'] || '');
      const result = await authService.login(req.body || {}, userAgent);

      res.cookie('restomax_token', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 86400 * 1000,
      });

      res.json(result);
    } catch (err) {
      handleControllerError(res, err, 'Erreur lors de la connexion.');
    }
  },

  async registerRestaurant(req: Request, res: Response) {
    try {
      const userAgent = String(req.headers['user-agent'] || '');
      const result = await authService.registerRestaurant(req.body || {}, userAgent);

      res.cookie('restomax_token', result.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 86400 * 1000,
      });

      res.status(201).json(result);
    } catch (err) {
      handleControllerError(
        res,
        err,
        'Erreur lors de la création du restaurant.',
      );
    }
  },

  async me(req: Request, res: Response) {
    try {
      const token = extractToken(req);
      const user = await authService.getMe(token);
      res.json({ user });
    } catch (err) {
      handleControllerError(res, err, 'Erreur vérification session.');
    }
  },

  async logout(req: Request, res: Response) {
    try {
      await authService.logout(req.auth);
      res.clearCookie('restomax_token', { path: '/' });
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur déconnexion.');
    }
  },

  async changePassword(req: Request, res: Response) {
    try {
      await authService.changePassword(req.auth!, req.body || {});
      res.json({ ok: true });
    } catch (err) {
      handleControllerError(res, err, 'Erreur changement de mot de passe.');
    }
  },
};
