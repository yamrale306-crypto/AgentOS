import { describe, it, expect } from 'vitest';
import { redact } from '../src/lib/logger.js';

describe('logger redaction', () => {
  it('redacts OpenAI-style API keys', () => {
    expect(redact('key sk-proj-abcdefgh1234567890-end')).toContain('[REDACTED]');
    expect(redact('key sk-proj-abcdefgh1234567890-end')).not.toContain('sk-proj');
  });

  it('redacts opaque service-role-looking base64 secrets', () => {
    const token = `eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturepart`;
    const out = redact(`header ${token} footer`);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('signaturepart');
  });

  it('redacts Bearer tokens', () => {
    const out = redact('Authorization: Bearer abc.def.ghi more');
    expect(out).not.toContain('abc.def.ghi');
  });

  it('leaves normal messages intact', () => {
    expect(redact('task completed normally')).toBe('task completed normally');
  });
});