import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  let database = 'ok';
  try {
    const { error } = await supabaseAdmin.from('tasks').select('id', { count: 'exact', head: true }).limit(1);
    if (error) database = 'unreachable';
  } catch {
    database = 'unreachable';
  }
  logger.info('health_checked', { database });
  res.json({ ok: true, service: 'agentos-backend', version: '1.0.0', status: database === 'ok' ? 'ok' : 'degraded', database });
});