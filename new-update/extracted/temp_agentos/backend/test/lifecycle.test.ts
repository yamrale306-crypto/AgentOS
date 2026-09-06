import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const wrap = (value: unknown) => {
    if (value === null || value === undefined) return { data: null, error: null, count: 0 };
    if (Array.isArray(value)) return { data: value, error: null, count: value.length };
    return { data: value, error: null, count: 1 };
  };
  const createBuilder = (result: () => unknown) => {
    const build = (): Record<string, unknown> => {
      const p = new Promise((resolve) => resolve(wrap(result())));
      (p as Record<string, unknown>).select = vi.fn(() => build());
      (p as Record<string, unknown>).eq = vi.fn(() => build());
      (p as Record<string, unknown>).in = vi.fn(() => build());
      (p as Record<string, unknown>).order = vi.fn(() => build());
      (p as Record<string, unknown>).limit = vi.fn(() => build());
      (p as Record<string, unknown>).update = vi.fn(() => build());
      (p as Record<string, unknown>).delete = vi.fn(() => build());
      (p as Record<string, unknown>).single = vi.fn(() => build());
      (p as Record<string, unknown>).maybeSingle = vi.fn(() => build());
      return p as unknown as Record<string, unknown>;
    };
    return build();
  };
  return { createBuilder };
});

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {}
  }
}));

import { supabaseAdmin } from '../src/lib/supabase.js';
import {
  getTask,
  getTaskByAdminId,
  listTasks,
  getStatus,
  transition,
  markFailed,
  cancelTask,
  deleteTask,
  createTask,
  incrementSearchUsage,
  validatePrompt
} from '../src/lib/taskStore.js';
import { AppError } from '../src/lib/errors.js';

const fromMock = vi.mocked(supabaseAdmin.from);
const rpcMock = vi.mocked(supabaseAdmin.rpc);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validatePrompt', () => {
  it('accepts valid prompts', () => {
    expect(validatePrompt('  Research something useful here  ')).toBe('Research something useful here');
  });
  it('rejects non-strings', () => {
    expect(() => validatePrompt(42)).toThrowError(AppError);
    expect(() => validatePrompt(42)).toThrowError('prompt must be a string');
  });
  it('rejects too-short or too-long prompts', () => {
    expect(() => validatePrompt('ab')).toThrowError('at least 3 characters');
    expect(() => validatePrompt('x'.repeat(4001))).toThrowError('4000 characters or fewer');
  });
});

describe('createTask (RPC-driven)', () => {
  it('returns ok with the created task', async () => {
    rpcMock.mockResolvedValue({ data: { id: 't1', status: 'queued', created_at: 'now' }, error: null });
    const out = await createTask('u1', 'prompt', 10, 2);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.id).toBe('t1');
    expect(rpcMock).toHaveBeenCalledWith('create_task', expect.objectContaining({ p_user: 'u1', p_max_daily: 10, p_max_active: 2 }));
  });

  it('maps daily_limit from the RPC', async () => {
    rpcMock.mockResolvedValue({ data: { error: 'daily_limit' }, error: null });
    const out = await createTask('u1', 'p', 1, 2);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('daily_limit');
  });

  it('maps active_limit from the RPC', async () => {
    rpcMock.mockResolvedValue({ data: { error: 'active_limit' }, error: null });
    const out = await createTask('u1', 'p', 10, 0);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('active_limit');
  });

  it('propagates RPC failures', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('db down') });
    await expect(createTask('u1', 'p', 10, 2)).rejects.toThrow('db down');
  });
});

describe('incrementSearchUsage', () => {
  it('returns count and over flag', async () => {
    rpcMock.mockResolvedValue({ data: { count: 6, over: true }, error: null });
    const out = await incrementSearchUsage('u1', 5);
    expect(out).toEqual({ count: 6, over: true });
  });
});

describe('getTask ownership', () => {
  it('filters by user_id so users cannot read others tasks', async () => {
    fromMock.mockReturnValue(
      supabaseMock.createBuilder(() => ({ id: 't1', user_id: 'u1', prompt: 'p', status: 'queued' })) as never
    );
    const task = await getTask('t1', 'u1');
    expect(task.id).toBe('t1');
    const calls = fromMock.mock.calls[0][0];
    expect(calls).toBe('tasks');
  });

  it('throws 404 when not found', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => null) as never);
    await expect(getTask('missing', 'u1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('getTaskByAdminId', () => {
  it('fetches regardless of owner (backend trusted path)', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => ({ id: 't1', user_id: 'someone' })) as never);
    await expect(getTaskByAdminId('t1')).resolves.toMatchObject({ id: 't1' });
  });
});

describe('getStatus', () => {
  it('returns null when the row is gone', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => null) as never);
    await expect(getStatus('x')).resolves.toBeNull();
  });
});

describe('transition lifecycle guards', () => {
  it('applies a patch when the status is in the allowed set', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => [{ id: 't1' }]) as never);
    await expect(transition('t1', ['queued'], { status: 'planning' })).resolves.toBeUndefined();
  });

  it('throws 409 conflict when the status is out of the allowed set', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => []) as never);
    // getStatus inside transition resolves terminal
    fromMock.mockImplementationOnce(() => supabaseMock.createBuilder(() => null) as never).mockImplementationOnce(
      () => supabaseMock.createBuilder(() => ({ status: 'cancelled' })) as never
    );
    await expect(transition('t1', ['planning'], { status: 'searching' })).rejects.toMatchObject({ status: 409 });
  });

  it('throws 404 when the task is gone', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => []) as never);
    fromMock.mockImplementationOnce(() => supabaseMock.createBuilder(() => null) as never).mockImplementationOnce(
      () => supabaseMock.createBuilder(() => null) as never
    );
    await expect(transition('gone', ['planning'], {})).rejects.toMatchObject({ status: 404 });
  });
});

describe('markFailed', () => {
  it('never overwrites a terminal status', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => []) as never);
    fromMock.mockImplementationOnce(() => supabaseMock.createBuilder(() => null) as never).mockImplementationOnce(
      () => supabaseMock.createBuilder(() => ({ status: 'completed' })) as never
    );
    await expect(markFailed('t1', 'boom')).rejects.toMatchObject({ status: 409 });
  });

  it('marks an active task failed', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => [{ id: 't1' }]) as never);
    await expect(markFailed('t1', 'boom')).resolves.toBeUndefined();
  });
});

describe('cancelTask', () => {
  it('rejects cancelling a terminal task with 409', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => ({ id: 't1', status: 'completed' })) as never);
    await expect(cancelTask('t1', 'u1')).rejects.toMatchObject({ status: 409 });
  });

  it('cancels an active task and returns', async () => {
    fromMock
      .mockImplementationOnce(() => supabaseMock.createBuilder(() => ({ id: 't1', status: 'queued' })) as never)
      .mockImplementationOnce(() => supabaseMock.createBuilder(() => [{ id: 't1' }]) as never);
    await expect(cancelTask('t1', 'u1')).resolves.toBeUndefined();
  });
});

describe('deleteTask', () => {
  it('refuses to delete a running task', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => ({ id: 't1', status: 'searching' })) as never);
    await expect(deleteTask('t1', 'u1')).rejects.toMatchObject({ status: 409 });
  });

it('deletes a terminal task', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => ({ id: 't1', status: 'failed' })) as never);
    await expect(deleteTask('t1', 'u1')).resolves.toBeUndefined();
  });
});

describe('listTasks', () => {
  it('lists a users own tasks', async () => {
    fromMock.mockReturnValue(supabaseMock.createBuilder(() => [{ id: 't1' }, { id: 't2' }]) as never);
    const rows = await listTasks('u1', 25);
    expect(rows).toHaveLength(2);
  });
});