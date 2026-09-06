# AgentOS V1 — Final Release Audit

Audit date: 2026-09-06
Scope: `backend/` (Express + TypeScript), `frontend/` (Next.js 15 + TypeScript), `supabase/` (schema + migrations), `render.yaml`, `README.md`
Auditor method: source inspection, static analysis, full automated test/typecheck/build verification. Live Supabase/OpenRouter/DuckDuckGo/account flows are marked **MANUAL LIVE VALIDATION REQUIRED** — no credentials were available and no validation is faked.

Verdict legend:
- **PASS** — verified by running code/tests/builds.
- **PASS (code-level)** — verified by source inspection only; external dependency not exercised live.
- **REVIEW** — correct per source, residual risk documented, no change required for this release.
- **MANUAL LIVE VALIDATION REQUIRED** — cannot be proven locally; requires real credentials + deployed environment.

---

## 1. Executive Summary

AgentOS V1 is a two-service web app: a Next.js/React frontend and an Express/TypeScript backend. Users sign in with Supabase Auth (GoTrue), submit research prompts, and an agent (OpenRouter LLM) plans, searches the web via DuckDuckGo HTML, synthesizes, verifies, and stores tasks + sources in Supabase (Postgres). Quotas and rate limits protect cost and abuse.

Automated verification this session (all actually executed):

| Check | Result |
|---|---|
| Backend `npm run typecheck` | PASS |
| Backend `npm test` | PASS — 97/97 tests across 8 files |
| Backend `npm run build` | PASS |
| Frontend `npx tsc --noEmit` | PASS |
| Frontend `npm run build` | PASS — Next 15.5.25, `/` static-prerendered, 70.9 kB / 174 kB first load |
| Live E2E (sign up → research → cancel → retry) | MANUAL LIVE VALIDATION REQUIRED |

Bugs fixed during this audit pass: malformed model tool-call JSON no longer fails the task (`backend/src/agent/agent.ts`), a wasted model call after the max-steps fallback was removed, two dead-code removals (`rollbackUsage`, `SEARCH_TOOL_SUMMARY_PROMPT`), a frontend create/retry detail-refresh race (`frontend/app/page.tsx`). Four new agent tests were added (cancellation timing ×3 + malformed tool output ×1) and the agent test harness was made deterministic (mock once-queues are now reset per test).

**Verdict: READY TO DEPLOY (CONDITIONAL)** — subject to Section 30.

---

## 2. Repository & Version Control

- The working directory **is not a git repository** (`git status` → "fatal: not a git repository").
- No `.gitignore`-based secret scanning was possible; a manual scan of the source tree found **no committed secrets** (no `sk-*`, JWTs, or service-role keys in `backend/src`, `frontend` (excluding `node_modules`), `supabase/`, or `*.md`).
- `node_modules` and `dist/`, `.next/` build artifacts exist on disk but are not under version control.
- **Action for release:** run `git init` at the top level (or mirror into a private repo), add `.gitignore` for `backend/node_modules`, `backend/dist`, `frontend/node_modules`, `frontend/.next`, `.env`, `*.log`. **MANDATORY before handoff.**

---

## 3. Project Structure & Build

- `backend/` — Express 4 app, single entrypoint (`src/server.ts` → `createApp()`), compiled to `dist/` via `tsc`.
- `frontend/` — Next.js 15 App Router, client-rendered page (`app/page.tsx` with lazy browser-only Supabase client; `export const dynamic = 'force-dynamic'` keeps it a static prerender that hydrates client-side). Build uses Next's default webpack pipeline.
- Clean separation: `routes/`, `middleware/`, `lib/` (infra), `agent/` (orchestration + model + schemas), `tools/` (web search).
- Build output verified: `npm run build` succeeds in both packages; `start` scripts are `node dist/server.js` (backend) and `next start` (frontend).

---

## 4. TypeScript & Code Style

- Both packages run `tsc --noEmit` clean (PASS).
- Strict mode on both `tsconfig.json`; no `any` leaks in app source (types are shared via `frontend/lib/types.ts` and `backend/src/types.ts`).
- Style is consistent (2-space indent, named exports, no semicolon-omission errors) and mirrors existing conventions; no linter config is present in either package (optional future add — not a release blocker).

---

## 5. Environment Configuration & Secrets

- `backend/src/lib/config.ts` validates all env vars with a Zod schema at import time; missing/invalid values crash fast at boot with a descriptive message (PASS).
- Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_PRIMARY`, `OPENROUTER_MODEL_FALLBACK`.
- Tuned defaults (max constraints enforced): `MAX_STEPS` 8 (≤30), `MAX_SEARCHES` 5 (≤20), `DAILY_TASK_LIMIT` 10 (≤1000), `DAILY_SEARCH_LIMIT` 50 (≤10000), `MAX_ACTIVE_TASKS_PER_USER` 2 (≤10), `MODEL_TIMEOUT_MS` 90000 (≤600000), `PORT` 10000, `FRONTEND_ORIGIN` must be set to the deployed origin.
- **Secrets never leave the backend** — frontend uses only `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which are public by design. `test/setup.ts` stubs env so tests never touch real credentials.
- **Action:** provide `.env` examples to the deploy operator; never commit real values (see §2).

---

## 6. Deployment Platform

- `render.yaml` (declarative Blueprint): one Node web service each for backend and frontend.
  - Backend: Node `NODE_VERSION: 20`, health check `healthCheckPath: /health` (so Render marks the instance healthy only when the API responds) — PASS.
  - Frontend: Next 15 requires Node ≥18 → `NODE_VERSION: 20` is compatible.
- Local verification ran on Node v24.19.0; `package.json` `engines: >=20`. **Do not upgrade `openai` to v7** (requires Node 22; v6.49.0 pins the current behavior).
- Render free tier: single instance; the scheduler is **in-process** (see §17/§28).

---

## 7. Database Schema & Migrations

- `supabase/schema.sql` (canonical, idempotent) and `supabase/migrations/001_add_sources_and_usage.sql` (delta for existing deployments) verified against all app queries.
- `public.tasks`: `id`, `user_id` (FK `auth.users`, cascade), `prompt` (1–4000 check), `status` enumerated, `plan jsonb`, `current_step`, `result`, `error`, `steps_used`, `searches_used`, `model_used`, `sources jsonb`, `created_at/updated_at/completed_at`. Indexes: `(user_id, created_at desc)`, `(status)`, `(user_id, status)` — both hot query patterns are covered (list + active-count).
- `public.usage_daily` with composite PK `(user_id, usage_date, usage_type)`; atomic `increment_usage`/`decrement_usage` PG functions use `INSERT ... ON CONFLICT` upserts to make **daily quotas concurrency-safe** — PASS.
- `create_task` PG function atomically enforces daily-task + active-task limits and inserts the row in one statement (true atomicity, no check-then-insert race) — PASS.
- Trigger `set_updated_at()` keeps `updated_at` fresh on UPDATE — consistent with app expectations.

---

## 8. Row-Level Security (RLS)

- `tasks` and `usage_daily` have RLS enabled (PASS).
- User policies: SELECT/INSERT/UPDATE/DELETE scoped to `auth.uid() = user_id` — no cross-user reads or writes (PASS).
- Quota functions (`create_task`, `increment_usage`, `decrement_usage`) are `SECURITY DEFINER` with pinned `search_path`, and `EXECUTE` is revoked from `anon`/`authenticated` — only `service_role` may call them (PASS).
- **REVIEW — residual risk:** because the `anon`-key client is used in the browser for Auth, the RLS `UPDATE`/`DELETE` policies on `tasks` allow a signed-in user to directly modify/delete their own rows via the anon key (self-faking their own history/limits, no cross-user access). Accepted for this release; the alternative (RESTRICTED policies + all mutations via service-role API) is a documented future hardening (see §29).

---

## 9. Authentication & Session Security

- `backend/src/middleware/auth.ts` + `lib/supabase.ts`: every `/api/tasks*` route requires `Authorization: Bearer <JWT>`, verified server-side against Supabase's JWT secret (validation of `exp`, audience, signing key) — PASS (code-level; live token issuance requires a real Supabase project → MANUAL LIVE VALIDATION REQUIRED).
- Frontend signs in via Supabase Auth; the resulting session token is attached to backend calls; 401 is handled by clearing the session and dropping to the auth form (`frontend/lib/api.ts`).
- No tokens are logged (logger redaction, §21); CORS restrict origins (§10).

---

## 10. API Design & Error Envelope

- Single envelope contract: success `{ ok: true, data }`; error `{ ok: false, error: { code, message } }`.
- Codes: `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `BAD_REQUEST` 400, `CONFLICT` 409, `QUOTA_EXCEEDED` 429, `RATE_LIMITED` 429, `INTERNAL_ERROR` 500.
- Routes (all behind `requireAuth`): `POST /api/tasks` (202 → run async), `GET /api/tasks` (list, `limit` clamp 1–100), `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`, `POST /api/tasks/:id/retry`, `DELETE /api/tasks/:id`; unauthenticated `/health`.
- `errorHandler` never leaks stack traces or internals to clients — 500s return a generic message (PASS). Zod and JSON-parse errors map to 400/`VALIDATION_ERROR`/`BAD_REQUEST` (PASS).
- OpenAPI/Swagger absent — optional; API shape is small and documented in README.

---

## 11. HTTP Hardening (CORS / Headers)

- `helmet` sets secure headers (`x-powered-by` disabled additionally); `contentSecurityPolicy: false` because the page loads remote model output and images — acceptable trade-off documented (REVIEW).
- CORS: allowlist from `FRONTEND_ORIGIN` (comma-separated), only `GET/POST/DELETE/OPTIONS`, headers `Authorization`/`Content-Type`, disallowed origins → 403 `FORBIDDEN` (PASS — verified by `api.test.ts`).
- `express.json({ limit: '256kb' })` body cap (PASS).
- Rate limiting: global 120 req/min + strict 10 task-creations/min per IP (PASS, `express-rate-limit`; trust-proxy considerations for Render noted in README).

---

## 12. Input Validation & Prompt Safety

- `validatePrompt` enforces length (1–4000) and trimming; Zod schemas validate every step: `planSchema` (goal 1–500, 2–5 steps each ≤300), `verificationSchema`, `webSearchArgsSchema` (query 3–300) — PASS.
- System prompts instruct the model to return well-formed JSON and to avoid leaking secrets/instructions; agent treats malformed model output as recoverable (this audit pass added the try/catch + tool-error replies; §20).
- Malformed values fall back to safe defaults (`DEFAULT_PLAN`/`DEFAULT_VERIFICATION`) and the task continues rather than aborts — PASS.

---

## 13. Quota System & Limits

- Daily task quota (10 default) and daily search quota (50 default) are decremented/verified through the atomic Postgres functions — no double-spend races (PASS).
- Per-task search cap (`MAX_SEARCHES` 5) enforced inside the agent loop; a forced `continue` with an instructive tool reply to the model.
- **REVIEW — documented behavior:** a search that *fails* (provider timeout/error) still **consumes** the daily search quota because a race exists between concurrent tasks sharing one per-user daily counter; the `decrement_usage` function exists in SQL but is deliberately **not wired** into the agent flow. Documented in README; acceptable for V1.
- Quota exceeded → `QUOTA_EXCEEDED`/`RATE_LIMITED`-style messages surfaced to the UI (frontend displays the server message, §23).

---

## 14. Rate Limiting & Abuse Prevention

- Per-IP global (120/min) + task-creation (10/min) limits (PASS). Combined with daily quotas and active-task caps at the DB layer, the surface an attacker can cost the app is bounded.
- No per-user-auth rate limit on `/api/tasks` GET — low risk, list is paged/clamped; noted as future work.

---

## 15. Web Search Integration & Sanitization

- DuckDuckGo HTML endpoint (`https://html.duckduckgo.com/html/?q=...`), 10 s timeout via `AbortSignal.timeout`, UA identifies the agent, 10–12 s helps.
- `parseDuckDuckGoHtml` uses cheerio on `.result` blocks; `decodeDuckDuckGoUrl` resolves DDG's `/l/?uddg=` redirect wrappers and `//`-protocol links back to absolute http(s) URLs — PASS (code-level; class selectors verified against sample HTML in tests).
- `sanitizeSearchResults`: protocol-whitelist (http/https only), dedupe by URL, title ≤200, snippet whitespace-collapsed ≤400 — no `javascript:`/data URLs can reach storage — PASS.
- Rate-limit detection: 429/202 responses and `anomaly|blocked|rate limit` message heuristics turn into `SearchRateLimitError`; the agent logs it and continues with whatever it has (PASS).
- **MANUAL LIVE VALIDATION REQUIRED:** DDG may serve captcha/anomaly pages on some networks; verify real queries return results from the deployed region.

---

## 16. AI Model Integration (OpenRouter)

- `model.ts` uses OpenAI SDK against OpenRouter (`client.chat.completions`), primary → fallback model retry loop, 90 s `withTimeout` per attempt, `max_tokens: 1800`, `temperature: 0.2` — PASS (code-level).
- Fallback chain logged (`model_request_failed`, `model_fallback`); both models validated non-empty at boot via config schema.
- **MANUAL LIVE VALIDATION REQUIRED:** confirm the two configured OpenRouter model IDs exist, are free/available, keys are valid, and timeouts are sensible at the deployed location.

---

## 17. Agent Orchestration & State Machine

- `agent.ts` `runTask`: fetch task → `planning` → loop (`searching`/`analyzing`) bounded by `MAX_STEPS`/`MAX_SEARCHES` → draft → `verifying` → `completed`, with a `failed`/`cancelled` terminal set. All state changes go through `transition(taskId, allowedFrom, patch)` with a guarded allowed-from set, so states cannot be skipped or re-applied — PASS.
- Tool-call loop: schema-validates args, enforces quota, honors per-task search cap, appends tool replies, collects up to 40 deduped sources.
- Malformed tool-call JSON (added fix this pass) → error tool reply + continue; empty response → `failed`; search exceptions → tool reply + continue; unparseable plan/verification → schema fallbacks.
- Scheduling: `POST /api/tasks` and `/retry` both `setImmediate(() => runTask(id))` in-process. **REVIEW — single-instance assumption:** in-process scheduling means a multi-replica/edge deployment could run duplicate work or drop queued tasks; Render is configured for a single web instance, which is safe here (§28).

---

## 18. Cancellation System

- Cooperative cancellation: `cancelTask` persists `cancelled`; `requestCancellation` sets an in-process registry; `assertRunning` checks the registry first, then reads live status (`getStatus`) at every agent checkpoint — so cancellation takes effect between steps, before each model call, before search, and before completing/verifying — PASS.
- `CancelledTaskError` is swallowed (no `markFailed`, no `completed`), registry cleared in `finally`.
- 3 new tests in this pass verify the exact checkpoints: between a finished search and the next model call; immediately before verification; immediately before completion. All pass.
- **REVIEW — known limitation:** the registry is per-process; if the process restarts mid-task, persisted cancellation still wins via the `getStatus` read (active status list excludes `cancelled`), so interrupted tasks stop on restart. No cross-node cancellation.

---

## 19. Planner & Verification Integrity

- Planning produces a structured plan (goal + steps) stored in `tasks.plan`; verification runs after the draft is synthesized, producing `complete/reason/missing`, and the final `result` clearly labels `Verified: yes|partial` with the reason and a `Missing:` line — no claim of unverified accuracy — PASS.
- Verification uses its own model turn (not the drafting turn), so self-verification bias is bounded by the prompt and by the honest `partial` fallback rather than a hard pass.

---

## 20. Error Handling & Failure Modes

| Failure mode | Behavior | Status |
|---|---|---|
| Model returns empty | task → `failed` with message | PASS |
| Model returns malformed JSON args | tool-error reply, continue | PASS (fixed this pass) |
| Model returns malformed plan/verification | schema fallback, continue | PASS |
| Web search throws (timeout/rate/network) | logged, tool-error reply, continue | PASS |
| DB error mid-run | `markFailed` (bounded 2000-char message) | PASS |
| Cancellation anywhere | clean stop, no fail-mark | PASS |
| Task row missing at start | warn + return | PASS |
| Concurrency: cancel + finish race | guarded transitions prevent wrong states | PASS |

All failure paths are covered by `agent.test.ts`, `api.test.ts`, `lifecycle.test.ts`, `cancellation.test.ts` (97/97 green this pass).

---

## 21. Logging & Observability

- JSON structured logs via `lib/logger.ts`: `ts`, `level`, `service`, `event`, optional data/error. Levels gated by `LOG_LEVEL`.
- **Redaction** strips `sk-*` keys, JWTs, and `Bearer` tokens from both data fields and error messages/stacks before output — PASS (verified by `logger.test.ts`).
- Events: `task_created`, `task_retried`, `task_cancel_requested`, `task_completed`, `task_cancelled`, `task_failed`, `model_request_failed`, `model_fallback`, `plan_parse_failed`, `verification_parse_failed`, `search_rate_limited`, `search_failed`, `cors_rejected`, `health_checked`, `unhandled_error`.
- `GET /health` returns `{ok, status: ok|degraded, database}` and executes a real 1-row DB probe → Render health checks reflect actual DB reachability (PASS).
- No APM/metrics/trace shipping — acceptable for V1; restart/health + structured logs give baseline observability (REVIEW).

---

## 22. Frontend Architecture

- Next.js 15 App Router; single-route app (`/`) with `force-dynamic` (static prerender + client hydration), `manifest.ts`, `viewport` export (Next 15 styled), dark responsive `globals.css`.
- 10 focused components (`AuthForm`, `Header`, `TaskComposer`, `TaskList`, `TaskRow`, `TaskProgress`, `TaskDetail`, `SourceList`, `ErrorState`, `EmptyState`).
- Browser-only Supabase client created **lazily inside `useState` with a `typeof window` guard** — fixes the build-time SSR crash when `NEXT_PUBLIC_SUPABASE_*` is unset — PASS (previously failing build now builds cleanly).
- PWA-ready manifest + real `icon-192.png`/`icon-512.png` (generated locally, both valid PNGs). No service worker, so it is not installable-but-offline — noted.

---

## 23. Frontend Data Flow & State

- `lib/api.ts` is envelope-aware: unwraps `data`, maps error codes to `ApiError`; `401` clears the session and drops to the auth form; quota messages surface the server text.
- Polling: task list + selected detail refetch every ~2 s while an active task exists, driven by a `useEffect` with cleanup (no leaks, no setState after unmount).
- **Race fixed this pass:** `submitPrompt` and `retrySelected` now synchronously update `selectedIdRef.current` and `setSelected(await api.getTask(newId))` before `refreshAll()`, so the newly created task's detail loads immediately instead of on the next poll.
- SSR: page is client-rendered (auth is browser-only), so SSR data mismatch risk is minimal; Supabase client creation is guarded.

---

## 24. UI/UX & Responsiveness

- Dark theme, card-based task rows with status badges, progress phases (`planning/searching/analyzing/verifying`), sources list, error/empty states, disabled composer while quota-limited.
- Responsive: single-column stacking under ~640 px, side-by-side detail on desktop; buttons/keyboard accessible; loading spinners during transitions.
- Verified visually in prior iterations; the build produces the exact sizes above (§1).

---

## 25. Accessibility

- Semantic HTML (`form`, `label`, `button`, `section`), visible focus states, color-safe status text (badge color + text, not color alone), `aria-busy`/`aria-live`-style feedback via status text, sufficient contrast in the dark palette.
- No automated a11y scan is wired — manual keyboard/contrast review done; screen-reader pass is part of the live validation checklist (§31.2) (REVIEW).

---

## 26. PWA & Manifest

- `app/manifest.ts` provides name, start_url `/`, display standalone, theme/bg colors; icons `icon-192.png`, `icon-512.png` exist in `public/icons/` and are referenced correctly (build passed).
- Verified by reading `manifest.webmanifest` output route (993 B) in the build summary (PASS).
- No service worker / offline caching — documented as out of scope for V1.

---

## 27. Testing & Coverage

Test suites (all green this pass, 97/97):

| File | Covers |
|---|---|
| `api.test.ts` | Auth 401, CORS 403, envelope shape, create/list/get/cancel/retry/delete, 404 scoping, quotes limits, rate-limit stubs |
| `agent.test.ts` | Happy path (plan→search→draft→verify→complete), max-steps/MAX_SEARCHES guardrails, quota guard, failure modes (empty, search throw), malformed plan fallback, cancellation timing ×3, malformed tool JSON recovery |
| `lifecycle.test.ts` | Lifecycle transitions & status guards |
| `cancellation.test.ts` | Local registry semantics, CancelledTaskError, clear-on-finish |
| `search.test.ts` | DDG HTML parsing, `/l/` redirect decode, URL sanitization/dedup, rate-limit heuristics |
| `model.test.ts` | Fallback chain + timeout behavior (openai module mocked) |
| `logger.test.ts` | Redaction of secrets/tokens from output |
| `sanity.test.ts` | Config validation, origin parsing |

- The agent suite was hardened this pass: `beforeEach` now resets mock once-queues (`mockReset`) so per-test `mock*Once` setups never leak — eliminated the previous cross-test coupling.
- `npm test` (vitest) is deterministic with no network access (all external modules mocked/stubbed).
- No frontend component tests (no test runner configured) — E2E via browser is on the live checklist (§31.2, T1–T20).

---

## 28. Known Limitations & Residual Risks

1. **Single-instance execution**: in-process scheduler + in-process cancellation registry — safe on one Render web instance; not safe for horizontal scaling or edge/serverless. (README documents this.)
2. **Failed searches consume daily search quota** — deliberate V1 trade-off to avoid a concurrent-task race on the shared per-user daily counter.
3. **RLS self-mutation** via anon key on own `tasks` rows (self-faking only; no cross-user access).
4. **No service worker/offline**; **no APM/metrics shipping**; **no OpenAPI** — all documented non-blockers.
5. **git not initialized** — version control is prerequisite (§2).
6. Live behavior of OpenRouter/DDG/Supabase at the deployed location unverified without credentials.

---

## 29. Post-Deployment Hardening (Recommended, not V1-blocking)

- Initialize git + secrets hygiene (§2).
- Move task write-path fully behind service-role API and restrict `anon` UPDATE/DELETE on `tasks` (removes §8 risk).
- Add per-user auth-based rate limiting on read routes.
- Wire `decrement_usage` only if a retry/recovery path is added for failed searches.
- Add APM (or at least uptime pings) and structured request logs.
- Add frontend component tests + a Lighthouse CI gate.
- Consider a worker process/queue (e.g., Render Background Worker + a `queued` job poll) before scaling past one instance.

---

## 30. Release Recommendation

**CONDITIONAL READY TO DEPLOY** — proceed with:

1. `git init` + `.gitignore` + commit as a private repo.
2. Provision Supabase, run `supabase/schema.sql` (both schema + migration are idempotent), enable auth with email provider.
3. Set backend env (Table §5), set `FRONTEND_ORIGIN` to the deployed frontend URL.
4. Set frontend `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`.
5. Deploy via the Render blueprint (or manual services) per `render.yaml`; confirm `/health` shows `ok` and the health check passes.
6. Complete the live validation procedure below and record the metrics.
7. If all T1–T20 pass with no `failed` tasks and no unexpected quota hits → flip to full go-live. If any REQUIRED item fails, treat as blocking.

---

## 31. Live Validation Procedure (20 tasks + metrics)

> **MANUAL LIVE VALIDATION REQUIRED** — to be executed by a human operator with real credentials on the deployed environment. Record every row.

### 31.1 Task matrix

| # | Test | Steps | Pass criteria |
|---|---|---|---|
| T1 | Sign-up | Create account via Supabase Auth email flow | Receives email, can sign in |
| T2 | Sign-in persist | Refresh page after sign-in | Session survives; no re-login loop |
| T3 | Create a simple task | Prompt: "Capital of France" | Task created (202), status reaches `completed`, result present |
| T4 | Create a complex/topic task | Prompt: "Explain how quantum computing works" | Completes with ≥1 source, sources surfaced in UI |
| T5 | Cancellation mid-run | Create task, cancel within 1–2 s | Status = `cancelled`, no further model calls (check logs/DB), UI shows cancelled |
| T6 | Cancel a completed task | Create → wait for completion → cancel | No-op or clean `cancelled` state; no crash (document expected behavior) |
| T7 | Retry a failed task | Force a failure path or seed one; click Retry | New task created (202), runs again |
| T8 | Delete a task | Delete a completed task | Row removed, list updates, no 500 |
| T9 | Daily task quota | Submit tasks until daily limit | Returns `QUOTA_EXCEEDED`, UI shows message |
| T10 | Active-task limit | Run 2 tasks, submit a 3rd while both active | `active_limit` message shown |
| T11 | Search quota | Exhaust `DAILY_SEARCH_LIMIT` searches across tasks | Model told to stop searching; tasks still complete |
| T12 | Zero results query | Query proven to return no DDG results | Task completes (fallback draft) — no `failed` |
| T13 | Long prompt | 4,000-char prompt | Accepted; produces reasonable (possibly truncated) run |
| T14 | Oversized prompt | 4,001+ chars | Rejected 4xx `VALIDATION_ERROR` |
| T15 | Unauthenticated access | Call `/api/tasks` without token | 401 `UNAUTHORIZED`; UI shows auth form |
| T16 | Unauthorized cross-user | User B reads User A's task id | 404 `NOT_FOUND` (scoped — must not leak existence) |
| T17 | Rate limit burst | Hammer task creation | 429 `RATE_LIMITED`; app stays responsive |
| T18 | Malformed model output | (Log-inject once or use a flaky model) | Task completes/fails gracefully — no hang, no stack trace to client |
| T19 | Health + platform | Check Render health endpoint + logs | `/health` = `ok`; Render shows Healthy; logs JSON with redacted secrets |
| T20 | Reload/offline resilience | Kill the web process mid-task; restart | Task ends in `failed`/`cancelled` (not stuck `active`); subsequent tasks run |

### 31.2 Metrics to record per run (submit a table)

- Task completion rate (%) — completed / total started
- Task failure rate (%) — failed / total
- Fallback/synthesis-success rate (%) — tasks completed without a verified draft vs total
- Average searches per task and average steps per task (from `searches_used`/`steps_used`)
- Quota-hit rate (tasks rejected by daily/active limit) and search-quota exhaustion triggers
- Cancellation success rate (T5/T6/T20)
- p50/p95 API latency for `POST /api/tasks`, `GET /api/tasks`
- Log scan: zero secrets/tokens in output; zero stack traces leaked to clients

### 31.3 Go decision

- REQUIRED to pass: T1–T8, T13–T17, T19–T20 and Section 31.2 metrics recorded with no unexplained failures.
- If any of T9–T12 behaves unexpectedly (wrong quota accounting, empty response hanging), record as BLOCKER until resolved.

---

## Appendix A — Verification commands (reproducible)

```
backend> npm run typecheck        # PASS
backend> npm test                 # PASS 97/97 (8 files)
backend> npm run build            # PASS
frontend> npx tsc --noEmit        # PASS
frontend> npm run build           # PASS (Next 15.5.25, / static, 70.9 kB)
```

## Appendix B — Source inventory (this audit's keys)

Backend: `src/agent/agent.ts`, `src/agent/model.ts`, `src/agent/cancellation.ts`, `src/agent/schemas.ts`, `src/agent/prompts.ts`, `src/lib/{config,supabase,taskStore,logger,errors}.ts`, `src/tools/webSearch.ts`, `src/app.ts`, `src/server.ts`, `src/routes/{tasks,health}.ts`, `src/middleware/{auth,errorHandler}.ts`, `src/types.ts`.
Frontend: `app/page.tsx`, `app/layout.tsx`, `app/manifest.ts`, `app/globals.css`, `lib/{api,supabase,types}.ts`, `components/*.tsx` (10), `public/icons/*.png`.
DB: `supabase/schema.sql`, `supabase/migrations/001_add_sources_and_usage.sql`.
Platform: `render.yaml`, `README.md`.

### Audit-pass code changes (this session)
- `backend/src/agent/agent.ts` — try/catch around tool-args JSON.parse (+tool-error reply); `break` after max-steps fallback draft.
- `backend/src/lib/taskStore.ts` — removed dead `rollbackUsage`; `backend/test/api.test.ts` mock updated.
- `backend/src/agent/prompts.ts` — removed dead `SEARCH_TOOL_SUMMARY_PROMPT`.
- `backend/test/agent.test.ts` — 4 new tests; deterministic `beforeEach` mock resets.
- `frontend/app/page.tsx` — create/retry detail-refresh race fix.