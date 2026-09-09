import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelCatalog } from '../src/catalog.js';
import { modelRegistry } from '../src/registry.js';
import { healthMonitor } from '../src/health.js';
import { AI_MODES } from '@agentos/schemas';
import { route, describeRoute, type AiMode, type AgentStage } from '../src/router.js';
import env from '@agentos/config';

const primaryKey = () => `openrouter:${env.OPENROUTER_MODEL_PRIMARY}`;

function seedRegistry(): void {
  modelRegistry.clear();
  modelRegistry.seedFromEnv({
    OPENROUTER_MODEL_PRIMARY: env.OPENROUTER_MODEL_PRIMARY,
    OPENROUTER_MODEL_FALLBACK: env.OPENROUTER_MODEL_FALLBACK
  });
  modelRegistry.all().forEach((m) => {
    modelRegistry.markVerified(m.key);
    healthMonitor.enable(m.key);
  });
}

describe('model catalog', () => {
  it('registers expected entries and resolves exact ids', () => {
    expect(modelCatalog.size).toBeGreaterThan(0);
    const openai = modelCatalog.get('openai:gpt-4o');
    expect(openai).toBeDefined();
    expect(openai?.providerId).toBe('openai');
  });

  it('finds closest candidate ids', () => {
    const candidates = modelCatalog.findClosest('openai:gpt-4o');
    expect(candidates).toContain('openai:gpt-4o');
    expect(modelCatalog.findClosest('openai:not-a-real-model')).toContain('openai:gpt-4o');
  });
});

describe('model registry', () => {
  beforeEach(() => {
    seedRegistry();
  });

  afterEach(() => {
    modelRegistry.clear();
    healthMonitor.reset();
  });

  it('seeds the primary and fallback models from environment', () => {
    expect(modelRegistry.get(primaryKey())).toMatchObject({ providerId: 'openrouter', priority: 1 });
    expect(modelRegistry.get(`openrouter:${env.OPENROUTER_MODEL_FALLBACK}`)).toMatchObject({ priority: 2 });
    expect(modelRegistry.size).toBeGreaterThanOrEqual(2);
  });

  it('marks models as verified', () => {
    expect(modelRegistry.get(primaryKey())?.verified).toBe(true);
    modelRegistry.markVerified(primaryKey());
    expect(modelRegistry.get(primaryKey())?.verified).toBe(true);
  });
});

describe('health monitor', () => {
  afterEach(() => {
    healthMonitor.reset();
  });

  it('starts with an empty snapshot', () => {
    expect(healthMonitor.snapshot()).toHaveLength(0);
  });

  it('tracks success and failure counts', () => {
    const key = primaryKey();
    healthMonitor.recordSuccess(key, 'openrouter', 100);
    healthMonitor.recordFailure(key, 'openrouter', 'MODEL_UNAVAILABLE');
    const rec = healthMonitor.snapshot().find((h) => h.modelKey === key);
    expect(rec?.successCount).toBe(1);
    expect(rec?.failureCount).toBe(1);
    expect(rec?.consecutiveFailures).toBe(1);
  });

  it('toggles skipping via disable/enable', () => {
    const key = primaryKey();
    healthMonitor.recordSuccess(key, 'openrouter', 50);
    expect(healthMonitor.shouldSkip(key)).toBe(false);
    healthMonitor.disable(key);
    expect(healthMonitor.shouldSkip(key)).toBe(true);
    healthMonitor.enable(key);
    expect(healthMonitor.shouldSkip(key)).toBe(false);
  });

  it('skips models in rate-limit cooldown', () => {
    const key = primaryKey();
    healthMonitor.recordFailure(key, 'openrouter', 'RATE_LIMIT');
    expect(healthMonitor.shouldSkip(key)).toBe(true);
  });
});

describe('router', () => {
  beforeEach(() => {
    seedRegistry();
  });

  afterEach(() => {
    modelRegistry.clear();
    healthMonitor.reset();
  });

  const req = (override: string | null = null, stage: AgentStage = 'planning', prompt = 'Tell me about rice farming in Vietnam.') => ({
    prompt,
    stage,
    mode: 'auto' as AiMode,
    override
  });

  it('ranks the seeded primary model first when no override is given', () => {
    const { candidates } = route(req(null, 'research'));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].key).toBe(primaryKey());
  });

  it('honors an explicit override model id', () => {
    const { candidates } = route(req('test/primary-model'));
    expect(candidates[0].key).toBe(primaryKey());
  });

  it('honors a catalog-level override key', () => {
    const { candidates } = route(req('openai:gpt-4o'));
    expect(candidates[0].key).toBe('openai:gpt-4o');
  });

  it('classifies prompts into task categories', () => {
    expect(route({ prompt: 'verify whether this claim is true', stage: 'verifying', mode: 'auto' }).category).toBe('FACT_VERIFICATION');
    expect(route(req()).category).toBe('WEB_RESEARCH_ANALYSIS');
  });

  it('returns a stable ranked candidate list with unique keys', () => {
    const { candidates } = route(req());
    expect(candidates.length).toBeGreaterThan(1);
    expect(new Set(candidates.map((c) => c.key)).size).toBe(candidates.length);
  });

  it('routes the general stage without capability requirements', () => {
    const { candidates } = route({ prompt: 'hi', stage: 'general', mode: 'auto' });
    expect(candidates[0].key).toBe(primaryKey());
  });
});

describe('describeRoute', () => {
  beforeEach(() => {
    seedRegistry();
  });

  afterEach(() => {
    modelRegistry.clear();
    healthMonitor.reset();
  });

  it('formats a readable route summary', () => {
    const lines = describeRoute(route({ prompt: 'Tell me about rice farming in Vietnam.', stage: 'research', mode: 'auto' }));
    expect(lines[0]).toContain('openrouter');
    expect(lines[0]).toContain(env.OPENROUTER_MODEL_PRIMARY);
  });
});

describe('AI modes from @agentos/schemas', () => {
  it('exposes the canonical mode list', () => {
    expect(AI_MODES).toEqual(['auto', 'quality', 'balanced', 'fast', 'lowcost']);
  });
});

describe('env integration', () => {
  it('exposes a parseable configuration', () => {
    expect(env.PORT).toBe(10000);
    expect(env.OPENROUTER_MODEL_PRIMARY).toBe('test/primary-model');
    expect(typeof env.AI_ROUTING_ENABLED).toBe('boolean');
    expect(AI_MODES).toContain(env.AI_DEFAULT_MODE);
  });
});