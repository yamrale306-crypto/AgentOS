import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createToolRegistry, type AgentTool, ToolRegistry } from '../src/tool-registry.js';

function makeTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    id: 'web_search',
    version: '1.0.0',
    description: 'Search the web',
    category: 'search',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: null,
    permissions: [{ action: 'search', resource: 'web' }],
    riskLevel: 'low',
    execute: vi.fn(async () => ({ ok: true, data: [] })),
    ...overrides
  };
}

describe('ToolRegistry', () => {
  it('registers, retrieves and lists tools', () => {
    const registry = createToolRegistry();
    registry.register(makeTool());
    expect(registry.has('web_search')).toBe(true);
    expect(registry.get('web_search')?.id).toBe('web_search');
    expect(registry.size()).toBe(1);
    expect(registry.list()).toHaveLength(1);
    expect(registry.listForCategory('search')).toHaveLength(1);
    expect(registry.listForCategory('database')).toHaveLength(0);
  });

  it('throws on duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    expect(() => registry.register(makeTool())).toThrow('already registered');
  });

  it('throws on unregisterable require()', () => {
    const registry = new ToolRegistry();
    expect(() => registry.require('nope')).toThrow('Unknown tool "nope"');
  });

  it('unregisters and clears', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool());
    expect(registry.unregister('web_search')).toBe(true);
    expect(registry.has('web_search')).toBe(false);
    registry.register(makeTool());
    registry.clear();
    expect(registry.size()).toBe(0);
  });
});