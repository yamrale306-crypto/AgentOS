import { runtimeStore } from '@agentos/database';
import { canTransitionRun, isActiveRunState, type RunRecord, type RunState } from '@agentos/schemas';
import type { Checkpoint } from '@agentos/schemas';
import { logger } from '@agentos/config';

type JsonRecord = Record<string, unknown>;

export type RunStage = 'planning' | 'research' | 'synthesis' | 'verifying';

export interface RunSessionState {
  stage: RunStage;
  /** Serialized OpenAI message array — plain JSON, safe to checkpoint. */
  messages: unknown[];
  sources: Array<{ title: string; url: string; snippet: string }>;
  steps: number;
  searchesUsedTask: number;
  plan: JsonRecord | null;
  draft: string;
  lastProvider: string;
  lastModel: string;
  anyFallback: boolean;
}

const EMPTY_STATE: RunSessionState = {
  stage: 'planning',
  messages: [],
  sources: [],
  steps: 1,
  searchesUsedTask: 0,
  plan: null,
  draft: '',
  lastProvider: '',
  lastModel: '',
  anyFallback: false
};

/**
 * Durable execution session for one run of a task. Wraps the runtime store
 * (migration 004 tables) and hands the worker a checkpoint-based contract:
 *
 *   begin → plan/research/verify → finish | fail | cancel
 *
 * On a worker crash the task's lease expires and the queue requeues it. When
 * the worker picks it up again, `open()` detects the existing non-terminal run
 * and resumes from the latest checkpoint instead of starting over.
 */
export class RunSession {
  private seq = 0;

  private constructor(
    readonly run: RunRecord,
    readonly taskId: string,
    readonly userId: string,
    readonly agentId: string,
    readonly workerId: string | undefined,
    readonly resumed: boolean,
    readonly state: RunSessionState
  ) {}

  get runId(): string {
    return String(this.run.id);
  }

  get currentRunState(): RunState {
    return String(this.run.state) as RunState;
  }

  /** Fresh session for a task that has no recoverable run. */
  static async begin(input: {
    task: JsonRecord;
    taskId: string;
    userId: string;
    agentId: string;
    workerId?: string;
    model?: string | null;
    provider?: string | null;
  }): Promise<RunSession> {
    const run = await runtimeStore.createRun({
      taskId: input.taskId,
      userId: input.userId,
      agentId: input.agentId,
      goal: String(input.task.goal ?? input.task.prompt ?? ''),
      attemptNumber: Number(input.task.attempt_count ?? 1),
      model: input.model ?? null,
      provider: input.provider ?? null
    });
    await runtimeStore.emitEvent({ type: 'run.created', userId: input.userId, taskId: input.taskId, runId: String(run.id), actor: input.workerId, payload: { state: 'QUEUED', agentId: input.agentId } });
    return new RunSession(run, input.taskId, input.userId, input.agentId, input.workerId, false, { ...EMPTY_STATE });
  }

  /**
   * Open an execution session for a task, resuming from the latest checkpoint
   * when a previous run already made progress. Fresh tasks start clean.
   */
  static async open(task: JsonRecord, workerId?: string): Promise<RunSession> {
    const taskId = String(task.id);
    const userId = String(task.user_id);
    const agentId = 'researcher';

    const existing = await runtimeStore.getRunByTask(taskId);
    if (existing && isActiveRunState(existing.state)) {
      const latest = await runtimeStore.checkpoints.latestForRun(existing.id);
      if (latest) {
        const metadata = (latest.resumeMetadata ?? {}) as JsonRecord;
        const state: RunSessionState = {
          stage: (metadata.stage as RunStage) ?? 'research',
          messages: Array.isArray(metadata.messages) ? (metadata.messages as unknown[]) : [],
          sources: Array.isArray(metadata.sources) ? (metadata.sources as Array<{ title: string; url: string; snippet: string }>) : [],
          steps: Number(metadata.steps ?? 1),
          searchesUsedTask: Number(metadata.searchesUsedTask ?? 0),
          plan: (metadata.plan as JsonRecord | null) ?? null,
          draft: String(metadata.draft ?? ''),
          lastProvider: String(metadata.lastProvider ?? ''),
          lastModel: String(metadata.lastModel ?? ''),
          anyFallback: Boolean(metadata.anyFallback)
        };
        const run = { ...existing, state: existing.state };
        if (run.state === 'PAUSED') {
          await runtimeStore.transitionRun(existing.id, 'PAUSED', 'EXECUTING');
          run.state = 'EXECUTING';
        } else if (run.state === 'QUEUED') {
          await runtimeStore.transitionRun(existing.id, 'QUEUED', 'EXECUTING');
          run.state = 'EXECUTING';
        }
        await runtimeStore.emitEvent({ type: 'run.resumed', userId, taskId, runId: existing.id, actor: workerId, payload: { state: run.state, fromCheckpoint: latest.checkpointId } });
        logger.info('run_resumed', { task_id: taskId, run_id: existing.id, checkpoint_sequence: latest.sequence, stage: state.stage });
        return new RunSession(run, taskId, userId, agentId, workerId, true, state);
      }
    }

    const session = await RunSession.begin({ task, taskId, userId, agentId, workerId });
    logger.info('run_started_fresh', { task_id: taskId, run_id: session.runId });
    return session;
  }

  /** Transition the run row through the shared state machine. Self-loops are no-ops. */
  async transition(to: RunState): Promise<void> {
    const from = this.currentRunState;
    if (from === to) return;
    await runtimeStore.transitionRun(this.runId, from, to);
    this.run.state = to;
  }

  async appendStep(stage: string, input?: unknown, output?: unknown, model?: string | null): Promise<string> {
    const stepId = await runtimeStore.appendStep({ runId: this.runId, sequence: ++this.seq, stage, input, output, model });
    return stepId;
  }

  async recordToolCall(call: {
    toolId: string;
    stepId?: string | null;
    input?: unknown;
    output?: unknown;
    riskLevel?: string;
    policyDecision?: unknown;
    error?: string | null;
    latencyMs?: number | null;
  }): Promise<string> {
    return runtimeStore.recordToolCall({ runId: this.runId, ...call });
  }

  async emit(type: string, payload?: unknown): Promise<string> {
    return runtimeStore.emitEvent({ type, userId: this.userId, taskId: this.taskId, runId: this.runId, actor: this.workerId, payload });
  }

  /** Persist a checkpoint capturing the current runnable state. */
  async checkpoint(): Promise<Checkpoint> {
    const sequence = sequenceFor(this.runId);
    const checkpoint: Checkpoint = {
      checkpointId: `cp_${this.runId}_${sequence}`,
      runId: this.runId,
      sequence,
      createdAt: new Date().toISOString(),
      taskState: { taskId: this.taskId },
      agentState: { agentId: this.agentId, userId: this.userId, workerId: this.workerId ?? null },
      contextReference: null,
      toolHistory: [],
      filesChanged: [],
      verificationState: {},
      resumeMetadata: {
        stage: this.state.stage,
        messages: this.state.messages,
        sources: this.state.sources,
        steps: this.state.steps,
        searchesUsedTask: this.state.searchesUsedTask,
        plan: this.state.plan,
        draft: this.state.draft,
        lastProvider: this.state.lastProvider,
        lastModel: this.state.lastModel,
        anyFallback: this.state.anyFallback
      }
    };
    await runtimeStore.checkpoints.save(checkpoint);
    await runtimeStore.emitEvent({ type: 'checkpoint.created', userId: this.userId, taskId: this.taskId, runId: this.runId, payload: { sequence } });
    return checkpoint;
  }

  async finish(payload: JsonRecord): Promise<void> {
    await this.transition('COMPLETED');
    await this.emit('run.completed', payload);
  }

  async fail(error: string): Promise<void> {
    const from = this.currentRunState;
    if (isActiveRunState(from) && canTransitionRun(from, 'FAILED')) {
      await runtimeStore.transitionRun(this.runId, from, 'FAILED');
      this.run.state = 'FAILED';
    }
    await runtimeStore.updateRun(this.runId, { error: error.slice(0, 2000) });
    await this.emit('run.failed', { error: error.slice(0, 2000) });
  }

  async cancel(): Promise<void> {
    const from = this.currentRunState;
    if (isActiveRunState(from) && canTransitionRun(from, 'CANCELLED')) {
      await runtimeStore.transitionRun(this.runId, from, 'CANCELLED');
      this.run.state = 'CANCELLED';
    }
    await this.emit('run.cancelled', {});
  }
}

function sequenceFor(runId: string): number {
  // keep a module-scoped per-run counter; exact values are informational and
  // the DB unique (run_id, sequence) constraint would catch collisions.
  const current = counters.get(runId) ?? 0;
  const next = current + 1;
  counters.set(runId, next);
  return next;
}

const counters = new Map<string, number>();