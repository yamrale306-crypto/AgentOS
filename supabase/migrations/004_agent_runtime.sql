-- Agent Runtime: agents, runs, run_steps, tool_calls, checkpoints, approvals,
-- agent_events, projects. Idempotent. The control plane writes via service_role;
-- browser clients may only read their own rows and never write directly.

-- ---------------------------------------------------------------------------
-- Agents (policy configuration, never custom code)
-- ---------------------------------------------------------------------------
create table if not exists public.agents (
  id text primary key,
  version integer not null default 1,
  name text not null,
  description text not null default '',
  instructions text not null default '',
  model_policy jsonb not null default '{}'::jsonb,
  tool_policy jsonb not null default '{}'::jsonb,
  permission_policy jsonb not null default '{}'::jsonb,
  memory_policy jsonb not null default '{}'::jsonb,
  verification_policy jsonb not null default '{}'::jsonb,
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runs (one attempt to execute a Task)
-- ---------------------------------------------------------------------------
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  agent_id text not null,
  state text not null default 'QUEUED',
  attempt_number integer not null default 1,
  model text,
  provider text,
  goal text not null default '',
  verification jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  paused_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runs_state_check check (state in
    ('QUEUED','PLANNING','EXECUTING','VERIFYING','PAUSED','FAILED','COMPLETED','CANCELLED'))
);

create index if not exists runs_user_idx on public.runs (user_id, created_at desc);
create index if not exists runs_task_idx on public.runs (task_id);

-- ---------------------------------------------------------------------------
-- Run steps and tool calls (the audit trail behind every run)
-- ---------------------------------------------------------------------------
create table if not exists public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  sequence integer not null,
  stage text not null,
  input jsonb,
  output jsonb,
  model text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists run_steps_run_idx on public.run_steps (run_id, sequence);

create table if not exists public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  step_id uuid references public.run_steps(id) on delete set null,
  tool_id text not null,
  input jsonb,
  output jsonb,
  risk_level text not null default 'low',
  policy_decision jsonb,
  approval_id uuid,
  error text,
  latency_ms integer,
  sha text,
  created_at timestamptz not null default now()
);

create index if not exists tool_calls_run_idx on public.tool_calls (run_id, created_at);

-- ---------------------------------------------------------------------------
-- Checkpoints (resume points for crashed runs)
-- ---------------------------------------------------------------------------
create table if not exists public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  sequence integer not null default 1,
  task_state jsonb not null default '{}'::jsonb,
  agent_state jsonb not null default '{}'::jsonb,
  context_reference jsonb,
  tool_history jsonb not null default '[]'::jsonb,
  files_changed jsonb not null default '[]'::jsonb,
  verification_state jsonb not null default '{}'::jsonb,
  resume_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint checkpoints_run_sequence_unique unique (run_id, sequence)
);

create index if not exists checkpoints_run_idx on public.checkpoints (run_id, sequence desc);

-- ---------------------------------------------------------------------------
-- Approvals (the gate for sensitive tool requests)
-- ---------------------------------------------------------------------------
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  task_id uuid,
  user_id uuid not null references public.users(id) on delete cascade,
  tool_id text not null,
  input jsonb,
  risk_level text not null,
  reason text not null default '',
  state text not null default 'requested',
  requested_by text,
  decided_by text,
  reason_given text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint approvals_state_check check (state in ('requested','approved','rejected','expired','cancelled'))
);

create index if not exists approvals_pending_idx on public.approvals (state, user_id) where state = 'requested';
create index if not exists approvals_run_idx on public.approvals (run_id);

-- ---------------------------------------------------------------------------
-- Agent events (realtime UI, notifications, audit/analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  ts timestamptz not null default now(),
  user_id uuid,
  task_id uuid,
  run_id uuid,
  actor text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists agent_events_user_idx on public.agent_events (user_id, ts desc);
create index if not exists agent_events_run_idx on public.agent_events (run_id, ts desc);
create index if not exists agent_events_type_idx on public.agent_events (type, ts desc);

-- ---------------------------------------------------------------------------
-- Projects (structured repository intelligence, never contents)
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  path text,
  repository_url text,
  status text not null default 'pending',
  intelligence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (status in ('pending','scanning','indexed','failed'))
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Privileges: browsers read their own rows; all writes stay on the control plane
-- ---------------------------------------------------------------------------
alter table public.agents enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.tool_calls enable row level security;
alter table public.checkpoints enable row level security;
alter table public.approvals enable row level security;
alter table public.agent_events enable row level security;
alter table public.projects enable row level security;

drop policy if exists "users can read agents" on public.agents;
drop policy if exists "users can read own runs" on public.runs;
drop policy if exists "users can read own run steps" on public.run_steps;
drop policy if exists "users can read own tool calls" on public.tool_calls;
drop policy if exists "users can read own checkpoints" on public.checkpoints;
drop policy if exists "users can read own approvals" on public.approvals;
drop policy if exists "users can read own agent events" on public.agent_events;
drop policy if exists "users can read own projects" on public.projects;

create policy "users can read agents" on public.agents
  for select using (true);
create policy "users can read own runs" on public.runs
  for select using (user_id = auth.uid());
create policy "users can read own run steps" on public.run_steps
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
  );
create policy "users can read own tool calls" on public.tool_calls
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
  );
create policy "users can read own checkpoints" on public.checkpoints
  for select using (
    exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
  );
create policy "users can read own approvals" on public.approvals
  for select using (user_id = auth.uid());
create policy "users can read own agent events" on public.agent_events
  for select using (user_id = auth.uid());
create policy "users can read own projects" on public.projects
  for select using (user_id = auth.uid());

-- Seed built-in agents. Their runtime policies live in @agentos/runtime; these
-- rows keep names/descriptions visible to clients before the runtime is wired.
insert into public.agents (id, version, name, description, instructions, is_builtin)
values
  ('developer', 1, 'Developer', 'Understands projects, plans changes, executes work, and verifies results.',
   'Understand the goal, inspect relevant files, plan a minimal change, execute it, verify, and report what changed.', true),
  ('researcher', 1, 'Researcher', 'Researches topics on the public web and delivers a factual, sourced answer.',
   'Form a short plan, search the web, analyze findings, synthesize a sourced answer, and verify it.', true),
  ('planner', 1, 'Planner', 'Breaks objectives into concrete, ordered execution steps.',
   'Turn the objective into a concise, ordered plan. Do not execute work yourself.', true),
  ('tester', 1, 'Tester', 'Verifies changes with executable checks and honest failure reports.',
   'Inspect changed files, run verification, report pass/fail honestly. Never claim success you did not observe.', true),
  ('reviewer', 1, 'Reviewer', 'Reviews agent output against the original objective and flags gaps.',
   'Compare delivered work against the objective and report what satisfies it and what is missing.', true)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      instructions = excluded.instructions;

-- Grant select on read tables to authenticated, reads+inserts to service_role.
grant select on table public.agents to authenticated;
grant select on table public.agents to service_role;
grant select, insert, update, delete on table public.runs to service_role;
grant select, insert, update, delete on table public.run_steps to service_role;
grant select, insert, update, delete on table public.tool_calls to service_role;
grant select, insert, update, delete on table public.checkpoints to service_role;
grant select, insert, update, delete on table public.approvals to service_role;
grant select, insert, update, delete on table public.agent_events to service_role;
grant select, insert, update, delete on table public.projects to service_role;
grant usage on schema public to service_role;