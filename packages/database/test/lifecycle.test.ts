import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/client.js', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));

import { supabaseAdmin } from '../src/client.js';
import {
  createTask,
  getTask,
  getTaskByAdminId,
  getStatus,
  transition,
  markFailed,
  cancelTask,
  deleteTask,
  incrementSearchUsage,
  claimNextTask,
  heartbeatTask
} from '../src/task-store.js';
import { validatePrompt } from '../src/task-store.js';
import { notFound, conflict } from '../src/errors.js';

interface BuilderResponse {
  data: unknown;
  error: unknown;
  count?: number;
}

function builder(response: BuilderResponse) {
  const b: Record<string, any> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle']) {
    b[m] = vi.fn(() => b);
  }
  b.data = response.data;
  b.error = response.error;
  b.count = response.count;
  b.then = (resolve?: (v: unknown) => unknown) => Promise.resolve(response).then(resolve);
  return b as unknown as ReturnType<typeof supabaseAdmin.from>;
}

const mockedFrom = vi.mocked(supabaseAdmin.from);
const mockedRpc = vi.mocked(supabaseAdmin.rpc);

let fromQueue: ReturnType<typeof builder>[] = [];
let rpcQueue: ReturnType<typeof builder>[] = [];

function enqueueFrom(...responses: (BuilderResponse | null)[]) {
  fromQueue.push(...responses.map((r) => builder(r ?? { data: null, error: null })));
}
function enqueueRpc(...responses: (BuilderResponse | null)[]) {
  rpcQueue.push(...responses.map((r) => builder(r ?? { data: null, error: null })));
}

beforeEach(() => {
  vi.clearAllMocks();
  fromQueue = [];
  rpcQueue = [];
  mockedFrom.mockImplementation(() => fromQueue.shift() ?? builder({ data: null, error: null }));
  mockedRpc.mockImplementation(() => rpcQueue.shift() ?? builder({ data: null, error: null }));
});

const row = { id: 'task-1', user_id: 'user-1', prompt: 'Research the sun.', status: 'queued', searches_used: 0, created_at: '2026-01-01T00:00:00.000Z' };
const rowErr = (message: string) => ({ message, code: '22P02', details: '', hint: '' });

describe('createTask', () => {
  it('creates a task via rpc and returns the created row', async () => {
    enqueueRpc({ data: row });
    const created = await createTask('user-1', 'Research the sun.', 10, 2);
    expect(created).toEqual({ ok: true, id: 'task-1', status: 'queued', created_at: row.created_at });
    expect(mockedRpc).toHaveBeenCalledWith('create_task', expect.objectContaining({ p_user: 'user-1', p_max_daily: 10, p_max_active: 2 }));
  });

  it('reports the daily limit outcome', async () => {
    enqueueRpc({ data: { error: 'daily_limit' } });
    expect(await createTask('user-1', 'p', 10, 2)).toEqual({ ok: false, error: 'daily_limit' });
  });

  it('throws the database error verbatim', async () => {
    enqueueRpc({ data: null, error: rowErr('insert failed') });
    await expect(createTask('user-1', 'p', 10, 2)).rejects.toMatchObject({ message: 'insert failed' });
  });
});

describe('getTask / getTaskByAdminId / getStatus', () => {
  it('returns a task by id', async () => {
    enqueueFrom({ data: row });
    expect(await getTask('task-1', 'user-1')).toMatchObject({ id: 'task-1' });
  });

  it('throws notFound when the task is missing', async () => {
    enqueueFrom({ data: null });
    await expect(getTask('task-1', 'user-1')).rejects.toMatchObject(notFound('Task not found.'));
  });

  it('supports admin lookup', async () => {
    enqueueFrom({ data: row });
    expect(await getTaskByAdminId('task-1')).toMatchObject({ id: 'task-1' });
  });

  it('returns the status string and null for a missing task', async () => {
    enqueueFrom({ data: row });
    expect(await getStatus('task-1')).toBe('queued');
    enqueueFrom({ data: null });
    expect(await getStatus('task-1')).toBeNull();
  });
});

describe('transition', () => {
  it('updates the task when the row matches the allowed statuses', async () => {
    enqueueFrom({ data: [{ id: 'task-1' }] });
    await expect(transition('task-1', ['queued'], { status: 'planning' })).resolves.toBeUndefined();
    expect(mockedFrom).toHaveBeenCalled();
  });

  it('throws a conflict when the status guard rejects the change', async () => {
    enqueueFrom({ data: [] });
    enqueueFrom({ data: { status: 'completed' } });
    await expect(transition('task-1', ['queued'], { status: 'planning' })).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});

describe('markFailed / cancelTask', () => {
  it('marks a task failed', async () => {
    enqueueFrom({ data: [{ id: 'task-1' }] });
    await expect(markFailed('task-1', 'boom', 'worker-1')).resolves.toBeUndefined();
  });

  it('cancels an active task', async () => {
    enqueueFrom({ data: row });
    enqueueFrom({ data: [{ id: 'task-1' }] });
    await expect(cancelTask('task-1', 'user-1')).resolves.toBeUndefined();
  });

  it('refuses to cancel a terminal task', async () => {
    enqueueFrom({ data: { ...row, status: 'failed' } });
    await expect(cancelTask('task-1', 'user-1')).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});

describe('deleteTask', () => {
  it('deletes a terminal task', async () => {
    enqueueFrom({ data: { ...row, status: 'cancelled' } });
    enqueueFrom({ data: null });
    await expect(deleteTask('task-1', 'user-1')).resolves.toBeUndefined();
  });

  it('refuses to delete an active task', async () => {
    enqueueFrom({ data: row });
    await expect(deleteTask('task-1', 'user-1')).rejects.toMatchObject(conflict('Cancel the task before deleting it.'));
  });
});

describe('claimNextTask', () => {
  it('returns null when the queue is empty', async () => {
    enqueueRpc({ data: null });
    expect(await claimNextTask('worker-1', 5, 3)).toBeNull();
  });

  it('claims the first queued task', async () => {
    enqueueRpc({ data: { id: 'task-7', attempt_count: 1 } });
    expect(await claimNextTask('worker-1', 5, 3)).toMatchObject({ id: 'task-7', attempt_count: 1 });
    expect(mockedRpc).toHaveBeenCalledWith('claim_next_task', { p_worker_id: 'worker-1', p_lease_seconds: 5, p_max_attempts: 3 });
  });
});

describe('incrementSearchUsage', () => {
  it('returns zeroed usage for a fresh user', async () => {
    enqueueRpc({ data: { count: 0, over: false } });
    expect(await incrementSearchUsage('user-1', 50)).toEqual({ count: 0, over: false });
  });

  it('reports when the limit is reached', async () => {
    enqueueRpc({ data: { count: 50, over: true } });
    expect(await incrementSearchUsage('user-1', 50)).toEqual({ count: 50, over: true });
  });
});

describe('heartbeatTask', () => {
  it('returns true for an owned task', async () => {
    enqueueRpc({ data: true });
    expect(await heartbeatTask('task-1', 'worker-1', 5)).toBe(true);
  });

  it('returns false when the lease is lost', async () => {
    enqueueRpc({ data: false });
    expect(await heartbeatTask('task-1', 'worker-1', 5)).toBe(false);
  });
});

describe('validatePrompt', () => {
  it('accepts a reasonable prompt', () => {
    expect(() => validatePrompt('Research the sun.')).not.toThrow();
  });

  it('throws on an empty prompt', () => {
    expect(() => validatePrompt('')).toThrow();
    expect(() => validatePrompt('   ')).toThrow();
  });
});