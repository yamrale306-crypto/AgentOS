import { providerManager } from './runtime.js';
import { tokens } from './runtime.js';
import { modelRegistry } from './registry.js';
import { healthMonitor } from './health.js';
import { chatWithFallback } from './complete.js';
import { AI_MODES } from '@agentos/schemas';
import { AiError, normalizeError } from './errors.js';
import type { AiMode, AgentStage } from './router.js';

export interface TokenDiagnostic {
  id: string;
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

export function providerDiagnostics(): ProviderDiagnostic[] {
  const tokenSnap = tokens.snapshot();
  const models = modelRegistry.all();
  const out: ProviderDiagnostic[] = [];
  for (const provider of providerManager.all()) {
    const providerTokens = tokenSnap.filter((t) => t.providerId === provider.id);
    const providerModels = models.filter((m) => m.providerId === provider.id);
    const unhealthyTokens = providerTokens.filter((t) => !t.healthy || t.inCooldown).length;
    const status: ProviderDiagnostic['status'] =
      providerTokens.length === 0 ? 'offline' : unhealthyTokens >= providerTokens.length ? 'degraded' : providerModels.some((m) => m.enabled) ? 'operational' : 'degraded';
    out.push({
      providerId: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      kind: provider.kind,
      tokenCount: providerTokens.length,
      healthyTokens: providerTokens.filter((t) => t.healthy && !t.inCooldown).length,
      modelCount: providerModels.filter((m) => m.enabled).length,
      status
    });
  }
  return out;
}

export function tokenDiagnostics(): TokenDiagnostic[] {
  return tokens.snapshot();
}

export function modelDiagnostics(): ModelDiagnostic[] {
  const health = healthMonitor.snapshot();
  return modelRegistry.all().map((spec) => {
    const record = health.find((h) => h.modelKey === spec.key);
    return {
      key: spec.key,
      providerId: spec.providerId,
      modelId: spec.modelId,
      label: spec.label,
      capabilities: { ...spec.capabilities },
      contextWindow: spec.contextWindow,
      qualityScore: spec.qualityScore,
      speedScore: spec.speedScore,
      costPriority: spec.costPriority,
      priority: spec.priority,
      enabled: spec.enabled,
      verified: spec.verified,
      dynamic: spec.dynamic,
      health: record?.status ?? 'unknown',
      avgLatencyMs: record?.avgLatencyMs ?? null,
      lastSuccessAt: record?.lastSuccessAt ?? null,
      lastFailureAt: record?.lastFailureAt ?? null,
      consecutiveFailures: record?.consecutiveFailures ?? 0,
      successCount: record?.successCount ?? 0,
      failureCount: record?.failureCount ?? 0
    };
  });
}

export interface SystemStatus {
  routingEnabled: boolean;
  defaultMode: AiMode;
  defaultModel: string | null;
  providers: ProviderDiagnostic[];
  modelCount: number;
  enabledModelCount: number;
}

export function systemStatus(envInput: { AI_ROUTING_ENABLED: boolean; AI_DEFAULT_MODE: string; AI_DEFAULT_MODEL?: string }): SystemStatus {
  const models = modelRegistry.all();
  return {
    routingEnabled: envInput.AI_ROUTING_ENABLED,
    defaultMode: (AI_MODES as readonly string[]).includes(envInput.AI_DEFAULT_MODE) ? (envInput.AI_DEFAULT_MODE as AiMode) : 'auto',
    defaultModel: envInput.AI_DEFAULT_MODEL ?? null,
    providers: providerDiagnostics(),
    modelCount: models.length,
    enabledModelCount: models.filter((m) => m.enabled).length
  };
}

export interface DiagnosticRequest {
  provider?: string;
  model?: string;
  mode?: AiMode;
  prompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface DiagnosticResult {
  ok: boolean;
  errorCategory?: string;
  errorMessage?: string;
  selectedModel?: string;
  providerId?: string;
  mode?: AiMode;
  latencyMs?: number;
  fallback?: boolean;
  output?: string;
}

export async function runDiagnosticRequest(req: DiagnosticRequest): Promise<DiagnosticResult> {
  const prompt = (req.prompt ?? 'Explain what a vector database is in two sentences.').slice(0, 4000);
  const mode: AiMode = req.mode ?? 'auto';
  const stage: AgentStage = 'general';
  const models = modelRegistry.enabled();

  let override = req.model ?? null;
  if (req.provider && !override) {
    const candidate = models
      .filter((m) => m.providerId.toLowerCase() === req.provider!.toLowerCase())
      .sort((a, b) => a.priority - b.priority)[0];
    override = candidate ? candidate.key : null;
  }

  const start = Date.now();
  try {
    const result = await chatWithFallback(
      [{ role: 'system', content: 'You are a diagnostic assistant. Answer concisely.' }, { role: 'user', content: prompt }],
      undefined,
      {
        stage,
        mode,
        override,
        prompt,
        maxTokens: Math.min(req.maxTokens ?? 200, 4096),
        timeoutMs: Math.min(req.timeoutMs ?? 30000, 60000)
      }
    );
    return {
      ok: true,
      selectedModel: result.model,
      providerId: result.provider,
      mode,
      latencyMs: Date.now() - start,
      fallback: result.fallback,
      output: result.response.choices[0]?.message?.content ?? ''
    };
  } catch (e) {
    const norm = e instanceof AiError ? e : normalizeError(e);
    return {
      ok: false,
      errorCategory: norm.category,
      errorMessage: norm.message.slice(0, 500),
      mode,
      latencyMs: Date.now() - start
    };
  }
}