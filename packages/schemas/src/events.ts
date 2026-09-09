/**
 * Event model. Events describe what happened; commands request state changes.
 * Persisting events gives us realtime UI updates, notifications, audit trails
 * and (later) analytics without leaking control-plane internals.
 */

export const AGENT_EVENT_TYPES = [
  'task.created',
  'task.started',
  'task.completed',
  'task.failed',

  'run.created',
  'run.started',
  'run.paused',
  'run.resumed',
  'run.failed',
  'run.completed',
  'run.cancelled',

  'tool.started',
  'tool.completed',
  'tool.failed',

  'approval.requested',
  'approval.approved',
  'approval.rejected',
  'approval.expired',

  'checkpoint.created',

  'verification.started',
  'verification.passed',
  'verification.failed'
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

export function isAgentEventType(value: unknown): value is AgentEventType {
  return typeof value === 'string' && (AGENT_EVENT_TYPES as readonly string[]).includes(value);
}

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  ts: string;
  userId: string | null;
  taskId: string | null;
  runId: string | null;
  actor: string | null;
  payload: Record<string, unknown>;
}

export interface EventDraft {
  type: AgentEventType;
  userId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  actor?: string | null;
  payload?: Record<string, unknown>;
}