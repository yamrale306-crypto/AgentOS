import type { NextFunction, Request, Response } from 'express';
import { authenticateBearer } from '@agentos/database';
import { unauthorized } from '@agentos/database';
import { forbidden } from '@agentos/database';
import env, { parseCsv } from '@agentos/config';

export interface AuthedUser {
  id: string;
  email: string | null;
}

/** Operational diagnostics are intentionally server-configured, never client-asserted. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  const ids = parseCsv(env.ADMIN_USER_IDS);
  const emails = parseCsv(env.ADMIN_EMAILS);
  if (!user || (!ids.includes(user.id.toLowerCase()) && !(user.email && emails.includes(user.email.toLowerCase())))) {
    return next(forbidden('Administrator access is required.'));
  }
  next();
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) throw unauthorized('Missing bearer token. Sign in and retry.');
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw unauthorized('Missing bearer token. Sign in and retry.');
    const user = await authenticateBearer(token);
    req.user = { id: user.id, email: user.email ?? null };
    next();
  } catch (e) {
    next(e);
  }
}