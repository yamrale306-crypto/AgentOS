import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/client.js', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }));

import { supabaseAdmin } from '../src/client.js';
import { RuntimeStore } from '../src/run-store.js';
import { conflict, notFound } from '../src/errors.js';

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

function enqueueFrom(...responses: (BuilderResponse | null)[]) {
  fromQueue.push(...responses.map((r) => builder(r ?? { data: null, error: null })));
}

beforeEach(() => {
  vi.clearAllMocks();
  fromQueue = [];
  mockedFrom.mockImplementation(() => fromQueue.shift() ?? builder({ data: null, error: null }));
  mockedRpc.mockImplementation(() => builder({ data: null, error: null }));
});

const runRow = {
  id: 'run-1',
  task_id: 'task-1',
  user_id: 'user-1',
  agent_id: 'researcher',
  state: 'QUEUED',
  attempt_number: 1,
  model: null,
  provider: null,
  goal: 'Research the sun.',
  verification: { complete: false, reason: '', missing: '' },
  usage: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
};

describe('RuntimeStore.createRun', () => {
  it('inserts a run and returns the mapped record', async () => {
    enqueueFrom({ data: runRow });
    const store = new RuntimeStore();
    const run = await store.createRun({ taskId: 'task-1', userId: 'user-1', agentId: 'researcher', goal: 'Research the sun.' });
    expect(run).toMatchObject({ id: 'run-1', state: 'QUEUED', task_id: 'task-1', agent_id: 'researcher' });
    expect(mockedFrom).toHaveBeenCalledWith('runs');
  });

  it('throws the database error verbatim', async () => {
    enqueueFrom({ data: null, error: { message: 'runs insert failed' } });
    const store = new RuntimeStore();
    await expect(store.createRun({ taskId: 't', userId: 'u', agentId: 'a', goal: 'g' })).rejects.toMatchObject({ message: 'runs insert failed' });
  });
});

describe('RuntimeStore.getRun / getRunByTask', () => {
  it('returns a run by id', async () => {
    enqueueFrom({ data: runRow });
    const store = new RuntimeStore();
    expect(await store.getRun('run-1')).toMatchObject({ id: 'run-1', agent_id: 'researcher' });
  });

  it('throws notFound when missing', async () => {
    enqueueFrom({ data: null });
    const store = new RuntimeStore();
    await expect(store.getRun('run-x')).rejects.toMatchObject(notFound('Run not found.'));
  });

  it('returns the latest run for a task, or null', async () => {
    enqueueFrom({ data: runRow });
    const store = new RuntimeStore();
    expect(await store.getRunByTask('task-1')).toMatchObject({ task_id: 'task-1' });
    enqueueFrom({ data: null });
    expect(await store.getRunByTask('missing')).toBeNull();
  });
});

describe('RuntimeStore.transitionRun', () => {
  it('applies a valid transition', async () => {
    enqueueFrom({ data: [{ id: 'run-1' }] });
    const store = new RuntimeStore();
    await expect(store.transitionRun('run-1', 'QUEUED', 'PLANNING')).resolves.toBeUndefined();
  });

  it('rejects an invalid edge before hitting the database', async () => {
    const store = new RuntimeStore();
    await expect(store.transitionRun('run-1', 'EXECUTING', 'PLANNING')).rejects.toMatchObject(conflict('Invalid run state transition: EXECUTING -> PLANNING.'));
    expect(mockedFrom).not.toHaveBeenCalled();
  });

  it('reports a conflict when the database guards the change', async () => {
    enqueueFrom({ data: [] });
    enqueueFrom({ data: { ...runRow, state: 'COMPLETED' } });
    const store = new RuntimeStore();
    await expect(store.transitionRun('run-1', 'QUEUED', 'PLANNING')).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });
});

describe('RuntimeStore append/record', () => {
  it('appends a run step and returns its id', async () => {
    enqueueFrom({ data: { id: 'step-1' } });
    const store = new RuntimeStore();
    const id = await store.appendStep({ runId: 'run-1', sequence: 1, stage: 'planning', input: { goal: 'g' } });
    expect(id).toBe('step-1');
    expect(mockedFrom).toHaveBeenCalledWith('run_steps');
  });

  it('records a tool call with policy decision', async () => {
    enqueueFrom({ data: { id: 'call-1' } });
    const store = new RuntimeStore();
    const id = await store.recordToolCall({ runId: 'run-1', toolId: 'web_search', input: { query: 'x' }, policyDecision: { outcome: 'approve' } });
    expect(id).toBe('call-1');
    expect(mockedFrom).toHaveBeenCalledWith('tool_calls');
  });
});

describe('RuntimeStore.checkpoints (CheckpointStore impl)', () => {
  it('saves a checkpoint and loads it back, normalized', async () => {
    enqueueFrom({ data: null });
    enqueueFrom({
      data: {
        id: 'cp-1',
        run_id: 'run-1',
        sequence: 1,
        task_state: { step: 2 },
        agent_state: {},
        context_reference: null,
        tool_history: [],
        files_changed: [],
        verification_state: {},
        resume_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z'
      }
    });
    const store = new RuntimeStore();
    await store.checkpoints.save({
      checkpointId: 'cp-1',
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      taskState: { step: 2 },
      agentState: {},
      contextReference: null,
      toolHistory: [],
      filesChanged: [],
      verificationState: {},
      resumeMetadata: {}
    });
    const loaded = await store.checkpoints.load('cp-1');
    expect(loaded).toMatchObject({ checkpointId: 'cp-1', runId: 'run-1', taskState: { step: 2 } });
  });

  it('returns the latest checkpoint for a run', async () => {
    enqueueFrom({ data: { id: 'cp-9', run_id: 'run-1', sequence: 9, task_state: {}, created_at: '2026-01-01T00:00:00.000Z' } });
    const store = new RuntimeStore();
    const latest = await store.checkpoints.latestForRun('run-1');
    expect(latest).toMatchObject({ checkpointId: 'cp-9', sequence: 9 });
  });

  it('returns null when a checkpoint is absent', async () => {
    enqueueFrom({ data: null });
    const store = new RuntimeStore();
    expect(await store.checkpoints.load('missing')).toBeNull();
  });
});

describe('RuntimeStore approvals + events + projects', () => {
  it('creates an approval and decides it', async () => {
    enqueueFrom({ data: { id: 'appr-1', run_id: 'run-1', task_id: 'task-1', user_id: 'user-1', tool_id: 'write_file', risk_level: 'high', reason: 'r', requested_by: 'agent', expires_at: '2026-01-02T00:00:00.000Z', state: 'requested', created_at: '2026-01-01T00:00:00.000Z' } });
    enqueueFrom({ data: [{ id: 'appr-1' }] });
    const store = new RuntimeStore();
    const approval = await store.createApproval({
      runId: 'run-1',
      taskId: 'task-1',
      userId: 'user-1',
      toolId: 'write_file',
      riskLevel: 'high',
      reason: 'r',
      requestedBy: 'agent',
      expiresAt: '2026-01-02T00:00:00.000Z'
    });
    expect(approval).toMatchObject({ id: 'appr-1', state: 'requested', riskLevel: 'high' });
    expect(await store.decideApproval('appr-1', 'approved', 'admin')).toBe(true);
  });

  it('emits an agent event', async () => {
    enqueueFrom({ data: { id: 'evt-1' } });
    const store = new RuntimeStore();
    const id = await store.emitEvent({ type: 'run.started', userId: 'user-1', taskId: 'task-1', runId: 'run-1', payload: { state: 'PLANNING' } });
    expect(id).toBe('evt-1');
    expect(mockedFrom).toHaveBeenCalledWith('agent_events');
  });

  it('upserts a project intelligence record', async () => {
    enqueueFrom({ data: { id: 'proj-1', user_id: 'user-1', name: 'AgentOS' } });
    const store = new RuntimeStore();
    const project = await store.upsertProject({ userId: 'user-1', name: 'AgentOS', status: 'indexed', intelligence: { languages: ['TypeScript'] } });
    expect(project).toMatchObject({ id: 'proj-1', name: 'AgentOS' });
  });
});