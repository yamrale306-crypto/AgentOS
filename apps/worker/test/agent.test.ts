import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@agentos/database', () => ({
  getTaskByAdminId: vi.fn(),
  transition: vi.fn(),
  markFailed: vi.fn(),
  getStatus: vi.fn(),
  incrementSearchUsage: vi.fn(),
  validatePrompt: vi.fn(),
  runtimeStore: {
    createRun: vi.fn(async (input: { taskId: string; userId: string; agentId: string; goal: string; attemptNumber?: number; model?: string | null; provider?: string | null }) => ({
      id: 'run-1',
      task_id: input.taskId,
      user_id: input.userId,
      agent_id: input.agentId,
      state: 'QUEUED',
      attempt_number: input.attemptNumber ?? 1,
      model: input.model ?? null,
      provider: input.provider ?? null,
      goal: input.goal,
      steps: [],
      tool_calls: [],
      errors: [],
      outputs: {},
      checkpoints: [],
      verification: { complete: false, reason: '' },
      usage: {},
      started_at: null,
      paused_at: null,
      completed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    })),
    getRunByTask: vi.fn(async () => null),
    updateRun: vi.fn(async () => {}),
    transitionRun: vi.fn(async () => {}),
    appendStep: vi.fn(async () => 'step-1'),
    recordToolCall: vi.fn(async () => 'call-1'),
    emitEvent: vi.fn(async () => 'evt-1'),
    checkpoints: {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      listForRun: vi.fn(async () => []),
      latestForRun: vi.fn(async () => null)
    }
  }
}));

vi.mock('@agentos/tools', async () => {
  const actual = await vi.importActual<typeof import('@agentos/tools')>('@agentos/tools');
  const { createToolRegistry } = await import('@agentos/runtime');
  const { z } = await import('zod');
  const registry = createToolRegistry();
  const tool = (id: string, category: 'filesystem' | 'terminal' | 'git' | 'http' | 'web' | 'search', permissions: Array<{ action: string; resource: string }>, riskLevel: 'low' | 'medium' | 'high' | 'critical') => {
    registry.register({
      id,
      version: '1.0.0',
      description: id,
      category,
      inputSchema: z.object({ value: z.string().optional() }),
      outputSchema: null,
      permissions,
      riskLevel,
      execute: async () => ({ ok: true, data: { ok: true } })
    });
  };

  tool('filesystem.read', 'filesystem', [{ action: 'read', resource: 'filesystem' }], 'low');
  tool('filesystem.write', 'filesystem', [{ action: 'write', resource: 'filesystem' }], 'medium');
  tool('shell.run', 'terminal', [{ action: 'execute', resource: 'terminal' }], 'medium');
  tool('git.status', 'git', [{ action: 'read', resource: 'git' }], 'low');
  tool('http.request', 'http', [{ action: 'request', resource: 'http' }], 'medium');
  tool('web.fetch', 'web', [{ action: 'fetch', resource: 'web' }], 'low');
  tool('web.search', 'search', [{ action: 'search', resource: 'web' }], 'low');

  return {
    ...actual,
    createDefaultProjectToolRegistry: vi.fn(() => registry),
    webSearch: vi.fn(),
    isProbablyRateLimited: vi.fn(() => false),
    searchProvider: { name: 'mock', search: vi.fn() }
  };
});

vi.mock('@agentos/ai', () => ({
  chatWithFallback: vi.fn(),
  structuredWithFallback: vi.fn()
}));

import { runTask } from '../src/agent/agent.js';
import { workerRegistry } from '../src/agent/tools.js';
import * as taskStore from '@agentos/database';
import * as searchTools from '@agentos/tools';
import * as model from '@agentos/ai';
import { requestCancellation, clearCancellation } from '../src/agent/cancellation.js';
import { DEFAULT_PLAN, DEFAULT_VERIFICATION } from '@agentos/schemas';

const mockedTransition = vi.mocked(taskStore.transition);
const mockedGetTask = vi.mocked(taskStore.getTaskByAdminId);
const mockedMarkFailed = vi.mocked(taskStore.markFailed);
const mockedWebSearch = vi.mocked(searchTools.webSearch);
const mockedChat = vi.mocked(model.chatWithFallback);
const mockedStructured = vi.mocked(model.structuredWithFallback);
const mockedIncrementSearch = vi.mocked(taskStore.incrementSearchUsage);
const mockedGetStatus = vi.mocked(taskStore.getStatus);
const mockedRuntime = vi.mocked(taskStore.runtimeStore);
const mockedCheckpoints = vi.mocked(taskStore.runtimeStore.checkpoints);

const baseTask = {
  id: 'task-1',
  user_id: 'user-1',
  prompt: 'Research the capital of France',
  status: 'queued',
  searches_used: 0,
  sources: []
};

const defaultRunRow = {
  id: 'run-1',
  task_id: 'task-1',
  user_id: 'user-1',
  agent_id: 'researcher',
  state: 'EXECUTING',
  attempt_number: 1,
  model: null,
  provider: null,
  goal: 'Research the capital of France',
  steps: [],
  tool_calls: [],
  errors: [],
  outputs: {},
  checkpoints: [],
  verification: { complete: false, reason: '' },
  usage: {},
  started_at: null,
  paused_at: null,
  completed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

const researchCheckpoint = {
  checkpointId: 'cp-4',
  runId: 'run-1',
  sequence: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  taskState: { taskId: 'task-1' },
  agentState: {},
  contextReference: null,
  toolHistory: [],
  filesChanged: [],
  verificationState: {},
  resumeMetadata: {
    stage: 'research',
    messages: [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Research the capital of France' },
      { role: 'assistant', content: 'Plan: {"goal":"g","steps":["find","synthesize"]}' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"capital of france"}' } }]
      },
      { role: 'tool', tool_call_id: 'call-1', content: JSON.stringify([{ title: 'Paris wiki', url: 'https://en.example/paris', snippet: 'Paris.' }]) }
    ],
    sources: [{ title: 'Paris wiki', url: 'https://en.example/paris', snippet: 'Paris.' }],
    steps: 2,
    searchesUsedTask: 1,
    plan: { goal: 'g', steps: ['find', 'synthesize'] },
    draft: '',
    lastProvider: 'test/primary',
    lastModel: 'test/primary',
    anyFallback: false
  }
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
  mockedRuntime.getRunByTask.mockResolvedValue(null as never);
  mockedCheckpoints.latestForRun.mockResolvedValue(null as never);
});

afterEach(() => {
  clearCancellation('task-1');
});

function completionFromChat(message: { content: string | null; tool_calls: unknown } | null) {
  return { response: { choices: [{ message, finish_reason: message?.tool_calls ? 'tool_calls' : 'stop' }] }, model: 'test/primary' };
}

describe('worker runtime registry integration', () => {
  it('includes the real project-scoped runtime tools in the worker registry', () => {
    expect(workerRegistry.has('web_search')).toBe(true);
    expect(workerRegistry.has('web.search')).toBe(true);
    expect(workerRegistry.has('filesystem.read')).toBe(true);
    expect(workerRegistry.has('filesystem.write')).toBe(true);
    expect(workerRegistry.has('shell.run')).toBe(true);
    expect(workerRegistry.has('git.status')).toBe(true);
    expect(workerRegistry.has('http.request')).toBe(true);
    expect(workerRegistry.has('web.fetch')).toBe(true);
  });
});

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

describe('runTask persistence (runtime store)', () => {
  it('persists the run, steps, tool calls, events and checkpoints on the happy path', async () => {
    mockedChat
      .mockResolvedValueOnce(completionFromChat(toolMessage('call-1', 'capital of france')))
      .mockResolvedValueOnce(completionFromChat(textMessage('Paris [1].')));
    mockedWebSearch.mockResolvedValue([{ title: 'Paris wiki', url: 'https://en.example/paris', snippet: 'Paris.' }]);

    await runTask('task-1');

    expect(mockedRuntime.createRun).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', userId: 'user-1', agentId: 'researcher', goal: 'Research the capital of France' }));

    const eventTypes = mockedRuntime.emitEvent.mock.calls.map(([e]) => e.type);
    expect(eventTypes).toContain('run.created');
    expect(eventTypes).toContain('run.completed');
    expect(eventTypes).toContain('checkpoint.created');

    const runTransitions = mockedRuntime.transitionRun.mock.calls.map(([, from, to]) => `${from}->${to}`);
    expect(runTransitions).toContain('PLANNING->EXECUTING');
    expect(runTransitions).toContain('EXECUTING->VERIFYING');
    expect(runTransitions).toContain('VERIFYING->COMPLETED');

    const savedStages = mockedCheckpoints.save.mock.calls.map(([c]) => c.resumeMetadata.stage);
    expect(savedStages).toContain('research');
    expect(mockedCheckpoints.save).toHaveBeenCalled();

    const approvedSearch = mockedRuntime.recordToolCall.mock.calls.find(([c]) => c.toolId === 'web_search' && c.policyDecision?.outcome === 'approve');
    expect(approvedSearch).toBeDefined();
    expect(mockedRuntime.appendStep).toHaveBeenCalledWith(expect.objectContaining({ stage: 'research.search' }));
  });

  it('does not create a run again for a task that resumed from a checkpoint', async () => {
    mockedChat.mockResolvedValueOnce(completionFromChat(textMessage('Already researched.')));
    mockedRuntime.getRunByTask.mockResolvedValue(defaultRunRow as never);
    mockedCheckpoints.latestForRun.mockResolvedValue(researchCheckpoint as never);

    await runTask('task-1');

    expect(mockedRuntime.createRun).not.toHaveBeenCalled();
    expect(mockedRuntime.transitionRun.mock.calls.some(([, from, to]) => `${from}->${to}` === 'PLANNING->EXECUTING')).toBe(false);
  });
});

describe('runTask crash recovery (checkpoint resume)', () => {
  it('resumes a crashed research run from its checkpoint without re-planning or re-searching', async () => {
    mockedRuntime.getRunByTask.mockResolvedValue(defaultRunRow as never);
    mockedCheckpoints.latestForRun.mockResolvedValue(researchCheckpoint as never);
    mockedChat.mockResolvedValueOnce(completionFromChat(textMessage('Paris confirmed [1].')));
    mockedStructured.mockImplementation((() => Promise.resolve({ value: { complete: true, reason: 'Answered.', missing: '' }, model: 'test/primary', ok: true })) as never);

    await runTask('task-1');

    // structured runs once (verification only) — the plan was restored, not re-generated.
    expect(mockedStructured).toHaveBeenCalledTimes(1);
    // No planning-stage task transitions (fresh runs use ['queued'] and ['planning']).
    const planningTransitions = mockedTransition.mock.calls.filter(([, from]) => Array.isArray(from) && (from as string[]).every((s) => s === 'queued' || s === 'planning'));
    expect(planningTransitions.length).toBe(0);

    // The previous search outcome was checkpointed; no new search happens.
    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedIncrementSearch).not.toHaveBeenCalled();

    // The resumed thread includes the checkpointed tool reply before our new draft.
    const firstChatArg = mockedChat.mock.calls[0][0];
    expect(JSON.stringify(firstChatArg)).toContain('https://en.example/paris');

    // Completed with the restored source list and search count.
    const finalPatch = mockedTransition.mock.calls.map(([, , patch]) => patch).find((p) => p.status === 'completed');
    expect(finalPatch.sources).toHaveLength(1);
    expect(String(finalPatch.searches_used)).toBe('1');
    expect(finalPatch.result).toContain('Paris confirmed');
  });

  it('resumes a crash during verification, skipping research and synthesis entirely', async () => {
    mockedRuntime.getRunByTask.mockResolvedValue(defaultRunRow as never);
    mockedCheckpoints.latestForRun.mockResolvedValue({
      ...researchCheckpoint,
      resumeMetadata: { ...researchCheckpoint.resumeMetadata, stage: 'verifying', draft: 'Paris is the capital.' }
    } as never);
    mockedStructured.mockImplementation((() => Promise.resolve({ value: { complete: true, reason: 'Answered.', missing: '' }, model: 'test/primary', ok: true })) as never);

    await runTask('task-1');

    expect(mockedChat).not.toHaveBeenCalled();
    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(mockedStructured).toHaveBeenCalledTimes(1);

    const finalPatch = mockedTransition.mock.calls.map(([, , patch]) => patch).find((p) => p.status === 'completed');
    expect(String(finalPatch.result)).toContain('Paris is the capital.');
    expect(String(finalPatch.searches_used)).toBe('1');
  });
});