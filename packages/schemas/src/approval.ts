/**
 * Approval workflow state. Approvals are persistent state, never a transient
 * side channel: a sensitive tool request creates an ApprovalRequest, and the
 * tool only executes after the request reaches `approved`.
 */

export const APPROVAL_STATES = ['requested', 'approved', 'rejected', 'expired', 'cancelled'] as const;

export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_TRANSITIONS: Record<ApprovalState, readonly ApprovalState[]> = {
  requested: ['approved', 'rejected', 'expired', 'cancelled'],
  approved: [],
  rejected: [],
  expired: [],
  cancelled: []
};

export const APPROVAL_DEFAULT_TTL_MS = 10 * 60 * 1000;

export function isApprovalState(value: unknown): value is ApprovalState {
  return typeof value === 'string' && (APPROVAL_STATES as readonly string[]).includes(value);
}

export function canTransitionApproval(from: ApprovalState, to: ApprovalState): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export function assertTransitionApproval(from: ApprovalState, to: ApprovalState): void {
  if (!canTransitionApproval(from, to)) {
    throw new Error(`Invalid approval state transition: ${from} -> ${to}.`);
  }
}

export function isApprovalTerminal(state: ApprovalState): boolean {
  return state === 'approved' || state === 'rejected' || state === 'expired' || state === 'cancelled';
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  taskId: string;
  userId: string;
  toolId: string;
  input: unknown;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  state: ApprovalState;
  requestedBy: string;
  decidedBy: string | null;
  reasonGiven: string | null;
  expiresAt: string;
  createdAt: string;
  decidedAt: string | null;
}