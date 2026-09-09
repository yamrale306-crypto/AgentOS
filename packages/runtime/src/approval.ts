import type { ApprovalRequest, ApprovalState } from '@agentos/schemas';
import { APPROVAL_TRANSITIONS, canTransitionApproval, isApprovalTerminal } from '@agentos/schemas';

/**
 * Approval lifecycle. An `ApprovalRequest` is created for a sensitive tool
 * request; the request transitions through the shared approval state machine.
 * `approve`/`reject` are idempotent-ish — a terminal request cannot change
 * state and the methods return `false` instead of throwing.
 */

export class ApprovalCoordinator {
  private readonly requests = new Map<string, ApprovalRequest>();

  constructor(private readonly clock: () => number = Date.now) {}

  private stamp(ms: number): string {
    return new Date(ms).toISOString();
  }

  create(input: {
    runId: string;
    taskId: string;
    userId: string;
    toolId: string;
    input: unknown;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    requestedBy: string;
    ttlMs?: number;
    id?: string;
  }): ApprovalRequest {
    const now = this.clock();
    const request: ApprovalRequest = {
      id: input.id ?? `appr_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      taskId: input.taskId,
      userId: input.userId,
      toolId: input.toolId,
      input: input.input,
      riskLevel: input.riskLevel,
      reason: input.reason,
      state: 'requested',
      requestedBy: input.requestedBy,
      decidedBy: null,
      reasonGiven: null,
      expiresAt: this.stamp(now + (input.ttlMs ?? 10 * 60 * 1000)),
      createdAt: this.stamp(now),
      decidedAt: null
    };
    this.requests.set(request.id, request);
    return request;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /** Approve the request; returns false if it is no longer in 'requested' state. */
  approve(id: string, decidedBy: string, reasonGiven?: string): boolean {
    return this.decide(id, 'approved', decidedBy, reasonGiven);
  }

  /** Reject the request; returns false if it is no longer in 'requested' state. */
  reject(id: string, decidedBy: string, reasonGiven?: string): boolean {
    return this.decide(id, 'rejected', decidedBy, reasonGiven);
  }

  /**
   * Expire any 'requested' request whose ttl has passed (or force-expire).
   * Returns the ids that were expired.
   */
  expireExpired(nowMs?: number): string[] {
    const now = nowMs ?? this.clock();
    const expired: string[] = [];
    for (const request of this.requests.values()) {
      if (request.state !== 'requested') continue;
      if (Date.parse(request.expiresAt) <= now) {
        const changed = this.decide(request.id, 'expired', 'system', 'request expired');
        if (changed) expired.push(request.id);
      }
    }
    return expired;
  }

  cancel(id: string, decidedBy: string): boolean {
    return this.decide(id, 'cancelled', decidedBy);
  }

  isPending(id: string): boolean {
    const request = this.requests.get(id);
    return request?.state === 'requested';
  }

  list(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }

  count(): number {
    return this.requests.size;
  }

  private decide(id: string, to: ApprovalState, decidedBy: string, reasonGiven?: string): boolean {
    const request = this.requests.get(id);
    if (!request) return false;
    if (isApprovalTerminal(request.state)) return false;
    if (!canTransitionApproval(request.state, to)) return false;
    const now = this.stamp(this.clock());
    this.requests.set(id, {
      ...request,
      state: to,
      decidedBy,
      reasonGiven: reasonGiven ?? null,
      decidedAt: now
    });
    return true;
  }
}

export { APPROVAL_TRANSITIONS, canTransitionApproval, isApprovalTerminal };