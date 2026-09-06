# AgentOS — CURRENT ARCHITECTURE DIAGRAMS

Companion to `AGENTOS_CURRENT_ARCHITECTURE.md`. All diagrams reflect the code as it exists on disk.

---

## 1. System Architecture (Top Level)

```
┌─────────────────────────────┐
│         User / Browser      │
└──────────────┬──────────────┘
               │  email / password → Supabase Auth (hosted)
               ↓
┌─────────────────────────────┐        ┌──────────────────────────────┐
│   FRONTEND  (Vercel)        │        │   SUPABASE (hosted)          │
│   Next.js 15 + React 19     │        │   PostgreSQL + Auth          │
│   App Router, single page   │        │   tasks, usage_daily, RPCs   │
│   Supabase Auth (client)    │        │   RLS + SECURITY DEFINER     │
│   @supabase/ssr             │        └──────────────▲───────────────┘
│   Plain CSS (dark theme)    │                       │
└──────────────┬──────────────┘                       │
               │  JWT Bearer                           │ service-role client
               │  GET/POST /api/*                      │ (bypasses RLS)
               ▼  polling 2.2s while active            │
┌─────────────────────────────┐                       │
│   BACKEND  (Render)         │───────────────────────┘
│   Express 5 + TypeScript    │
│   single Node instance      │
│                             │
│   ┌───────────────────────┐ │
│   │ routes/               │ │
│   │  health  tasks  system│ │
│   └───────────┬───────────┘ │
│               │             │
│   ┌───────────▼───────────┐ │
│   │ middleware/           │ │
│   │  auth (JWT verify)    │ │
│   │  errorHandler         │ │
│   └───────────┬───────────┘ │
│               │             │
│   ┌───────────▼───────────┐ │
│   │ lib/                  │ │
│   │  taskStore (persist)  │ │
│   │  supabase (admin)     │ │
│   │  config (Zod)         │ │
│   └───────────┬───────────┘ │
│               │             │
│   ┌───────────▼───────────┐ │
│   │ agent/agent.ts        │ │
│   │  runTask (orchestrator│ │
│   │   fire-and-forget)    │ │
│   └───┬────────┬──────────┘ │
│       │        │            │
│   ┌───▼───┐  ┌─▼──────────┐ │
│   │ model │  │ cancellation│ │
│   │ .ts   │  │  (memory)   │ │
│   └───┬───┘  └────────────┘ │
│       │                     │
│   ┌───▼───────────────┐     │
│   │ ai/               │     │
│   │  router  providers│     │
│   │  tokenManager     │     │
│   │  health  registry │     │
│   │  errors  runtime  │     │
│   │  diagnostics      │     │
│   └───┬───────────┬───┘     │
│       │           │         │
│   ┌───▼───┐   ┌───▼──────┐  │
│   │ tools │   │ 6 AI     │  │
│   │ webSearch◄─┤providers │  │
│   └───┬───┘   │(OpenAI)  │  │
│       │       └──────────┘  │
│       ↓                     │
│   DuckDuckGo (HTML)         │
└─────────────────────────────┘
```

---

## 2. Research Task End-to-End Flow

```
 User (browser)
   │  POST /api/tasks {prompt, modelMode, model}
   ▼
 Express routes/tasks.ts:38
   │  validatePrompt (3-4000), parse modelMode/model
   ▼
 lib/taskStore.ts createTask
   │  → RPC create_task (atomic quota + insert)
   ▼
 Supabase schema.sql create_task (SECURITY DEFINER)
   │  increments usage, checks active limit, inserts row (queued), returns {id,...}
   ▼
 routes/tasks.ts:53
   │  setImmediate(() => runTask(id))     ← NO queue, fire-and-forget
   ▼
 agent/agent.ts runTask()
   │
   ├─[planning]   structuredWithFallback(planSchema) → model/router → JSON plan
   │              transition(queued → planning, plan, model_used)
   │
   ├─[searching/analyzing]  REPEAT ≤ MAX_STEPS:
   │     chatWithFallback(messages, [web_search tool], {stage})
   │        └── model calls web_search(query)
   │              → validate args (webSearchArgsSchema)
   │              → incrementSearchUsage (RPC quota)
   │              → webSearch(query,5) [tools/webSearch.ts → DuckDuckGo HTML via cheerio]
   │              → collectSources (dedupe, cap 40) → tool reply to model
   │        └── model returns message
   │              • tool_calls present → continue loop
   │              • no tool_calls → draft = content → break
   │     assertRunning() at each boundary (local set + DB status)
   │
   ├─[synthesis]  (only if no draft) chatWithFallback(SYNTHESIS_PROMPT...)
   │
   ├─[verifying]  structuredWithFallback(verificationSchema)
   │              transition(→ verifying)
   │              → {complete, reason, missing}
   │
   └─[completed]  transition(→ completed, result=draft+verification, sources,
                             model_used, provider_used, fallback_used,
                             steps_used, searches_used, completed_at)
   │
   │  on exception     → markFailed (transition → failed, error truncated 2000)
   │  on cancel        → CancelledTaskError (DB already set cancelled by endpoint)
   ▼
 Frontend polling (page.tsx, every 2.2s while active)
   │  GET /api/tasks  +  GET /api/tasks/:id
   ▼
 TaskDetail renders by status: active→progress, plan→goal/steps,
   completed→<pre>result</pre>+sources, failed→error+Retry, cancelled→notice
```

---

## 3. AI / Model Selection Flow

```
 Agent stage: planning | research | analyzing | verifying | synthesis | general
   + mode: auto | quality | balanced | fast | lowcost
   + override (per-task | AI_DEFAULT_MODEL | null)
   + estimatedContextChars
   + prompt text
        ↓
 ai/router.ts route()
   ├── classifyTask(prompt) → category (keyword scoring, default WEB_RESEARCH_ANALYSIS)
   ├── STAGE_REQUIREMENTS[stage] → {tools, structured, vision, embeddings}
   ├── build candidate pool = modelRegistry.enabled()  (hard-excluded: auth_error/disabled)
   ├── primary = capable candidates (satisfy requirements)
   ├── relaxed = candidates skipped for rate-limit/degraded or not matching
   ├── rank by scoreCandidate():
   │     capabilityFit + contextFit + healthScore + latencyScore(EWMA)
   │     + quality*speed weights + cost + priority bonus
   ├── override spec prepended if provided
   └── dedupe, cap at maxCandidates (6) → RouteDecision{candidates, category}
        ↓
 ai/providers.ts ProviderManager.clientFor(providerId, token) → cached OpenAI client
        ↓
 ai/tokenManager.ts TokenManager.select(providerId, {avoid, modelKey})
   ├── enabled + healthy only
   ├── cooldown (per token+model, exponential 30s→5min)
   └── LRU (least recently used first)
        ↓
 ai/health.ts HealthMonitor
   ├── recordSuccess: EWMA latency (α=0.3), reset failures
   └── recordFailure: degraded@2, unavailable@5, auth→skip, rate→backoff, 90s recovery
        ↓
 for each candidate × each token (≤ MAX_MODEL_ATTEMPTS=6):
   callModel() → OpenAI SDK chat.completions.create (AbortController, MODEL_TIMEOUT_MS=90s)
        ↓
 response OR AiError category (normalizeError: auth/rate/timeout/model_unavail/badreq/server/network/unknown)
   └── success → return ChatModelResult{response, model, provider, fallback(attempts>1)...}
   └── fail    → record health + token, try next candidate/token
        ↓
 All fail → throw AiError → agent markFailed / caller
```

---

## 4. Provider Architecture

```
                       ┌────────────────────────────────────────────┐
  6 providers ────────▶│ OpenAI-compatible (OpenAI SDK)            │
                       │  openrouter  → https://openrouter.ai/api/v1│
                       │  deepseek    → https://api.deepseek.com/v1 │
                       │  groq        → https://api.groq.com/openai/v1│
                       │  gemini      → .../v1beta/openai/          │
                       │  zai         → https://api.z.ai/api/paas/v4│
                       │  cloudflare  → https://api.cloudflare.com/ │
                       │              client/v4/accounts/{id}/ai/v1 │
                       │  (kind: cloudflare, account-id base URL)  │
                       └────────────────────────────────────────────┘
   Auth:    env *_API_KEY / *_API_KEYS (CSV → TokenManager multi-token)
   Config:  ai/catalog.ts DEFAULT_PROVIDERS + ai/providers.ts buildProviders
   Dynamic: OpenRouter /api/v1/models discovery (ai/registry.ts, 8s timeout)
   Tools:   web_search (all providers capable)
   Structured: prompt-emitted JSON + parseStructured (no native structured outputs)
   Streaming: none
```

---

## 5. Model Catalog / Registry

```
 Static catalog (ai/catalog.ts STATIC_CATALOG, 13 models)
   ├── deepseek: deepseek-chat(V3.x), deepseek-reasoner(R1)
   ├── groq: gpt-oss-120b, gpt-oss-20b, qwen3.8-27b, compound-mini
   ├── gemini: gemini-3.6-flash, gemini-3.7-flash, gemini-3.1-flash-lite
   ├── zai: GLM-4.5-Flash
   └── cloudflare: llama-3.3-70b-fp8-fast, llama-3.1-8b-fp8, qwen2.5-coder-32b
        │  (each: capabilities{tools,vision,structuredOutput,embeddings},
        │         contextWindow, qualityScore, speedScore, costPriority, priority)
        ▼
 ai/registry.ts ModelRegistry (in-memory Map<key 'provider:model', ModelSpec>)
   ├── seedFromEnv()    → static + OpenRouter env pair (legacy)
   ├── discoverOpenRouterModels() → dynamic OpenRouter models (dedupe/skip if exists)
   └── seedModelRegistry() at runtime.ts (import-time side effect)
        │  all in-memory, NOT persisted
        ▼
 Consumed by router.ts (enabled()), diagnostics.ts (modelDiagnostics), model.ts
```

---

## 6. Database Entity Relationship

```
┌────────────────────────────────────────────────────────────┐
│ auth.users  (Supabase internal / hosted)                  │
│   id (uuid PK)                                            │
└─────────────┬───────────────────────────────┬─────────────┘
              │ user_id                        │ user_id
              │ 1:N                            │ 1:N
              ▼                                ▼
┌────────────────────────────────┐  ┌────────────────────────────────┐
│ public.tasks                   │  │ public.usage_daily             │
├────────────────────────────────┤  ├────────────────────────────────┤
│ id            uuid PK          │  │ user_id    uuid FK (cascade)   │
│ user_id       uuid FK (cascade)│  │ usage_date date (UTC)          │
│ prompt        text (1-4000)    │  │ usage_type text (task|search)  │
│ status        text CHECK (8)   │  │ count       int                │
│ plan          jsonb            │  │ PK (user_id, usage_date,       │
│ current_step  text             │  │     usage_type)                │
│ result        text             │  │                                │
│ error         text             │  │ RLS: enabled, no policies      │
│ steps_used    int              │  │ (service_role via RPCs only)   │
│ searches_used int              │  └────────────────────────────────┘
│ model_used    text  (legacy)   │
│ model_mode    text CHECK (5)   │
│ model         text             │
│ provider_used text             │
│ fallback_used bool             │
│ sources       jsonb ([] of     │
│               {title,url,snippet})
│ created_at    timestamptz      │
│ updated_at    timestamptz      │  (trigger set_updated_at)
│ completed_at  timestamptz      │
│                                │
│ RLS: 4 owner-scoped policies   │
│ Indexes: (user_id, created_at) │
│          (status)              │
│          (user_id, status)     │
└────────────────────────────────┘

 Security-definer RPCs (search_path pinned, revoked from anon/authenticated,
                         granted service_role only):
   create_task(p_user,p_prompt,p_max_daily,p_max_active,p_mode,p_model) → jsonb
   increment_usage(p_user,p_type,p_max) → {count, over}
   decrement_usage(p_user,p_type) → void
```

---

## 7. Task State Machine

```
           (create_task RPC)
                 │
                 ▼
              QUEUED ──────────────┐
                 │                 │
                 │ runTask start   │
                 ▼                 │
             PLANNING              │
                 │                 │
          ┌──────┴───────┐         │ any active → FAILED (on exception via markFailed)
          │              │         │ any active → CANCELLED (endpoint: DB update + signal)
          ▼              ▼         │
     SEARCHING  ⇄   ANALYZING      │
          │              │         │
          └──────┬───────┘         │
                 ▼                 │
            VERIFYING              │
                 │                 │
                 ▼                 │
           COMPLETED  ─────────────┘

   ACTIVE   = [queued, planning, searching, analyzing, verifying]
   TERMINAL = [completed, failed, cancelled]

   Guards: transition() UPDATE ... WHERE status IN (from)  + affected-rows check (CAS)
           markFailed() only from ACTIVE
           cancelTask() only from ACTIVE, owner-scoped
           deleteTask() only from TERMINAL, owner-scoped
```

---

## 8. Deployment Architecture

### LOCAL

```
┌─────────────────┐                ┌─────────────────┐
│ Frontend        │                │ Backend         │
│ next dev :3000  │───────────────▶│ tsx watch :10000│
│ .env.local      │  HTTP + JWT    │ .env            │
│ NEXT_PUBLIC_*   │                │ (svc key +      │
│                 │                │  provider keys) │
└─────────────────┘                └────────┬────────┘
                                            │ service-role client
                                            ▼
                                  ┌─────────────────┐
                                  │ Supabase (local │
                                  │  or cloud DB)   │
                                  │ schema.sql      │
                                  └─────────────────┘
```

### PRODUCTION

```
            User Browser
                 │
                 ▼
        ┌───────────────────┐
        │  Vercel           │   (Next.js standalone, no config needed)
        │  Next.js 15       │
        │  ENV: NEXT_PUBLIC_*│
        └─────────┬─────────┘
                  │ JWT Bearer + API calls
                  ▼
        ┌───────────────────┐        ┌───────────────────┐
        │  Render           │        │  Supabase (hosted)│
        │  agentos-backend  │────────▶  PostgreSQL+Auth  │
        │  (Node 20)        │        │  tasks, usage,    │
        │  /health liveness │        │  RPCs, RLS        │
        │  render.yaml      │        └───────────────────┘
        │  single web svc   │
        └─────────┬─────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   ┌──────────────┐   ┌──────────────┐
   │ 6 AI providers│   │ DuckDuckGo  │
   │ (OpenAI SDK) │   │ (HTML scrape)│
   └──────────────┘   └──────────────┘
```

---

## 9. Dependency Map (layered)

```
 UI (page.tsx)
   │
   ├─ components/*  ── lib/types
   │
   └─ lib/api (ApiClient)
        │
        ▼
 Express routes (tasks / system / health)
   │
   ├─ middleware/auth  ── lib/supabase (authenticateBearer)
   ├─ lib/taskStore    ── lib/supabase (supabaseAdmin) ── Supabase RPCs
   ├─ lib/prompt (validate)
   │
   └─ agent/agent.ts (runTask)
        │
        ├─ agent/model.ts
        │     ├─ ai/router.ts
        │     │    ├─ ai/registry.ts  ── ai/catalog.ts
        │     │    ├─ ai/health.ts
        │     │    └─ lib/config
        │     ├─ ai/providers.ts (ProviderManager, OpenAI clients)
        │     │    └─ ai/tokenManager.ts
        │     ├─ ai/errors.ts
        │     └─ ai/runtime.ts (singletons: tokens, aiRuntime, providerManager)
        │
        ├─ agent/cancellation.ts ── lib/taskStore (getStatus)
        │
        └─ tools/webSearch.ts ── cheerio ── DuckDuckGo

 Diagnostics: ai/diagnostics.ts ─▶ router / model / providers / tokens / health
```
