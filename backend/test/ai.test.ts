import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeError, AiError, isRetryable } from '../src/ai/errors.js';
import { TokenManager, maskToken, type TokenState } from '../src/ai/tokenManager.js';
import { modelRegistry } from '../src/ai/registry.js';
import { healthMonitor } from '../src/ai/health.js';
import { route, classifyTask, describeRoute } from '../src/ai/router.js';
import { specFromOpenRouter } from '../src/ai/catalog.js';
import { modelKey } from '../src/ai/catalog.js';

beforeEach(() => {
  modelRegistry.clear();
  healthMonitor.reset();
  modelRegistry.seedFromEnv({});
});

describe('normalizeError', () => {
  it('returns the same AiError instance unchanged', () => {
    const err = new AiError('RATE_LIMIT', 'slow down');
    expect(normalizeError(err)).toBe(err);
  });

  it('maps HTTP statuses to categories', () => {
    expect(normalizeError({ status: 401, message: 'bad key' }).category).toBe('AUTH_ERROR');
    expect(normalizeError({ status: 403, message: 'nope' }).category).toBe('AUTH_ERROR');
    expect(normalizeError({ status: 429, message: 'throttled' }).category).toBe('RATE_LIMIT');
    expect(normalizeError({ status: 422, message: 'bad body' }).category).toBe('BAD_REQUEST');
    expect(normalizeError({ status: 404, message: 'missing' }).category).toBe('MODEL_UNAVAILABLE');
    expect(normalizeError({ status: 408, message: 'late' }).category).toBe('TIMEOUT');
    expect(normalizeError({ status: 503, message: 'down' }).category).toBe('SERVER_ERROR');
  });

  it('classifies messages when there is no status', () => {
    expect(normalizeError(new Error('Request timed out')).category).toBe('TIMEOUT');
    expect(normalizeError(new Error('Too many requests, slow down')).category).toBe('RATE_LIMIT');
    expect(normalizeError(new Error('Invalid API key provided')).category).toBe('AUTH_ERROR');
    expect(normalizeError(new Error('Model not found')).category).toBe('MODEL_UNAVAILABLE');
    expect(normalizeError(new Error('fetch failed')).category).toBe('NETWORK_ERROR');
    expect(normalizeError(new Error('something odd happened')).category).toBe('UNKNOWN');
  });

  it('preserves the original message', () => {
    expect(normalizeError(new Error('boom')).message).toBe('boom');
  });

  it('marks only retryable categories retryable', () => {
    expect(isRetryable('RATE_LIMIT')).toBe(true);
    expect(isRetryable('TIMEOUT')).toBe(true);
    expect(isRetryable('SERVER_ERROR')).toBe(true);
    expect(isRetryable('NETWORK_ERROR')).toBe(true);
    expect(isRetryable('AUTH_ERROR')).toBe(false);
    expect(isRetryable('MODEL_UNAVAILABLE')).toBe(false);
    expect(isRetryable('UNKNOWN')).toBe(false);
  });
});

describe('maskToken', () => {
  it('masks long tokens keeping head and tail', () => {
    const masked = maskToken('sk-or-v1-abcdef1234567890');
    expect(masked).not.toContain('abcdef1234567890');
    expect(masked).toContain('sk-');
    expect(masked.endsWith('7890')).toBe(true);
    expect(masked).toContain('***');
  });

  it('fully masks very short values', () => {
    expect(maskToken('abc')).toBe('***');
  });
});

describe('TokenManager', () => {
it('rotates between tokens by least-recent use', () => {
    const tm = new TokenManager();
    const t1 = tm.register('groq', 'gsk-a');
    const t2 = tm.register('groq', 'gsk-b');
    expect(tm.select('groq', { now: 100 })).toBe(t1);
    expect(tm.select('groq', { now: 200 })).toBe(t2);
    tm.recordSuccess(t1, { now: 300 });
    expect(tm.select('groq', { now: 400 })).toBe(t2);
    tm.recordSuccess(t2, { now: 500 });
    expect(tm.select('groq', { now: 600 })).toBe(t1);
  });

  it('respects the avoid list', () => {
    const tm = new TokenManager();
    const t1 = tm.register('openrouter', 'or-a');
    const t2 = tm.register('openrouter', 'or-b');
    expect(tm.select('openrouter', { avoid: [t1.id] })).toBe(t2);
  });

  it('does not return disabled or unhealthy tokens', () => {
    const tm = new TokenManager();
    tm.register('deepseek', 'sk-ds');
    const [token] = tm.tokensFor('deepseek');
    tm.recordFailure(token, 'AUTH_ERROR');
    expect(tm.select('deepseek')).toBeNull();
  });

  it('applies cooldown per token+model combination only', () => {
    const tm = new TokenManager();
    tm.register('gemini', 'aq-key');
    const [token] = tm.tokensFor('gemini');
    tm.recordFailure(token, 'RATE_LIMIT', { modelKey: 'm1' });
    expect(tm.select('gemini', { modelKey: 'm1' })).toBeNull();
    expect(tm.select('gemini', { modelKey: 'm2' })).toBe(token);
  });

  it('clears cooldown after a success for the same model', () => {
    const tm = new TokenManager();
    tm.register('zai', 'zk');
    const [token] = tm.tokensFor('zai');
    tm.recordFailure(token, 'RATE_LIMIT', { modelKey: 'm1' });
    expect(tm.select('zai', { modelKey: 'm1' })).toBeNull();
    tm.recordSuccess(token, { modelKey: 'm1' });
    expect(tm.select('zai', { modelKey: 'm1' })).toBe(token);
  });

  it('disables a token entirely after an auth error', () => {
    const tm = new TokenManager();
    tm.register('openrouter', 'or-x');
    const [token] = tm.tokensFor('openrouter');
    tm.recordFailure(token, 'AUTH_ERROR', { modelKey: 'm1' });
    expect(tm.select('openrouter', { modelKey: 'm1' })).toBeNull();
    expect(tm.select('openrouter', { modelKey: 'm2' })).toBeNull();
  });

  it('exposes only masked values and hashes in snapshots', () => {
    const tm = new TokenManager();
    tm.register('groq', 'gsk-prod-secret-value');
    const snap = tm.snapshot();
    expect(snap).toHaveLength(1);
    expect(JSON.stringify(snap)).not.toContain('gsk-prod-secret-value');
    expect(snap[0].masked).toContain('***');
    expect(snap[0].tokenHash.length).toBeGreaterThan(0);
  });

  it('tracks consecutive failures towards unhealthy', () => {
    const tm = new TokenManager();
    tm.register('groq', 'gsk-c');
    const token = tm.tokensFor('groq')[0];
    for (let i = 0; i < 5; i++) tm.recordFailure(token, 'SERVER_ERROR', { modelKey: 'm' });
    expect(token.healthy).toBe(false);
    expect(tm.select('groq', { modelKey: 'm' })).toBeNull();
  });
});

describe('classifyTask', () => {
  it.each([
    ['summarize this article in short', 'SOURCE_SUMMARIZATION'],
    ['verify whether this fact is true', 'FACT_VERIFICATION'],
    ['extract all the emails into a table', 'STRUCTURED_EXTRACTION'],
    ['what is the capital of France', 'FAST_SIMPLE_ANSWER'],
    ['debug this javascript function', 'CODING_TECHNICAL'],
    ['summarize the code changes', 'CODING_TECHNICAL']
  ] as const)('classifies %s as %s', (prompt, category) => {
    expect(classifyTask(prompt)).toBe(category);
  });

  it('defaults to web research analysis', () => {
    expect(classifyTask('how does the weather feel today')).toBe('WEB_RESEARCH_ANALYSIS');
  });
});

describe('route', () => {
  it('keeps only structured-capable candidates for the planning stage', () => {
    const decision = route({ stage: 'planning', mode: 'auto' });
    expect(decision.candidates.length).toBeGreaterThan(0);
    for (const spec of decision.candidates) {
      expect(spec.capabilities.structuredOutput).toBe(true);
    }
  });

it('ranks a fast model higher in fast mode and a quality model higher in quality mode', () => {
    const fast = route({ stage: 'general', mode: 'fast', maxCandidates: 14 }).candidates.map((s) => s.key);
    const quality = route({ stage: 'general', mode: 'quality', maxCandidates: 14 }).candidates.map((s) => s.key);
    const fastIndex = (keys: string[]) =>
      keys.indexOf('groq:openai/gpt-oss-20b') < keys.indexOf('groq:openai/gpt-oss-120b') ? '20b' : '120b';
    expect(fastIndex(fast)).toBe('20b');
    expect(fastIndex(quality)).toBe('120b');
  });

  it('honors lowcost mode preference', () => {
    const lowcost = route({ stage: 'general', mode: 'lowcost', maxCandidates: 14 }).candidates.map((s) => s.key);
    expect(lowcost.indexOf('zai:GLM-4.5-Flash')).toBeLessThan(lowcost.indexOf('gemini:gemini-3.1-flash-lite'));
  });

  it('forces the overridden model to the front', () => {
    const decision = route({ stage: 'general', mode: 'auto', override: 'deepseek:deepseek-chat' });
    expect(decision.candidates[0].key).toBe('deepseek:deepseek-chat');
  });

  it('accepts environment-model overrides by model id', () => {
    modelRegistry.seedFromEnv({ OPENROUTER_MODEL_PRIMARY: 'custom/env-model', OPENROUTER_MODEL_FALLBACK: 'custom/env-fallback' });
    const decision = route({ stage: 'general', mode: 'auto', override: 'custom/env-model' });
    expect(decision.candidates[0].key).toBe('openrouter:custom/env-model');
  });

  it('drops hard-excluded (auth error / disabled) models', () => {
    healthMonitor.recordFailure('deepseek:deepseek-chat', 'deepseek', 'AUTH_ERROR');
    healthMonitor.ensure('groq:llama-3.1-8b-instant', 'groq');
    healthMonitor.disable('groq:llama-3.1-8b-instant');
    const keys = route({ stage: 'general', mode: 'auto' }).candidates.map((s) => s.key);
    expect(keys).not.toContain('deepseek:deepseek-chat');
    expect(keys).not.toContain('groq:llama-3.1-8b-instant');
  });

  it('moves repeatedly failing models out of the primary pool', () => {
    for (let i = 0; i < 5; i++) healthMonitor.recordFailure('zai:GLM-4.5-Air', 'zai', 'SERVER_ERROR');
    const keys = route({ stage: 'general', mode: 'auto' }).candidates.map((s) => s.key);
    expect(keys).not.toContain('zai:GLM-4.5-Air');
  });

  it('includes verified context windows for context fit', () => {
    const decision = route({ stage: 'general', mode: 'auto', estimatedContextChars: 100_000 });
    expect(decision.candidates.length).toBeGreaterThan(0);
  });

  it('adds discovered dynamic openrouter models without clobbering overrides', () => {
    const added = modelRegistry.upsertFromOpenRouter([{ id: 'some-provider/some-v3' }, { id: 'another/llama-4' }], false);
    expect(added).toBe(2);
    const spec = modelRegistry.get('openrouter:some-provider/some-v3');
    expect(spec).toBeDefined();
    expect(spec?.dynamic).toBe(true);
    expect(spec?.capabilities.tools).toBe(true);
  });

  it('skips dynamic upserts when skipDynamic is set', () => {
    expect(modelRegistry.upsertFromOpenRouter([{ id: 'x/y' }], true)).toBe(0);
  });

  it('describes routes as provider/model pairs', () => {
    const decision = route({ stage: 'general', mode: 'auto', maxCandidates: 2 });
    const desc = describeRoute(decision);
    expect(desc).toHaveLength(2);
    expect(desc[0]).toContain('/');
  });

  it('respects maxCandidates', () => {
    expect(route({ stage: 'general', mode: 'auto', maxCandidates: 3 }).candidates).toHaveLength(3);
  });

  it('builds specFromOpenRouter with embedding detection', () => {
    const spec = { ...specFromOpenRouter({ contextLength: 1000 }, 'text-embedding-3-small'), key: modelKey('openrouter', 'text-embedding-3-small'), priority: 100 };
    expect(spec.capabilities.embeddings).toBe(true);
    expect(spec.capabilities.structuredOutput).toBe(false);
    expect(spec.contextWindow).toBe(1000);
  });
});

describe('TokenState typing', () => {
  it('exposes masked values only', () => {
    const tm = new TokenManager();
    tm.register('openrouter', 'sk-or-v1-full-secret');
    const state: TokenState | undefined = tm.select('openrouter');
    expect(state).toBeDefined();
    expect(state!.masked).not.toContain('full-secret');
  });
});
