import type { AgentDefinition, Permission, ToolCategory } from '@agentos/schemas';
import { permissionMatches, riskAtLeast, type RiskLevel, RISK_LEVELS } from '@agentos/schemas';
import type { AgentTool } from './tool-registry.js';

/**
 * Policy engine. Every tool request is evaluated to a `PolicyDecision` before
 * the tool executes:
 *
 * - `deny`        — hard-blocked (not in agent grants, explicitly blocked, or
 *                   protected resource). Not approvable.
 * - `approve`     — runs immediately.
 * - `requireApproval` — runs only after an ApprovalRequest reaches `approved`.
 *
 * Decisions are cheap, pure and context-free (no I/O), so the same function is
 * safe to call both inside the worker and in a sandbox/audit path.
 */

export interface PolicyCheckInput {
  toolId: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  /** Effective resource path of the request (for protected-resource checks). */
  resourcePath?: string;
  /** Capability the request actually needs, e.g. { action: 'write', resource: 'filesystem' }. */
  requiredPermission: Permission;
  context: PolicyContext;
}

export interface PolicyContext {
  userId: string;
  agentId: string;
  /** Applied inline (e.g. a flagged tool override). Empty means no extra grants. */
  grants?: Permission[];
  /** Risk threshold override for this request. */
  approvalThreshold?: RiskLevel;
}

export type PolicyDecision =
  | { outcome: 'approve'; reason: string; riskLevel: RiskLevel; requiredPermission: Permission }
  | {
      outcome: 'deny';
      reason: string;
      riskLevel: RiskLevel;
      requiredPermission: Permission;
      permanent: true;
      denialReasons: string[];
    }
  | {
      outcome: 'requireApproval';
      reason: string;
      riskLevel: RiskLevel;
      requiredPermission: Permission;
      ttlMs?: number;
    };

export function isPermanentPolicyDecision(
  decision: PolicyDecision
): decision is Extract<PolicyDecision, { outcome: 'deny' }> {
  return decision.outcome === 'deny';
}

export class PolicyEngine {
  /**
   * Evaluate one tool request against the agent's policy and context.
   * Order of checks matters and is documented below.
   */
  evaluate(tool: Pick<AgentTool, 'id' | 'category' | 'riskLevel' | 'permissions'>, agent: AgentDefinition, input: PolicyCheckInput): PolicyDecision {
    const ctx = input.context;
    const approvalThreshold = ctx.approvalThreshold ?? riskFromPolicy(agent);

    // 1. Explicitly blocked tool ids always deny.
    if (agent.toolPolicy.blocked?.includes(tool.id)) {
      return deny(input, `Tool "${tool.id}" is blocked for agent "${agent.id}"`, ['blocked tool']);
    }

    // 2. `allowed` narrows the available tool pool. Empty means "registry default".
    if (agent.toolPolicy.allowed && agent.toolPolicy.allowed.length > 0 && !agent.toolPolicy.allowed.includes(tool.id)) {
      return deny(input, `Tool "${tool.id}" is not allowed for agent "${agent.id}"`, ['tool not allowed']);
    }

    // 3. The tool must declare the capability it needs, and the effective grant
    //    (agent grants + context grants) must cover it.
    const required = input.requiredPermission;
    const effectiveGrants = [...(agent.permissionPolicy.grants ?? []), ...(ctx.grants ?? [])];
    const covered = tool.permissions.some((declared) => permissionMatches(required, declared) && effectiveGrants.some((g) => permissionMatches(required, g)));
    if (!covered) {
      return deny(input, `Agent "${agent.id}" lacks permission ${required.action}:${required.resource}`, ['missing grant']);
    }

    // 4. Protected resources never match, even with a grant.
    if (input.resourcePath) {
      const protectedHit = (agent.permissionPolicy.protectedResources ?? []).some((prefix) => input.resourcePath?.startsWith(prefix));
      if (protectedHit) {
        return deny(input, `Resource path "${input.resourcePath}" is protected for agent "${agent.id}"`, ['protected resource']);
      }
    }

    // 5. Risk gate: requests above the approval threshold require approval.
    if (riskAtLeast(tool.riskLevel, approvalThreshold)) {
      return {
        outcome: 'requireApproval',
        reason: `Tool "${tool.id}" risk "${tool.riskLevel}" exceeds approval threshold "${approvalThreshold}"`,
        riskLevel: tool.riskLevel,
        requiredPermission: required
      };
    }

    return { outcome: 'approve', reason: `Tool "${tool.id}" cleared all policy checks`, riskLevel: tool.riskLevel, requiredPermission: required };
  }
}

function riskFromPolicy(agent: AgentDefinition): RiskLevel {
  return agent.toolPolicy.approvalRequiredFor ?? 'critical';
}

function deny(input: PolicyCheckInput, reason: string, denialReasons: string[]): PolicyDecision {
  return {
    outcome: 'deny',
    reason,
    riskLevel: input.riskLevel,
    requiredPermission: input.requiredPermission,
    permanent: true,
    denialReasons
  };
}

export function isKnownRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && (RISK_LEVELS as readonly string[]).includes(value);
}