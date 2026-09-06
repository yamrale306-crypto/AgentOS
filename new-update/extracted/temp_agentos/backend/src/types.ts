export const TASK_STATUSES = [
  'queued',
  'planning',
  'searching',
  'analyzing',
  'verifying',
  'completed',
  'failed',
  'cancelled'
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_STATUSES: TaskStatus[] = ['queued', 'planning', 'searching', 'analyzing', 'verifying'];
export const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];

export function isActiveStatus(status: string): status is TaskStatus {
  return (ACTIVE_STATUSES as string[]).includes(status);
}

export function isTerminalStatus(status: string): status is TaskStatus {
  return (TERMINAL_STATUSES as string[]).includes(status);
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchPlan {
  goal: string;
  steps: string[];
}

export interface VerificationResult {
  complete: boolean;
  reason: string;
  missing?: string | null;
}

export interface NewTaskResult {
  id: string;
  status: TaskStatus;
  created_at: string;
}

export type CreateTaskError = 'daily_limit' | 'active_limit';

export type CreateTaskOutcome = {
  ok: true;
  task: NewTaskResult;
  quotaCount: number;
} | {
  ok: false;
  error: CreateTaskError;
  quotaCount: number;
};

export interface TaskRecord {
  id: string;
  user_id: string;
  prompt: string;
  status: TaskStatus;
  plan: ResearchPlan | null;
  current_step: string | null;
  result: string | null;
  error: string | null;
  steps_used: number;
  searches_used: number;
  model_used: string | null;
  sources: SearchResult[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskListItem {
  id: string;
  prompt: string;
  status: TaskStatus;
  current_step: string | null;
  steps_used: number;
  searches_used: number;
  model_used: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ApiErrorBody = { ok: false; error: { code: string; message: string } };
export type ApiSuccessBody<T> = { ok: true; data: T };