-- Migration 002: multi-model routing metadata + create_task RPC model params.
-- For existing deployments that already ran schema.sql / 001. Idempotent;
-- run in the Supabase SQL editor.

alter table public.tasks add column if not exists model_mode text default 'auto';
alter table public.tasks add column if not exists model text;
alter table public.tasks add column if not exists provider_used text;
alter table public.tasks add column if not exists fallback_used boolean not null default false;

create or replace function public.create_task(p_user uuid, p_prompt text, p_max_daily integer, p_max_active integer, p_mode text default 'auto', p_model text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_count integer;
  v_active integer;
  v_id uuid;
  v_status text;
  v_created_at timestamptz;
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

  insert into public.tasks (user_id, prompt, status, model_mode, model)
  values (p_user, p_prompt, 'queued', p_mode, p_model)
  returning id, status, created_at into v_id, v_status, v_created_at;

  return jsonb_build_object('id', v_id, 'status', v_status, 'created_at', v_created_at);
end;
$$;

revoke all on function public.create_task(uuid, text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_task(uuid, text, integer, integer, text, text) to service_role;