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

- A static catalog (`packages/ai/src/catalog.ts`) defines candidate models per provider
  with capabilities (`tools`, `structuredOutput`, `vision`, `embeddings`), known
  context window, and a quality/speed/cost profile.
- The registry (`packages/ai/src/registry.ts`) merges the catalog with dynamically
  discovered models, generates model keys (`<providerId>/<modelId>`), seeds tokens for
  enabled providers, and exposes helper lookups (`get`, `byProvider`, `ensureEnvModel`).
- Capabilities were **verified against the real APIs**, not invented. A model only
  advertises a capability it demonstrated (e.g. `vision` on the Gemini flash models
  was confirmed with live image input).
- The `--include-dynamic` provider probe and the System dashboard "re-discover" path
  refresh the model list against the current catalog/live providers.

## How AUTO routing works

Request flow: `chatWithFallback` / `structuredWithFallback`
(`packages/ai/src/complete.ts`) → router (`packages/ai/src/router.ts`).

1. The stage is classified into a profile (`planning`, `research`, `analyzing`,
   `verifying`, `synthesis`, or `general`).
2. Every registered model is scored from:
   - **capability match** — does it support the stage's needs (tools, structured
     output, …)?
   - **health** — `healthy`/`degraded`/`offline` state from the health tracker;
   - **latency EMA** — recent averaged latency;
   - **profile fit** — `quality` / `balanced` / `fast` / `lowcost`;
   - **priority bonus** — configured model priority (0–100) adds a small bonus so a
     preferred but slightly slower model can still win.
3. The top candidates are selected; `AI_DEFAULT_MODE` sets the default profile for
   tasks that do not specify one; `AI_ROUTING_ENABLED=true` (default) turns routing on.

## Token management

`packages/ai/src/token-manager.ts` keeps per-provider token state.

- Keys are **never returned to the client** — the dashboard shows only a masked
  form (e.g. `abc***Wxyz`).
- Each token tracks consecutive failures, total failures/successes, last-used and
  last-failure timestamps, and the failure category.
- On repeated failure a token is put into an exponential **cooldown**; providers with no
  healthy tokens are marked offline and skipped entirely by the router.
- Rotation picks the healthiest, least-recently-used token for the provider on each call.
- `MAX_MODEL_ATTEMPTS` (default 6) bounds how many models are tried before a task call
  gives up.

## Fallback behavior

- Every call goes through `chatWithFallback`, which routes an ordered candidate list and
  iterates candidate × token until one succeeds or the attempt budget is exhausted.
- Failures only advance to the next candidate when they are **retryable**; permanent
  failures (`AUTH_ERROR`, invalid input) skip the offending token/model directly.
- The result reports `fallback: true` and the provider/model that actually produced it,
  so the UI and task metadata show the real winner.
- **Legacy mode** (`AI_ROUTING_ENABLED=false`): only `OPENROUTER_MODEL_PRIMARY` →
  `OPENROUTER_MODEL_FALLBACK` are used (defaulting to `openrouter/free`), preserving
  the original single-provider behaviour.

## Testing providers

- `pnpm verify:providers` at the repo root calls each configured provider's real API
  and reports `PASS` / `DEGRADED` / `FAIL` with the latency and model used. Pass
  `--include-dynamic` to also exercise dynamically discovered OpenRouter models.
- The System dashboard shows a **Test** button per provider (section in dashboards);
  it returns the latency, the selected model, and a safe failure reason.
- `pnpm import:keys` imports credentials from a local key file into the backend
  `.env` without printing the secrets. Pass `--file=<path>` to point at the file.

## Adding a new provider

1. Add the env vars to `packages/config/src/env.ts` (zod schema + `PROVIDER_KEY_VARS`).
2. Add the provider to `DEFAULT_PROVIDERS` in `packages/ai/src/catalog.ts` (base URL,
   kind) and map its env keys in `packages/ai/src/providers.ts`
   (`ProviderEnvInput` / `tokenByProvider`).
3. Add catalog entries with **verified** capabilities; run the provider probe and mark
   down exactly what the real API supports.
4. Mirror the provider in `scripts/credentials.ts` (key import + format validation) and
   `scripts/verify-providers.ts`.
5. Add tests to `packages/ai/test/` and re-run `pnpm typecheck && pnpm lint && pnpm test`.

## Adding a new model

Add an entry to `packages/ai/src/catalog.ts`:

```ts
{
  providerId: 'gemini',
  modelId: 'gemini-3.7-flash',
  contextWindow: 1_048_576,
  qualityScore: 85,
  speedScore: 80,
  costPriority: 4,
  capabilities: { tools: true, structuredOutput: true, vision: true },
  priority: 0,
}
```

Then re-run the provider probe (`pnpm verify:providers`) to confirm the ID and
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