import type { SupabaseClient } from '@supabase/supabase-js';
import type { Task, TaskListItem } from './types';

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!configuredApiUrl && process.env.NODE_ENV === 'production') {
  throw new Error('NEXT_PUBLIC_API_URL must be set for production builds.');
}
const BASE_URL = configuredApiUrl ?? 'http://localhost:10000';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

async function request<T>(supabase: SupabaseClient, path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the AgentOS backend. Is the server running?');
  }

  let body: ApiEnvelope;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    throw new ApiError(response.status, 'BAD_RESPONSE', 'The server returned an unparseable response.');
  }

  if (!response.ok || !body.ok) {
    const error = body.error ?? { code: 'UNKNOWN_ERROR', message: 'Request failed.' };
    throw new ApiError(response.status, error.code, error.message);
  }
  return body.data as T;
}

export interface CreatedTask {
  id: string;
  status: string;
  created_at: string;
}

export interface ApiClient {
  listTasks(limit?: number): Promise<TaskListItem[]>;
  getTask(id: string): Promise<Task>;
  createTask(prompt: string): Promise<CreatedTask>;
  cancelTask(id: string): Promise<void>;
  retryTask(id: string): Promise<CreatedTask>;
  deleteTask(id: string): Promise<void>;
}

export function createApi(supabase: SupabaseClient): ApiClient {
  return {
    listTasks: (limit = 25) => request<TaskListItem[]>(supabase, `/api/tasks?limit=${limit}`),
    getTask: (id) => request<Task>(supabase, `/api/tasks/${encodeURIComponent(id)}`),
    createTask: (prompt) =>
      request<CreatedTask>(supabase, '/api/tasks', { method: 'POST', body: JSON.stringify({ prompt }) }),
    cancelTask: (id) =>
      request<void>(supabase, `/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    retryTask: (id) =>
      request<CreatedTask>(supabase, `/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    deleteTask: (id) => request<void>(supabase, `/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  };
}