import { supabaseAdmin } from './supabase.js';
import { notFound, conflict } from './errors.js';
import { validatePrompt } from './prompt.js';
import { ACTIVE_STATUSES, TERMINAL_STATUSES, isActiveStatus, type CreateTaskError, type TaskStatus } from '../types.js';

export { validatePrompt };

type JsonRecord = { [key: string]: unknown };

const TASK_FIELDS = 'id,user_id,prompt,status,plan,current_step,result,error,steps_used,searches_used,model_used,sources,created_at,updated_at,completed_at';

const LIST_FIELDS = 'id,prompt,status,current_step,steps_used,searches_used,model_used,created_at,completed_at';

function noRows(row: unknown): boolean {
  return row === undefined || row === null;
}

export async function createTask(
  userId: string,
  prompt: string,
  dailyLimit: number,
  activeLimit: number
): Promise<{ ok: true; id: string; status: TaskStatus; created_at: string } | { ok: false; error: CreateTaskError }> {
  const { data, error } = await supabaseAdmin.rpc('create_task', {
    p_user: userId,
    p_prompt: prompt,
    p_max_daily: dailyLimit,
    p_max_active: activeLimit
  });
  if (error) throw error;
  const result = data as JsonRecord;
  if (result?.error === 'daily_limit' || result?.error === 'active_limit') return { ok: false, error: result.error };
  if (!result?.id) throw new Error('Task creation returned an unexpected response.');
  return { ok: true, id: String(result.id), status: result.status as TaskStatus, created_at: String(result.created_at) };
}

export async function getTask(taskId: string, userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.from('tasks').select(TASK_FIELDS).eq('id', taskId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (noRows(data)) throw notFound('Task not found.');
  return data as Record<string, unknown>;
}

export async function getTaskByAdminId(taskId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.from('tasks').select(TASK_FIELDS).eq('id', taskId).maybeSingle();
  if (error) throw error;
  if (noRows(data)) throw notFound('Task not found.');
  return data as Record<string, unknown>;
}

export async function listTasks(userId: string, limit = 25): Promise<unknown[]> {
  const { data, error } = await supabaseAdmin.from('tasks').select(LIST_FIELDS).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getStatus(taskId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('tasks').select('status').eq('id', taskId).maybeSingle();
  if (error) throw error;
  return data ? String((data as JsonRecord).status) : null;
}

export async function transition(taskId: string, from: string[], patch: JsonRecord): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .in('status', from)
    .select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    const status = await getStatus(taskId);
    if (status === null) throw notFound('Task not found.');
    throw conflict(`Task cannot transition to that state with current status "${status}".`);
  }
}

export async function markFailed(taskId: string, message: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .update({ status: 'failed', current_step: 'Failed', error: message, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .in('status', ACTIVE_STATUSES)
    .select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    const status = await getStatus(taskId);
    if (status !== null && TERMINAL_STATUSES.includes(status as never)) {
      throw conflict(`Task is already in terminal state "${status}".`);
    }
    if (status === null) throw notFound('Task not found.');
  }
}

export async function cancelTask(taskId: string, userId: string): Promise<void> {
  const task = await getTask(taskId, userId);
  const status = String((task as JsonRecord).status);
  if (!isActiveStatus(status)) {
    throw conflict(`Task is already in terminal state "${status}".`);
  }
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .update({ status: 'cancelled', current_step: 'Cancelled by user', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) throw conflict('Task could not be cancelled because it already finished.');
}

export async function deleteTask(taskId: string, userId: string): Promise<void> {
  const task = await getTask(taskId, userId);
  const status = String((task as JsonRecord).status);
  if (isActiveStatus(status)) {
    throw conflict('Cancel the task before deleting it.');
  }
  const { error } = await supabaseAdmin.from('tasks').delete().eq('id', taskId).eq('user_id', userId);
  if (error) throw error;
}

export async function incrementSearchUsage(userId: string, maxSearchesPerDay: number): Promise<{ count: number; over: boolean }> {
  const { data, error } = await supabaseAdmin.rpc('increment_usage', {
    p_user: userId,
    p_type: 'search',
    p_max: maxSearchesPerDay
  });
  if (error) throw error;
  const result = (data ?? {}) as JsonRecord;
  return { count: Number(result.count ?? 0), over: Boolean(result.over) };
}