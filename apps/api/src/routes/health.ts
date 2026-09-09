import { Router } from 'express';
import { supabaseAdmin } from '@agentos/database';
import { logger } from '@agentos/config';

export const healthRouter: Router = Router();

healthRouter.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'agentos-backend', version: '1.0.0', status: 'ok' });
});

healthRouter.get('/ready', async (_req, res) => {
  let database = 'ok';
  try {
    const { error } = await supabaseAdmin.from('tasks').select('id', { count: 'exact', head: true }).limit(1);
    if (error) database = 'unreachable';
  } catch {
    database = 'unreachable';
  }
  logger.info('health_checked', { database });
  const ready = database === 'ok';
  res.status(ready ? 200 : 503).json({ ok: ready, service: 'agentos-backend', status: ready ? 'ready' : 'not_ready', database });
});