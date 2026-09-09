import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BUILT_IN_AGENTS } from '../src/agents.js';
import { ApprovalCoordinator } from '../src/approval.js';
import { ExecutionLoop } from '../src/execution-loop.js';
import { createToolRegistry, type AgentTool } from '../src/tool-registry.js';
import type { PolicyCheckInput } from '../src/policy.js';

function searchTool(): AgentTool {
  return {
    id: 'web_search',
    version: '1.0.0',
    description: 'Search the web',
    category: 'search',
    inputSchema: z.object({ query: z.string().min(3) }),
    outputSchema: null,
    permissions: [{ action: 'search', resource: 'web' }],
    riskLevel: 'low',
    execute: vi.fn(async () => ({ ok: true, data: [{ title: 'Answer', url: 'https://example.com', snippet: 'snippet' }] }))
  };
}

function writeFileTool(riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'high'): AgentTool {
  return {
    id: 'write_file',
    version: '1.0.0',
    description: 'Write a file',
    category: 'filesystem',
    inputSchema: z.object({ path: z.string() }),
    outputSchema: null,
    permissions: [{ action: 'write', resource: 'filesystem' }],
    riskLevel,
    execute: vi.fn(async () => ({ ok: true, data: { written: true } }))
  };
}

function policyInput(overrides: Partial<PolicyCheckInput> = {}): PolicyCheckInput {
  return {
    toolId: 'web_search',
    category: 'search',
    riskLevel: 'low',
    requiredPermission: { action: 'search', resource: 'web' },
    context: { userId: 'user-1', agentId: 'researcher' },
    ...overrides
  };
}

function context(over: Partial<Record<string, unknown>> = {}) {
  return { runId: 'run-1', taskId: 'task-1', agentId: 'researcher', userId: 'user-1', ...over };
}

describe('ExecutionLoop', () => {
  it('approves and executes a granted low-risk search', async () => {
    const registry = createToolRegistry();
    const tool = searchTool();
    registry.register(tool);

    const onDecision = vi.fn();
    const approvals = new ApprovalCoordinator();
    const loop = new ExecutionLoop(registry, approvals, { agent: BUILT_IN_AGENTS.researcher, onDecision });

    const step = await loop.step({ toolId: 'web_search', input: { query: 'capital of france' } }, context() as never, policyInput());

    expect(step.allowed).toBe(true);
    expect(step.error).toBeNull();
    expect(step.approvalId).toBeNull();
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision.mock.calls[0][0].outcome).toBe('approve');
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect((step.output as { ok: boolean }).ok).toBe(true);
  });

  it('denies without executing when policy denies', async () => {
    const registry = createToolRegistry();
    const tool = writeFileTool('high');
    registry.register(tool);
    const loop = new ExecutionLoop(registry, new ApprovalCoordinator(), { agent: BUILT_IN_AGENTS.researcher, onDecision: async () => {} });

    const step = await loop.step({ toolId: 'write_file', input: { path: '/etc/passwd' } }, context() as never, {
      ...policyInput({ toolId: 'write_file', category: 'filesystem', riskLevel: 'high', requiredPermission: { action: 'write', resource: 'filesystem' } })
    });

    expect(step.allowed).toBe(false);
    expect(step.error).toContain('allow');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('surfaces approval requests without running the tool', async () => {
    const registry = createToolRegistry();
    const tool = writeFileTool('high');
    registry.register(tool);
    const approvals = new ApprovalCoordinator();
    const loop = new ExecutionLoop(registry, approvals, { agent: BUILT_IN_AGENTS.developer, onDecision: async () => {} });

    const step = await loop.step({ toolId: 'write_file', input: { path: 'src/a.ts' } }, { ...context(), agentId: 'developer' } as never, {
      ...policyInput({ toolId: 'write_file', category: 'filesystem', riskLevel: 'high', requiredPermission: { action: 'write', resource: 'filesystem' }, context: { userId: 'user-1', agentId: 'developer' } })
    });

    expect(step.allowed).toBe(false);
    expect(step.approvalId).toBeTruthy();
    expect(approvals.isPending(step.approvalId as string)).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('returns an error for unknown tools', async () => {
    const registry = createToolRegistry();
    const loop = new ExecutionLoop(registry, new ApprovalCoordinator(), { agent: BUILT_IN_AGENTS.researcher, onDecision: async () => {} });
    const step = await loop.step({ toolId: 'ghost', input: {} }, context() as never, policyInput());
    expect(step.allowed).toBe(false);
    expect(step.error).toContain('Unknown tool');
  });

  it('returns a failed ToolResult (not a throw) when execute rejects', async () => {
    const registry = createToolRegistry();
    const tool = searchTool();
    (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('provider down'));
    registry.register(tool);
    const loop = new ExecutionLoop(registry, new ApprovalCoordinator(), { agent: BUILT_IN_AGENTS.researcher, onDecision: async () => {} });

    const step = await loop.step({ toolId: 'web_search', input: { query: 'hello world' } }, context() as never, policyInput());
    expect(step.allowed).toBe(true);
    expect(step.output).toEqual({ ok: false, error: 'provider down', retryable: true });
  });

  it('rejects invalid tool input without executing', async () => {
    const registry = createToolRegistry();
    const tool = searchTool();
    registry.register(tool);
    const loop = new ExecutionLoop(registry, new ApprovalCoordinator(), { agent: BUILT_IN_AGENTS.researcher, onDecision: async () => {} });

    const step = await loop.step({ toolId: 'web_search', input: { query: 'x' } }, context() as never, policyInput());
    expect(step.allowed).toBe(true);
    expect(step.output).toEqual({ ok: false, error: expect.stringContaining('Invalid tool input'), retryable: false });
    expect(tool.execute).not.toHaveBeenCalled();
  });
});