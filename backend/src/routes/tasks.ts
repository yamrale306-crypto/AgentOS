import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createTask,
  getTask,
  listTasks,
  cancelTask,
  deleteTask,
  validatePrompt
} from '../lib/taskStore.js';
import { runTask } from '../agent/agent.js';
import { requestCancellation } from '../agent/cancellation.js';
import { quotaExceeded, tooManyRequests, conflict, badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import env from '../lib/config.js';
import { AI_MODES as APP_AI_MODES } from '../types.js';

export const tasksRouter = Router();
tasksRouter.use('/api/tasks', requireAuth);

function parseModelMode(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'auto';
  if (typeof value !== 'string') throw badRequest('modelMode must be auto, quality, balanced, fast or lowcost.');
  const mode = value.trim().toLowerCase();
  if ((APP_AI_MODES as readonly string[]).includes(mode)) return mode;
  throw badRequest('modelMode must be auto, quality, balanced, fast or lowcost.');
}

function parseModelOverride(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('model must be a string.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) throw badRequest('model must be 200 characters or fewer.');
  return trimmed;
}

tasksRouter.post('/api/tasks', async (req, res, next) => {
  try {
    const user = req.user!;
    const prompt = validatePrompt(req.body?.prompt);
    const modelMode = parseModelMode(req.body?.modelMode);
    const modelOverride = parseModelOverride(req.body?.model);

    const outcome = await createTask(user.id, prompt, env.DAILY_TASK_LIMIT, env.MAX_ACTIVE_TASKS_PER_USER, modelMode, modelOverride);
    if (!outcome.ok) {
      if (outcome.error === 'daily_limit') {
        throw quotaExceeded(`You have reached the daily limit of ${env.DAILY_TASK_LIMIT} research tasks. Try again tomorrow.`);
      }
      throw tooManyRequests(`You already have ${env.MAX_ACTIVE_TASKS_PER_USER} active research task(s). Wait for one to finish or cancel it first.`);
    }

    setImmediate(() => {
      runTask(outcome.id).catch((e) => logger.error('task_scheduler_error', { task_id: outcome.id }, e));
    });

    logger.info('task_created', { task_id: outcome.id, user_id: user.id, model_mode: modelMode });
    return res.status(202).json({ ok: true, data: { id: outcome.id, status: outcome.status, created_at: outcome.created_at } });
  } catch (e) {
    return next(e);
  }
});

tasksRouter.get('/api/tasks', async (req, res, next) => {
  try {
    const user = req.user!;
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    const data = await listTasks(user.id, limit);
    return res.json({ ok: true, data });
  } catch (e) {
    return next(e);
  }
});

tasksRouter.get('/api/tasks/:id', async (req, res, next) => {
  try {
    const user = req.user!;
    const data = await getTask(req.params.id, user.id);
    return res.json({ ok: true, data });
  } catch (e) {
    return next(e);
  }
});

tasksRouter.post('/api/tasks/:id/cancel', async (req, res, next) => {
  try {
    const user = req.user!;
    await cancelTask(req.params.id, user.id);
    requestCancellation(req.params.id);
    logger.info('task_cancel_requested', { task_id: req.params.id, user_id: user.id });
    return res.json({ ok: true, data: { id: req.params.id, status: 'cancelled' } });
  } catch (e) {
    return next(e);
  }
});

tasksRouter.post('/api/tasks/:id/retry', async (req, res, next) => {
  try {
    const user = req.user!;
    const task = await getTask(req.params.id, user.id);
    if (task.status !== 'failed') {
      throw conflict('Only failed tasks can be retried.');
    }

    const prompt = validatePrompt(task.prompt);
    const modelMode = parseModelMode(task.model_mode);
    const modelOverride = parseModelOverride(task.model);
    const outcome = await createTask(user.id, prompt, env.DAILY_TASK_LIMIT, env.MAX_ACTIVE_TASKS_PER_USER, modelMode, modelOverride);
    if (!outcome.ok) {
      if (outcome.error === 'daily_limit') {
        throw quotaExceeded(`You have reached the daily limit of ${env.DAILY_TASK_LIMIT} research tasks. Try again tomorrow.`);
      }
      throw tooManyRequests(`You already have ${env.MAX_ACTIVE_TASKS_PER_USER} active research task(s). Wait for one to finish or cancel it first.`);
    }

    setImmediate(() => {
      runTask(outcome.id).catch((e) => logger.error('task_scheduler_error', { task_id: outcome.id }, e));
    });

    logger.info('task_retried', { task_id: outcome.id, user_id: user.id, original_id: req.params.id });
    return res.status(202).json({ ok: true, data: { id: outcome.id, status: outcome.status, created_at: outcome.created_at } });
  } catch (e) {
    return next(e);
  }
});

tasksRouter.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const user = req.user!;
    await deleteTask(req.params.id, user.id);
    return res.json({ ok: true, data: { id: req.params.id, deleted: true } });
  } catch (e) {
    return next(e);
  }
});