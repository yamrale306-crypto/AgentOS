# Multi-Model AI Engine

AgentOS routes every model call through a multi-provider engine: OpenRouter, DeepSeek,
Groq, Google Gemini, Z.ai (Zhipu), and Cloudflare Workers AI. This document covers how
the engine works and how to operate it.

## Supported providers

| Provider | Env keys | Default models (verified) |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | dynamic — on-demand discovery from the OpenRouter catalog |
| DeepSeek | `DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEYS` | `deepseek-chat`, `deepseek-reasoner` |
| Groq | `GROQ_API_KEY` / `GROQ_API_KEYS` | `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, `groq/compound-mini` |
| Google Gemini | `GEMINI_API_KEY` / `GEMINI_API_KEYS` | `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.1-flash-lite` |
| Z.ai | `ZAI_API_KEY` / `ZAI_API_KEYS` | `GLM-4.5-Flash` |
| Cloudflare | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.1-8b-instruct-fp8` |

Key facts:

- Every provider is **optional individually**; at least one is required to start the
  backend outside tests.
- A `*_API_KEYS` companion variable accepts a newline- or comma-separated list of keys
  so the token manager can rotate across multiple credentials per provider.
- OpenRouter is treated as a **dynamic source**: the on-demand catalog pins models by
  their ID (`openrouter/<id>`) at first use and the alias `openrouter/free` routes to a
  currently-available free model.

## How model discovery works

- A static catalog (`backend/src/ai/catalog.ts`) defines candidate models per provider
  with capabilities (`tools`, `structuredOutput`, `vision`, `embeddings`), known
  context window, and a quality/speed/cost profile.
- The registry (`backend/src/ai/registry.ts`) merges the catalog with dynamically
  discovered models, generates model keys (`<providerId>/<modelId>`), seeds tokens for
  enabled providers, and exposes helper lookups (`byKey`, `ensureEnvModel`).
- Capabilities were **verified against the real APIs**, not invented. A model only
  advertises a capability it demonstrated (e.g. `vision` on the Gemini flash models
  was confirmed with live image input).
- The `--include-dynamic` provider probe and the System dashboard "re-discover" path
  refresh the model list against the current catalog/live providers.

## How AUTO routing works

Request flow: `chartWithFallback` / `structuredWithFallback`
(`backend/src/agent/model.ts`) → router (`backend/src/ai/router.ts`).

1. The stage is classified into a mode: `research`, `plan`, `verify`, `quality`,
   `structured`, or `fast`.
2. Every registered model is scored from:
   - **capability match** — does it support the mode's needs (tools, structured
     output, …)?
   - **health** — `healthy`/`degraded`/`offline` state from the health tracker;
   - **latency EMA + failure EMA** — recent averaged latency and failures;
   - **profile fit** — `quality` / `balanced` / `fast` / `lowcost`;
   - **priority bonus** — configured model priority (0–100) adds a small bonus so a
     preferred but slightly slower model can still win;
   - **mock penalty** — mock/candidate models rank last.
3. The top valid candidate is selected; `AI_DEFAULT_MODE` sets the default profile for
   tasks that do not specify one; `AI_ROUTING_ENABLED=true` (default) turns routing on.

## Token management

`backend/src/ai/tokenManager.ts` keeps per-provider token state.

- Keys are **never returned to the client** — the dashboard shows only a masked
  suffix (e.g. `…a1B2`).
- Each token tracks consecutive failures, total failures/successes, last-used and
  last-failure timestamps, and the failure category.
- On repeated hardware failure a token is put into a **cooldown**; providers with no
  healthy tokens are marked offline and skipped entirely by the router.
- Rotation picks the healthiest token for the provider on each call.
- `MAX_MODEL_ATTEMPTS` (default 6) bounds how many models are tried before a task call
  gives up.

## Fallback behavior

- Every call goes through a fallback chain: selected model from routing → the next
  acceptable model from the router → the env overlay model → a guaranteed last-resort
  default (local mock if no providers remain).
- Failures only fall back when they are **retryable**; permanent failures
  (`MODEL_UNAVAILABLE`, auth errors, invalid input) do not waste quota on a retry.
- The result reports `fallback: true` and the provider/model that actually produced it,
  so the UI and task metadata show the real winner.
- **Legacy mode** (`AI_ROUTING_ENABLED=false`): only `OPENROUTER_MODEL_PRIMARY` →
  `OPENROUTER_MODEL_FALLBACK` are used (defaulting to `openrouter/free`), preserving
  the original single-provider behaviour.

## Testing providers

- `npm run verify:providers` in `backend/` calls each configured provider's real API
  and reports `PASS` / `DEGRADED` / `FAIL` with the latency and model used. Pass
  `--include-dynamic` to also exercise dynamically discovered OpenRouter models.
- The System dashboard shows a **Test** button per provider (section in dashboards);
  it returns the latency, the selected model, and a safe failure reason.
- `npm run import:keys` imports credentials from a local key file into the backend
  `.env` without printing the secrets.

## Adding a new provider

1. Add the env vars to `backend/src/lib/config.ts` (zod schema + `PROVIDER_KEY_VARS`).
2. Implement a provider client in `backend/src/ai/providers.ts` (request builder +
  error normalizer), surfacing the provider's own IDs for categories like
  `RATE_LIMIT`, `AUTH_ERROR`, `MODEL_UNAVAILABLE`.
3. Register the provider in the factory/registry so the engine can instantiate it.
4. Add catalog entries with **verified** capabilities; run the provider probe and mark
  down exactly what the real API supports.
5. Mirror the provider in `backend/scripts/credentials.ts` (key import + format
  validation) and `backend/scripts/verify-providers.ts`.
6. Add tests to `backend/test/ai.test.ts` and re-run `npm run typecheck && npm test`.

## Adding a new model

Add an entry to `backend/src/ai/catalog.ts`:

```ts
{
  id: 'gemini-3.7-flash',
  providerId: 'gemini',
  contextWindow: 1_048_576,
  profile: { quality: 75, balanced: 85, fast: 85, lowcost: 70 },
  capabilities: { tools: true, structuredOutput: true, vision: true },
  priority: 0,
}
```

Then re-run the provider probe (`npm run verify:providers`) to confirm the ID and
capabilities against the real API before relying on it. Models that 404, are
quota-blocked, or rate-limit are removed from the catalog rather than kept as dead
weight.

## Secret management

- The only supported inputs are environment variables; `.env` is gitignored.
- `Dev Keys.txt` must stay **outside** the repository; the importer never modifies it
  and never logs raw keys.
- The API, logs, and dashboard redact/mask keys. The response surface never includes
  real credentials.
- If a key leaks, rotate it at the provider and remove it from anything committed;
  the token manager will pick up the new value on restart.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Provider shows `auth_error` | Token is invalid or expired — check the masked token and re-import. |
| Model marked `model_unavailable` / `DEGRADED` | 402/410/404 from the provider: model removed, quota exhausted, or (DeepSeek) no balance. Top up or remove the model. |
| `RATE_LIMIT` / `offline` | Provider throttling; the token enters cooldown and is skipped. Wait or add more keys. |
| Fallback always fires | Primary model unhealthy — check health tracker; or capabilities don't match the stage requirements. |
| Backend won't start | At least one provider key is required (tests exempt). Check the env error message. |
| OpenRouter free alias fails | Free-model availability changes; re-run the discovery probe and update the alias pin. |