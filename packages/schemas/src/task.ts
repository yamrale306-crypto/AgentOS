import type { AiMode } from './ai.js';
import type { SearchResult } from './search.js';
import type { ResearchPlan } from './agent.js';

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

export interface NewTaskResult {
  id: string;
  status: TaskStatus;
  created_at: string;
}

export type CreateTaskError = 'daily_limit' | 'active_limit';

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
  model_mode: AiMode | null;
  model: string | null;
  provider_used: string | null;
  fallback_used: boolean | null;
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
  provider_used: string | null;
  model_mode: AiMode | null;
  created_at: string;
  completed_at: string | null;
}

export type ApiErrorBody = { ok: false; error: { code: string; message: string } };
export type ApiSuccessBody<T> = { ok: true; data: T };