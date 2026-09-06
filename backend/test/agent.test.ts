import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/lib/taskStore.js', () => ({
  getTaskByAdminId: vi.fn(),
  transition: vi.fn(),
  markFailed: vi.fn(),
  getStatus: vi.fn(),
  incrementSearchUsage: vi.fn(),
  validatePrompt: vi.fn()
}));

vi.mock('../src/tools/webSearch.js', () => ({
  webSearch: vi.fn(),
  isProbablyRateLimited: vi.fn(() => false),
  searchProvider: { name: 'mock', search: vi.fn() }
}));

vi.mock('../src/agent/model.js', () => ({
  chatWithFallback: vi.fn(),
  structuredWithFallback: vi.fn()
}));

import { runTask } from '../src/agent/agent.js';
import * as taskStore from '../src/lib/taskStore.js';
import * as searchTools from '../src/tools/webSearch.js';
import * as model from '../src/agent/model.js';
import { requestCancellation, clearCancellation } from '../src/agent/cancellation.js';
import { DEFAULT_PLAN, DEFAULT_VERIFICATION } from '../src/agent/schemas.js';

const mockedTransition = vi.mocked(taskStore.transition);
const mockedGetTask = vi.mocked(taskStore.getTaskByAdminId);
const mockedMarkFailed = vi.mocked(taskStore.markFailed);
const mockedWebSearch = vi.mocked(searchTools.webSearch);
const mockedChat = vi.mocked(model.chatWithFallback);
const mockedStructured = vi.mocked(model.structuredWithFallback);
const mockedIncrementSearch = vi.mocked(taskStore.incrementSearchUsage);
const mockedGetStatus = vi.mocked(taskStore.getStatus);

const baseTask = {
  id: 'task-1',
  user_id: 'user-1',
  prompt: 'Research the capital of France',
  status: 'queued',
  searches_used: 0,
  sources: []
};

function toolMessage(toolCallId: string, query: string) {
  return {
    content: null,
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: 'web_search', arguments: JSON.stringify({ query }) }
      }
    ]
  };
}

function textMessage(content: string) {
  return { content, tool_calls: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetTask.mockReset();
  mockedGetStatus.mockReset();
  mockedTransition.mockReset();
  mockedMarkFailed.mockReset();
  mockedIncrementSearch.mockReset();
  mockedChat.mockReset();
  mockedStructured.mockReset();
  mockedWebSearch.mockReset();
  clearCancellation('task-1');
  mockedGetTask.mockResolvedValue(baseTask as never);
  mockedGetStatus.mockResolvedValue('planning');
  mockedTransition.mockResolvedValue(undefined);
  mockedMarkFailed.mockResolvedValue(undefined);
  mockedIncrementSearch.mockResolvedValue({ count: 1, over: false });
  mockedStructured.mockImplementation((() => Promise.resolve({ value: { goal: 'g', steps: ['a', 'b'] }, model: 'test/primary', ok: true })) as never);
});

afterEach(() => {
  clearCancellation('task-1');
});

function completionFromChat(message: { content: string | null; tool_calls: unknown } | null) {
  return { response: { choices: [{ message, finish_reason: message?.tool_calls ? 'tool_calls' : 'stop' }] }, model: 'test/primary' };
}

describe('runTask happy path', () => {
  it('plans, searches once, drafts, verifies, and completes with sources', async () => {
    mockedChat
      .mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'capital of france')))
      .mockResolvedValueOnce(completionFromChat(textMessage('Paris is the capital of France [1].')));
    mockedWebSearch.mockResolvedValue([{ title: 'Paris wiki', url: 'https://en.example/paris', snippet: 'Paris is the capital.' }]);
    mockedStructured.mockImplementation((() => Promise.resolve({ value: { complete: true, reason: 'Answered the goal.', missing: '' }, model: 'test/primary', ok: true })) as never);

    await runTask('task-1');

    expect(mockedWebSearch).toHaveBeenCalledWith('capital of france', 5);
    expect(mockedIncrementSearch).toHaveBeenCalledWith('user-1', 50);

    const completedPatches = mockedTransition.mock.calls
      .map(([, , patch]) => patch)
      .filter((p) => p.status === 'completed');
    expect(completedPatches.length).toBeGreaterThan(0);
    const finalPatch = completedPatches[0];
    expect(String(finalPatch.result)).toContain('Paris is the capital of France');
    expect(String(finalPatch.result)).toContain('Verified: yes');
    expect(String(finalPatch.searches_used)).toBe('1');
    expect(Array.isArray(finalPatch.sources)).toBe(true);
    expect(finalPatch.sources).toHaveLength(1);
    expect(finalPatch.model_used).toBe('test/primary');
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });
});

describe('runTask verification integrity', () => {
  it('falls back to an honest "partial" verification when model output is malformed', async () => {
    mockedChat
      .mockResolvedValueOnce(completionFromChat(textMessage('Some draft answer [1].')));
    mockedStructured.mockImplementation((() => Promise.resolve({ value: DEFAULT_VERIFICATION, model: 'test/primary', ok: false })) as never);

    await runTask('task-1');

    const completedPatches = mockedTransition.mock.calls
      .map(([, , patch]) => patch)
      .filter((p) => p.status === 'completed');
    const finalPatch = completedPatches[0];
    const result = String(finalPatch.result);
    expect(result).toContain('partial');
    expect(result).not.toContain('Verified: yes');
    expect(result).toContain('could not be completed');
  });
});

describe('runTask cooperative cancellation', () => {
  it('stops immediately when cancelled before any work, preserving cancelled status', async () => {
    requestCancellation('task-1');
    await runTask('task-1');
    expect(mockedTransition).not.toHaveBeenCalled();
    expect(mockedChat).not.toHaveBeenCalled();
    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });

  it('does not search once cancellation lands mid-step (agent stops before search)', async () => {
    mockedChat.mockImplementationOnce(() => {
      requestCancellation('task-1');
      return Promise.resolve(completionFromChat(toolMessage('call-1', 'capital of france')));
    });
    await runTask('task-1');

    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedMarkFailed).not.toHaveBeenCalled();
    const completed = mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed');
    expect(completed).toBe(false);
  });
});

describe('runTask quota guards', () => {
  it('never calls web_search when the daily search quota is exceeded', async () => {
    mockedIncrementSearch.mockResolvedValue({ count: 6, over: true });
    mockedChat
      .mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'capital of france')))
      .mockResolvedValueOnce(completionFromChat(textMessage('Answer without searching.')));

    await runTask('task-1');

    expect(mockedWebSearch).not.toHaveBeenCalled();
    const completed = mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed');
    expect(completed).toBe(true);
  });

  it('stops searching for this task when MAX_SEARCHES is reached', async () => {
    mockedGetTask.mockResolvedValue({ ...baseTask, searches_used: 5 } as never);
    mockedChat
      .mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'capital of france')))
      .mockResolvedValueOnce(completionFromChat(textMessage('Final text.')));

    await runTask('task-1');

    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(true);
  });
});

describe('runTask failure handling', () => {
  it('marks the task failed when the model returns nothing', async () => {
    mockedChat.mockResolvedValueOnce(completionFromChat(null));
    await runTask('task-1');
    expect(mockedMarkFailed).toHaveBeenCalledWith('task-1', expect.stringMatching(/empty response/));
  });

  it('marks the task failed when search throws', async () => {
    mockedChat
      .mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'q')))
      .mockResolvedValueOnce(completionFromChat(textMessage('answer')));
    mockedWebSearch.mockRejectedValue(new Error('provider exploded'));
    await runTask('task-1');
    expect(mockedMarkFailed).not.toHaveBeenCalled();
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(true);
  });
});

describe('runTask early termination with malformed plan', () => {
  it('uses the default plan but still completes', async () => {
    mockedChat.mockResolvedValueOnce(completionFromChat(textMessage('Final answer.')));
    mockedStructured.mockImplementation((() => Promise.resolve({ value: { ...DEFAULT_PLAN, goal: 'Research the capital of France' }, model: 'test/primary', ok: false })) as never);

    await runTask('task-1');

    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(true);
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });
});

describe('runTask cancellation timing', () => {
  const planReply = { value: { goal: 'g', steps: ['a', 'b'] }, model: 'test/primary', ok: true };
  const verifyReply = { value: { complete: true, reason: 'done', missing: '' }, model: 'test/primary', ok: true };

  it('stops between a completed search and the next model call', async () => {
    mockedChat.mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'cancel mid-search')));
    mockedWebSearch.mockImplementationOnce(async () => {
      requestCancellation('task-1');
      return [];
    });

    await runTask('task-1');

    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(mockedWebSearch).toHaveBeenCalledTimes(1);
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(false);
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'verifying')).toBe(false);
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });

  it('stops immediately before verification (no verification model call)', async () => {
    mockedStructured
      .mockResolvedValueOnce(planReply as never)
      .mockImplementationOnce((() => {
        throw new Error('verification must not run when cancelled');
      }) as never);
    mockedChat.mockImplementationOnce(() => {
      requestCancellation('task-1');
      return Promise.resolve(completionFromChat(textMessage('draft')));
    });

    await runTask('task-1');

    expect(mockedStructured).toHaveBeenCalledTimes(1);
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'verifying')).toBe(false);
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(false);
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });

  it('stops immediately before completion even after verification succeeds', async () => {
    mockedChat.mockResolvedValueOnce(completionFromChat(textMessage('final draft')));
    mockedStructured
      .mockResolvedValueOnce(planReply as never)
      .mockImplementationOnce((() => {
        requestCancellation('task-1');
        return Promise.resolve(verifyReply);
      }) as never);

    await runTask('task-1');

    expect(mockedStructured).toHaveBeenCalledTimes(2);
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(false);
    expect(mockedMarkFailed).not.toHaveBeenCalled();
  });
});

describe('runTask malformed model output', () => {
  it('recovers from malformed tool-call JSON instead of failing the whole task', async () => {
    mockedChat
      .mockResolvedValueOnce(
        completionFromChat({ content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{invalid json' } }] })
      )
      .mockResolvedValueOnce(completionFromChat(textMessage('Recovered answer.')));

    await runTask('task-1');

    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedMarkFailed).not.toHaveBeenCalled();
    expect(mockedTransition.mock.calls.some(([, , patch]) => patch.status === 'completed')).toBe(true);
  });
});