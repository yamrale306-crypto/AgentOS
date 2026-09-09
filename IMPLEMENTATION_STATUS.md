# AgentOS — Implementation Status

This document reflects the current state of the monorepo. It is kept deliberately
short; the canonical architecture and operations docs are `README.md` (setup, API,
deployment) and `MULTI_MODEL.md` (AI engine, providers, routing).

## What exists today

**Backend (TypeScript, pnpm + Turborepo monorepo)**
- `apps/api` — Express 5 REST API: Supabase JWT auth, rate limiting, CORS
  allowlist, helmet, structured redacting logger, and admin `/api/system/*`
  diagnostics. Also serves `/api/app/version` for desktop/mobile updates.
- `apps/worker` — durable PostgreSQL queue consumer. Claims tasks atomically
  (`claim_next_task`), heartbeats the lease, and runs the agent loop
  (plan → search → analyze → synthesize → verify) with cooperative cancellation.
  Tool requests are evaluated by the shared `PolicyEngine` before execution. Every
  run now persists a `RunSession` (run, steps, tool calls, events, checkpoints)
  and resumes from the latest checkpoint after a worker crash.
- `packages/ai` — multi-provider engine: model router, token rotation, health
  tracking with EWMA latency, per-provider fallback, structured/zod extraction,
  and diagnostics. Providers: OpenRouter, DeepSeek, Groq, Gemini, Z.ai, Cloudflare.
- `packages/database` — Supabase service-role client, task store (typed),
  `RuntimeStore` (runs, run_steps, tool_calls, checkpoints, approvals,
  agent_events, projects), ownership-scoped queries, atomic quota RPC wrappers.
- `packages/schemas` — shared zod schemas and types (statuses, plans, search,
  verification, AI modes, plus the new runtime models: run state machine, tools,
  agents, approvals, checkpoints, events, projects).
- `packages/runtime` — general-purpose agent runtime primitives: state machine,
  tool registry, policy engine, approval lifecycle, checkpoint serialization,
  execution loop, built-in agent policies, and a project scanner. Zero DB/AI
  dependencies — pure functions over types, testable without I/O.
- `packages/tools` — DuckDuckGo HTML search provider with URL decoding,
  sanitization, dedup, retries, and typed errors.
- `packages/config` — zod-validated env (`AppEnv`/`ValidatedEnv`), CORS/CSV
  parsers, structured logger with secret redaction.
- `supabase/` — idempotent `schema.sql` plus migrations (001–004) implementing
  atomic per-user quotas, the durable task queue, the agent runtime tables
  (agents, runs, run_steps, tool_calls, checkpoints, approvals, agent_events,
  projects), and service-role-only grants with RLS.

**Frontend (Next.js 15 App Router, standalone npm app)**
- Functional pages: home, `/tasks`, `/artifacts`, `/history`, `/system`.
- `/projects` is a deliberate placeholder awaiting a product decision.
- Typed API client (`lib/api.ts`), Supabase SSR session handling, shared
  `useAgentOS` hook, command palette, and PWA manifest.

**Desktop / mobile**
- `desktop/` — Tauri 2 shell (NSIS/MSI), distributes the frontend static export.
- `mobile/` — Capacitor 7 Android shell, distributes the same static export.

## Quality gates

| Gate | Command | Status |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | Pass (8 packages) |
| Build | `pnpm build` | Pass (8 packages) |
| Lint | `pnpm lint` | Pass (8 packages + root scripts) — ESLint 9 + typescript-eslint |
| Unit/integration tests | `pnpm test` | Pass (21 test files, 200+ assertions) |
| E2E release suite | `pnpm --filter @agentos/api test:e2e` | Manual against a deployed staging env |
| Secret scan | gitleaks CI job | Pass in CI |
| Dependency audit | `pnpm audit --audit-level=high` | Run in CI |

## Runtime architecture (Phase 1 — implemented)

### State machine
- **Run states:** `QUEUED → PLANNING → EXECUTING → VERIFYING → COMPLETED` (happy path), with `PAUSED`, `FAILED`, `CANCELLED` edges.
- Transition table is the single source of truth, shared between the runtime and
  the control plane via `@agentos/schemas`.
- `RunStateMachine` validates every transition deterministically; invalid edges throw.

### Tool registry
- `AgentTool<In, Out>` contract: id, description, category, risk level, permissions, zod input schema, `execute()`.
- `ToolRegistry` — register/lookup/list tools by category. Never bypassed: the
  execution loop resolves a model tool request through the registry first.

### Policy engine
- Every tool request is evaluated to a `PolicyDecision`:
  - `approve` — runs immediately.
  - `requireApproval` — runs only after an `ApprovalRequest` reaches `approved`.
  - `deny` — hard-blocked (not approvable, permanent).
- Checks in order: blocked tool → allowed-list gate → permission coverage →
  protected resource → risk threshold.
- `PolicyCheckInput.context` supports inline context grants that supplement
  the agent's static grants.

### Approvals
- `ApprovalCoordinator` — create/approve/reject/cancel/expire. Approvals are
  persistent state, never a transient side-channel.
- TTL-driven expiration; only `requested` transitions to terminal.

### Checkpoints
- `Checkpoint` — task state, agent state, tool history, files changed, resume
  metadata. `InMemoryCheckpointStore` (pluggable for persistence).
- `createCheckpoint()` serializes an execution step into a resume point.

### Built-in agents
- Five policy-only built-in agents: `developer`, `researcher`, `planner`,
  `tester`, `reviewer`. Each declares allowed tools, permissions, risk
  thresholds, and model policy. No custom execution logic.

### Execution loop
- `ExecutionLoop.step()` resolves, gates, and (if allowed) executes one model
  tool request. Returns a `StepResult` — never throws for denied/failed tools.
- Fully injectable: `onDecision`, `executeTool`, `onToolResult` deps keep
  persistence, model access and testing decoupled.

### Project scanner
- `analyzeProject(files)` — pure function over a file listing: detects
  languages, framework, package manager, dependencies, scripts, env
  requirements, git status.
- `scanProjectDirectory(dir)` — walks the file tree, reads `package.json`,
  produces `ProjectIntelligence`. Never uploads repository contents.

### Migration 004
- `supabase/migrations/004_agent_runtime.sql`: agents (with built-in seeds),
  runs, run_steps, tool_calls, checkpoints, approvals, agent_events, projects.
- RLS owner-select policies for browser clients. All writes via `service_role`.
- Idempotent (`create table if not exists`).

## Persistence + recovery (Phase 2 — implemented)

### `RuntimeStore` (`packages/database`)
- Durable store over the 004 tables, implementing the schemas runtime types.
  Runs are inserted `QUEUED`, then driven through the shared transition table
  (`transitionRun` re-checks `canTransitionRun` and guards on the current DB row
  with a CAS conflict).
- `checkpoints` property implements the `CheckpointStore` interface defined in
  `@agentos/schemas` (moved out of the runtime so the database package stays
  independent of it) — save/load/list/latest, backed by the `checkpoints` table.
- Approvals (create/decide on `requested`), agent events, and projects all have
  typed stores. A process-wide `runtimeStore` singleton is exported for workers
  and services. Mappers (`mapRun`/`mapCheckpoint`/`mapApproval`) normalize rows.

### `RunSession` (`apps/worker`)
- The worker wraps each task in a durable session: creates a run, appends
  `run_steps`, records every `tool_call` attempt (policy decision included,
  executed or not), emits lifecycle events, and checkpoints at safe boundaries.
- Checkpoint resume metadata carries the full worker state: stage, message
  thread, sources, plan, draft, step/search counters, provider/model, fallback.
- **Crash recovery:** when the queue requeues an expired-lease task, `open()`
  finds the existing non-terminal run and its latest checkpoint, restores the
  worker state, and continues from `research`/`synthesis`/`verifying` — no
  re-planning, no re-searching. Terminal runs get a new run (retries are new
  runs, never state changes).
- Cancellation and failures also transition the run and emit `run.cancelled` /
  `run.failed`; run-state edges that are invalid (e.g. completing a `QUEUED`
  run) are guarded so partial failures still mark the task failed.

## Known gaps (accepted product decisions)

- **No browser automation, shell/code execution, or sandbox yet.** — reserved
  for the next iteration (medium/high-risk tools, isolation).
- **No memory or persistent conversation.** — `MemoryPolicy` is plumbed but
  the store is not implemented.
- **Router/health/token state is in-memory** and resets on process restart.
- **`/projects` in the frontend is a placeholder**; the runtime scanner exists
  and `projects` rows can be stored via `RuntimeStore`, but no UI or scan job
  writes them yet.
- **Approval workflow is in-memory in the worker.** The `approvals` table and
  store exist, but the worker has no medium/high-risk tool to route through a
  human approval flow yet (that lands with Phase 3 tooling).
- **No realtime yet.** `agent_events` are persisted but nothing subscribes to
  them server-side or streams them to the browser.
- **`analytics_query` tool** is deferred (high-risk, never executes in this
  iteration — policy denies it).
- Legacy `AgentOS/` directory (a pre-monorepo duplicate with its own `.git`) is
  ignored by the monorepo. It is scheduled for removal once its credential files
  are relocated; see the README security notes.