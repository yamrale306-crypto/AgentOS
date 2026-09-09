import type { Checkpoint, CheckpointDraft, CheckpointStore } from '@agentos/schemas';

export type { CheckpointStore };

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.store.set(checkpoint.checkpointId, checkpoint);
  }

  async load(checkpointId: string): Promise<Checkpoint | null> {
    return this.store.get(checkpointId) ?? null;
  }

  async listForRun(runId: string): Promise<Checkpoint[]> {
    return Array.from(this.store.values())
      .filter((c) => c.runId === runId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async latestForRun(runId: string): Promise<Checkpoint | null> {
    const all = await this.listForRun(runId);
    return all.length > 0 ? all[all.length - 1] : null;
  }
}

let seqCounter = 0;

/**
 * Serialize an execution step into a `Checkpoint`. Copies task/agent state and
 * tags it with tool history and files changed so a crashed run can resume.
 */
export function createCheckpoint(draft: CheckpointDraft, now: () => string = () => new Date().toISOString()): Checkpoint {
  seqCounter += 1;
  return {
    checkpointId: `cp_${now().replace(/[^0-9]/g, '').slice(0, -4)}_${seqCounter.toString(36)}`,
    runId: draft.runId,
    sequence: seqCounter,
    createdAt: now(),
    taskState: structuredClone(draft.taskState),
    agentState: draft.agentState ? structuredClone(draft.agentState) : {},
    contextReference: draft.contextReference ? structuredClone(draft.contextReference) : null,
    toolHistory: draft.toolHistory ? structuredClone(draft.toolHistory) : [],
    filesChanged: draft.filesChanged ? structuredClone(draft.filesChanged) : [],
    verificationState: draft.verificationState ? structuredClone(draft.verificationState) : {},
    resumeMetadata: draft.resumeMetadata ? structuredClone(draft.resumeMetadata) : {}
  };
}