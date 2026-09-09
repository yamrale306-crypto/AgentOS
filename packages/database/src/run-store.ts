import { supabaseAdmin } from './client.js';
import { notFound, conflict } from './errors.js';
import type { Checkpoint, CheckpointStore } from '@agentos/schemas';
import {
  isApprovalState,
  RUN_STATES,
  RUN_TRANSITIONS,
  canTransitionRun,
  isRunState,
  type AgentEventType,
  type ApprovalRequest,
  type ApprovalState,
  type RunRecord,
  type RunState
} from '@agentos/schemas';

type JsonRecord = { [key: string]: unknown };

const RUN_FIELDS =
  'id,task_id,user_id,agent_id,state,attempt_number,model,provider,goal,verification,metadata,usage,error,started_at,paused_at,completed_at,created_at,updated_at';

/**
 * Durable store for the agent runtime (migration 004 tables). Every write goes
 * through the service role; browser clients only ever read via RLS-on-row.
 *
 * This is intentionally a thin layer: no business logic, just typed mapping
 * between the DB rows and the `@agentos/schemas` runtime types, plus the same
 * ownership/state guards the task store uses.
 */
export class RuntimeStore {
  // ------------------------------------------------------------------ runs
  async createRun(input: {
    taskId: string;
    userId: string;
    agentId: string;
    goal: string;
    attemptNumber?: number;
    model?: string | null;
    provider?: string | null;
  }): Promise<RunRecord> {
    const { data, error } = await supabaseAdmin
      .from('runs')
      .insert({
        task_id: input.taskId,
        user_id: input.userId,
        agent_id: input.agentId,
        goal: input.goal,
        attempt_number: input.attemptNumber ?? 1,
        model: input.model ?? null,
        provider: input.provider ?? null,
        state: 'QUEUED'
      })
      .select(RUN_FIELDS)
      .single();
    if (error) throw error;
    return mapRun(data as JsonRecord);
  }

  async getRun(runId: string): Promise<RunRecord> {
    const { data, error } = await supabaseAdmin.from('runs').select(RUN_FIELDS).eq('id', runId).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Run not found.');
    return mapRun(data as JsonRecord);
  }

  async getRunByTask(taskId: string): Promise<RunRecord | null> {
    const { data, error } = await supabaseAdmin.from('runs').select(RUN_FIELDS).eq('task_id', taskId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapRun(data as JsonRecord);
  }

  async updateRun(runId: string, patch: JsonRecord): Promise<void> {
    const { error } = await supabaseAdmin
      .from('runs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', runId);
    if (error) throw error;
  }

  /** Guarded run state transition. Throws a conflict on an invalid edge. */
  async transitionRun(runId: string, from: RunState, to: RunState): Promise<void> {
    if (!canTransitionRun(from, to)) {
      throw conflict(`Invalid run state transition: ${from} -> ${to}.`);
    }
    const patch: JsonRecord = { state: to, updated_at: new Date().toISOString() };
    if (to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED') patch.completed_at = new Date().toISOString();
    if (to === 'PAUSED') patch.paused_at = new Date().toISOString();
    if (to === 'EXECUTING') patch.started_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin.from('runs').update(patch).eq('id', runId).eq('state', from).select('id');
    if (error) throw error;
    if (!Array.isArray(data) || data.length === 0) {
      const run = await this.getRun(runId);
      throw conflict(`Run cannot transition to ${to} while in state "${run.state}".`);
    }
  }

  async listRuns(userId: string, limit = 50): Promise<RunRecord[]> {
    const { data, error } = await supabaseAdmin.from('runs').select(RUN_FIELDS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((d) => mapRun(d as JsonRecord));
  }

  // ------------------------------------------------------------ run_steps
  async appendStep(step: { runId: string; sequence: number; stage: string; input?: unknown; output?: unknown; model?: string | null; error?: string | null }): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('run_steps')
      .insert({
        run_id: step.runId,
        sequence: step.sequence,
        stage: step.stage,
        input: step.input ?? null,
        output: step.output ?? null,
        model: step.model ?? null,
        error: step.error ?? null
      })
      .select('id')
      .single();
    if (error) throw error;
    return String((data as JsonRecord).id);
  }

  async listSteps(runId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin.from('run_steps').select('*').eq('run_id', runId).order('sequence', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  // ----------------------------------------------------------- tool_calls
  async recordToolCall(call: {
    runId: string;
    stepId?: string | null;
    toolId: string;
    input?: unknown;
    output?: unknown;
    riskLevel?: string;
    policyDecision?: unknown;
    approvalId?: string | null;
    error?: string | null;
    latencyMs?: number | null;
  }): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('tool_calls')
      .insert({
        run_id: call.runId,
        step_id: call.stepId ?? null,
        tool_id: call.toolId,
        input: call.input ?? null,
        output: call.output ?? null,
        risk_level: call.riskLevel ?? 'low',
        policy_decision: call.policyDecision ?? null,
        approval_id: call.approvalId ?? null,
        error: call.error ?? null,
        latency_ms: call.latencyMs ?? null
      })
      .select('id')
      .single();
    if (error) throw error;
    return String((data as JsonRecord).id);
  }

  // ---------------------------------------------------------- checkpoints
  readonly checkpoints: CheckpointStore = {
    save: async (checkpoint: Checkpoint): Promise<void> => {
      const { error } = await supabaseAdmin.from('checkpoints').insert({
        run_id: checkpoint.runId,
        sequence: checkpoint.sequence,
        task_state: checkpoint.taskState,
        agent_state: checkpoint.agentState,
        context_reference: checkpoint.contextReference,
        tool_history: checkpoint.toolHistory,
        files_changed: checkpoint.filesChanged,
        verification_state: checkpoint.verificationState,
        resume_metadata: checkpoint.resumeMetadata
      });
      if (error) throw error;
    },
    load: async (checkpointId: string): Promise<Checkpoint | null> => {
      const { data, error } = await supabaseAdmin.from('checkpoints').select('*').eq('id', checkpointId).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return mapCheckpoint(data as JsonRecord);
    },
    listForRun: async (runId: string): Promise<Checkpoint[]> => {
      const { data, error } = await supabaseAdmin.from('checkpoints').select('*').eq('run_id', runId).order('sequence', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((d) => mapCheckpoint(d as JsonRecord));
    },
    latestForRun: async (runId: string): Promise<Checkpoint | null> => {
      const { data, error } = await supabaseAdmin.from('checkpoints').select('*').eq('run_id', runId).order('sequence', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return mapCheckpoint(data as JsonRecord);
    }
  };

  // ------------------------------------------------------------ approvals
  async createApproval(input: {
    runId: string;
    taskId: string;
    userId: string;
    toolId: string;
    input?: unknown;
    riskLevel: string;
    reason: string;
    requestedBy: string;
    expiresAt: string;
  }): Promise<ApprovalRequest> {
    const { data, error } = await supabaseAdmin
      .from('approvals')
      .insert({
        run_id: input.runId,
        task_id: input.taskId,
        user_id: input.userId,
        tool_id: input.toolId,
        input: input.input ?? null,
        risk_level: input.riskLevel,
        reason: input.reason,
        requested_by: input.requestedBy,
        expires_at: input.expiresAt,
        state: 'requested'
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapApproval(data as JsonRecord);
  }

  async decideApproval(id: string, to: ApprovalState, decidedBy: string, reasonGiven?: string | null): Promise<boolean> {
    const { data, error } = await supabaseAdmin
      .from('approvals')
      .update({ state: to, decided_by: decidedBy, reason_given: reasonGiven ?? null, decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('state', 'requested')
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  async getPendingApprovals(userId: string): Promise<ApprovalRequest[]> {
    const { data, error } = await supabaseAdmin.from('approvals').select('*').eq('user_id', userId).eq('state', 'requested');
    if (error) throw error;
    return (data ?? []).map((d) => mapApproval(d as JsonRecord));
  }

  // ---------------------------------------------------------- agent_events
  async emitEvent(event: {
    type: AgentEventType | string;
    userId?: string | null;
    taskId?: string | null;
    runId?: string | null;
    actor?: string | null;
    payload?: unknown;
  }): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from('agent_events')
      .insert({
        type: event.type,
        user_id: event.userId ?? null,
        task_id: event.taskId ?? null,
        run_id: event.runId ?? null,
        actor: event.actor ?? null,
        payload: event.payload ?? {}
      })
      .select('id')
      .single();
    if (error) throw error;
    return String((data as JsonRecord).id);
  }

  async listEvents(userId: string, limit = 50): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin.from('agent_events').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  // -------------------------------------------------------------- projects
  async upsertProject(input: {
    id?: string;
    userId: string;
    name: string;
    path?: string | null;
    repositoryUrl?: string | null;
    status: 'pending' | 'scanning' | 'indexed' | 'failed';
    intelligence?: unknown;
  }): Promise<JsonRecord> {
    const now = new Date().toISOString();
    if (input.id) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .update({ ...input, updated_at: now })
        .eq('id', input.id)
        .eq('user_id', input.userId)
        .select('*')
        .single();
      if (error) throw error;
      return data as JsonRecord;
    }
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert({ user_id: input.userId, name: input.name, path: input.path ?? null, repository_url: input.repositoryUrl ?? null, status: input.status, intelligence: input.intelligence ?? null })
      .select('*')
      .single();
    if (error) throw error;
    return data as JsonRecord;
  }

  async listProjects(userId: string): Promise<unknown[]> {
    const { data, error } = await supabaseAdmin.from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getProject(projectId: string, userId: string): Promise<unknown> {
    const { data, error } = await supabaseAdmin.from('projects').select('*').eq('id', projectId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Project not found.');
    return data;
  }
}

function normalizeVerification(row: unknown): { complete: boolean; reason: string; missing?: string | null } {
  if (row && typeof row === 'object') {
    const v = row as JsonRecord;
    return {
      complete: Boolean(v.complete),
      reason: String(v.reason ?? ''),
      missing: v.missing === null || v.missing === undefined ? undefined : String(v.missing)
    };
  }
  return { complete: false, reason: '', missing: undefined };
}

function mapRun(row: JsonRecord): RunRecord {
  const state = row.state;
  if (!isRunState(state)) throw new Error(`Unrecognized run state "${String(state)}".`);
  const stepsRaw = row.steps;
  const steps = Array.isArray(stepsRaw) ? (stepsRaw as Array<{ label: string; status: string }>) : [];
  return {
    id: String(row.id),
    task_id: String(row.task_id),
    user_id: String(row.user_id),
    agent_id: String(row.agent_id),
    state,
    attempt_number: Number(row.attempt_number ?? 1),
    model: (row.model as string | null) ?? null,
    provider: (row.provider as string | null) ?? null,
    goal: String(row.goal ?? ''),
    steps,
    tool_calls: Array.isArray(row.tool_calls) ? (row.tool_calls as unknown[]) : [],
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    outputs: (row.outputs as Record<string, unknown>) ?? {},
    checkpoints: Array.isArray(row.checkpoints) ? (row.checkpoints as string[]) : [],
    verification: normalizeVerification(row.verification),
    usage: (row.usage as Record<string, number>) ?? {},
    started_at: (row.started_at as string | null) ?? null,
    paused_at: (row.paused_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function mapCheckpoint(row: JsonRecord): Checkpoint {
  return {
    checkpointId: String(row.id),
    runId: String(row.run_id),
    sequence: Number(row.sequence ?? 0),
    createdAt: String(row.created_at),
    taskState: (row.task_state as Record<string, unknown>) ?? {},
    agentState: (row.agent_state as Record<string, unknown>) ?? {},
    contextReference: (row.context_reference as Record<string, unknown> | null) ?? null,
    toolHistory: Array.isArray(row.tool_history) ? (row.tool_history as Checkpoint['toolHistory']) : [],
    filesChanged: Array.isArray(row.files_changed) ? (row.files_changed as string[]) : [],
    verificationState: (row.verification_state as Record<string, unknown>) ?? {},
    resumeMetadata: (row.resume_metadata as Record<string, unknown>) ?? {}
  };
}

function mapApproval(row: JsonRecord): ApprovalRequest {
  const state = isApprovalState(row.state) ? row.state : 'requested';
  return {
    id: String(row.id),
    runId: String(row.run_id),
    taskId: String(row.task_id ?? ''),
    userId: String(row.user_id),
    toolId: String(row.tool_id),
    input: row.input ?? {},
    riskLevel: String(row.risk_level ?? 'low') as 'low' | 'medium' | 'high' | 'critical',
    reason: String(row.reason ?? ''),
    state,
    requestedBy: String(row.requested_by ?? ''),
    decidedBy: (row.decided_by as string | null) ?? null,
    reasonGiven: (row.reason_given as string | null) ?? null,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    decidedAt: (row.decided_at as string | null) ?? null
  };
}

export function isRunStateValue(value: unknown): value is RunState {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value);
}

/** Process-wide singleton runtime store, shared by the worker and services. */
export const runtimeStore = new RuntimeStore();

export { RUN_STATES, RUN_TRANSITIONS };