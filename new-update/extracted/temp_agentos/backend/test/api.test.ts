import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/supabase.js', () => ({
  authenticateBearer: vi.fn(),
  supabaseAdmin: { from: vi.fn(), rpc: vi.fn() }
}));

vi.mock('../src/lib/taskStore.js', async () => {
  const { validatePrompt } = await import('../src/lib/prompt.js');
  return {
    createTask: vi.fn(),
    getTask: vi.fn(),
    getTaskByAdminId: vi.fn(),
    listTasks: vi.fn(),
    cancelTask: vi.fn(),
    deleteTask: vi.fn(),
    transition: vi.fn(),
    markFailed: vi.fn(),
    getStatus: vi.fn(),
    incrementSearchUsage: vi.fn(),
    validatePrompt
  };
});

vi.mock('../src/agent/agent.js', () => ({ runTask: vi.fn().mockResolvedValue(undefined) }));

import { authenticateBearer, supabaseAdmin } from '../src/lib/supabase.js';
import * as taskStore from '../src/lib/taskStore.js';
import { runTask } from '../src/agent/agent.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/lib/errors.js';

const fromMock = vi.mocked(supabaseAdmin.from);

function dbOk() {
  fromMock.mockReturnValue({
    select: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [], error: null })) })),
    eq: vi.fn().mockReturnThis()
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateBearer).mockImplementation(async (token: string) => {
    if (token === 'good-token') return { id: 'user-1', email: 'a@b.c' } as never;
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired authentication token.');
  });
  dbOk();
});

const api = createApp();
const authed = { authorization: 'Bearer good-token' };

describe('health', () => {
  it('returns health payload', async () => {
    const res = await request(api).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('agentos-backend');
    expect(res.body.status).toBe('ok');
  });
});

describe('authentication', () => {
  it('rejects requests without a token with 401', async () => {
    const res = await request(api).get('/api/tasks');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid token with 401 and no stack traces', async () => {
    const res = await request(api).get('/api/tasks').set('authorization', 'Bearer nope');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('at ');
  });
});

describe('task creation', () => {
  it('creates a task (202), schedules the agent, and returns the created id', async () => {
    vi.mocked(taskStore.createTask).mockResolvedValue({ ok: true, id: 'task-1', status: 'queued', created_at: '2026-01-01T00:00:00Z' });
    const res = await request(api).post('/api/tasks').set(authed).send({ prompt: 'Research the capital of France' });
    expect(res.status).toBe(202);
    expect(res.body.data.id).toBe('task-1');
    expect(res.body.data.status).toBe('queued');
    expect(runTask).toHaveBeenCalledWith('task-1');
  });

  it('rejects a too-short prompt with 400', async () => {
    const res = await request(api).post('/api/tasks').set(authed).send({ prompt: 'ab' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects prompts longer than 4000 chars with 400', async () => {
    const res = await request(api).post('/api/tasks').set(authed).send({ prompt: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
  });

  it('returns 429 when the daily task limit is reached', async () => {
    vi.mocked(taskStore.createTask).mockResolvedValue({ ok: false, error: 'daily_limit' });
    const res = await request(api).post('/api/tasks').set(authed).send({ prompt: 'Research anything' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('returns 429 when the active-task limit is reached', async () => {
    vi.mocked(taskStore.createTask).mockResolvedValue({ ok: false, error: 'active_limit' });
    const res = await request(api).post('/api/tasks').set(authed).send({ prompt: 'Research anything' });
    expect(res.status).toBe(429);
    expect(res.body.error.message).toMatch(/active/);
  });
});

describe('task listing and detail', () => {
  it('lists only the current user\'s tasks (listTasks is called with user id)', async () => {
    vi.mocked(taskStore.listTasks).mockResolvedValue([{ id: 't1', prompt: 'p', status: 'completed' }]);
    const res = await request(api).get('/api/tasks').set(authed);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(taskStore.listTasks).toHaveBeenCalledWith('user-1', 25);
  });

  it('returns task details', async () => {
    vi.mocked(taskStore.getTask).mockResolvedValue({ id: 't1', prompt: 'p', status: 'completed', result: 'r' });
    const res = await request(api).get('/api/tasks/t1').set(authed);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('t1');
  });

  it('returns 404 for a task the user does not own', async () => {
    vi.mocked(taskStore.getTask).mockRejectedValue(new AppError(404, 'NOT_FOUND', 'Task not found.'));
    const res = await request(api).get('/api/tasks/missing').set(authed);
    expect(res.status).toBe(404);
  });
});

describe('cancellation', () => {
  it('cancels an active task', async () => {
    vi.mocked(taskStore.cancelTask).mockResolvedValue(undefined);
    const res = await request(api).post('/api/tasks/t1/cancel').set(authed);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('returns 409 when cancelling a finished task', async () => {
    vi.mocked(taskStore.cancelTask).mockRejectedValue(new AppError(409, 'CONFLICT', 'Task is already in terminal state "completed".'));
    const res = await request(api).post('/api/tasks/t1/cancel').set(authed);
    expect(res.status).toBe(409);
  });
});

describe('retry', () => {
  it('retries a failed task by creating a fresh run of the same prompt', async () => {
    vi.mocked(taskStore.getTask).mockResolvedValue({ id: 'old', prompt: 'Research X', status: 'failed' });
    vi.mocked(taskStore.createTask).mockResolvedValue({ ok: true, id: 'new-1', status: 'queued', created_at: 'x' });
    const res = await request(api).post('/api/tasks/old/retry').set(authed);
    expect(res.status).toBe(202);
    expect(res.body.data.id).toBe('new-1');
    expect(taskStore.createTask).toHaveBeenCalledWith('user-1', 'Research X', expect.any(Number), expect.any(Number));
    expect(runTask).toHaveBeenCalledWith('new-1');
  });

  it('refuses to retry a non-failed task with 409', async () => {
    vi.mocked(taskStore.getTask).mockResolvedValue({ id: 'old', prompt: 'Research X', status: 'completed' });
    const res = await request(api).post('/api/tasks/old/retry').set(authed);
    expect(res.status).toBe(409);
  });
});

describe('deletion', () => {
  it('deletes a terminal task', async () => {
    vi.mocked(taskStore.deleteTask).mockResolvedValue(undefined);
    const res = await request(api).delete('/api/tasks/t1').set(authed);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  it('returns 409 when deleting a running task', async () => {
    vi.mocked(taskStore.deleteTask).mockRejectedValue(new AppError(409, 'CONFLICT', 'Cancel the task before deleting it.'));
    const res = await request(api).delete('/api/tasks/t1').set(authed);
    expect(res.status).toBe(409);
  });
});

describe('error handling', () => {
  it('returns 404 JSON for unknown routes', async () => {
    const res = await request(api).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('maps unexpected errors to 500 without leaking internals', async () => {
    vi.mocked(taskStore.listTasks).mockRejectedValue(new Error('db blew up with secret sk-abcd1234'));
    const res = await request(api).get('/api/tasks').set(authed);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('sk-abcd');
  });
});