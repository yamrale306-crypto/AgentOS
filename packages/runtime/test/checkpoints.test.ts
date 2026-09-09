import { describe, expect, it } from 'vitest';
import { createCheckpoint, InMemoryCheckpointStore } from '../src/checkpoints.js';

describe('checkpoints', () => {
  it('serializes a draft into a checkpoint', () => {
    const cp = createCheckpoint(
      {
        runId: 'run-1',
        taskState: { step: 2 },
        agentState: { memory: ['a'] },
        toolHistory: [{ toolId: 'web_search', input: { query: 'x' }, ok: true, at: '2026-01-01T00:00:00Z' }],
        filesChanged: ['src/a.ts']
      },
      () => '2026-01-01T00:00:00.000Z'
    );
    expect(cp.runId).toBe('run-1');
    expect(cp.taskState).toEqual({ step: 2 });
    expect(cp.agentState).toEqual({ memory: ['a'] });
    expect(cp.toolHistory).toHaveLength(1);
    expect(cp.filesChanged).toEqual(['src/a.ts']);
    expect(cp.sequence).toBeGreaterThan(0);
  });

  it('defensively clones draft state', () => {
    const taskState = { mutated: false };
    const cp = createCheckpoint({ runId: 'r', taskState });
    taskState.mutated = true;
    expect(cp.taskState).toEqual({ mutated: false });
  });

  it('InMemoryCheckpointStore saves, loads, lists and finds latest', async () => {
    const store = new InMemoryCheckpointStore();
    const a = createCheckpoint({ runId: 'run-1', taskState: { n: 1 } }, () => '2026-01-01T00:00:00.000Z');
    const b = createCheckpoint({ runId: 'run-1', taskState: { n: 2 } }, () => '2026-01-01T00:00:01.000Z');
    const other = createCheckpoint({ runId: 'run-2', taskState: { n: 9 } }, () => '2026-01-01T00:00:02.000Z');
    await store.save(a);
    await store.save(b);
    await store.save(other);

    expect((await store.load(a.checkpointId))?.taskState).toEqual({ n: 1 });
    expect((await store.latestForRun('run-1'))?.taskState).toEqual({ n: 2 });
    expect((await store.listForRun('run-1')).map((c) => c.taskState)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(await store.load('missing')).toBeNull();
    expect(await store.latestForRun('missing')).toBeNull();
  });
});