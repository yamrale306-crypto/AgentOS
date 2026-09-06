export const ACTIVE_STATUSES = ['queued', 'planning', 'searching', 'analyzing', 'verifying'] as const;
export const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type TaskStatus = (typeof ACTIVE_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number];

export function isActiveStatus(status: string): status is TaskStatus {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
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

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  current_step: string | null;
  result: string | null;
  error: string | null;
  plan: ResearchPlan | null;
  steps_used: number;
  searches_used: number;
  model_used: string | null;
  sources: SearchResult[];
  created_at: string;
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