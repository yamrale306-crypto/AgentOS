/**
 * Checkpoint model. A checkpoint captures enough state to safely continue a
 * run after a worker crash or recoverable failure — it must never require a
 * full restart of the task.
 */

export interface ToolCallRef {
  toolId: string;
  input: unknown;
  output?: unknown;
  ok: boolean;
  at: string;
}

export interface Checkpoint {
  checkpointId: string;
  runId: string;
  sequence: number;
  createdAt: string;
  taskState: Record<string, unknown>;
  agentState: Record<string, unknown>;
  /** Reference to external context (e.g. project index), not the content. */
  contextReference: Record<string, unknown> | null;
  toolHistory: ToolCallRef[];
  filesChanged: string[];
  verificationState: Record<string, unknown>;
  resumeMetadata: Record<string, unknown>;
}

export interface CheckpointDraft {
  runId: string;
  taskState: Record<string, unknown>;
  agentState?: Record<string, unknown>;
  contextReference?: Record<string, unknown> | null;
  toolHistory?: ToolCallRef[];
  filesChanged?: string[];
  verificationState?: Record<string, unknown>;
  resumeMetadata?: Record<string, unknown>;
}

/** Serializable store for checkpoints. Persistence is pluggable. */
export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  load(checkpointId: string): Promise<Checkpoint | null>;
  listForRun(runId: string): Promise<Checkpoint[]>;
  latestForRun(runId: string): Promise<Checkpoint | null>;
}