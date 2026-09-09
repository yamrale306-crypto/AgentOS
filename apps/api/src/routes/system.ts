import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { badRequest } from '@agentos/database';
import env from '@agentos/config';
import { logger } from '@agentos/config';
import { providerDiagnostics, tokenDiagnostics, modelDiagnostics, systemStatus, runDiagnosticRequest, type DiagnosticRequest } from '@agentos/ai';
import { AI_MODES } from '@agentos/schemas';
import type { AiMode } from '@agentos/schemas';

export const systemRouter: Router = Router();
systemRouter.use('/api/system', requireAuth);
systemRouter.use('/api/system', requireAdmin);

function parseMode(value: unknown): AiMode | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw badRequest('mode must be auto, quality, balanced, fast or lowcost.');
  const mode = value.trim().toLowerCase();
  if ((AI_MODES as readonly string[]).includes(mode)) return mode as AiMode;
  throw badRequest('mode must be auto, quality, balanced, fast or lowcost.');
}

systemRouter.get('/api/system/status', (_req, res) => {
  res.json({ ok: true, data: systemStatus({ AI_ROUTING_ENABLED: env.AI_ROUTING_ENABLED, AI_DEFAULT_MODE: env.AI_DEFAULT_MODE, AI_DEFAULT_MODEL: env.AI_DEFAULT_MODEL }) });
});

systemRouter.get('/api/system/providers', (_req, res) => {
  res.json({ ok: true, data: providerDiagnostics() });
});

systemRouter.get('/api/system/models', (_req, res) => {
  res.json({ ok: true, data: modelDiagnostics() });
});

systemRouter.get('/api/system/tokens', (_req, res) => {
  res.json({ ok: true, data: tokenDiagnostics() });
});

systemRouter.post('/api/system/test', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { provider?: string; model?: string; mode?: unknown; prompt?: string };
    const mode = parseMode(body.mode);
    if (body.provider !== undefined && typeof body.provider !== 'string') throw badRequest('provider must be a string.');
    const provider = typeof body.provider === 'string' ? body.provider.trim() || undefined : undefined;
    const model = typeof body.model === 'string' ? body.model.trim() || undefined : body.model;

    logger.info('system_test_started', { provider, model, mode });
    const result = await runDiagnosticRequest({ provider, model, mode, prompt: body.prompt, maxTokens: 32, timeoutMs: 45000 });
    logger.info('system_test_finished', { ok: result.ok, provider: result.providerId, model: result.selectedModel, errorCategory: result.errorCategory });
    res.json({ ok: true, data: result });
  } catch (e) {
    return next(e);
  }
});

systemRouter.post('/api/system/playground', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as DiagnosticRequest;
    const mode = parseMode(body.mode);
    const result = await runDiagnosticRequest({ ...body, mode, timeoutMs: 60000 });
    res.json({ ok: true, data: result });
  } catch (e) {
    return next(e);
  }
});