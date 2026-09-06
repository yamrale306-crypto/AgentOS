-- AgentOS schema
-- Idempotent: safe to run repeatedly in the Supabase SQL editor.
-- Run `supabase/schema.sql` (or the pieces you are missing). New deployments can
-- run the whole file; existing deployments can run it again safely.

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null check (char_length(prompt) between 1 and 4000),
  status text not null default 'queued' check (status in ('queued','planning','searching','analyzing','verifying','completed','failed','cancelled')),
  plan jsonb,
  current_step text,
  result text,
  error text,
  steps_used integer not null default 0,
  searches_used integer not null default 0,
  model_used text,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks add column if not exists sources jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists completed_at timestamptz;

create index if not exists tasks_user_created_idx on public.tasks(user_id, created_at desc);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_user_status_idx on public.tasks(user_id, status);

alter table public.tasks enable row level security;

drop policy if exists "users can read own tasks" on public.tasks;
create policy "users can read own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert own tasks" on public.tasks;
create policy "users can insert own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update own tasks" on public.tasks;
create policy "users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own tasks" on public.tasks;
create policy "users can delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Usage counters (concurrency-safe daily quotas)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'UTC')::date,
  usage_type text not null check (usage_type in ('task','search')),
  count integer not null default 0,
  primary key (user_id, usage_date, usage_type)
);

alter table public.usage_daily enable row level security;

-- The backend uses its service-role client which bypasses RLS. These functions
-- are security definer so they run with table ownership rights, and search_path
-- is pinned to prevent search-path hijacking.
create or replace function public.decrement_usage(p_user uuid, p_type text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.usage_daily
     set count = greatest(0, count - 1)
   where user_id = p_user
     and usage_date = (now() at time zone 'UTC')::date
     and usage_type = p_type;
end;
$$;

-- Increments today's counter for the user/type atomically.
-- Returns jsonb {"count": n, "over": true|false}; "over" is true when the new
-- count exceeds p_max.
create or replace function public.increment_usage(p_user uuid, p_type text, p_max integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.usage_daily (user_id, usage_date, usage_type, count)
  values (p_user, (now() at time zone 'UTC')::date, p_type, 1)
  on conflict (user_id, usage_date, usage_type)
  do update set count = public.usage_daily.count + 1
  returning count into v_count;

  return jsonb_build_object('count', v_count, 'over', v_count > p_max);
end;
$$;

-- Atomically enforces daily task limit AND active-task limit, then inserts the
-- task row. Returns {"id","status","created_at"} on success, or {"error":"daily_limit"}
-- / {"error":"active_limit"}. The task row is inserted by this function so two
-- concurrent requests cannot both pass the limit checks.
create or replace function public.create_task(p_user uuid, p_prompt text, p_max_daily integer, p_max_active integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
  v_active integer;
  v_task public.tasks%rowtype;
begin
  insert into public.usage_daily (user_id, usage_date, usage_type, count)
  values (p_user, (now() at time zone 'UTC')::date, 'task', 1)
  on conflict (user_id, usage_date, usage_type)
  do update set count = public.usage_daily.count + 1
  returning count into v_count;

  if v_count > p_max_daily then
    perform public.decrement_usage(p_user, 'task');
    return jsonb_build_object('error', 'daily_limit');
  end if;

  select count(*) into v_active
    from public.tasks
   where user_id = p_user
     and status in ('queued','planning','searching','analyzing','verifying');

  if v_active >= p_max_active then
    perform public.decrement_usage(p_user, 'task');
    return jsonb_build_object('error', 'active_limit');
  end if;

  insert into public.tasks (user_id, prompt, status)
  values (p_user, p_prompt, 'queued')
  returning id, status, created_at into v_task;

  return jsonb_build_object('id', v_task.id, 'status', v_task.status, 'created_at', v_task.created_at);
end;
$$;

revoke all on function public.create_task(uuid, text, integer, integer) from anon, authenticated;
revoke all on function public.increment_usage(uuid, text, integer) from anon, authenticated;
revoke all on function public.decrement_usage(uuid, text) from anon, authenticated;
grant execute on function public.create_task(uuid, text, integer, integer) to service_role;
grant execute on function public.increment_usage(uuid, text, integer) to service_role;
grant execute on function public.decrement_usage(uuid, text) to service_role;