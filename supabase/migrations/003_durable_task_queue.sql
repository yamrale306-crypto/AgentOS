-- Durable PostgreSQL work queue. Run this migration before deploying workers.
alter table public.tasks
  add column if not exists started_at timestamptz,
  add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
  add column if not exists last_error text,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists recovered_at timestamptz;

create index if not exists tasks_queue_claim_idx
  on public.tasks (status, lease_expires_at, created_at)
  where status in ('queued', 'planning', 'searching', 'analyzing', 'verifying');

-- Browser clients may read their tasks, but all writes run through the backend's
-- service role. This prevents direct status edits, quota bypasses and deletions.
drop policy if exists "users can insert own tasks" on public.tasks;
drop policy if exists "users can update own tasks" on public.tasks;
drop policy if exists "users can delete own tasks" on public.tasks;

create or replace function public.claim_next_task(
  p_worker_id text,
  p_lease_seconds integer,
  p_max_attempts integer
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare v_task public.tasks%rowtype;
begin
  -- Expired work is recoverable; exhausted work becomes terminal instead.
  update public.tasks
     set status = 'failed', current_step = 'Failed', error = 'Task exceeded recovery attempts.',
         last_error = 'Task exceeded recovery attempts.', completed_at = now(), updated_at = now(),
         lease_owner = null, lease_expires_at = null
   where status in ('planning','searching','analyzing','verifying')
     and lease_expires_at < now() and attempt_count >= p_max_attempts;

  update public.tasks
     set status = 'queued', current_step = 'Recovered after worker lease expired', recovered_at = now(),
         lease_owner = null, lease_expires_at = null, updated_at = now()
   where status in ('planning','searching','analyzing','verifying')
     and lease_expires_at < now() and attempt_count < p_max_attempts;

  select * into v_task from public.tasks
   where status = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;
  if not found then return null; end if;

  update public.tasks
     set lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempt_count = attempt_count + 1,
         started_at = coalesce(started_at, now()), updated_at = now()
   where id = v_task.id
   returning * into v_task;
  return to_jsonb(v_task);
end;
$$;

create or replace function public.heartbeat_task(p_task_id uuid, p_worker_id text, p_lease_seconds integer)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  update public.tasks set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where id = p_task_id and lease_owner = p_worker_id
     and status in ('queued','planning','searching','analyzing','verifying');
  return found;
end;
$$;

revoke all on function public.claim_next_task(text, integer, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_task(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_task(text, integer, integer) to service_role;
grant execute on function public.heartbeat_task(uuid, text, integer) to service_role;
