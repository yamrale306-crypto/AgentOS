import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestCancellation, clearCancellation, isCancelledLocally, assertRunning, CancelledTaskError } from '../src/agent/cancellation.js';

vi.mock('@agentos/database', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getStatus: vi.fn() };
});

import { getStatus } from '@agentos/database';

const mockedGetStatus = vi.mocked(getStatus);

beforeEach(() => {
  clearCancellation('task-1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('cancellation registry', () => {
  it('starts empty and can be requested and cleared', () => {
    expect(isCancelledLocally('task-1')).toBe(false);
    requestCancellation('task-1');
    expect(isCancelledLocally('task-1')).toBe(true);
    clearCancellation('task-1');
    expect(isCancelledLocally('task-1')).toBe(false);
  });
});

describe('assertRunning', () => {
  it('passes while the task is active and not locally cancelled', async () => {
    mockedGetStatus.mockResolvedValue('searching');
    await expect(assertRunning('task-1')).resolves.toBeUndefined();
  });

  it('throws when the task is locally cancelled (no extra DB read needed)', async () => {
    requestCancellation('task-1');
    await expect(assertRunning('task-1')).rejects.toBeInstanceOf(CancelledTaskError);
    expect(mockedGetStatus).not.toHaveBeenCalled();
  });

  it('throws when the database reports a terminal status', async () => {
    mockedGetStatus.mockResolvedValue('completed');
    await expect(assertRunning('task-1')).rejects.toBeInstanceOf(CancelledTaskError);
  });

  it('throws when the task row no longer exists', async () => {
    mockedGetStatus.mockResolvedValue(null);
    await expect(assertRunning('task-1')).rejects.toBeInstanceOf(CancelledTaskError);
  });
});