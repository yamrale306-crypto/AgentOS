import { buildStaticModels, modelKey, specForEnvModel, specFromOpenRouter, type ModelSpec } from './catalog.js';
import { logger } from '../lib/logger.js';

export class ModelRegistry {
  private readonly specs = new Map<string, ModelSpec>();

  register(spec: ModelSpec): ModelSpec {
    const existing = this.specs.get(spec.key);
    if (existing) {
      existing.enabled = spec.enabled;
      existing.priority = spec.priority;
      existing.capabilities = { ...existing.capabilities, ...spec.capabilities };
      if (spec.contextWindow !== null && spec.contextWindow !== undefined) existing.contextWindow = spec.contextWindow;
      return existing;
    }
    this.specs.set(spec.key, spec);
    return spec;
  }

  all(): ModelSpec[] {
    return Array.from(this.specs.values());
  }

  enabled(): ModelSpec[] {
    return this.all().filter((s) => s.enabled);
  }

  get(key: string): ModelSpec | undefined {
    return this.specs.get(key);
  }

  byProvider(providerId: string): ModelSpec[] {
    return this.all().filter((s) => s.providerId === providerId);
  }

  markVerified(key: string): void {
    const spec = this.specs.get(key);
    if (spec) spec.verified = true;
  }

  setEnabled(key: string, enabled: boolean): void {
    const spec = this.specs.get(key);
    if (spec) spec.enabled = enabled;
  }

  clear(): void {
    this.specs.clear();
  }

  upsertFromOpenRouter(discovered: Array<{ id: string }>, skipDynamic: boolean): number {
    if (skipDynamic) return 0;
    let added = 0;
    for (const item of discovered) {
      if (!item?.id) continue;
      const base = specFromOpenRouter({}, item.id);
      const key = modelKey('openrouter', item.id);
      if (this.get(key)) continue;
      this.register({ ...base, key, priority: 100 });
      added += 1;
    }
    return added;
  }

  seedFromEnv(input: { OPENROUTER_MODEL_PRIMARY?: string; OPENROUTER_MODEL_FALLBACK?: string }): void {
    for (const spec of buildStaticModels()) this.register(spec);
    if (input.OPENROUTER_MODEL_PRIMARY) {
      const base = specForEnvModel(input.OPENROUTER_MODEL_PRIMARY, false);
      this.register({ ...base, key: `openrouter:${base.modelId}` });
      const spec = this.get(`openrouter:${base.modelId}`);
      if (spec) spec.capabilities.tools = true;
    }
    if (input.OPENROUTER_MODEL_FALLBACK) {
      const base = specForEnvModel(input.OPENROUTER_MODEL_FALLBACK, true);
      this.register({ ...base, key: `openrouter:${base.modelId}` });
      const spec = this.get(`openrouter:${base.modelId}`);
      if (spec) spec.capabilities.tools = true;
    }
  }

  ensureEnvModel(modelId: string, fallback: boolean): ModelSpec {
    const key = `openrouter:${modelId}`;
    const existing = this.get(key);
    if (existing) return existing;
    const base = specForEnvModel(modelId, fallback);
    return this.register({ ...base, key });
  }
}

export const modelRegistry = new ModelRegistry();

export async function discoverOpenRouterModels(apiKey: string | undefined, skipDynamic: boolean): Promise<number> {
  if (!apiKey || skipDynamic) return 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn('model_discovery_failed', { provider: 'openrouter', status: res.status });
      return 0;
    }
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    const added = modelRegistry.upsertFromOpenRouter(body.data ?? [], false);
    if (added > 0) logger.info('model_discovery_added', { provider: 'openrouter', count: added });
    return added;
  } catch (e) {
    logger.warn('model_discovery_failed', { provider: 'openrouter', reason: e instanceof Error ? e.message : 'unknown' });
    return 0;
  }
}