import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '@agentos/schemas';
import { BUILT_IN_AGENTS } from '../src/agents.js';
import { PolicyEngine, type PolicyCheckInput } from '../src/policy.js';
import type { AgentTool } from '../src/tool-registry.js';

const researcher: AgentDefinition = BUILT_IN_AGENTS.researcher;
const developer: AgentDefinition = BUILT_IN_AGENTS.developer;

function searchTool(riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low'): Pick<AgentTool, 'id' | 'category' | 'riskLevel' | 'permissions'> {
  return {
    id: 'web_search',
    category: 'search',
    riskLevel,
    permissions: [{ action: 'search', resource: 'web' }]
  };
}

function fsWriteTool(riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium'): Pick<AgentTool, 'id' | 'category' | 'riskLevel' | 'permissions'> {
  return {
    id: 'write_file',
    category: 'filesystem',
    riskLevel,
    permissions: [{ action: 'write', resource: 'filesystem' }]
  };
}

function fsReadTool(): Pick<AgentTool, 'id' | 'category' | 'riskLevel' | 'permissions'> {
  return {
    id: 'read_file',
    category: 'filesystem',
    riskLevel: 'low',
    permissions: [{ action: 'read', resource: 'filesystem' }]
  };
}

/** Custom agent without any allowed-list restriction — exercises grant/risk logic directly. */
function unrestrictedAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    ...researcher,
    toolPolicy: { ...researcher.toolPolicy, allowed: [], blocked: [], approvalRequiredFor: 'critical' },
    permissionPolicy: { grants: [], protectedResources: ['.git'] },
    ...overrides
  };
}

function baseInput(overrides: Partial<PolicyCheckInput> = {}): PolicyCheckInput {
  return {
    toolId: 'web_search',
    category: 'search',
    riskLevel: 'low',
    requiredPermission: { action: 'search', resource: 'web' },
    context: { userId: 'user-1', agentId: 'researcher' },
    ...overrides
  };
}

describe('PolicyEngine', () => {
  const engine = new PolicyEngine();

  it('approves a granted low-risk search for the researcher', () => {
    const decision = engine.evaluate(searchTool(), researcher, baseInput());
    expect(decision.outcome).toBe('approve');
  });

  it('denies a tool the agent lacks grants for (missing grant)', () => {
    const agent = unrestrictedAgent();
    const decision = engine.evaluate(
      fsWriteTool(),
      agent,
      baseInput({ toolId: 'write_file', category: 'filesystem', riskLevel: 'medium', requiredPermission: { action: 'write', resource: 'filesystem' } })
    );
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') {
      expect(decision.permanent).toBe(true);
      expect(decision.denialReasons).toContain('missing grant');
    }
  });

  it('denies tools that are explicitly blocked per agent', () => {
    const agent: AgentDefinition = { ...researcher, toolPolicy: { ...researcher.toolPolicy, blocked: ['web_search'] } };
    const decision = engine.evaluate(searchTool(), agent, baseInput());
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.denialReasons).toContain('blocked tool');
  });

  it('denies tools outside the agent allowed list (non-empty allowed excludes)', () => {
    const agent: AgentDefinition = { ...researcher }; // researcher allowed = ['web_search']
    const decision = engine.evaluate(
      fsWriteTool(),
      agent,
      baseInput({ toolId: 'write_file', category: 'filesystem', riskLevel: 'medium', requiredPermission: { action: 'write', resource: 'filesystem' } })
    );
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.denialReasons).toContain('tool not allowed');
  });

  it('denies requests touching protected resource prefixes despite a matching grant', () => {
    const decision = engine.evaluate(
      fsWriteTool('medium'),
      developer,
      baseInput({
        toolId: 'write_file',
        category: 'filesystem',
        riskLevel: 'medium',
        requiredPermission: { action: 'write', resource: 'filesystem' },
        resourcePath: '.git/refs/heads/main'
      })
    );
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.denialReasons).toContain('protected resource');
  });

  it('requires approval when a tool risk crosses the agent approval threshold', () => {
    const agent = unrestrictedAgent({ toolPolicy: { allowed: [], blocked: [], approvalRequiredFor: 'medium' }, permissionPolicy: { grants: [{ action: 'write', resource: 'filesystem' }] } });
    const decision = engine.evaluate(
      fsWriteTool('medium'),
      agent,
      baseInput({ toolId: 'write_file', category: 'filesystem', riskLevel: 'medium', requiredPermission: { action: 'write', resource: 'filesystem' } })
    );
    expect(decision.outcome).toBe('requireApproval');
    if (decision.outcome === 'requireApproval') expect(decision.riskLevel).toBe('medium');
  });

  it('context grants can supplement agent grants', () => {
    const agent = unrestrictedAgent({ toolPolicy: { allowed: [], blocked: [], approvalRequiredFor: 'medium' } });
    const decision = engine.evaluate(
      fsWriteTool('medium'),
      agent,
      baseInput({
        toolId: 'write_file',
        category: 'filesystem',
        riskLevel: 'medium',
        requiredPermission: { action: 'write', resource: 'filesystem' },
        context: { userId: 'user-1', agentId: 'developer', grants: [{ action: 'write', resource: 'filesystem' }] }
      })
    );
    expect(decision.outcome).toBe('requireApproval'); // grant satisfied via context; risk still gates
  });

  it('permission matching respects resource prefixes', () => {
    const agent = unrestrictedAgent({ permissionPolicy: { grants: [{ action: 'read', resource: 'filesystem' }], protectedResources: ['.git'] } });
    const check = baseInput({ toolId: 'read_file', category: 'filesystem', riskLevel: 'low', requiredPermission: { action: 'read', resource: 'filesystem/src' } });
    const decision = engine.evaluate(fsReadTool(), agent, check);
    expect(decision.outcome).toBe('approve');
  });

  it('tools with matching category but incompatible permission never approve', () => {
    // tool declares only 'write' ability; request needs 'read'
    const agent = unrestrictedAgent({ permissionPolicy: { grants: [{ action: 'write', resource: 'filesystem' }] } });
    const badTool: Pick<AgentTool, 'id' | 'category' | 'riskLevel' | 'permissions'> = {
      id: 'write_file',
      category: 'filesystem',
      riskLevel: 'low',
      permissions: [{ action: 'write', resource: 'filesystem' }]
    };
    const decision = engine.evaluate(badTool, agent, {
      ...baseInput({ toolId: 'write_file', category: 'filesystem', requiredPermission: { action: 'read', resource: 'filesystem' } })
    });
    expect(decision.outcome).toBe('deny');
  });
});