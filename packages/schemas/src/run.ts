/**
 * Run state machine — the single source of truth for run lifecycle.
 *
 * A Run is one attempt to execute a Task. Its state machine is intentionally
 * separate from `TaskStatus` (the worker progress labels on the legacy `tasks`
 * table). Run transitions are deterministic and validated by
 * `canTransitionRun`/`assertTransitionRun`.
 */

export const RUN_STATES = [
  'QUEUED',
  'PLANNING',
  'EXECUTING',
  'VERIFYING',
  'PAUSED',
  'FAILED',
  'COMPLETED',
  'CANCELLED'
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const ACTIVE_RUN_STATES: RunState[] = ['QUEUED', 'PLANNING', 'EXECUTING', 'VERIFYING', 'PAUSED'];

export const TERMINAL_RUN_STATES: RunState[] = ['FAILED', 'COMPLETED', 'CANCELLED'];

/**
 * Explicit transition table. Anything not listed here is rejected.
 * A transition to a terminal state always exists; terminal states have no
 * outgoing edges (retries are new Runs, not state changes).
 */
export const RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  QUEUED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['EXECUTING', 'PAUSED', 'FAILED', 'CANCELLED'],
  EXECUTING: ['VERIFYING', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'],
  VERIFYING: ['EXECUTING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED'],
  PAUSED: ['PLANNING', 'EXECUTING', 'FAILED', 'CANCELLED'],
  FAILED: [],
  COMPLETED: [],
  CANCELLED: []
};

export function isRunState(value: unknown): value is RunState {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value);
}

export function isActiveRunState(state: RunState): boolean {
  return (ACTIVE_RUN_STATES as RunState[]).includes(state);
}

export function isTerminalRunState(state: RunState): boolean {
  return (TERMINAL_RUN_STATES as RunState[]).includes(state);
}

export function canTransitionRun(from: RunState, to: RunState): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertTransitionRun(from: RunState, to: RunState): void {
  if (!canTransitionRun(from, to)) {
    throw new Error(`Invalid run state transition: ${from} -> ${to}.`);
  }
}

/** A run row as persisted by the control plane. */
export interface RunRecord {
  id: string;
  task_id: string;
  user_id: string;
  agent_id: string;
  state: RunState;
  attempt_number: number;
  model: string | null;
  provider: string | null;
  goal: string;
  steps: Array<{ label: string; status: string }>;
  tool_calls: unknown[];
  errors: string[];
  outputs: Record<string, unknown>;
  checkpoints: string[];
  verification: { complete: boolean; reason: string; missing?: string | null };
  usage: Record<string, number>;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunStepRecord {
  id: string;
  run_id: string;
  sequence: number;
  stage: string;
  input: unknown;
  output: unknown;
  model: string | null;
  error: string | null;
  created_at: string;
}

export interface ToolCallRecord {
  id: string;
  run_id: string;
  step_id: string | null;
  tool_id: string;
  input: unknown;
  output: unknown;
  risk_level: string;
  policy_decision: Record<string, unknown>;
  approval_id: string | null;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
}