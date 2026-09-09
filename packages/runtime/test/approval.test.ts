import { describe, expect, it } from 'vitest';
import { ApprovalCoordinator } from '../src/approval.js';

const iso = (ms: number) => new Date(ms).toISOString();

describe('ApprovalCoordinator', () => {
  it('creates a requested approval with expiry', () => {
    const clock = () => 1_000_000;
    const c = new ApprovalCoordinator(clock);
    const request = c.create({
      runId: 'run-1',
      taskId: 'task-1',
      userId: 'user-1',
      toolId: 'write_file',
      input: { path: '.env' },
      riskLevel: 'high',
      reason: 'high risk',
      requestedBy: 'agent:developer'
    });
    expect(request.state).toBe('requested');
    expect(request.expiresAt).toBe(iso(1_000_000 + 10 * 60 * 1000));
    expect(c.count()).toBe(1);
  });

  it('approves a pending request (single transition)', () => {
    const c = new ApprovalCoordinator();
    const r = c.create({ runId: 'r', taskId: 't', userId: 'u', toolId: 'x', input: {}, riskLevel: 'medium', reason: 'r', requestedBy: 'agent' });
    expect(c.approve(r.id, 'admin')).toBe(true);
    expect(c.get(r.id)?.state).toBe('approved');
    expect(c.get(r.id)?.decidedBy).toBe('admin');
    expect(c.isPending(r.id)).toBe(false);
  });

  it('cannot double-decide a terminal request', () => {
    const c = new ApprovalCoordinator();
    const r = c.create({ runId: 'r', taskId: 't', userId: 'u', toolId: 'x', input: {}, riskLevel: 'low', reason: 'r', requestedBy: 'agent' });
    expect(c.approve(r.id, 'admin')).toBe(true);
    expect(c.reject(r.id, 'admin', 'changed my mind')).toBe(false);
    expect(c.get(r.id)?.state).toBe('approved');
  });

  it('rejects an unknown id', () => {
    const c = new ApprovalCoordinator();
    expect(c.approve('missing', 'admin')).toBe(false);
  });

  it('expires requests past their ttl', () => {
    let now = 0;
    const c = new ApprovalCoordinator(() => now);
    const r = c.create({ runId: 'r', taskId: 't', userId: 'u', toolId: 'x', input: {}, riskLevel: 'low', reason: 'r', requestedBy: 'agent', ttlMs: 1000 });
    expect(c.expireExpired(now)).toHaveLength(0);
    now = 1001;
    const expired = c.expireExpired(now);
    expect(expired).toContain(r.id);
    expect(c.get(r.id)?.state).toBe('expired');
    // a second sweep does not re-expire
    expect(c.expireExpired(now)).toHaveLength(0);
  });

  it('cancels a pending request', () => {
    const c = new ApprovalCoordinator();
    const r = c.create({ runId: 'r', taskId: 't', userId: 'u', toolId: 'x', input: {}, riskLevel: 'low', reason: 'r', requestedBy: 'agent' });
    expect(c.cancel(r.id, 'system')).toBe(true);
    expect(c.get(r.id)?.state).toBe('cancelled');
  });
});