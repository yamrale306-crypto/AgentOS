import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

const openaiMock = vi.hoisted(() => {
  let content = '';
  const create = vi.fn();
  return {
    create,
    setContent: (v: string) => {
      content = v;
    },
    getContent: () => content
  };
});

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: openaiMock.create } };
  }
  return { default: MockOpenAI };
});

import { parseStructured, structuredWithFallback, chatWithFallback } from '../src/agent/model.js';
import { planSchema, verificationSchema, webSearchArgsSchema, DEFAULT_PLAN, DEFAULT_VERIFICATION } from '../src/agent/schemas.js';

function completion(content: string) {
  return { choices: [{ message: { content }, finish_reason: 'stop' }] };
}

describe('parseStructured', () => {
  const schema = z.object({ complete: z.boolean(), reason: z.string() });

  it('parses clean JSON', () => {
    const { parsed, ok } = parseStructured(schema, '{"complete":true,"reason":"ok"}', { complete: false, reason: '' });
    expect(ok).toBe(true);
    expect(parsed.complete).toBe(true);
  });

  it('parses JSON inside a markdown fence', () => {
    const { parsed, ok } = parseStructured(schema, '```json\n{"complete":true,"reason":"ok"}\n```', { complete: false, reason: '' });
    expect(ok).toBe(true);
    expect(parsed.reason).toBe('ok');
  });

  it('recovers surrounding prose around JSON', () => {
    const { parsed, ok } = parseStructured(schema, 'Here you go: {"complete":false,"reason":"nope"} hope that helps', { complete: false, reason: '' });
    expect(ok).toBe(true);
    expect(parsed.complete).toBe(false);
  });

  it('falls back on garbage without claiming success', () => {
    const { parsed, ok } = parseStructured(schema, 'this is not json at all', { complete: false, reason: 'fallback' });
    expect(ok).toBe(false);
    expect(parsed.reason).toBe('fallback');
  });

  it('falls back when JSON does not match the schema', () => {
    const { parsed, ok } = parseStructured(schema, '{"complete":"yes","reason":123}', { complete: false, reason: 'fallback' });
    expect(ok).toBe(false);
    expect(parsed.complete).toBe(false);
  });
});

describe('schemas', () => {
  it('planSchema accepts 2-5 steps and rejects others', () => {
    expect(planSchema.safeParse({ goal: 'g', steps: ['a', 'b'] }).success).toBe(true);
    expect(planSchema.safeParse({ goal: 'g', steps: ['a'] }).success).toBe(false);
    expect(planSchema.safeParse({ goal: 'g', steps: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(planSchema.safeParse({ steps: ['a', 'b'] }).success).toBe(false);
  });

  it('verificationSchema requires a boolean complete', () => {
    expect(verificationSchema.safeParse({ complete: true, reason: 'r', missing: '' }).success).toBe(true);
    expect(verificationSchema.safeParse({ complete: 'yes', reason: 'r' }).success).toBe(false);
    expect(verificationSchema.safeParse({ complete: false, reason: 'r' }).success).toBe(true);
  });

  it('webSearchArgsSchema requires a proper query', () => {
    expect(webSearchArgsSchema.safeParse({ query: 'what is the capital of France' }).success).toBe(true);
    expect(webSearchArgsSchema.safeParse({ query: 'ab' }).success).toBe(false);
    expect(webSearchArgsSchema.safeParse({}).success).toBe(false);
  });

  it('default verification is never complete:true', () => {
    expect(DEFAULT_VERIFICATION.complete).toBe(false);
    expect(DEFAULT_PLAN.steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('structuredWithFallback (real implementation, mocked model client)', () => {
  it('validates good model JSON', async () => {
    openaiMock.create.mockResolvedValueOnce(completion('{"complete":true,"reason":"enough"}'));
    const schema = z.object({ complete: z.boolean(), reason: z.string().min(5) });
    const out = await structuredWithFallback(schema, [], { complete: false, reason: 'fallback' });
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ complete: true, reason: 'enough' });
    expect(out.model).toBe('test/primary-model');
  });

  it('returns ok:false with an honest incomplete fallback on malformed output', async () => {
    openaiMock.create.mockResolvedValueOnce(completion('not json at all'));
    const fallback = { complete: false, reason: 'fallback' };
    const out = await structuredWithFallback(z.object({ complete: z.boolean(), reason: z.string().min(5) }), [], fallback);
    expect(out.ok).toBe(false);
    expect(out.value.complete).toBe(false);
  });
});

describe('chatWithFallback model fallback', () => {
  it('falls back to the secondary model when the primary fails', async () => {
    openaiMock.create.mockImplementation(async (opts: { model?: string; messages?: unknown[] }) => {
      if (opts.model === 'test/primary-model') throw new Error('upstream down');
      return completion('{"complete":true,"reason":"done"}');
    });
    const out = await chatWithFallback([{ role: 'user', content: 'hi' }]);
    expect(out.model).toBe('test/fallback-model');
  });

  it('throws a real error when every model fails', async () => {
    openaiMock.create.mockRejectedValue(new Error('everything is down'));
    await expect(chatWithFallback([{ role: 'user', content: 'hi' }])).rejects.toThrow('everything is down');
  });
});