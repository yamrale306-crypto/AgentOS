import type { AgentDefinition, AgentToolPolicy, BuiltInAgentId } from '@agentos/schemas';

/**
 * Built-in agent policies. An agent is configuration and policy — never a
 * custom execution implementation. All built-in agents share the generic
 * runtime; the difference is instructions and policy gates.
 */

const BASE_DEFINITION: Pick<AgentDefinition, 'version' | 'memoryPolicy' | 'verificationPolicy'> = {
  version: 1,
  memoryPolicy: { enabled: false, scope: 'task' },
  verificationPolicy: { enabled: true, mode: 'model-consistency' }
};

const COMMON_TOOL_POLICY: AgentToolPolicy = {
  allowed: ['web_search'],
  blocked: [] as string[],
  approvalRequiredFor: 'high'
};

export const BUILT_IN_AGENTS: Record<BuiltInAgentId, AgentDefinition> = {
  developer: {
    ...BASE_DEFINITION,
    id: 'developer',
    name: 'Developer',
    description: 'Understands projects, plans changes, executes work, and verifies results.',
    instructions:
      'You are AgentOS Developer. Understand the user goal, inspect the relevant project files, plan a minimal change, execute it with the available tools, run verification, and report exactly what changed.',
    modelPolicy: { defaultMode: 'balanced', allowedProviders: [], preferLocal: true, maxTokens: 4096 },
    toolPolicy: { ...COMMON_TOOL_POLICY, allowed: [] },
    permissionPolicy: { grants: [{ action: 'read', resource: 'filesystem' }, { action: 'write', resource: 'filesystem' }], protectedResources: ['.git'] }
  },
  researcher: {
    ...BASE_DEFINITION,
    id: 'researcher',
    name: 'Researcher',
    description: 'Researches topics on the public web and delivers a factual, sourced answer.',
    instructions:
      'You are AgentOS Researcher. Understand the goal, form a short plan, search the web for primary sources, analyze findings, synthesize a sourced answer, and verify it satisfies the goal.',
    modelPolicy: { defaultMode: 'auto', maxTokens: 1800 },
    toolPolicy: { ...COMMON_TOOL_POLICY },
    permissionPolicy: { grants: [{ action: 'search', resource: 'web' }] }
  },
  planner: {
    ...BASE_DEFINITION,
    id: 'planner',
    name: 'Planner',
    description: 'Breaks objectives into concrete, ordered execution steps.',
    instructions:
      'You are AgentOS Planner. Turn the objective into a concise, ordered plan with concrete steps and explicit dependencies. Do not execute work yourself.',
    modelPolicy: { defaultMode: 'auto', maxTokens: 1200 },
    toolPolicy: { ...COMMON_TOOL_POLICY, allowed: [] },
    permissionPolicy: { grants: [] }
  },
  tester: {
    ...BASE_DEFINITION,
    id: 'tester',
    name: 'Tester',
    description: 'Verifies changes with executable checks and honest failure reports.',
    instructions:
      'You are AgentOS Tester. Inspect the changed files, run the relevant verification steps, and report pass/fail honestly. Never claim success you did not observe.',
    modelPolicy: { defaultMode: 'balanced', maxTokens: 2000 },
    toolPolicy: { ...COMMON_TOOL_POLICY, allowed: [] },
    permissionPolicy: { grants: [{ action: 'read', resource: 'filesystem' }] }
  },
  reviewer: {
    ...BASE_DEFINITION,
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews agent output against the original objective and flags gaps.',
    instructions:
      'You are AgentOS Reviewer. Compare the work delivered against the original objective. Report what satisfies the goal and what is still missing. Be precise and concise.',
    modelPolicy: { defaultMode: 'auto', maxTokens: 1500 },
    toolPolicy: { ...COMMON_TOOL_POLICY, allowed: [] },
    permissionPolicy: { grants: [{ action: 'read', resource: 'filesystem' }] }
  }
};

export function builtInAgent(id: string): AgentDefinition | null {
  return (BUILT_IN_AGENTS as Record<string, AgentDefinition>)[id] ?? null;
}

export function listBuiltInAgents(): AgentDefinition[] {
  return Object.values(BUILT_IN_AGENTS);
}