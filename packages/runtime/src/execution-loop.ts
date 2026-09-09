import type { AgentDefinition, ToolContext, ToolResult } from '@agentos/schemas';
import { permissionKey } from '@agentos/schemas';
import type { AgentTool, ToolRegistry } from './tool-registry.js';
import { PolicyEngine, type PolicyCheckInput, type PolicyDecision } from './policy.js';
import { ApprovalCoordinator } from './approval.js';

/**
 * The agent execution loop. The runtime drives the loop by handing every model
 * tool request through the policy engine; the model itself never executes,
 * inspects policy, or bypasses gates.
 *
 * `loop` is intentionally side-effect-light: it depends on injected callbacks
 * (`onDecision`, `executeTool`, `modelStep`) so persistence, model access and
 * testability stay clean.
 */

export interface StepResult {
  toolId: string | null;
  decision: PolicyDecision | null;
  output: ToolResult<unknown> | null;
  approvalId: string | null;
  allowed: boolean;
  error: string | null;
}

export interface ExecuteToolArgs<In> {
  tool: AgentTool<In>;
  input: In;
  context: ToolContext;
}

export interface ExecutionLoopDeps {
  agent: AgentDefinition;
  /** Persist `requiredPermission`: grant decisions, deny decisions and approvals. */
  onDecision: (decision: PolicyDecision, tool: AgentTool, context: ToolContext) => Promise<void>;
  /** Actually run the tool. The default runs `tool.execute` directly. */
  executeTool?: <In>(args: ExecuteToolArgs<In>) => Promise<ToolResult<unknown>>;
  /**
   * Model interaction point: called when a decision is `approve` so the caller
   * can send the tool output back to the model. Return value is ignored.
   */
  onToolResult?: (result: StepResult) => Promise<void> | void;
}

export class ExecutionLoop {
  private readonly policy = new PolicyEngine();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly approvals: ApprovalCoordinator,
    private readonly deps: ExecutionLoopDeps
  ) {}

  get policyEngine(): PolicyEngine {
    return this.policy;
  }

  /**
   * Resolve, gate and (if allowed) execute one model tool request.
   * Returns a `StepResult` describing what happened — never throws for a
   * denied or failed tool call.
   */
  async step<In>(request: { toolId: string; input: unknown }, context: ToolContext, input: PolicyCheckInput): Promise<StepResult> {
    const tool = this.registry.get(request.toolId);
    if (!tool) {
      return { toolId: request.toolId, decision: null, output: null, approvalId: null, allowed: false, error: `Unknown tool "${request.toolId}".` };
    }

    const decision = this.policy.evaluate(tool, this.deps.agent, input);
    await this.deps.onDecision(decision, tool, context);

    if (decision.outcome === 'deny') {
      return {
        toolId: tool.id,
        decision,
        output: null,
        approvalId: null,
        allowed: false,
        error: `${decision.reason} (${decision.denialReasons.join(', ')})`
      };
    }

    if (decision.outcome === 'requireApproval') {
      const requestEntity = this.approvals.create({
        runId: context.runId,
        taskId: context.taskId,
        userId: context.userId,
        toolId: tool.id,
        input: request.input,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
        requestedBy: `agent:${context.agentId}`,
        ttlMs: decision.ttlMs
      });
      if (!this.approvals.isPending(requestEntity.id)) {
        return { toolId: tool.id, decision, output: null, approvalId: null, allowed: false, error: 'Approval expired before it could be decided.' };
      }
      // Wait for the decision loop in `run` result; here we treat still-requested
      // as blocked until approved.
      return {
        toolId: tool.id,
        decision,
        output: null,
        approvalId: requestEntity.id,
        allowed: false,
        error: `Approval required (${requestEntity.id}): ${requestEntity.reason}`
      };
    }

    // outcome === 'approve'
    const result = await this.runTool({ tool, input: request.input as In, context });
    const step: StepResult = {
      toolId: tool.id,
      decision,
      output: result,
      approvalId: null,
      allowed: true,
      error: result.ok ? null : result.error
    };
    await this.deps.onToolResult?.(step);
    return step;
  }

  private async runTool<In>(args: ExecuteToolArgs<In>): Promise<ToolResult<unknown>> {
    if (this.deps.executeTool) {
      return this.deps.executeTool(args);
    }
    try {
      const parsed = args.tool.inputSchema.safeParse(args.input);
      if (!parsed.success) {
        return { ok: false, error: `Invalid tool input for "${args.tool.id}": ${parsed.error.message}`, retryable: false };
      }
      return await args.tool.execute(parsed.data, args.context);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
    }
  }
}

export function requiredPermissionForTool(tool: AgentTool): PolicyCheckInput['requiredPermission'] {
  const permission = tool.permissions[0];
  if (!permission) throw new Error(`Tool "${tool.id}" must declare at least one permission.`);
  return permission;
}

export const permissionKey_ = permissionKey;