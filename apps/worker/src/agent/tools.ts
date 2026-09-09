import { webSearchArgsSchema, type SearchResult } from '@agentos/schemas';
import { createDefaultProjectToolRegistry, webSearch } from '@agentos/tools';
import { BUILT_IN_AGENTS, PolicyEngine, createToolRegistry, type AgentTool, type PolicyCheckInput } from '@agentos/runtime';

/**
 * The worker's web_search tool, registered through the runtime ToolRegistry
 * and gated by the shared PolicyEngine before execution. The worker stays a
 * research pipeline (not a fully generic agent loop) — this wiring is what
 * gives it the same policy guarantees as every other agent: a model tool
 * request can only ever execute after the policy engine approves it.
 */

export const SEARCH_RESULTS_PER_CALL = 5;
export const WORKER_AGENT_ID = 'researcher';

export const webSearchTool: AgentTool<{ query: string }, SearchResult[]> = {
  id: 'web_search',
  version: '1.0.0',
  description: 'Search the public web and return a few title, URL and snippet results for the given query.',
  category: 'search',
  inputSchema: webSearchArgsSchema,
  outputSchema: null,
  permissions: [{ action: 'search', resource: 'web' }],
  riskLevel: 'low',
  async execute(input) {
    try {
      const results = await webSearch(input.query, SEARCH_RESULTS_PER_CALL);
      return { ok: true, data: results };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Search failed', retryable: true };
    }
  }
};

export const workerRegistry = createToolRegistry();

for (const tool of createDefaultProjectToolRegistry(process.cwd()).list()) {
  workerRegistry.register(tool);
}
workerRegistry.register(webSearchTool);

export const workerAgent = BUILT_IN_AGENTS[WORKER_AGENT_ID];
export const workerPolicy = new PolicyEngine();

export function policyCheckForSearch(userId: string): PolicyCheckInput {
  return {
    toolId: webSearchTool.id,
    category: webSearchTool.category,
    riskLevel: webSearchTool.riskLevel,
    requiredPermission: { action: 'search', resource: 'web' },
    context: { userId, agentId: WORKER_AGENT_ID }
  };
}