import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@dn/shared';
import { sql } from '../lib/db.js';
import { HttpError } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export interface AuthUser {
  id: string;
  email: string | null;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new HttpError(401, 'Missing bearer token');

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Invalid or expired token');

  // Role is read from the database, never from the token, so role changes apply immediately.
  const [profile] = await sql<{ role: UserRole }[]>`
    select role from public.profiles where id = ${data.user.id}
  `;
  if (!profile) throw new HttpError(403, 'Profile not found');

  req.user = { id: data.user.id, email: data.user.email ?? null, role: profile.role };
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'Insufficient role');
    next();
  };
}
