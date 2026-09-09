import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { planSchema, verificationSchema, webSearchArgsSchema, DEFAULT_PLAN, DEFAULT_VERIFICATION } from '@agentos/schemas';
import { modelRegistry } from '../src/registry.js';
import { healthMonitor } from '../src/health.js';
import { initAiRuntime, tokens, providerManager } from '../src/runtime.js';
import env from '@agentos/config';
import { parseStructured, structuredWithFallback, chatWithFallback } from '../src/complete.js';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
    constructor() {}
  }
}));

const completion = (content: string, model: string = 'test/primary-model') => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 123,
  model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
});

beforeAll(() => {
  initAiRuntime();
});

beforeEach(() => {
  tokens.resetAll();
  for (const provider of providerManager.all()) {
    for (const value of provider.tokenValues) {
      tokens.register(provider.id, value);
    }
  }
  modelRegistry.clear();
  modelRegistry.seedFromEnv({
    OPENROUTER_MODEL_PRIMARY: env.OPENROUTER_MODEL_PRIMARY,
    OPENROUTER_MODEL_FALLBACK: env.OPENROUTER_MODEL_FALLBACK
  });
  healthMonitor.reset();
  modelRegistry.all().forEach((m) => {
    modelRegistry.markVerified(m.key);
    healthMonitor.enable(m.key);
  });
  create.mockReset();
});

describe('schemas (shared via @agentos/schemas)', () => {
  it('parses a valid plan', () => {
    expect(planSchema.safeParse({ goal: 'G', steps: ['a', 'b'] }).success).toBe(true);
  });

  it('rejects a plan without steps', () => {
    expect(planSchema.safeParse({ goal: 'G', steps: [] }).success).toBe(false);
  });

  it('rejects an empty verification goal', () => {
    expect(planSchema.safeParse({ goal: '', steps: ['a'] }).success).toBe(false);
  });

  it('parses a complete verification and a partial one', () => {
    expect(verificationSchema.safeParse({ complete: true, reason: 'ok', missing: '' }).success).toBe(true);
    expect(verificationSchema.safeParse({ complete: false, reason: 'nope', missing: 'x' }).success).toBe(true);
  });

  it('parses a search argument with a single non-empty query', () => {
    expect(webSearchArgsSchema.safeParse({ query: 'rice farming vietnam' }).success).toBe(true);
    expect(webSearchArgsSchema.safeParse({ query: '  ' }).success).toBe(false);
  });

  it('exposes safe defaults', () => {
    expect(DEFAULT_PLAN).toEqual({ goal: '', steps: ['Research the topic', 'Synthesize findings', 'Verify the result'] });
    expect(DEFAULT_VERIFICATION).toEqual({
      complete: false,
      reason: 'Verification could not be completed because the model output was malformed.',
      missing: 'Could not confirm the answer satisfies the goal.'
    });
  });
});

describe('parseStructured', () => {
  const fallback = { goal: '', steps: [] };

  it('parses clean JSON', () => {
    const out = parseStructured(planSchema, '{"goal":"G","steps":["a","b"]}', fallback);
    expect(out.ok).toBe(true);
    expect(out.parsed).toEqual({ goal: 'G', steps: ['a', 'b'] });
  });

  it('returns the fallback when content has a trailing suffix', () => {
    const out = parseStructured(planSchema, '{"goal":"G","steps":["a","b"]} trailing', fallback);
    expect(out.ok).toBe(false);
    expect(out.parsed).toEqual(fallback);
  });

  it('returns the fallback for unparsable content', () => {
    expect(parseStructured(planSchema, 'not json', fallback).ok).toBe(false);
  });
});

describe('structuredWithFallback', () => {
  const stage = { stage: 'research' as const, mode: 'auto' as const };

  it('parses and returns typed results using the primary model', async () => {
    create.mockResolvedValue(completion('{"goal":"G","steps":["a","b"]}'));
    const out = await structuredWithFallback(planSchema, [{ role: 'user', content: 'hi' }], { goal: '', steps: [] }, stage);
    expect(out.ok).toBe(true);
    expect(out.value.goal).toBe('G');
    expect(out.provider).toBe('openrouter');
    expect(out.model).toBe('test/primary-model');
    expect(out.fallback).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('falls back to the secondary model when the primary fails', async () => {
    create
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockResolvedValueOnce(completion('{"goal":"G2","steps":["x","y"]}', 'test/fallback-model'));
    const out = await structuredWithFallback(planSchema, [{ role: 'user', content: 'hi' }], { goal: '', steps: [] }, stage);
    expect(out.ok).toBe(true);
    expect(out.value.goal).toBe('G2');
    expect(out.model).toBe('test/fallback-model');
    expect(out.fallback).toBe(true);
    expect(create.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns the fallback value with ok=false when parsing fails', async () => {
    create.mockResolvedValue(completion('not json at all'));
    const out = await structuredWithFallback(planSchema, [{ role: 'user', content: 'hi' }], { goal: 'fallback', steps: ['s'] }, stage);
    expect(out.ok).toBe(false);
    expect(out.value).toEqual({ goal: 'fallback', steps: ['s'] });
  });
});

describe('chatWithFallback', () => {
  it('returns the model text', async () => {
    create.mockResolvedValue(completion('hello world'));
    const out = await chatWithFallback([{ role: 'user', content: 'hi' }], undefined, { stage: 'research', mode: 'auto' });
    expect(out.response.choices[0].message.content).toBe('hello world');
    expect(out.model).toBe('test/primary-model');
    expect(out.fallback).toBe(false);
  });

  it('throws when every candidate fails', async () => {
    create.mockRejectedValue(new Error('total outage'));
    await expect(chatWithFallback([{ role: 'user', content: 'hi' }], undefined, { stage: 'research', mode: 'auto' })).rejects.toThrow();
    expect(create.mock.calls.length).toBeGreaterThan(1);
  });
});