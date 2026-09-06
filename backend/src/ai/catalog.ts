export interface ModelCapabilities {
  tools: boolean;
  vision: boolean;
  structuredOutput: boolean;
  embeddings: boolean;
}

export type ModelStatus = 'unknown' | 'healthy' | 'degraded' | 'rate_limited' | 'model_unavailable' | 'auth_error' | 'disabled';

export interface ModelSpec {
  key: string;
  providerId: string;
  modelId: string;
  label: string;
  capabilities: ModelCapabilities;
  contextWindow: number | null;
  qualityScore: number;
  speedScore: number;
  costPriority: number;
  priority: number;
  enabled: boolean;
  verified: boolean;
  dynamic: boolean;
}

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

interface StaticEntry {
  providerId: string;
  modelId: string;
  label?: string;
  capabilities?: Partial<ModelCapabilities>;
  contextWindow?: number | null;
  qualityScore?: number;
  speedScore?: number;
  costPriority?: number;
}

const STATIC_CATALOG: StaticEntry[] = [
  { providerId: 'deepseek', modelId: 'deepseek-chat', label: 'DeepSeek Chat (V3.x)', capabilities: { tools: true, structuredOutput: true }, contextWindow: 64000, qualityScore: 8, speedScore: 7, costPriority: 2 },
  { providerId: 'deepseek', modelId: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', capabilities: { tools: false, structuredOutput: false }, contextWindow: 64000, qualityScore: 9, speedScore: 4, costPriority: 2 },

  { providerId: 'groq', modelId: 'openai/gpt-oss-120b', label: 'Groq GPT-OSS 120B', capabilities: { tools: true, structuredOutput: true }, contextWindow: 131072, qualityScore: 9, speedScore: 7, costPriority: 2 },
  { providerId: 'groq', modelId: 'openai/gpt-oss-20b', label: 'Groq GPT-OSS 20B', capabilities: { tools: true, structuredOutput: false }, contextWindow: 131072, qualityScore: 7, speedScore: 9, costPriority: 1 },
  { providerId: 'groq', modelId: 'qwen/qwen3.8-27b', label: 'Groq Qwen3.8 27B', capabilities: { tools: true, structuredOutput: true }, contextWindow: 131072, qualityScore: 8, speedScore: 8, costPriority: 1 },
  { providerId: 'groq', modelId: 'groq/compound-mini', label: 'Groq Compound Mini', capabilities: { tools: false, structuredOutput: true }, contextWindow: 131072, qualityScore: 6, speedScore: 9, costPriority: 1 },

  { providerId: 'gemini', modelId: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', capabilities: { tools: true, vision: true, structuredOutput: true }, contextWindow: 1048576, qualityScore: 9, speedScore: 8, costPriority: 2 },
  { providerId: 'gemini', modelId: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', capabilities: { tools: true, vision: true, structuredOutput: true }, contextWindow: 1048576, qualityScore: 9, speedScore: 8, costPriority: 2 },
  { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite', capabilities: { tools: true, vision: true, structuredOutput: true }, contextWindow: 1048576, qualityScore: 7, speedScore: 9, costPriority: 1 },

  { providerId: 'zai', modelId: 'GLM-4.5-Flash', label: 'Z.ai GLM-4.5 Flash', capabilities: { tools: true, structuredOutput: true }, contextWindow: 131072, qualityScore: 7, speedScore: 8, costPriority: 0 },

  { providerId: 'cloudflare', modelId: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Cloudflare Llama 3.3 70B', capabilities: { tools: true, structuredOutput: true }, contextWindow: 131072, qualityScore: 8, speedScore: 7, costPriority: 0 },
  { providerId: 'cloudflare', modelId: '@cf/meta/llama-3.1-8b-instruct-fp8', label: 'Cloudflare Llama 3.1 8B FP8', capabilities: { tools: true, structuredOutput: true }, contextWindow: 131072, qualityScore: 6, speedScore: 8, costPriority: 0 },
  { providerId: 'cloudflare', modelId: '@cf/qwen/qwen2.5-coder-32b-instruct', label: 'Cloudflare Qwen2.5 Coder 32B', capabilities: { tools: false, structuredOutput: true }, contextWindow: 131072, qualityScore: 8, speedScore: 6, costPriority: 0 }
];

export interface ProviderSpec {
  id: string;
  name: string;
  baseUrl: string;
  kind: 'openai-compatible' | 'cloudflare';
  docs?: string;
}

export const DEFAULT_PROVIDERS: ProviderSpec[] = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', kind: 'openai-compatible', docs: 'https://openrouter.ai/docs' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', kind: 'openai-compatible', docs: 'https://api-docs.deepseek.com' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', kind: 'openai-compatible', docs: 'https://console.groq.com/docs' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/', kind: 'openai-compatible', docs: 'https://ai.google.dev' },
  { id: 'zai', name: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4', kind: 'openai-compatible', docs: 'https://docs.z.ai' },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', baseUrl: '', kind: 'cloudflare', docs: 'https://developers.cloudflare.com/workers-ai' }
];

export function buildStaticModels(): ModelSpec[] {
  return STATIC_CATALOG.map((entry) => {
    const caps: ModelCapabilities = { tools: false, vision: false, structuredOutput: false, embeddings: false, ...entry.capabilities };
    return {
      key: modelKey(entry.providerId, entry.modelId),
      providerId: entry.providerId,
      modelId: entry.modelId,
      label: entry.label ?? entry.modelId,
      capabilities: caps,
      contextWindow: entry.contextWindow ?? null,
      qualityScore: entry.qualityScore ?? 5,
      speedScore: entry.speedScore ?? 5,
      costPriority: entry.costPriority ?? 5,
      priority: 100,
      enabled: true,
      verified: false,
      dynamic: false
    };
  });
}

export function specFromOpenRouter(context: { contextLength?: number }, modelId: string): Omit<ModelSpec, 'key' | 'priority'> {
  const lower = modelId.toLowerCase();
  const vision = lower.includes('vision') || /gemini-\d/.test(lower) || lower.includes('image') || lower.includes('vl');
  const embedding = lower.includes('embed');
  const reasoningOnly = lower.includes('reasoner') || lower.includes('o1') || lower.includes('o3') || lower.includes('thinking');
  return {
    providerId: 'openrouter',
    modelId,
    label: modelId,
    capabilities: { tools: !reasoningOnly, vision, structuredOutput: !embedding, embeddings: embedding },
    contextWindow: context.contextLength ?? null,
    qualityScore: 7,
    speedScore: 7,
    costPriority: lower.includes(':free') ? 0 : 3,
    enabled: true,
    verified: false,
    dynamic: true
  };
}

export function specForEnvModel(modelId: string, fallback: boolean): Omit<ModelSpec, 'key'> {
  const used = modelId.trim();
  return {
    providerId: 'openrouter',
    modelId: used,
    label: used,
    capabilities: { tools: true, vision: false, structuredOutput: false, embeddings: false },
    contextWindow: null,
    qualityScore: 6,
    speedScore: 7,
    costPriority: used.includes(':free') ? 0 : 3,
    priority: fallback ? 2 : 1,
    enabled: true,
    verified: true,
    dynamic: false
  };
}