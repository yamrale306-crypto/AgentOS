import type { NextFunction, Request, Response } from 'express';
import { authenticateBearer } from '../lib/supabase.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthedUser {
  id: string;
  email: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
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