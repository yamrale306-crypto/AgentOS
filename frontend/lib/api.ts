import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMode, Task, TaskListItem } from './types';

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

export interface CreateTaskOptions {
  mode?: ModelMode;
  model?: string | null;
}

export interface SystemStatusData {
  routingEnabled: boolean;
  defaultMode: ModelMode;
  defaultModel: string | null;
  providers: ProviderDiagnostic[];
  modelCount: number;
  enabledModelCount: number;
}

export interface ProviderDiagnostic {
  providerId: string;
  name: string;
  baseUrl: string;
  kind: string;
  tokenCount: number;
  healthyTokens: number;
  modelCount: number;
  status: 'operational' | 'degraded' | 'offline';
}

export interface ModelDiagnostic {
  key: string;
  providerId: string;
  modelId: string;
  label: string;
  capabilities: { tools: boolean; vision: boolean; structuredOutput: boolean; embeddings: boolean };
  contextWindow: number | null;
  qualityScore: number;
  speedScore: number;
  costPriority: number;
  priority: number;
  enabled: boolean;
  verified: boolean;
  dynamic: boolean;
  health: string;
  avgLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

export interface TokenDiagnostic {
  id: string;
  providerId: string;
  masked: string;
  enabled: boolean;
  healthy: boolean;
  inCooldown: boolean;
  consecutiveFailures: number;
  failureCount: number;
  successCount: number;
  lastUsedAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: string | null;
}

export interface DiagnosticResult {
  ok: boolean;
  errorCategory?: string;
  errorMessage?: string;
  selectedModel?: string;
  providerId?: string;
  mode?: string;
  latencyMs?: number;
  fallback?: boolean;
  output?: string;
}

export interface PlaygroundRequest {
  provider?: string;
  model?: string;
  mode?: ModelMode;
  prompt?: string;
}

export interface ApiClient {
  listTasks(limit?: number): Promise<TaskListItem[]>;
  getTask(id: string): Promise<Task>;
  createTask(prompt: string, options?: CreateTaskOptions): Promise<CreatedTask>;
  cancelTask(id: string): Promise<void>;
  retryTask(id: string): Promise<CreatedTask>;
  deleteTask(id: string): Promise<void>;
  getSystemStatus(): Promise<SystemStatusData>;
  getSystemProviders(): Promise<ProviderDiagnostic[]>;
  getSystemModels(): Promise<ModelDiagnostic[]>;
  getSystemTokens(): Promise<TokenDiagnostic[]>;
  testConnection(provider: string): Promise<DiagnosticResult>;
  runPlayground(req: PlaygroundRequest): Promise<DiagnosticResult>;
}

export function createApi(supabase: SupabaseClient): ApiClient {
  return {
    listTasks: (limit = 25) => request<TaskListItem[]>(supabase, `/api/tasks?limit=${limit}`),
    getTask: (id) => request<Task>(supabase, `/api/tasks/${encodeURIComponent(id)}`),
    createTask: (prompt, options = {}) => {
      const body: Record<string, unknown> = { prompt };
      if (options.mode) body.modelMode = options.mode;
      if (options.model) body.model = options.model;
      return request<CreatedTask>(supabase, '/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    },
    cancelTask: (id) =>
      request<void>(supabase, `/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
    retryTask: (id) =>
      request<CreatedTask>(supabase, `/api/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
    deleteTask: (id) => request<void>(supabase, `/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getSystemStatus: () => request<SystemStatusData>(supabase, '/api/system/status'),
    getSystemProviders: () => request<ProviderDiagnostic[]>(supabase, '/api/system/providers'),
    getSystemModels: () => request<ModelDiagnostic[]>(supabase, '/api/system/models'),
    getSystemTokens: () => request<TokenDiagnostic[]>(supabase, '/api/system/tokens'),
    testConnection: (provider) =>
      request<DiagnosticResult>(supabase, '/api/system/test', { method: 'POST', body: JSON.stringify({ provider }) }),
    runPlayground: (req) =>
      request<DiagnosticResult>(supabase, '/api/system/playground', { method: 'POST', body: JSON.stringify(req) })
  };
}