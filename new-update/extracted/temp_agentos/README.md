# AgentOS

Autonomous web research agent: give it a goal, and it plans, searches the web, analyzes findings, and returns a verified answer with sources you can check.

- **Frontend** — Next.js 15 (App Router, TypeScript), dark responsive UI, PWA-ready
- **Backend** — Express 5 + TypeScript, rate limited, CORS allowlisted
- **Database** — Supabase (PostgreSQL + Auth)
- **Models** — OpenRouter with primary → fallback model routing and timeouts
- **Search** — DuckDuckGo results provider with URL decoding and sanitization

## How it works

1. **Plan** — the agent asks the model to turn the goal into a research plan.
2. **Loop** — the model issues `web_search` calls; each result is deduped, sanitized, and stored; the model analyzes what it finds.
3. **Verify** — a final pass decides whether the goal was completed. A malformed or missing verification never claims success — the task is marked `partial`.
4. **Result** — persisted with the collected sources, step count, and the model used.

## Features

- Supabase Auth sign in / sign up (JWT validated server-side — the browser is never trusted for identity)
- Atomic per-user daily quotas (`create_task`, `increment_usage`) and a max-concurrent-tasks limit enforced in SQL
- Cooperative cancellation: stopping a task is picked up at the next model, search, and verification boundary
- Guarded status transitions (a finished task can never be overwritten)
- Sources stored only from results the agent actually retrieved (max 40, deduped)
- Honest failure reporting — never fabricates `complete: true`
- Structured JSON logging with secret redaction

## Prerequisites

1. **Supabase** project — `SUPABASE_URL`, and both anon + service role keys.
2. **OpenRouter** API key — `OPENROUTER_API_KEY`.
3. **Render** (backend) and **Vercel** (frontend) — or run locally.

## Local setup

### 1. Database

Run `supabase/schema.sql` in the Supabase SQL editor.
It is idempotent (safe to re-run) and creates the tables, indexes, RLS policies, and quota RPCs.
Incremental delta scripts live in `supabase/migrations/`.

### 2. Backend

```bash
cd backend
cp .env.example .env    # fill in real values
npm install
npm run dev             # http://localhost:10000
```

Test with the full stack locally (no real Supabase/OpenRouter/DuckDuckGo required — everything is mocked):

```bash
npm test
npm run typecheck
npm run build
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # fill in real values
npm install
npm run dev                  # http://localhost:3000
```

### 4. Configuration

Backend (`.env`):

| Variable | Description |
| --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | Listening port (default `10000`) |
| `FRONTEND_ORIGIN` | Comma-separated allowed CORS origins |
| `APP_URL` | Public frontend URL (OpenRouter referer) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key. Never expose to the browser |
| `OPENROUTER_API_KEY` | OpenRouter key. Never expose to the browser |
| `OPENROUTER_MODEL_PRIMARY` | Primary model id |
| `OPENROUTER_MODEL_FALLBACK` | Fallback model id |
| `MAX_STEPS` | Max agent loop iterations per task |
| `MAX_SEARCHES` | Max searches per task |
| `DAILY_TASK_LIMIT` | Daily task quota per user |
| `DAILY_SEARCH_LIMIT` | Daily search quota per user |
| `MAX_ACTIVE_TASKS_PER_USER` | Max concurrently running tasks per user |
| `MODEL_TIMEOUT_MS` | Model request timeout before fallback |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |

Frontend (`.env.local`):

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (safe for the browser) |
| `NEXT_PUBLIC_API_URL` | Backend base URL |

## API

All endpoints are JSON. Success: `{ "ok": true, "data": ... }`. Errors: `{ "ok": false, "error": { "code", "message" } }`.

Auth: `Authorization: Bearer <supabase-jwt>` (except `/health`).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness + DB connectivity |
| `POST` | `/api/tasks` | Create a task (`{ prompt }`) → `202`; returns `{ id }` |
| `GET` | `/api/tasks` | List the caller's tasks |
| `GET` | `/api/tasks/:id` | Full task (plan, result, sources) |
| `POST` | `/api/tasks/:id/cancel` | Request cancellation |
| `POST` | `/api/tasks/:id/retry` | Re-run a failed task as a fresh run |
| `DELETE` | `/api/tasks/:id` | Delete a finished task |

Error codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (invalid transition / still active), `QUOTA_EXCEEDED` 429, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500.

## Deployment

### Backend — Render

Use `render.yaml` (Web Service rooted at `backend/`) or create a service manually:

- Build: `npm install && npm run build`
- Start: `npm start`
- Environment: everything from the backend table above; Render injects `PORT`.

### Frontend — Vercel

Import the repository and set the project root to `frontend`, then set the three `NEXT_PUBLIC_*` variables. `npm run build` runs automatically.

### Security notes

- The backend only ever reads the caller's identity from the validated Supabase JWT.
- The service role key and OpenRouter key live only on the server.
- CORS is restricted to `FRONTEND_ORIGIN`; requests from other origins are rejected.
- Request bodies are capped, and a global per-IP rate limiter protects the API.
- Errors returned to clients never include stack traces or secrets.

## Free-tier reality check

Render Free services sleep after ~15 minutes of inactivity and can take about a minute to wake. Supabase Free projects can pause after a week of low activity. OpenRouter's free model availability and limits can change — the fallback model and hard quotas exist partly for this. Operate first; scale later.

## Known limitations (V1)

- No browser automation, shell/code execution, or sandboxes — web research only.
- No long-term memory or multi-agent orchestration.
- "Verified" means the model's own consistency check passed. A model can be wrong even when it is confident.
- Search quota is per-user per-day; there is no admin panel or plan tiers.

## Validation plan

Before broader rollout, run 20 personal tasks and track: completion rate, average duration, model fallback frequency, search failures, verification failures, quota hits, and useful-result rate. Only when the core loop is reliable should the next version add browser automation.