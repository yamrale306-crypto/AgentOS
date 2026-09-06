# AgentOS — CURRENT ARCHITECTURE AUDIT

**Date:** 2026-09-06
**Status:** READ-ONLY AUDIT — no architectural changes proposed or made
**Scope:** Complete inspection of repository as it exists on disk at `C:\Users\admin\Desktop\New folder\AgentOS`
**Branch:** `c614674 chore: harden AgentOS for release`

---

## 1. Executive Summary

AgentOS is a **single-purpose autonomous web-research agent** application. A user types a research goal, the system plans the research, iteratively searches the public web via a single (DuckDuckGo HTML) provider, analyzes findings with an LLM, verifies the answer, and returns a sourced final synthesis.

The codebase is a **two-package, non-monorepo** structure:

- **Frontend** — Next.js 15 (App Router) + React 19, single page, PWA-ready, Supabase Auth for login, plain CSS.
- **Backend** — Express 5 + TypeScript (ESM), Supabase (PostgreSQL + Auth) for persistence/identity, a six-provider multi-model AI layer with smart routing, token rotation, health tracking and fallback.
- **Database** — Supabase PostgreSQL with two tables (`tasks`, `usage_daily`), Row-Level Security, and atomic `SECURITY DEFINER` RPC functions for quota enforcement.

Notable strengths: a genuinely sophisticated smart AI router with provider abstraction, token rotation, model health tracking, and error categorization; a clean owner-scoped task model; atomic PostgreSQL quotas; server-side-only credentials.

Notable risks: **task execution is fire-and-forget and entirely in-process** (via `setImmediate`, single Render instance assumption); there is **no durable job queue or resume-on-restart**; the **only search provider is DuckDuckGo HTML scraping** (fragile, no fallback, no API); the **frontend is a single monolithic page** (no routing, no real-time, 2.2s polling); the **AI provider/model configuration is partially hardcoded and partially scattered** across catalog + env + dynamic discovery; `tokens`/`health`/`cancellation` state is **in-memory and process-local**.

---

## 2. Repository Structure

```
AgentOS/
├── .gitignore                    # Ignores .env, Dev Keys.txt, node_modules, dist, etc.
├── README.md                     # Project docs, setup, API reference, deployment
├── AUDIT_REPORT.md               # Prior comprehensive audit report (448 lines)
├── FINAL_RELEASE_REPORT.md       # Release validation report (CONDITIONAL GO)
├── MULTI_MODEL.md                # Multi-provider AI engine documentation
├── render.yaml                   # Render Blueprint — backend only (Node 20)
├── Dev Keys.txt                  # LOCAL ONLY — gitignored credential file (NOT committed)
│
├── frontend/                     # Next.js 15 app (deployed to Vercel)
│   ├── app/
│   │   ├── layout.tsx            # Root layout, PWA manifest, globals.css
│   │   ├── page.tsx              # ENTIRE app — single client page (composition root)
│   │   ├── globals.css           # All styling (dark-theme design system)
│   │   └── manifest.ts           # PWA web app manifest
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── AuthForm.tsx
│   │   ├── TaskComposer.tsx      # Prompt + mode + model override form
│   │   ├── TaskList.tsx
│   │   ├── TaskRow.tsx
│   │   ├── TaskDetail.tsx        # Main detail view
│   │   ├── TaskProgress.tsx      # Indeterminate progress bar
│   │   ├── SourceList.tsx        # Source cards as external links
│   │   ├── SystemDashboard.tsx   # Ops UI (providers/models/tokens/test/playground)
│   │   ├── EmptyState.tsx
│   │   └── ErrorState.tsx
│   ├── lib/
│   │   ├── api.ts                # All backend API calls
│   │   ├── supabase.ts           # Supabase browser client factory
│   │   └── types.ts              # Domain types (TaskStatus, ModelMode, ...)
│   ├── utils/supabase/client.ts  # DUPLICATE unused client factory
│   ├── .env.example
│   ├── next.config.ts            # output: 'standalone'
│   ├── package.json
│   └── tsconfig.json             # strict, @/* → ./*
│
├── backend/                      # Express 5 API (deployed to Render)
│   ├── src/
│   │   ├── server.ts             # Bootstrap: createApp(), listen(env.PORT)
│   │   ├── app.ts                # Express app factory (helmet/cors/rate-limit/logger)
│   │   ├── types.ts              # Task lifecycle, statuses, API envelope types
│   │   ├── routes/
│   │   │   ├── health.ts         # GET /health (public)
│   │   │   ├── tasks.ts          # /api/tasks CRUD + cancel/retry
│   │   │   └── system.ts         # /api/system/* diagnostics (ops)
│   │   ├── middleware/
│   │   │   ├── auth.ts           # requireAuth (JWT bearer → supabase getUser)
│   │   │   └── errorHandler.ts   # AppError/ZodError/SyntaxError→envelope; 500s never leak
│   │   ├── lib/
│   │   │   ├── config.ts         # Zod-validated EnvSchema + singleton env
│   │   │   ├── errors.ts         # AppError + factories (badRequest/unauthorized/...)
│   │   │   ├── logger.ts         # Level-filtered JSON logger with redaction
│   │   │   ├── prompt.ts         # validatePrompt (3-4000 chars)
│   │   │   ├── supabase.ts       # supabaseAdmin (service role) + authenticateBearer
│   │   │   └── taskStore.ts      # ALL persistence operations
│   │   ├── ai/                   # Model routing / provider / health layer
│   │   │   ├── catalog.ts        # Static model catalog + provider specs
│   │   │   ├── providers.ts      # ProviderManager, OpenAI client cache, env→providers
│   │   │   ├── tokenManager.ts   # Multi-token rotation, cooldowns, health
│   │   │   ├── registry.ts       # ModelRegistry + OpenRouter dynamic discovery
│   │   │   ├── router.ts         # Smart routing (category+stage+mode scoring)
│   │   │   ├── health.ts         # HealthMonitor (EWMA latency, degraded/unavailable)
│   │   │   ├── errors.ts         # AiError + normalizeError (8 categories)
│   │   │   ├── runtime.ts        # Singleton wiring, seed + model discovery
│   │   │   └── diagnostics.ts    # System/Provider/Model/Token diagnostics + pings
│   │   ├── agent/                # The research agent orchestrator
│   │   │   ├── agent.ts          # runTask(taskId) — full research loop
│   │   │   ├── model.ts          # chatWithFallback / structuredWithFallback
│   │   │   ├── prompts.ts        # SYSTEM/PLAN/VERIFY/SYNTHESIS prompts
│   │   │   ├── schemas.ts        # Zod plan/verification/webSearchArgs + defaults
│   │   │   └── cancellation.ts   # In-memory cancellation set + assertRunning
│   │   └── tools/
│   │       └── webSearch.ts      # DuckDuckGo HTML scraping ONLY
│   ├── scripts/
│   │   ├── credentials.ts        # Dev Keys.txt → env var parsing (masked)
│   │   ├── import-keys.ts        # npm run import:keys
│   │   └── verify-providers.ts   # npm run verify:providers (live ping table)
│   ├── test/                     # Vitest + supertest (9 files)
│   ├── .env.example              # Documents all 27 backend env vars
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
└── supabase/
    ├── schema.sql                # Full idempotent schema + RLS + RPCs
    └── migrations/
        ├── 001_add_sources_and_usage.sql
        └── 002_add_model_metadata.sql
```

**There is no monorepo tooling** — no root `package.json`, no `turbo.json`, `nx.json`, `pnpm-workspace.yaml`, or lerna. Each package manages its own dependencies and node_modules independently.

---

## 3. Technology Stack

| Component | Technology | Version | Purpose | Important dependencies |
|---|---|---|---|---|
| **Frontend framework** | Next.js (App Router) | ^15.5.3 | Full-stack React framework | `next`, `react` 19, `react-dom` 19 |
| **Frontend language** | TypeScript | ^5.9.2 | Typed JS | — |
| **Frontend auth client** | @supabase/ssr | ^0.7.0 | Supabase browser client | `@supabase/supabase-js` |
| **Frontend DB client** | @supabase/supabase-js | ^2.57.4 | Supabase client (auth sessions) | — |
| **Backend framework** | Express | ^5.2.1 | HTTP server | `cors`, `helmet`, `express-rate-limit` |
| **Backend language** | TypeScript (ESM, `"type":"module"`) | ^5.9.2 | Typed JS | — |
| **Backend runtime** | Node.js | >=20 | Server runtime | — |
| **Backend runner (dev)** | tsx | ^4.20.5 | Watch/run TS | — |
| **Database** | Supabase (PostgreSQL) | hosted | Persistence + Auth | — |
| **DB client** | @supabase/supabase-js | ^2.115.0 | service-role client | — |
| **Validation** | Zod | ^4.1.5 | Env + structured output validation | — |
| **AI SDK** | OpenAI SDK (`openai`) | ^6.7.0 | Chat completions against OpenAI-compatible endpoints + Cloudflare | — |
| **AI providers** | 6 (see below) | — | Model inference | — |
| **Search** | DuckDuckGo HTML endpoint (scraped) | — | Web search | `cheerio` ^1.1.2 |
| **HTML parsing** | cheerio | ^1.1.2 | DuckDuckGo result parsing | — |
| **Auth backend** | Supabase Auth (JWT) | hosted | Identity provider | `@supabase/supabase-js` |
| **Config** | dotenv | ^17.2.2 | `.env` loading | — |
| **Logging** | Custom JSON logger | — | Structured logs + secret redaction | — |
| **Testing** | Vitest + supertest | ^3.2.4 / ^7.1.4 | Unit + HTTP tests | — |
| **Build (backend)** | tsc (`npm run build`) | — | TS→dist | — |
| **Build (frontend)** | Next.js build | — | Standalone output | — |
| **Deployment** | Render (backend), Vercel (frontend), Supabase (DB) | — | Hosting | — |

### AI Providers (all implemented in code, `src/ai/catalog.ts:69-76`)

| Provider | Base URL | Access via | Models (static catalog) |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI SDK + dynamic model discovery | Dynamic (any registered OpenRouter model) |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI SDK | `deepseek-chat`, `deepseek-reasoner` |
| Groq | `https://api.groq.com/openai/v1` | OpenAI SDK | `gpt-oss-120b`, `gpt-oss-20b`, `qwen3.8-27b`, `compound-mini` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI-compatible SDK | `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.1-flash-lite` |
| Z.ai | `https://api.z.ai/api/paas/v4` | OpenAI SDK | `GLM-4.5-Flash` |
| Cloudflare Workers AI | `${account}/ai/v1` (dynamic base URL) | OpenAI SDK (custom kind `cloudflare`) | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/qwen/qwen2.5-coder-32b-instruct` |

An **OpenCode API key** variable also exists (`OPENCODE_API_KEY` in config) but is metadata-only — not wired to any active provider client in the routing layer.

---

## 4. System Architecture Diagram

See `AGENTOS_CURRENT_ARCHITECTURE_DIAGRAM.md` for the full ASCII diagrams. Summary here:

```
User (browser)
   │  email/password → Supabase Auth (hosted)
   ▼
Frontend (Next.js 15, Vercel) ─── single page, plain CSS
   │  JWT Bearer  │  polling GET /api/tasks every 2.2s while active
   ▼
Backend (Express 5, Render) ─── single Node instance
   │
   ├── routes/  (health, tasks, system)
   ├── middleware/ (auth → Supabase JWT verify; error handler)
   ├── lib/taskStore.ts → Supabase PostgreSQL (tasks, usage_daily)
   │
   ├── POST /api/tasks → create_task RPC (atomic quotas) → setImmediate(runTask)
   │
   ├── agent/runTask()  (fire-and-forget, in-process)
   │     planning → research loop → synthesis → verification
   │       │
   │       ├── ai/model.ts chatWithFallback → ai/router.ts → candidates
   │       │     ├── ai/providers.ts (OpenAI clients, token rotation)
   │       │     └── 6 AI providers (OpenRouter/DeepSeek/Groq/Gemini/Z.ai/Cloudflare)
   │       │
   │       └── tools/webSearch.ts → DuckDuckGo HTML (scraped via cheerio)
   └──  ^ Database writes back task status/result/sources per step
```

---

## 5. Frontend Architecture

### 5.1 Framework & Rendering

- **Framework:** Next.js 15.5 (App Router), React 19.1, TypeScript strict.
- **Single route:** `/` (`app/page.tsx`, `'use client'`, `force-dynamic`). No dynamic routes, no route nesting, no layout beyond root.
- **Rendering model:** Entirely client-side (client component page). All components except presentation-only ones are `'use client'`. There is effectively **no SSR/ISR**; the page is `force-dynamic` and interactive-only (auth-gated).
- **PWA:** `manifest.ts` + theme-color + icons (standalone display).

### 5.2 State Management

- **No external state library.** All state is local `useState`/`useRef` in `page.tsx` (session, tasks list, selected task, banner, busy) and `SystemDashboard.tsx`.
- **Composition root:** `page.tsx` holds all app-wide state and passes it down via props (no Context).
- Selected task id mirrored into `selectedIdRef` so async callbacks read the current selection.

### 5.3 Routing

- No router-level routing. "Routing" is conditional rendering driven by `session` (auth vs. app) and `selectedId` (task selection).

### 5.4 Data Fetching & Polling

- All API calls centralized in `lib/api.ts` via a `request<T>()` helper that attaches the Supabase access token as a Bearer header.
- **Polling:** `refreshAll()` (useCallback) refetches the task list and selected task. A `useEffect` installs `setInterval(refreshAll, 2200)` **only while any task is in an active status** (`isActiveStatus`), tearing it down when nothing is active.
- No WebSocket / SSE / realtime — polling-based live updates only.

### 5.5 Forms

- `TaskComposer` (prompt textarea ≤4000 chars, mode dropdown, optional model override) — controlled inputs, disabled while busy.
- `AuthForm` (sign-in/sign-up toggle) → Supabase `signInWithPassword` / `signUp`.
- Client-side validation (min length, min password length).

### 5.6 UI Component Architecture

- Props-based composition; presentational children (TaskRow, TaskProgress, SourceList, EmptyState, ErrorState) delegate callbacks up.
- Shared primitives: `EmptyState`, `ErrorState`.
- Status pills, model badges, run-meta display.

### 5.7 Styling

- **Global plain CSS** in `app/globals.css` (dark theme design system via CSS custom properties). Imported once in layout.
- No Tailwind, no CSS modules, no styled-components, no UI kit.
- Responsive at a single 760px breakpoint.
- Status/state color coding via `.status-<state>` and `.sys-<state>` classes.

### 5.8 Markdown Rendering

- **None.** The task result is rendered inside a `<pre>` block (`TaskDetail.tsx:61`) as plain preformatted text. No markdown parsing/rendering library exists. The synthesis prompt asks the model to use headings/bullets, but they show as literal markdown characters in `<pre>`.

### 5.9 Error Handling & Loading States

- `ApiError` class (status, code, message); `NETWORK_ERROR` (0) and `BAD_RESPONSE` categories.
- Single `banner` state → `<ErrorState>`. `busy` flag disables buttons.
- 401 → `supabase.auth.signOut()`. 404 → clear selected task.
- SystemDashboard has its own local error + busy + per-provider test states.

### 5.10 Authentication Flow

1. Mount → `supabase.auth.getSession()`, subscribe `onAuthStateChange`.
2. No session → header + hero + `AuthForm`.
3. Session exists → full app (composer/list/detail/system).
4. Sign-out clears task state; 401 mid-use signs out.

### 5.11 Task / Result Flow

```
TaskComposer (goal + mode + override)
   → api.createTask(prompt, {mode, model})
   → GET /api/tasks (list refreshed)
   → selected new task, GET /api/tasks/:id
   → poll every 2.2s while active
   → TaskDetail renders by status:
        active → TaskProgress (indeterminate + current step)
        plan → goal + steps
        completed → <pre>{result}</pre> + sources
        failed → error banner + Retry
        cancelled → notice banner
   → Stop / Retry / Delete actions
```

### 5.12 Where Important State Lives

- **Session:** `page.tsx` (`useState<Session>`).
- **Task list / selection:** `page.tsx` (`tasks`, `selectedId`, `selected`).
- **Diagnostics:** `SystemDashboard.tsx` (status/providers/models/tokens/testResults/playground).
- **Model mode selection:** `TaskComposer.tsx` local (`mode`, `model`), sent at submit.

---

## 6. Backend Architecture

### 6.1 Server Framework

- **Express 5** (`express@^5.2.1`), TypeScript ESM.
- `src/server.ts` → `createApp()` → `app.listen(env.PORT)`.
- `src/app.ts` assembles: helmet (CSP disabled), CORS allowlist from `FRONTEND_ORIGIN`, JSON body limit 256kb, 2 rate limiters, request logging, 3 routers, then 404 + error handler. `trust proxy = 1` only in production.

### 6.2 Route Structure

| Router | Mount | Endpoints |
|---|---|---|
| `healthRouter` | `/health` | GET `/health` (public, DB probe) |
| `tasksRouter` | `/api/tasks` (all auth) | POST `/`, GET `/`, GET `/:id`, POST `/:id/cancel`, POST `/:id/retry`, DELETE `/:id` |
| `systemRouter` | `/api/system` (all auth) | GET `/status`, `/providers`, `/models`, `/tokens`, POST `/test`, POST `/playground` |

### 6.3 Layer Map

```
HTTP (Express) 
   ├── middleware/auth (requireAuth → JWT)
   ├── routes/*  (thin: parse/validate → call service → envelope)
   ├── lib/taskStore.ts  (persistence boundary)
   ├── lib/supabase.ts   (DB + auth admin client)
   ├── agent/agent.ts    (runTask — research orchestrator)
   ├── agent/model.ts    (chatWithFallback / structuredWithFallback)
   ├── ai/*              (routing, providers, tokens, health, registry, diagnostics)
   └── tools/webSearch.ts (DuckDuckGo)
```

### 6.4 Task Execution & Background Processing

- **Schedule:** `POST /api/tasks` creates the row (via `create_task` RPC) then calls `runTask(id)` via `setImmediate(...)` — a **fire-and-forget in-process scheduler**. No queue service, no worker process, no persistence of pending work beyond the `queued` status row.
- **Recovery:** A crash mid-run leaves the task in an active status indefinitely; the only recovery paths are user `cancel` or `retry`. There is no startup scan to re-queue or fail stuck tasks (the `queued` status is set but nothing recovers orphaned `planning/searching/...` rows).
- **Cancellation:** cooperative — `requestCancellation` adds to an in-memory `Set` (process-local `cancellation.ts`), and `assertRunning` checks local set + DB status at each step boundary. Cross-instance recovery relies on the DB status check (which only happens at step boundaries).
- Concurrency is bounded per-user by `create_task` RPC (`MAX_ACTIVE_TASKS_PER_USER`, default 2), but **all active tasks run concurrently within the single Node process** (no limiter on total in-flight).

### 6.5 Database Access

- Single `supabaseAdmin` service-role client (`lib/supabase.ts`) used for ALL reads/writes. **RLS is bypassed** by the service role, so the app-level `user_id` scoping in `taskStore.ts` is the real security boundary.
- Checks (owner scoping) applied at the query level: `getTask`, `cancelTask`, `deleteTask` filter `.eq('user_id', userId)`.
- Quota RPCs: `create_task`, `increment_usage`, `decrement_usage` are `SECURITY DEFINER`, pinned `search_path=public`, revoked from `anon`/`authenticated`, granted only `service_role`.

### 6.6 Service I/O Summaries

**createTask / runTask (research agent)**
```
Input:  taskId (admin-fetched, unscoped)
Processing: plan → loop(web_search) → synthesis → verification → persist
Output: completes/updates task row (plan, sources, result, model metadata)
Dependencies: taskStore, model.ts (AI), webSearch.ts (DuckDuckGo), prompts/schemas
```

**chatWithFallback (AI request)**
```
Input: messages[], tools?, {stage, mode, override, prompt}
Processing: route→candidates → for each candidate × tokens → callModel
Output: ChatModelResult{response, model, provider, fallback, ...}
Dependencies: router.ts, providers.ts, tokenManager.ts, health.ts, registry.ts
```

**route (model selection)**
```
Input: {stage, mode, override, estimatedContextChars, prompt}
Processing: classifyTask (keyword scoring) + stage capability reqs + weighted scoring
Output: RouteDecision{candidates[], category}
Dependencies: registry, health, catalog
```

**webSearch (DuckDuckGo)**
```
Input: query, limit
Processing: fetch html.duckduckgo.com/html → cheerio parse → sanitize/dedupe
Output: SearchResult[{title,url,snippet}]
Dependencies: cheerio, fetch (Node global)
```

### 6.7 Error Handling (backend-level)

- Domain errors: `AppError(status, code, message)` → errorHandler maps to `{ok:false, error:{code,message}}`.
- Zod → 400 `VALIDATION_ERROR`; SyntaxError → 400; CORS origin → 403 `FORBIDDEN`; unknown → 500 `INTERNAL_ERROR` (never leaks message).
- AI errors normalized to 8 categories; retryable ones drive fallback. Search errors typed and surfaced back to the model as tool results.

---

## 7. Research Engine (End-to-End Trace of ONE Task)

Exact file/function for each step:

| Step | Where |
|---|---|
| **1. Frontend submission** | `page.tsx:114` `submitPrompt` → `api.createTask(prompt, {mode, model})` (`lib/api.ts:166`) |
| **2. API request** | `POST /api/tasks` → `routes/tasks.ts:38` |
| **3. Input validation** | `lib/prompt.ts` `validatePrompt` (3–4000 chars); `routes/tasks.ts:21-36` parse modelMode/model |
| **4. Task creation (atomic quota)** | `lib/taskStore.ts:18` `createTask` → `supabaseAdmin.rpc('create_task', ...)` → `supabase/schema.sql:135` PL/pgSQL (increments usage, checks active limit, inserts row, returns id) |
| **5. Queue/worker** | NO queue. `routes/tasks.ts:53` → `setImmediate(() => runTask(id))` |
| **6. Planning** | `agent/agent.ts:100` → `structuredWithFallback(planSchema, ...)` → `agent/model.ts:246`. Router (`ai/router.ts:207`) selects model/`route`; plan model emits JSON, parsed by `parseStructured` (`model.ts:233`). `transition(taskId, ['queued'], {status:'planning', plan,...})` |
| **7. Research loop** | `agent/agent.ts:124` `for (let i=0; i<env.MAX_STEPS; i++)` → `chatWithFallback(messages, [webSearchTool], ...)`; status → `searching` or `analyzing` based on remaining search budget |
| **8. Search tool call** | model calls `web_search` → `agent.ts:159` iterates tool calls → validates args (`schemas.ts` `webSearchArgsSchema`) → `incrementSearchUsage` quota (`taskStore.ts:126`) → `webSearch(query,5)` (`tools/webSearch.ts:137`) → DuckDuckGo HTML scrape → results returned as tool reply |
| **9. Source collection** | `agent.ts:48` `collectSources` — dedupe by URL, cap 40 (`MAX_SOURCES_STORED`), stored in task `sources` jsonb |
| **10. Loop termination** | model returns message with no tool_calls → `draft = message.content`; break. Or max steps reached. If no draft → synthesis pass (`agent.ts:209-226`) |
| **11. Verification** | `agent.ts:236` → `structuredWithFallback(verificationSchema, ...)` → `transition(..., {status:'verifying'})`. Produces `{complete, reason, missing}`. |
| **12. Final result persistence** | `agent.ts:252-266` builds result string (draft + verification), `transition(...  {status:'completed', result, sources, model_used, provider_used, fallback_used, steps_used, searches_used, completed_at})` |
| **13. Failure/terminal** | on error → `markFailed` (`agent.ts:286`); on `CancelledTaskError` → log & return (DB already set cancelled by cancel endpoint). `finally` → `clearCancellation`. |
| **14. Frontend polling/realtime** | `page.tsx:88-94` — `setInterval(refreshAll, 2200)` while `anyActive`. No realtime. |
| **15. Final rendering** | `TaskDetail.tsx` — `<pre>{result}</pre>` (no markdown), `SourceList` for sources |

Important caveat: `runTask` fetches the task via `getTaskByAdminId` (unscoped), so the deep-detail path the frontend sees is the same row.

---

## 8. AI Architecture

### 8.1 CURRENT AI FLOW

```
User Task (goal + mode + optional model override)
   ↓
agent/agent.ts runTask() — per stage:
   planning | research(search) | analyzing | synthesis | verifying
   ↓
agent/model.ts chatWithFallback(messages, tools, {stage,mode,override,prompt})
   ↓
ai/router.ts route()  [if AI_ROUTING_ENABLED=true]
   ├── classifyTask(prompt) → category (11 categories, keyword scoring; default WEB_RESEARCH_ANALYSIS)
   ├── STAGE_REQUIREMENTS (tools/structured/vision/embeddings per agent stage)
   └── score candidates: capability fit + context fit + health + EWMA latency + quality/speed/cost + priority
   → List<ModelSpec> candidates (primary from capable pool; relaxed fill if <2)
   ↓
[legacy path if AI_ROUTING_ENABLED=false: OPENROUTER_MODEL_PRIMARY/FALLBACK pair]
   ↓
for each candidate × each available token (TokenManager.select → LRU + cooldown):
   ai/providers.ts clientFor(providerId, token)  (cached OpenAI clients, maxRetries:0)
   → callModel() with AbortController timeout (MODEL_TIMEOUT_MS default 90s)
   ↓
receive ChatCompletion → success: record health success, token success, mark verified
   │
   └─ on failure: normalizeError → AiError category
        healthMonitor.recordFailure  (degraded@2, unavailable@5, auth→skip, rate→backoff)
        tokenManager.recordFailure    (cooldown exponential 30s→5min; auth→disable)
        → try next candidate/token (fallback = attempts > 1)
   ↓
Response to agent stage
   ↓
planning/verifying: structuredWithFallback → parseStructured (extract JSON → Zod) 
   with DEFAULT fallbacks if malformed
```

### 8.2 Model Selection

- **5 user-selectable modes:** `auto`, `quality`, `balanced`, `fast`, `lowcost` (`AI_MODES`).
- **11 task categories:** RESEARCH_PLANNING, WEB_RESEARCH_ANALYSIS, SOURCE_SUMMARIZATION, FACT_VERIFICATION, LONG_FORM_SYNTHESIS, STRUCTURED_EXTRACTION, FAST_SIMPLE_ANSWER, CODING_TECHNICAL, VISION_IMAGE, EMBEDDING, UTILITY_CLASSIFICATION (only some used by keyword classifier; the rest are declared but unproducted).
- **6 agent stages:** planning, research, analyzing, verifying, synthesis, general — each with capability requirements and quality/speed weights.
- **Override:** per-task model override string (from frontend or `AI_DEFAULT_MODEL`), resolved via registry.
- **Scoring weights** blend capability fit, context fit, health, EWMA latency, quality/speed/cost, priority.

### 8.3 Where Model Names Are Defined

- **Static catalog:** `ai/catalog.ts` `STATIC_CATALOG` (13 models hardcoded with capabilities/scores/context).
- **Env-configurable:** `OPENROUTER_MODEL_PRIMARY` / `OPENROUTER_MODEL_FALLBACK` (legacy mode) seed specs via `specForEnvModel`.
- **Dynamic discovery:** `ai/registry.ts` fetches OpenRouter `/api/v1/models` at startup (8s timeout) and adds any new models dynamically.
- **DB:** `model_used`, `model`, `provider_used`, `fallback_used`, `model_mode` persisted per task.

### 8.4 Streaming / Structured Output / Tool Calling

- **Streaming:** ❌ Not implemented. All calls use non-streaming `chat.completions.create`.
- **Structured output:** ❌ Not using native structured outputs. Instead, prompt-emitted JSON + tolerant `parseStructured` (extracts fenced/prose-wrapped JSON → Zod validate → fallback defaults if malformed). The `structuredOutput` capability flag exists but is only used for routing (not passed to API).
- **Tool calling:** ✅ `web_search` function tool via OpenAI tool-calling for the research stage. Unknown tools are rejected with an error tool-reply. No other tools.

### 8.5 Retries / Timeout / Fallback / Token / Context

- **Retries:** `MAX_MODEL_ATTEMPTS` (default 6, cap 10) across all candidates × tokens. No per-request HTTP retries (`maxRetries: 0`); retry is at the routing level.
- **Timeout:** AbortController per call, `MODEL_TIMEOUT_MS` (default 90s).
- **Fallback:** `fallback = attempts > 1`; recorded per task. Router re-scores for each stage.
- **Token handling:** `TokenManager` — per-token LRU rotation, per-token+model exponential cooldown (30s→5min), unhealthy after 5 consecutive failures, disabled on auth error. Multi-token via `*_API_KEYS` CSV.
- **Context handling:** `estimateContextChars` sums message content; feeds `estimatedContextChars` into routing for context-window fit scoring. No truncation/compaction of long conversations (bounded by MAX_STEPS).

### 8.6 Startup Side-Effects

- `agent/model.ts:12-13` runs `seedModelRegistry()` + `startModelDiscovery()` as **import-time side effects** (importing `model.ts` for diagnostics triggers registry setup).

---

## 9. Provider Architecture

| Provider | Integration | OpenAI SDK | Models | Auth | Streaming | Tools | Structured output | Retry | Fallback | Where configured |
|---|---|---|---|---|---|---|---|---|---|---|
| **OpenRouter** | OpenAI-compatible + dynamic model discovery | yes | Dynamic catalog (any registered model) | `OPENROUTER_API_KEY` (single) | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `registry.ts` |
| **DeepSeek** | OpenAI-compatible | yes | `deepseek-chat`, `deepseek-reasoner` (static) | `DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEYS` | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `catalog.ts` |
| **Groq** | OpenAI-compatible | yes | 4 static models | `GROQ_API_KEY` / `GROQ_API_KEYS` | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `catalog.ts` |
| **Google Gemini** | OpenAI-compatible endpoint | yes | 3 static Gemini models | `GEMINI_API_KEY` / `GEMINI_API_KEYS` | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `catalog.ts` |
| **Z.ai** | OpenAI-compatible | yes | `GLM-4.5-Flash` | `ZAI_API_KEY` / `ZAI_API_KEYS` | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `catalog.ts` |
| **Cloudflare Workers AI** | Custom kind; base URL built from account id | yes | 3 static models | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | no | yes | prompt-based only | routing-level | yes | `providers.ts`, `catalog.ts` |

All providers route through the same `chatWithFallback` + router path. All use OpenAI SDK (`openai` package). Only OpenRouter supports **dynamic model discovery** and multi-token rotation of a distinct mechanism; all support multi-token via `*_API_KEYS` CSV (except Cloudflare which expects a single token). All are configured via environment variables; no database/provider registry.

---

## 10. Model Configuration

| Location | Kind | Details |
|---|---|---|
| `ai/catalog.ts` `STATIC_CATALOG` | **Hardcoded** | 13 models; capabilities, contextWindow, quality/speed/cost scores |
| `ai/catalog.ts` `DEFAULT_PROVIDERS` | **Hardcoded** | 6 provider base URLs/specs |
| `ai/registry.ts` `seedFromEnv` | **Env** | Seeds static catalog + OpenRouter env model pair |
| `ai/registry.ts` `discoverOpenRouterModels` | **Runtime dynamic** | OpenRouter `/models` fetch adds new models |
| `config.ts` `AI_DEFAULT_MODE`, `AI_DEFAULT_MODEL` | **Env** | Global defaults |
| `config.ts` `OPENROUTER_MODEL_PRIMARY/FALLBACK` | **Env (legacy only)** | Only used when `AI_ROUTING_ENABLED=false` |
| DB `tasks.model_mode`, `tasks.model` | **Per-task** | User-selected mode / override |
| Frontend `TaskComposer` | **Frontend selection** | Mode dropdown + free-text model override |
| `agent.ts` `routeOpts` | **Runtime** | Passes mode/override/prompt to router each stage |

**Registry type:** There IS a central in-memory `ModelRegistry` (a `Map`), but it is **populated from scattered sources** (static hardcoded catalog + env + dynamic discovery) and is **not persisted** (reseeded at each process start). Provider specs are separate/hardcoded. There is **no DB-backed model table** and **no admin UI to edit models** (only the read-only SystemDashboard).

---

## 11. Token / Secret Architecture

### 11.1 Where Keys Come From

```
Developer "Dev Keys.txt" (gitignored, root) 
   └── scripts/import-keys.ts (masked import) → backend/.env (gitignored)
         └── dotenv → process.env (config.ts Zod validation)
               └── ai/providers.ts buildProviders() → TokenManager.register
                     └── ProviderManager.clientFor → OpenAI client (apiKey)
```

### 11.2 Environment Variable Loading

- Backend: `dotenv/config` in `config.ts:1` loads `.env`; Zod `EnvSchema` validates `process.env` and throws on missing/invalid at boot.
- Frontend: only `NEXT_PUBLIC_*` variables are baked into the client bundle (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`).

### 11.3 Keys Reaching Frontend?

- **Backend AI provider keys — NO.** They never appear in API responses; diagnostics return only masked/`tokenHash`. Frontend only holds Supabase publishable/anon key + project URL (client-safe).
- Frontend `SystemDashboard` displays masked token states (head***tail) and hashes only.

### 11.4 Provider Credential Selection

- Determined by which `*_API_KEY(S)` env vars are set. `buildProviders` skips providers with no token/baseURL. Cloudflare requires account ID + token.
- A single OpenRouter key feeds dynamic model discovery.

### 11.5 Multiple Keys / Rotation / Rate-Limit / Failure

- **Multiple keys:** yes, per-provider via `DEEPSEEK_API_KEYS`, `GROQ_API_KEYS`, `GEMINI_API_KEYS`, `ZAI_API_KEYS` (CSV). OpenRouter accepts only `OPENROUTER_API_KEY` (single). Cloudflare single token.
- **Rotation:** `TokenManager.select` — least-recently-used across enabled/healthy tokens, per-token+model cooldown.
- **Rotation:** No scheduled key renewal/rotation service — not applicable to static provider keys.
- **Rate-limit/token failure handling:** yes — cooldowns, disable-on-auth-error, health tracking, per-call timeout.

### 11.6 Security Boundary

- Provider keys are server-side-only. The service-role Supabase key is server-side-only. The logger redacts `sk-`, JWTs, Bearer tokens. `.env` and `Dev Keys.txt` are gitignored (verified: not in `git ls-files`).

---

## 12. Database Architecture (Supabase PostgreSQL)

### 12.1 Tables

**`public.tasks`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | default `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | FK → `auth.users(id)` ON DELETE CASCADE |
| `prompt` | text NOT NULL | CHECK 1–4000 chars |
| `status` | text NOT NULL | CHECK 8 states, default `queued` |
| `plan` | jsonb | research plan `{goal, steps[]}` |
| `current_step` | text | human-readable step label |
| `result` | text | final synthesis |
| `error` | text | failure reason |
| `steps_used` | integer NOT NULL | default 0 |
| `searches_used` | integer NOT NULL | default 0 |
| `model_used` | text | legacy model field |
| `model_mode` | text | CHECK auto/quality/balanced/fast/lowcost, default auto |
| `model` | text | actual model id/override |
| `provider_used` | text | provider id |
| `fallback_used` | boolean NOT NULL | default false |
| `sources` | jsonb NOT NULL | default `[]` (array of `{title,url,snippet}`) |
| `created_at` | timestamptz NOT NULL | default now() |
| `updated_at` | timestamptz NOT NULL | auto-set by trigger |
| `completed_at` | timestamptz | |

**`public.usage_daily`**

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid NOT NULL | FK → `auth.users(id)` CASCADE |
| `usage_date` | date NOT NULL | default UTC date |
| `usage_type` | text NOT NULL | CHECK `task`/`search` |
| `count` | integer NOT NULL | default 0 |
| PK | (user_id, usage_date, usage_type) | |

### 12.2 Relationships

```
auth.users
   │
   ├── 1:N ── tasks (user_id)  [owned / cascade delete]
   │             └── sources stored in tasks.sources (jsonb, denormalized)
   │
   └── 1:N ── usage_daily (user_id)  [owned / cascade delete]
```

No foreign-key relationship between `tasks` and an entity table for sources — sources are a denormalized JSONB array on the task row.

### 12.3 Indexes

- `tasks_user_created_idx (user_id, created_at desc)` — list tasks ordered by recency.
- `tasks_status_idx (status)` — status filtering.
- `tasks_user_status_idx (user_id, status)` — active-count query.

### 12.4 Constraints & Enums

- Status CHECK constraint (8 values). Model-mode CHECK. Prompt length CHECK. Usage-type CHECK. Composite PK on usage_daily.
- **No native Postgres ENUM types** — all enums are `text` + CHECK constraints.

### 12.5 RLS Policies (+ ownership)

- `tasks`: SELECT/INSERT/UPDATE/DELETE all scoped to `auth.uid() = user_id` (defense-in-depth; backend service-role bypasses it).
- `usage_daily`: RLS enabled but no user policies (accessed only via SECURITY DEFINER RPC through service_role).

### 12.6 Functions / Triggers

- `set_updated_at()` trigger on `tasks`.
- `increment_usage(p_user, p_type, p_max)` → `{count, over}` atomic upsert.
- `decrement_usage(p_user, p_type)` → rollback helper.
- `create_task(p_user, p_prompt, p_max_daily, p_max_active, p_mode, p_model)` → atomic task creation + quota; returns `{id,status,created_at}` or `{error}`.
- All `SECURITY DEFINER`, `search_path=public`, revoked from pub/anon/authenticated, granted `service_role` only.

### 12.7 Important Queries

- `listTasks`: `select LIST_FIELDS where user_id order by created_at desc limit ?`
- `getTask`: select by `id` + `user_id`.
- `getTaskByAdminId`: select by `id` only (backend-trusted, used by agent).
- `transition`: atomic UPDATE with `status IN (from)` — returns rows to apply CAS-style state guard.
- `create_task` RPC: single atomic transaction.

### 12.8 Entity Relationship Diagram (text)

```
auth.users
 │
 ├──< tasks
 │     ├── id (PK)
 │     ├── user_id (FK→auth.users, cascade)
 │     ├── status (text CHECK)
 │     ├── plan (jsonb)
 │     ├── sources (jsonb — denormalized array)
 │     ├── model fields (model_mode/model/model_used/provider_used/fallback_used)
 │     └── timestamps (created/updated/completed)
 │
 └──< usage_daily
       ├── user_id (FK→auth.users, cascade)
       ├── usage_date (date)
       ├── usage_type (task|search)
       └── count
       PK (user_id, usage_date, usage_type)
```

---

## 13. Task State Machine

### 13.1 States (as actually coded)

From `src/types.ts` / `supabase/schema.sql`:

```
QUEUED
  ↓ (runTask start)
PLANNING
  ↓ (plan emitted + persisted)
SEARCHING  ⇄  ANALYZING     (loop; transitioning between per search budget/stage)
  ↓ (final draft obtained)
VERIFYING
  ↓ (verification complete)
COMPLETED

Any active state → FAILED      (on exception, markFailed)
Any active state → CANCELLED   (cancel endpoint; DB update + in-memory signal)
```

`ACTIVE_STATUSES = [queued, planning, searching, analyzing, verifying]`
`TERMINAL_STATUSES = [completed, failed, cancelled]`

### 13.2 Per-State Details

| State | DB value | Who sets it | When | Frontend behavior | Backend behavior |
|---|---|---|---|---|---|
| `queued` | `queued` | `create_task` RPC | On task creation | shows as active; poll continues | task row inserted; runTask scheduled |
| `planning` | `planning` | `agent.ts:92` | runTask start | active, "Creating a research plan" | plan model call |
| `searching` | `searching` | `agent.ts:130` | when search budget remains | active | model + web_search loop |
| `analyzing` | `analyzing` | `agent.ts:130` | when search budget exhausted | active | model-only step |
| `verifying` | `verifying` | `agent.ts:229` | before verification | active | verification model call |
| `completed` | `completed` | `agent.ts:255` | final persistence | full result + sources | writes result/sources/meta |
| `failed` | `failed` | `markFailed` (`agent.ts:286`) | on exception | error banner + Retry | writes error + completed_at |
| `cancelled` | `cancelled` | `cancelTask` endpoint (`taskStore.ts:99`) | cancel request | notice banner | DB update + in-memory signal |

### 13.3 Guard Implementation

- `transition` (taskStore.ts:67) performs an UPDATE with `status IN (from)` and checks affected rows — acts as a **CAS guard** on allowed transitions. `markFailed` only from active states.
- Impossible/dangerous transitions are prevented by these guards (e.g., cannot complete from `completed`, cannot mark a terminal task failed).

### 13.4 Notable Hazards

- `queued` tasks are never re-checked at startup (orphan risk on crash before `runTask`).
- `cancelledLocally` set is process-local — on multi-instance, a cancel on instance A relies on DB status check at next step boundary (not immediate).
- The `retry` endpoint creates a **brand-new task row** (new id) rather than resetting the original.

---

## 14. Data Flow

### Research Goal
- **Created:** `TaskComposer` (`page.tsx`).
- **Stored:** `tasks.prompt` (validated 3–4000 chars).
- **Transformed:** fed into plan prompt + research loop as user message.
- **Consumed:** `agent.ts` (`prompt`), router (`classifyTask`).

### Task
- **Created:** `create_task` RPC (atomic).
- **Stored:** `tasks` row.
- **Transformed:** status transitions + metadata updates in `agent.ts`.
- **Consumed:** frontend (list/detail), `runTask`.

### Research Plan (`{goal, steps[]}`)
- **Created:** planning stage → `structuredWithFallback(planSchema)`.
- **Stored:** `tasks.plan` (jsonb).
- **Transformed:** injected into the model messages (`assistant Plan: {...}`).
- **Consumed:** `agent.ts` loop start; frontend `TaskDetail` (goal+steps).

### Search Result (`{title,url,snippet}`)
- **Created:** DuckDuckGo scrape (`webSearch.ts`).
- **Stored:** temporarily in conversation; persisted in `tasks.sources` (jsonb).
- **Transformed:** deduped/capped in `collectSources`; returned as tool result to model.
- **Consumed:** model (as tool content); `SourceList` (frontend rendering).

### Source
- **Created:** deduped `SearchResult[]` in `collectSources`.
- **Stored:** `tasks.sources` (jsonb, max 40, denormalized).
- **Transformed:** appended during loop.
- **Consumed:** frontend `SourceList` (external links).

### Finding
- **Created:** implicit — model analysis within the research loop (no discrete finding entity/table).
- **Stored:** only within model conversation history (draft).
- **Transformed:** accumulated message history.
- **Consumed:** synthesis prompt.

### Verification (`{complete, reason, missing}`)
- **Created:** `structuredWithFallback(verificationSchema)`.
- **Stored:** merged into `tasks.result` (appended text), not a separate column.
- **Transformed:** appended to draft as "Agent verification" section.
- **Consumed:** rendered within the final `result` `<pre>`.

### Final Answer
- **Created:** synthesis pass (or final loop message `draft`).
- **Stored:** `tasks.result` (plain text, no markdown rendering).
- **Transformed:** not transformed after persistence.
- **Consumed:** `TaskDetail` `<pre>` + source list.

---

## 15. API Inventory

### `GET /health` (public)
- **Auth:** none
- **Input:** none
- **Output:** `{ok, service, version, status, database}` (DB probe).
- **DB:** probes `tasks` table head.
- **AI:** none.
- **Errors:** returns degraded status, doesn't throw.

### `POST /api/tasks` (auth)
- **Input:** `{prompt, modelMode?, model?}`
- **Output:** 202 `{ok, data:{id,status,created_at}}`
- **DB:** `create_task` RPC (quota + insert).
- **AI:** schedules `runTask` (fire-and-forget).
- **Errors:** 400 (validation), 429 (RATE_LIMITED / QUOTA_EXCEEDED), 401 (auth).

### `GET /api/tasks?limit=` (auth)
- **Input:** `limit` (default 25, cap 100).
- **Output:** `{ok, data: TaskListItem[]}`
- **DB:** `listTasks`.
- **Errors:** 401.

### `GET /api/tasks/:id` (auth)
- **Input:** id path param.
- **Output:** `{ok, data: Task}`
- **DB:** `getTask` (owner-scoped).
- **Errors:** 404 (not found / not yours), 401.

### `POST /api/tasks/:id/cancel` (auth)
- **Input:** id path param.
- **Output:** `{ok, data:{id,status:'cancelled'}}`
- **DB:** `cancelTask` (owner-scoped, active-only).
- **AI:** `requestCancellation` (in-memory signal).
- **Errors:** 409 (already terminal), 404, 401.

### `POST /api/tasks/:id/retry` (auth)
- **Input:** id path param.
- **Output:** 202 `{ok, data:{id,status,created_at}}` (NEW task).
- **DB:** `getTask` → `createTask`.
- **AI:** schedules `runTask`.
- **Errors:** 409 (not failed), 429 (limits), 404, 401.

### `DELETE /api/tasks/:id` (auth)
- **Input:** id path param.
- **Output:** `{ok, data:{id,deleted:true}}`
- **DB:** `deleteTask` (owner-scoped, terminal-only).
- **Errors:** 409 (active), 404, 401.

### `GET /api/system/status|providers|models|tokens` (auth)
- **Input:** none.
- **Output:** diagnostics envelopes (status config, provider list, model specs+health, masked token states).
- **Errors:** 401.

### `POST /api/system/test` (auth)
- **Input:** `{provider?, model?, mode?, prompt?}`
- **Output:** `DiagnosticResult {ok, selectedModel, providerId, latencyMs, fallback, output/error...}`
- **AI:** live ping (≤45s) via `chatWithFallback`.
- **Errors:** 401, 400.

### `POST /api/system/playground` (auth)
- **Input:** `DiagnosticRequest {provider?, model?, mode?, prompt?, maxTokens?, timeoutMs?}`
- **Output:** `DiagnosticResult` (≤60s).
- **AI:** live ping.
- **Errors:** 401, 400.

### Identified API concerns

- **Duplicate responsibility:** `POST /api/tasks` and `POST /api/tasks/:id/retry` share identical scheduling/quota logic (no shared service — duplicated inline).
- **Retry creates a new task** — id changes; frontend re-selects new id. Arguably fine but means retry is not "retry the same row."
- **No pagination cursor** on list (limit only).
- **System endpoints expose internal routing/baseURLs** to any authenticated user (not admin-gated) — informational, no credentials leaked, but couples an operational surface into the user app.
- **Consistent envelope** (`{ok, data|error}`) across all endpoints — a strength.

---

## 16. Authentication / Authorization

### 16.1 Flow

```
Browser
   ↓ (email/password → Supabase Auth hosted SDK / UI)
Supabase Auth (sign in/up, JWT, email confirmation for signup)
   ↓ access_token (stored by @supabase/ssr)
Frontend lib/api.ts request() → attaches `Authorization: Bearer <token>`
   ↓
Backend middleware/auth.ts requireAuth → authenticateBearer(token)
   → supabaseAdmin.auth.getUser(token)  (server-side JWT verify, v2 session check)
   → req.user = {id, email}
   ↓
Routes use req.user.id for all owner-scoped DB queries
   ↓
Databases (RLS as defense-in-depth; service-role bypasses it)
```

### 16.2 Session

- Sessions managed by Supabase Auth (hosted, auto-refreshed client-side by `@supabase/ssr`). No server-side session/cookie store.
- Backend is **stateless** w.r.t. sessions — validates JWT per request via `getUser`.
- Frontend reacts to `onAuthStateChange`; 401 handler signs out.

### 16.3 Server-side authorization / ownership

- Enforced in `taskStore.ts`: `getTask`, `cancelTask`, `deleteTask` filter by `user_id`. `transition`/`getTaskByAdminId`/`markFailed` are unscoped (internal, trusted to agent run path).
- **No admin/role distinction** — `requireAuth` grants the same access to everyone; the `/api/system/*` ops endpoints are accessible to any authenticated user.

### 16.4 Guest/sandbox mode

- **None.** No anonymous/guest access path; `/health` is the only public endpoint.

### 16.5 Where authorization is actually enforced

- Ownership on reads/writes: middleware + taskStore app-level checks (primary).
- RLS policies: secondary defense (bypassed by service role).
- No authorization on `/api/system/*` beyond being authenticated (potential privilege concern).

---

## 17. External Services

| Service | Purpose | Integration point | Failure behavior | Timeout | Retry | Fallback |
|---|---|---|---|---|---|---|
| **Supabase Auth** | Identity | `authenticateBearer` / SDK | 401 on invalid/expired | — | none | none (re-auth) |
| **Supabase PostgreSQL** | Persistence | `supabaseAdmin` + RPCs | query errors → task fails / 500 | — | none | none |
| **OpenRouter** | AI inference + model discovery | OpenAI SDK / fetch | categorized AiError; model discovery warns | discovery 8s; request 90s | routing-level | other providers/models |
| **DeepSeek** | AI inference | OpenAI SDK | categorized AiError | 90s | routing-level | other providers |
| **Groq** | AI inference | OpenAI SDK | categorized AiError | 90s | routing-level | other providers |
| **Google Gemini** | AI inference | OpenAI SDK | categorized AiError | 90s | routing-level | other providers |
| **Z.ai** | AI inference | OpenAI SDK | categorized AiError | 90s | routing-level | other providers |
| **Cloudflare Workers AI** | AI inference | OpenAI SDK | categorized AiError | 90s | routing-level | other providers |
| **DuckDuckGo (HTML)** | Web search | `webSearch` fetch + cheerio | typed errors surfaced to model as tool result | 10s | none (surfaced as tool error; model adapts) | **none — single provider** |

---

## 18. Error Handling

| Failure | Where it occurs | Representation | Backend handling | Frontend sees | Retry |
|---|---|---|---|---|---|
| **AI failure (auth/429/timeout/etc.)** | `model.ts` callModel → normalizeError → AiError category | 8 categories | health/token recorded; try next candidate/token; if all fail → thrown → task `markFailed` OR surfaced to caller | failed status error banner (task) or DiagnosticResult (system) | routing-level fallback |
| **Search failure** | `webSearch.ts` (timeout/http/parse/no_results/rate-limit) | typed errors | caught in `agent.ts`, tool error reply to model; model may adapt/continue | task continues or completes with gaps | none (only reacts in-loop) |
| **Database failure** | `taskStore.ts` / queries | raw Supabase errors | propagated → 500 (or task-level catch) | 500 INTERNAL_ERROR / task failed | none |
| **Timeout** | AbortController in callModel | → AiError TIMEOUT | fallback | as above | routing-level |
| **Invalid input** | `prompt.ts` / `routes` validation / Zod | AppError / ZodError | 400 VALIDATION_ERROR / BAD_REQUEST | banner with message | none |
| **Rate limit (HTTP)** | express-rate-limit | 429 envelope RATE_LIMITED | returns 429 | banner | none |
| **Quota (DB)** | create_task / increment_usage RPC | 429 QUOTA_EXCEEDED | 429 | banner | none (retry creates new task) |
| **Authentication failure** | backend `authenticateBearer` | unauthorized 401 | 401 UNAUTHORIZED | frontend signs out | none |
| **Malformed AI response** | `parseStructured` | try/catch + fallback defaults | uses DEFAULT plan/verification; logs warn | task proceeds with fallback plan | implicit |

500 errors never leak internals (generic message); logs redact secrets.

---

## 19. Performance Architecture

### 19.1 Polling
- Frontend polls every **2.2s** while any task is active. The interval tears down when nothing active. Reasonable for a low-traffic solo/user app; not scalable to many concurrent users browsing (each active task page keeps polling).

### 19.2 Database
- Queries are simple and indexed (user_id+created_at, status, user+status). List queries uncapped beyond `limit`. No N+1 concerns (single-row task detail). Quota RPCs are atomic.

### 19.3 AI calls
- **The main bottleneck.** Each research loop step may involve one or more chat-completion calls **sequentially**. Steps run client-visible via polling. Latency is dominated by model time (90s timeout × up to 6 attempts worst-case). No parallel tool calls / no batch fan-out of searches.

### 19.4 Search calls
- Sequential, one query at a time, up to `MAX_SEARCHES` per task + `DAILY_SEARCH_LIMIT` per user. 10s timeout each. DuckDuckGo scraping is slower/unreliable vs. a real search API.

### 19.5 Concurrency
- Single Node process. Active tasks run concurrently but **unbounded total** (only per-user active cap). With many users, in-flight model requests + `setImmediate` scheduler could exhaust the event loop / hit Render request timeouts. **No worker pool / no queue backpressure.**

### 19.6 Caching
- **None** — no HTTP cache, no Redis, no layer cache. OpenAI clients cached per provider+token (minor). Model discovery result cached (single `discoveryPromise`).

### 19.7 Rendering
- Single page, `<pre>` for results (no markdown). Large reports render in a single pre-block — fine for moderate sizes but unoptimized for very long outputs (no chunking/incremental).

### 19.8 Source processing
- Capped at 40 sources/task, snippets truncated to 400 chars. Light dedupe via Set. No content fetching/reading — only snippets from search results.

### 19.9 Likely bottlenecks (current)
1. Sequential model calls per step.
2. Single-thread in-process scheduler with unbounded concurrent tasks.
3. No cache for repeat prompts/sources.
4. DuckDuckGo scraping latency/fragility.
5. `getStatus` DB round-trip on every `assertRunning` step boundary adds latency per loop iteration.

---

## 20. Security Architecture

- **Secrets:** Provider + service-role keys are server-side only; gitignored; redacted in logs; masked/hashed in diagnostics. Frontend includes only publishable/anon Supabase credentials + API URL. Verified `.env`/`Dev Keys.txt` not tracked by git.
- **Authorization:** Every task route requires a valid JWT; ownership enforced app-level (primary) + RLS (defense-in-depth). No admin/role separation.

### Risks

- **SSRF:** Low. The agent only fetches DuckDuckGo's fixed HTML endpoint with user-controlled **query text quoted into the URL path** (encoded) — not a direct user-URL fetch. However, any future "fetch URL" feature would need SSRF guarding. Sources from search results are only stored as metadata, never fetched.
- **Prompt injection:** High exposure. Untrusted search **snippet text** is returned verbatim into the model context as tool results. The system prompt instructs not to fabricate/cite invented sources, but there's no explicit instruction/defense against adversarial snippets instructing the model (no delimiters/escaping, no "ignore content that instructs you" hardening).
- **Untrusted web content:** Snippets flow into context and result (limited truncation) but are never rendered as HTML in the frontend (rendered as text in `<pre>`/external link targets — escaped by React). No XSS vector identified on the result render path (React escapes text).
- **Unsafe URLs:** Search result URLs passed to `normalizeUrl` (http/https only) and rendered as `<a href>` targets — could point to arbitrary external sites (user-click risk, typical for a search app). No allowlist / no proxying.
- **Excessive permissions:** `true` on `ALWAYS` — the backend uses the **service-role Supabase client** for ALL reads/writes including simple user data. Broader than a per-user/client-key approach (though guarded by app-level checks). RPCs (SECURITY DEFINER) correctly restricted.
- **Data isolation:** Owner scoping prevents cross-user reads/deletes. `getTaskByAdminId` is unscoped but only used internally by the agent with a server-known taskId.
- **Injection risks:** SQL injection mitigated by Supabase SDK parameterized queries; no raw SQL in app code (SQL only in trusted schema functions/triggers). No `eval`/`new Function` on model output; JSON parsed via `JSON.parse` + Zod (safe).
- **Client/server secret boundaries:** Clean — provider keys never reach client; only `NEXT_PUBLIC_*` are client-visible.
- **Rate limiting:** Global 120/min + task-create 10/min + per-user DB quotas. `trust proxy=1` in prod.
- **Helmet:** Enabled but CSP disabled.
- **CORS:** Strict allowlist from `FRONTEND_ORIGIN`, credentials false.

---

## 21. Deployment Architecture

### 21.1 LOCAL

```
Backend  (Render-style local)    Frontend (Next.js dev)
  npm run dev (tsx watch, :10000)   npm run dev (Vercel-style, :3000)
  ├── .env (Supabase URL + svc key + provider keys)  ├── .env.local (NEXT_PUBLIC_*)
  └── Supabase local/cloud DB  (schema.sql applied)   └── calls backend :10000
```

### 21.2 PRODUCTION

```
User Browser
   │
   ▼
Vercel (Frontend, Next.js standalone)
   │  JWT  │                          ┌──────────────────────────┐
   ▼       │                          │ Render Blueprint app      │
Supabase Auth                          │  agentos-backend (Node 20)│
   │                                   │  npm install && npm build │
   ▼                                   │  npm start (dist/server) │
Supabase PostgreSQL ────────────────▶  │  /health liveness        │
  tasks, usage_daily, RPCs             │                          │
                                       │  ▼                       │
                                       │  6 AI providers          │
                                       │  ▼                       │
                                       │  DuckDuckGo (HTML)       │
                                       └──────────────────────────┘
```

### 21.3 Build process
- Backend: `tsc -p tsconfig.json` → `dist/`; start `node dist/server.js`. Dev via `tsx watch`.
- Frontend: `next build` (`output: 'standalone'`).

### 21.4 Deployment config
- **`render.yaml`:** defines a single `web` service (backend only), Node 20, health path `/health`, build `npm install && npm run build`, start `npm start`. Frontend deployed separately on Vercel (auto-detected). **No multi-instance/worker service defined.**

### 21.5 Environment variables
- Backend: 27 vars (Section 11 / `.env.example`).
- Frontend: 3 `NEXT_PUBLIC_*` vars.

### 21.6 External service dependencies
- Supabase (DB + Auth), 6 AI providers, DuckDuckGo. All must be reachable.

---

## 22. Dependency Map

```
UI (page.tsx) ─── components ─── lib/types
   │
   └── lib/api (ApiClient) ──┐
                             ▼
                       Express routes (tasks, system, health)
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        middleware/auth  lib/taskStore  lib/prompt
              │              │
              ▼              ▼
        lib/supabase     supabaseAdmin
        (authenticate   RPC create_task/increment_usage
         Bearer)  
                             │
                             ▼
                     agent/agent.ts (runTask)
                             │
              ┌──────────────┼───────────────────┐
              ▼              ▼                   ▼
       agent/model.ts   agent/cancellation  tools/webSearch
              │                                │
              ▼                                ▼
       ai/router.ts                        DuckDuckGo (cheerio)
              │
              ▼
       ai/registry + ai/health + ai/errors
              │
              ▼
       ai/providers (ProviderManager) + ai/tokenManager
              │
              ▼
       6 AI providers (OpenAI SDK)
```

### Circular / suspicious couplings
- `agent/model.ts` imports `ai/runtime` and `ai/registry` and **also triggers registry seeding via import side-effect** — importing model for diagnostics mutates global AI state. Coupling is implicit via modules, not explicit function call chains.
- `diagnostics.ts` imports `chatWithFallback` from `agent/model.ts` and `providerManager` from `ai/runtime.ts` — connects the agent layer and the diagnostics layer.
- `ai/runtime.ts` builds providers at import (module-level `createAiRuntime`), making the whole AI graph eager at server boot.
- No formal DI/container; singletons via module-level exports (`tokens`, `aiRuntime`, `providerManager`, `modelRegistry`, `healthMonitor`) — implicit global state and harder to test/swap.

---

## 23. Single Points of Failure

1. **Single backend process** for ALL task execution (in-process `setImmediate` scheduler). A crash mid-run strands tasks; no auto-recovery.
2. **Single search provider** (DuckDuckGo HTML). If DDG blocks/changes HTML, all research fails — no fallback search provider.
3. **Single production database** (Supabase) — no replica/read pool used; outage = total outage.
4. **Single OpenRouter key** for dynamic model discovery — if it fails, dynamic models disappear (though static catalog persists).
5. **Single polling mechanism** (2.2s interval drives all live updates) — no realtime; a single stuck task keeps polling alive.
6. **In-memory cancellation registry** — multi-instance deploys would not cancel instantly across instances.
7. **In-memory health/token/registry state** — lost on restart, must rebuild via seeds/discovery.
8. **`AI_ROUTING_ENABLED` single toggle** — if router is off, falls to legacy single-provider OpenRouter pair.

---

## 24. Architectural Weaknesses (current)

### CRITICAL
1. **Task execution is fire-and-forget + in-process, no durable queue.** `setImmediate` scheduling means no resume, no retry-on-restart, no horizontal scaling, tasks stuck on crash. The `queued` state has no re-driver.
2. **Single search provider (DuckDuckGo HTML scrape)** with no fallback — the research engine's input is fragile and dependency-locked; scraping is against ToS-ambiguous and can break arbitrarily.
3. **Unbounded total concurrent tasks in one process** — only per-user active cap; no aggregate worker/semaphore; risk of event-loop saturation at scale.

### HIGH
4. **Single-page monolith frontend** — no routing, no code-splitting, all logic in `page.tsx`; poor scalability of the UI layer and no realtime (polling only).
5. **Model/provider config scattered** — static catalog hardcoded + env + dynamic discovery + no DB persistence or admin UI; model additions require code changes. Hard to tune per-installation.
6. **Structured output via prompt + JSON parse, no native structured outputs** — brittle; relies on fallback defaults instead of guaranteed schemas.
7. **Model/health/token/registry all in-memory** — non-durable, single-process, non-observable later (counters reset on restart).
8. **No markdown rendering** — results are raw text in `<pre>`; the synthesis prompt asks for rich formatting that isn't rendered.
9. **`/api/system/*` exposed to any authenticated user** (not admin-scoped) — leaks internal routing/health/base URLs; potential misuse as a free model playground.

### MEDIUM
10. **`getTaskByAdminId` unscoped access** — single internal caller, but a landmine if re-used by a route.
11. **Retry creates a new row** (new id) instead of re-running the same task — UX/identity semantics.
12. **No caching** anywhere (model, search, prompts).
13. **Sequential research loop** — model + search serialized per step; no parallel search fan-out.
14. **Duplicated scheduling/quota logic** between `POST /api/tasks` and `POST /:id/retry`.
15. **Single-page no-real framework benefit** from Next.js App Router given it's one client page (SSR/server components essentially unused).
16. **Task error text is raw model/search error** persisted — limited sanitization (truncated to 2000 chars) but could include sensitive internal details.

### LOW
17. **Duplicate unused `utils/supabase/client.ts`** vs `lib/supabase.ts`.
18. **7 of 11 task categories declared but only ~5 actually used by the keyword classifier** (EMBEDDING, RESEARCH_PLANNING, UTILITY_CLASSIFICATION, etc. referenced in type but not fully productive).
19. **CSP disabled** in helmet (CORS strict, but no CSP).
20. **No lint/format** scripts defined in either package.

---

## 25. Architectural Strengths (preserve)

1. **Genuine provider abstraction with multi-token rotation** — `ProviderManager` + `TokenManager` + OpenAI-compatible interface is a solid base for adding providers/models.
2. **Smart routing layer** (`router.ts`) — scores candidates by capability fit, health, latency (EWMA), quality/speed/cost, priority; stage/category/mode aware. A strong foundation to extend.
3. **Model health tracking** (`HealthMonitor`) — EWMA latency, degraded/unavailable thresholds, auth/rate-limit handling, recovery delays.
4. **Error categorization** (`normalizeError` → 8 categories; retryable set) — clean, reusable.
5. **Atomic DB quotas** (`create_task` / `increment_usage` SECURITY DEFINER RPCs) — correct concurrency-safe limits with rollback.
6. **Clean owner-scoped task model** with CAS-style `transition` guards — safe state machine.
7. **Consistent API envelope** (`{ok, data|error}`) across all endpoints.
8. **Server-side-only secrets + redaction** — clean key boundary; `.env`/`Dev Keys.txt` not committed.
9. **Simple, decomposable backend layers** (routes → taskStore → agent → ai → tools) — easy to reason about.
10. **Cooperative cancellation** design (assertRunning at stage boundaries) — sound pattern.
11. **Good test coverage** (Vitest + supertest, external deps mocked, ~131 tests).
12. **Idempotent schema + migrations** with pinned `search_path` security-definer functions.
13. **Easy local dev** — two `npm run dev`s, dotenv, `.env.example` docs.

---

## 26. Technical Debt

- **Dead/obsolete code:** `utils/supabase/client.ts` (unused duplicate of `lib/supabase.ts`). `model_used` legacy column overlaps with `model`. Legacy single-provider path (`OPENROUTER_MODEL_PRIMARY/FALLBACK`) still in code though routing is default on. `OPENCODE_API_KEY` env var defined but not wired to a live provider path.
- **Unused dependencies:** `@types/supertest`/`supertest` used. `cheerio` used. `@supabase/ssr` in frontend only used for client creation. No other obvious unused deps; frontend has no lint/test tooling.
- **Duplicated code:** task-create+schedule logic duplicated between `POST /api/tasks` and `POST /:id/retry`; `AI_MODES` defined in 3 places (types.ts, config.ts, router.ts re-export); `ACTIVE_STATUSES`/`TERMINAL_STATUSES` duplicated in backend/types.ts and frontend/lib/types.ts; model capability raster duplicated as `ModelSpec`/`ModelDiagnostic`.
- **Configuration duplication:** env keys defined in `config.ts` schema, `providers.ts` input interface, `.env.example`, and README — 4 sources of truth for env var names.
- **Temporary hacks:** `setImmediate` scheduling is a stand-in for a real queue; `parseStructured` fallback is a stand-in for native structured output.
- **Inconsistent naming:** `model_used` vs `model`; `DuckDuckGoSearchError.kind` uses `'parse'` for network failures; `model_key` terminology (`modelKey` var) vs provider/model.
- **Overly large modules:** `page.tsx` (264 lines, all app logic); `agent.ts` (293 lines orchestrator); `globals.css` (entire design system in one file).
- **Import-time side effects:** `model.ts` seeds registry/discovery on import — surprising coupling.

---

## 27. Current Architecture Scorecard

| Dimension | Score | Reason |
|---|---|---|
| **Maintainability** | 6/10 | Clean layers and small files, but multiple sources of truth for config/models, global singletons, import side-effects, duplicated logic, no lint tooling. |
| **Scalability** | 3/10 | Single-process, in-process scheduler, no queue, no horizontal scaling, polling frontend, sequential research loop, no caching. |
| **Reliability** | 5/10 | Good error categorization + routing fallback + atomic DB quotas, but fire-and-forget tasks (no resume/retry-on-restart), single search provider, in-memory state loss on restart. |
| **Security** | 7/10 | Strong secret boundary, owner scoping, redemption, safe JSON parsing, atomic RPCs. Deductions: prompt-injection exposure via unfenced snippets, system endpoints non-admin, unscoped `getTaskByAdminId`, CSP off, service-role for everything. |
| **Testability** | 7/10 | Good Vitest/supertest coverage (~131 tests), external deps mocked; deductions: global singletons/import side-effects make some paths harder to isolate. |
| **AI extensibility** | 8/10 | OpenAI-compatible abstraction + router + token manager + health monitor is genuinely extensible; strong core. Deduction: static catalog hardcoded, structured output prompt-based. |
| **Provider extensibility** | 8/10 | Adding a provider = env key + static catalog entry (+ optional discovery); clean interface. Deduction: Cloudflare special-cased, OpenRouter discovery special-cased. |
| **Performance** | 3/10 | Sequential model+search loop, polling, no cache, unbounded concurrency, per-boundary DB round-trips. |
| **Developer experience** | 7/10 | Two `npm run dev`s, .env.example, scripts (import:keys, verify:providers), good docs (README/MULTI_MODEL). Deduction: no monorepo tooling, no lint, config duplication, secrets file workflow. |
| **Deployment simplicity** | 8/10 | Render Blueprint + Vercel + Supabase, minimal moving parts, health check. Deduction: single-instance assumption is both simple and limiting; no worker config. |

---

## 28. Final Current-State Summary

```
CURRENT AGENTOS ARCHITECTURE

Frontend:
  Next.js 15 (App Router) + React 19, single client page ('use client', force-dynamic),
  Supabase Auth (email/password), plain global CSS, no markdown rendering (result in <pre>),
  no state library (local useState in page.tsx), 2.2s polling while any task active, no realtime.

Backend:
  Express 5 + TypeScript (ESM), route→service→store layering, JWT bearer auth (Supabase verify),
  consistent {ok,data|error} envelope, unified error handler (AppError/Zod/envelope, 500s never leak),
  fire-and-forget task scheduling via setImmediate on a single Render Node instance.

Database:
  Supabase PostgreSQL: tasks + usage_daily, RLS + owner scoping (service-role bypass = app-level checks primary),
  atomics SECURITY DEFINER RPCs for quotas (create_task/increment_usage/decrement_usage),
  status CHECK constraint + CAS-style transition guards, denormalized sources jsonb, no native ENUMs.

AI:
  Six providers (OpenRouter/DeepSeek/Groq/Gemini/Z.ai/Cloudflare) via OpenAI SDK,
  smart router (11 categories × 6 stages × 5 modes, weighted scoring),
  TokenManager (multi-token LRU rotation + cooldown + health), HealthMonitor (EWMA latency, thresholds),
  ModelRegistry (static catalog + env + OpenRouter dynamic discovery), all in-memory/non-persisted,
  prompt-JSON structured output (no native structured outputs), no streaming,
  fallback bounded by MAX_MODEL_ATTEMPTS (6), per-call AbortController timeout (90s).

Search:
  DuckDuckGo HTML endpoint scraped with cheerio — the ONLY search provider (no fallback),
  10s timeout, quota-tracked (MAX_SEARCHES/task + DAILY_SEARCH_LIMIT/user), snippets fed back to model.

Task execution:
  create_task RPC (atomic quota) → setImmediate(runTask) → planning → loop(web_search) → synthesis → verification
  → completed with result+sources+model metadata. Cooperative cancellation at step boundaries (local set + DB status).
  No durable queue, no resume-on-restart, no worker pool.

Authentication:
  Supabase Auth (email/password, email confirmation). JWT passed as Bearer; verified server-side per request.
  Ownership enforced app-level (user_id filters) + RLS defense-in-depth. No admin/role separation. No guest mode.

Deployment:
  Render Blueprint (backend, Node 20, single web service) + Vercel (frontend) + Supabase (DB+Auth).
  Build: tsc → dist; Next.js standalone. Health check /health.

Main bottleneck:
  Sequential in-process research pipeline on a single instance (model+search serialized per step),
  no queue/worker/cache, unbounded concurrent tasks — limits throughput and scalability.

Main architectural risk:
  Task execution is entirely in-process and fire-and-forget (no durable job queue, no resume on restart),
  plus a single fragile search provider (DuckDuckGo HTML scrape) as the sole research input source.

Strongest architectural decision:
  The multi-provider AI abstraction — ProviderManager + smart router + TokenManager rotation
  + model HealthMonitor + error categorization — is cohesive, extensible, and deliberately built,
  and should be preserved as the foundation for the next architecture.

Most important thing that should NOT be broken:
  The AI routing/provider/token/health core and the atomic quota RPCs — they are the most
  valuable, correct, and hard-to-rebuild parts of the system.
```

---

*This audit is READ-ONLY. No architecture was redesigned, refactored, or modified. It is the source of truth for the upcoming redesign.*
