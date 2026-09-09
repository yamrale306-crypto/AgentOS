import type { z } from 'zod';
import type { Permission, RiskLevel, ToolCategory, ToolContext, ToolResult } from '@agentos/schemas';

/**
 * The tool contract every AgentOS tool implements. Tools never bypass the
 * policy engine — the runtime resolves a model tool request into an `AgentTool`
 * and only then evaluates it against the agent's policy.
 */
export interface AgentTool<In = unknown, Out = unknown> {
  id: string;
  version: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType<In>;
  outputSchema: z.ZodType<Out> | null;
  permissions: Permission[];
  riskLevel: RiskLevel;
  execute(input: In, context: ToolContext): Promise<ToolResult<Out>>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool?.id) throw new Error('Tool registry requires a tool with an id.');
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool "${tool.id}" is already registered.`);
    }
    this.tools.set(tool.id, tool);
  }

  unregister(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  get(toolId: string): AgentTool | undefined {
    return this.tools.get(toolId);
  }

  require(toolId: string): AgentTool {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Unknown tool "${toolId}".`);
    return tool;
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  size(): number {
    return this.tools.size;
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  listForCategory(category: ToolCategory): AgentTool[] {
    return this.list().filter((t) => t.category === category);
  }

  clear(): void {
    this.tools.clear();
  }
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}