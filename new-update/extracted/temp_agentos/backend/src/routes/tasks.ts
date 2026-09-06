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
import { quotaExceeded, tooManyRequests, conflict } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import env from '../lib/config.js';

export const tasksRouter = Router();
tasksRouter.use('/api/tasks', requireAuth);

tasksRouter.post('/api/tasks', async (req, res, next) => {
  try {
    const user = req.user!;
    const prompt = validatePrompt(req.body?.prompt);

    const outcome = await createTask(user.id, prompt, env.DAILY_TASK_LIMIT, env.MAX_ACTIVE_TASKS_PER_USER);
    if (!outcome.ok) {
      if (outcome.error === 'daily_limit') {
        throw quotaExceeded(`You have reached the daily limit of ${env.DAILY_TASK_LIMIT} research tasks. Try again tomorrow.`);
      }
      throw tooManyRequests(`You already have ${env.MAX_ACTIVE_TASKS_PER_USER} active research task(s). Wait for one to finish or cancel it first.`);
    }

    setImmediate(() => {
      runTask(outcome.id).catch((e) => logger.error('task_scheduler_error', { task_id: outcome.id }, e));
    });

    logger.info('task_created', { task_id: outcome.id, user_id: user.id });
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
    const outcome = await createTask(user.id, prompt, env.DAILY_TASK_LIMIT, env.MAX_ACTIVE_TASKS_PER_USER);
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