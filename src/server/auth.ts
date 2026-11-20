import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { getDb, generateId } from './db.ts';
import { getKnex } from './knex.ts';
import { hasPermission, resolveEffectivePermissions } from './rbac.ts';
import type { Permission, RestaurantStatus, Role, UserStatus } from '../types/index.ts';

const JWT_SECRET =
  process.env.JWT_SECRET || 'restomax-dev-secret-do-not-use-in-prod';

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  userStatus: UserStatus;
  restaurantId: string | null;
  restaurantName: string | null;
  restaurantSlug: string | null;
  restaurantStatus: RestaurantStatus | null;
  permissions: Permission[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function signSessionToken(payload: {
  sessionId: string;
  userId: string;
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  const cookieToken = req.cookies?.restomax_token;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  return null;
}

export function recordAudit(
  db: SqliteDatabase,
  params: {
    actorUserId: string | null;
    actorEmail: string;
    actorRole: string;
    restaurantId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    details?: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit_logs (
      id, actor_user_id, actor_email, actor_role, restaurant_id,
      action, target_type, target_id, details, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId('aud'),
    params.actorUserId,
    params.actorEmail,
    params.actorRole,
    params.restaurantId,
    params.action,
    params.targetType,
    params.targetId,
    params.details || '',
    new Date().toISOString(),
  );
}

export function resolveAuthContext(
  db: SqliteDatabase,
  token: string,
): AuthContext | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sessionId: string;
      userId: string;
    };
    const session = db
      .prepare(
        `SELECT s.id, s.user_id, s.restaurant_id, s.expires_at, s.revoked_at,
                u.tenant_id, u.email, u.full_name, u.global_role, u.status as user_status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.user_id = ?`,
      )
      .get(decoded.sessionId, decoded.userId) as
      | {
          id: string;
          user_id: string;
          restaurant_id: string | null;
          expires_at: string;
          revoked_at: string | null;
          tenant_id: string | null;
          email: string;
          full_name: string;
          global_role: string;
          user_status: UserStatus;
        }
      | undefined;

    if (!session) return null;
    if (session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) return null;
    if (session.user_status !== 'ACTIVE') return null;

    if (session.global_role === 'SUPER_ADMIN') {
      return {
        sessionId: session.id,
        userId: session.user_id,
        email: session.email,
        fullName: session.full_name,
        role: 'SUPER_ADMIN',
        userStatus: session.user_status,
        restaurantId: null,
        restaurantName: null,
        restaurantSlug: null,
        restaurantStatus: null,
        permissions: resolveEffectivePermissions('SUPER_ADMIN'),
      };
    }

    if (!session.restaurant_id) return null;
    if (session.tenant_id && session.tenant_id !== session.restaurant_id) {
      return null;
    }

    const membership = db
      .prepare(
        `SELECT rm.role, rm.custom_permissions_json, rm.status as member_status,
                r.name as restaurant_name, r.slug as restaurant_slug, r.status as restaurant_status, r.deleted_at
         FROM restaurant_members rm
         JOIN restaurants r ON r.id = rm.restaurant_id
         WHERE rm.user_id = ? AND rm.restaurant_id = ?`,
      )
      .get(session.user_id, session.restaurant_id) as
      | {
          role: Role;
          custom_permissions_json: string;
          member_status: UserStatus;
          restaurant_name: string;
          restaurant_slug: string;
          restaurant_status: RestaurantStatus;
          deleted_at: string | null;
        }
      | undefined;

    if (!membership) return null;
    if (membership.member_status !== 'ACTIVE') return null;
    if (membership.deleted_at || membership.restaurant_status === 'DELETED') {
      return null;
    }

    let customPerms: Permission[] = [];
    try {
      customPerms = JSON.parse(membership.custom_permissions_json || '[]');
    } catch {
      customPerms = [];
    }

    return {
      sessionId: session.id,
      userId: session.user_id,
      email: session.email,
      fullName: session.full_name,
      role: membership.role,
      userStatus: session.user_status,
      restaurantId: session.restaurant_id,
      restaurantName: membership.restaurant_name,
      restaurantSlug: membership.restaurant_slug,
      restaurantStatus: membership.restaurant_status,
      permissions: resolveEffectivePermissions(membership.role, customPerms),
    };
  } catch {
    return null;
  }
}

export async function resolvePostgresAuthContext(token: string): Promise<AuthContext | null> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { sessionId: string; userId: string };
    const db = getKnex();
    const session = await db('sessions as s')
      .join('users as u', 'u.id', 's.user_id')
      .select(
        's.id', 's.user_id', 's.restaurant_id', 's.expires_at', 's.revoked_at',
        'u.tenant_id', 'u.email', 'u.full_name', 'u.global_role',
        { user_status: 'u.status' },
      )
      .where('s.id', decoded.sessionId)
      .andWhere('s.user_id', decoded.userId)
      .first();
    if (!session || session.revoked_at ||
        new Date(session.expires_at).getTime() < Date.now() ||
        session.user_status !== 'ACTIVE') return null;

    if (session.global_role === 'SUPER_ADMIN') {
      return {
        sessionId: session.id, userId: session.user_id, email: session.email,
        fullName: session.full_name, role: 'SUPER_ADMIN',
        userStatus: session.user_status, restaurantId: null,
        restaurantName: null, restaurantSlug: null, restaurantStatus: null,
        permissions: resolveEffectivePermissions('SUPER_ADMIN'),
      };
    }
    if (!session.restaurant_id ||
        (session.tenant_id && session.tenant_id !== session.restaurant_id)) return null;

    const membership = await db('restaurant_members as rm')
      .join('restaurants as r', 'r.id', 'rm.restaurant_id')
      .select(
        'rm.role', 'rm.custom_permissions_json',
        { member_status: 'rm.status' },
        { restaurant_name: 'r.name' }, { restaurant_slug: 'r.slug' },
        { restaurant_status: 'r.status' }, 'r.deleted_at',
      )
      .where('rm.user_id', session.user_id)
      .andWhere('rm.restaurant_id', session.restaurant_id)
      .first();
    if (!membership || membership.member_status !== 'ACTIVE' ||
        membership.deleted_at || membership.restaurant_status === 'DELETED') return null;

    let customPerms: Permission[] = [];
    try { customPerms = JSON.parse(membership.custom_permissions_json || '[]'); }
    catch { customPerms = []; }
    return {
      sessionId: session.id, userId: session.user_id, email: session.email,
      fullName: session.full_name, role: membership.role,
      userStatus: session.user_status, restaurantId: session.restaurant_id,
      restaurantName: membership.restaurant_name, restaurantSlug: membership.restaurant_slug,
      restaurantStatus: membership.restaurant_status,
      permissions: resolveEffectivePermissions(membership.role, customPerms),
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  try {
    const usePostgres = ['pg', 'postgres', 'postgresql'].includes((process.env.DATABASE_CLIENT || 'sqlite').toLowerCase()) && process.env.RESTOMAX_POSTGRES_CUTOVER === 'true' && Boolean(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL);
    const ctx = usePostgres
      ? await resolvePostgresAuthContext(token)
      : resolveAuthContext(getDb(), token);
    if (!ctx) {
      res.status(401).json({ error: 'Session expirée, révoquée ou compte suspendu.' });
      return;
    }
    req.auth = ctx;
    next();
  } catch {
    res.status(503).json({ error: 'Service d’authentification temporairement indisponible.' });
  }
}

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.auth || req.auth.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Accès réservé au Super-administrateur.' });
    return;
  }
  next();
}

export function requireActiveRestaurant(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.auth || !req.auth.restaurantId) {
    res
      .status(403)
      .json({ error: 'Aucun établissement associé à cette session.' });
    return;
  }
  if (req.auth.restaurantStatus === 'SUSPENDED') {
    res.status(403).json({
      error:
        'Cet établissement est actuellement suspendu. Veuillez contacter le support Resto’MAX.',
    });
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentification requise.' });
      return;
    }
    if (!hasPermission(req.auth.permissions, permission)) {
      res.status(403).json({
        error: `Permission insuffisante (${permission}).`,
      });
      return;
    }
    next();
  };
}
