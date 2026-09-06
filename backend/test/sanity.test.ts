import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/lib/config.js';
import { ACTIVE_STATUSES, TERMINAL_STATUSES, isActiveStatus, isTerminalStatus } from '../src/types.js';

describe('module resolution sanity', () => {
  it('resolves .js -> .ts imports', () => {
    expect(ACTIVE_STATUSES).toContain('queued');
    expect(TERMINAL_STATUSES).toContain('cancelled');
  });

  it('parses a valid env object', () => {
    const env = parseConfig({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      OPENROUTER_API_KEY: 'sk-x',
      OPENROUTER_MODEL_PRIMARY: 'm/primary',
      OPENROUTER_MODEL_FALLBACK: 'm/fallback'
    });
    expect(env.PORT).toBe(10000);
  });

  it('throws on missing required env', () => {
    expect(() => parseConfig({})).toThrow('Invalid environment configuration');
  });
});

describe('status helpers', () => {
  it('classifies active and terminal statuses', () => {
    expect(isActiveStatus('queued')).toBe(true);
    expect(isActiveStatus('completed')).toBe(false);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('verifying')).toBe(false);
  });
});