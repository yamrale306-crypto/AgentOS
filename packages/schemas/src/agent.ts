import type { AiMode } from './ai.js';

export interface ResearchPlan {
  goal: string;
  steps: string[];
}

export interface VerificationResult {
  complete: boolean;
  reason: string;
  missing?: string | null;
}

// ---------------------------------------------------------------------------
// Agent definitions — policy, never a custom execution implementation.
// ---------------------------------------------------------------------------

export const BUILT_IN_AGENT_IDS = ['developer', 'researcher', 'planner', 'tester', 'reviewer'] as const;

export type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[number];

export type MemoryScope = 'conversation' | 'task' | 'project' | 'agent' | 'knowledge';

export type VerificationMode = 'model-consistency' | 'tool-assisted' | 'manual';

export interface AgentModelPolicy {
  defaultMode: AiMode;
  /** Restrict the provider pool (provider ids). Empty means "any". */
  allowedProviders?: string[];
  /** Prefer local/private providers for privacy-sensitive work. */
  preferLocal?: boolean;
  maxTokens: number;
}

export interface AgentToolPolicy {
  /** Tool ids the agent may call. Empty means "registry default" (all). */
  allowed?: string[];
  /** Tool ids that are hard-blocked regardless of the registry. */
  blocked?: string[];
  /** Risk threshold above which tool calls require an approval. */
  approvalRequiredFor?: 'medium' | 'high' | 'critical';
}

export interface AgentPermissionPolicy {
  /** Capabilities granted to the agent, e.g. [{ action: 'read', resource: 'filesystem' }]. */
  grants: Array<{ action: string; resource: string }>;
  /** Protected resources (path prefixes) the agent may never touch. */
  protectedResources?: string[];
}

export interface AgentMemoryPolicy {
  enabled: boolean;
  scope: MemoryScope;
}

export interface AgentVerificationPolicy {
  enabled: boolean;
  mode: VerificationMode;
}

export interface AgentDefinition {
  id: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  modelPolicy: AgentModelPolicy;
  toolPolicy: AgentToolPolicy;
  permissionPolicy: AgentPermissionPolicy;
  memoryPolicy: AgentMemoryPolicy;
  verificationPolicy: AgentVerificationPolicy;
  createdAt?: string;
}