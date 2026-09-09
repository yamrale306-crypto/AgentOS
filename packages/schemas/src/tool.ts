import type { z } from 'zod';

/**
 * Shared tool-contract value types. The `AgentTool` interface itself lives in
 * `@agentos/runtime` (it is runtime-domain); these are the primitive types every
 * tool registry, policy engine, and approval workflow shares.
 */

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && (RISK_LEVELS as readonly string[]).includes(value);
}

export const RISK_ORDER: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function riskAtLeast(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER[level] >= RISK_ORDER[threshold];
}

export const TOOL_CATEGORIES = ['filesystem', 'terminal', 'git', 'search', 'web', 'browser', 'http', 'database'] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * A granular capability grant. `action` is a verb like `read`, `write`,
 * `delete`, `execute`, `push`; `resource` is a domain like `filesystem`,
 * `git`, `terminal`, `web`. Uses no glob strings by design — the policy
 * engine matches exact pairs (with optional resource-prefix support).
 */
export interface Permission {
  action: string;
  resource: string;
}

export function permissionKey(permission: Permission): string {
  return `${permission.action}:${permission.resource}`;
}

export function permissionMatches(required: Permission, granted: Permission): boolean {
  if (required.action !== granted.action) return false;
  return required.resource === granted.resource || required.resource.startsWith(`${granted.resource}/`);
}

export interface ToolResultOk<T = unknown> {
  ok: true;
  data: T;
}

export interface ToolResultErr {
  ok: false;
  error: string;
  retryable?: boolean;
}

export type ToolResult<T = unknown> = ToolResultOk<T> | ToolResultErr;

export interface ToolLimits {
  maxResults?: number;
  maxBytes?: number;
  maxFiles?: number;
  timeoutMs?: number;
}

/** Execution context handed to every tool. Never contains model internals. */
export interface ToolContext {
  runId: string;
  taskId: string;
  agentId: string;
  userId: string;
  cwd?: string;
  limits?: ToolLimits;
}

/** Static, validation-time tool metadata (safe to inspect before execution). */
export interface ToolContractMetadata {
  id: string;
  version: string;
  description: string;
  category: ToolCategory;
  permissions: Permission[];
  riskLevel: RiskLevel;
}

export function zodTypeFromSchema(schema: unknown): z.ZodType | null {
  return typeof schema === 'object' && schema !== null && '_def' in schema ? (schema as z.ZodType) : null;
}