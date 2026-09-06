-- Migration 001: add sources/completed_at and concurrency-safe usage counters.
-- For existing deployments that already ran the V0.1 schema.sql. Idempotent;
-- run in the Supabase SQL editor.

alter table public.tasks add column if not exists sources jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists completed_at timestamptz;
create index if not exists tasks_user_status_idx on public.tasks(user_id, status);

drop policy if exists "users can delete own tasks" on public.tasks;
create policy "users can delete own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'UTC')::date,
  usage_type text not null check (usage_type in ('task','search')),
  count integer not null default 0,
  primary key (user_id, usage_date, usage_type)
);

alter table public.usage_daily enable row level security;

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