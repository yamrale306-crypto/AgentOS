import 'dotenv/config';
import { z } from 'zod';
import { AI_MODES } from '@agentos/schemas';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(10000),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/, 'APP_VERSION must use semantic versioning.').default('1.0.0'),
  DESKTOP_LATEST_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  DESKTOP_DOWNLOAD_URL: z.string().url().optional(),
  ANDROID_LATEST_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  ANDROID_DOWNLOAD_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),

  // --- AI providers (at least one is required; all are optional individually) ---
  OPENROUTER_API_KEY: z.string().optional(),
  // Env-configured OpenRouter model pair. Used ONLY for legacy single-provider
  // mode (AI_ROUTING_ENABLED=false). In AUTO routing mode the router selects
  // from the verified catalog instead, so these are not seeded by default.
  OPENROUTER_MODEL_PRIMARY: z.string().min(1).optional(),
  OPENROUTER_MODEL_FALLBACK: z.string().min(1).optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEYS: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_API_KEYS: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_API_KEYS: z.string().optional(),
  ZAI_API_KEY: z.string().optional(),
  ZAI_API_KEYS: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),

  // --- Routing / model selection ---
  AI_DEFAULT_MODE: z.enum(AI_MODES).default('auto'),
  AI_DEFAULT_MODEL: z.string().optional(),
  AI_ROUTING_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  MAX_MODEL_ATTEMPTS: z.coerce.number().int().positive().max(10).default(6),

  MAX_STEPS: z.coerce.number().int().positive().max(30).default(8),
  MAX_SEARCHES: z.coerce.number().int().positive().max(20).default(5),
  DAILY_TASK_LIMIT: z.coerce.number().int().positive().max(1000).default(10),
  DAILY_SEARCH_LIMIT: z.coerce.number().int().positive().max(10000).default(50),
  MAX_ACTIVE_TASKS_PER_USER: z.coerce.number().int().positive().max(10).default(2),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().max(600000).default(90000),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  ADMIN_USER_IDS: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Runtime environment after `parseConfig` validation.
 *
 * The schema marks `SUPABASE_SERVICE_ROLE_KEY` as optional so that `parseConfig`
 * can give a precise error naming the variable, but the function guarantees the
 * key is present (or throws). This type reflects that invariant so consumers do
 * not have to narrow `string | undefined` at every use site.
 */
export type ValidatedEnv = AppEnv & { SUPABASE_SERVICE_ROLE_KEY: string };

const PROVIDER_KEY_VARS = [
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_API_KEYS',
  'GROQ_API_KEY',
  'GROQ_API_KEYS',
  'GEMINI_API_KEY',
  'GEMINI_API_KEYS',
  'ZAI_API_KEY',
  'ZAI_API_KEYS',
  'CLOUDFLARE_API_TOKEN'
] as const;

export function parseConfig(input: Record<string, string | undefined>): ValidatedEnv {
  // The Supabase project renamed role keys: the legacy SERVICE_ROLE key was
  // replaced by the SECRET key (sb_secret_...). Accept both so existing
  // deployments do not break. The new name wins when both are present.
  const normalized: Record<string, string | undefined> = {
    ...input,
    SUPABASE_SERVICE_ROLE_KEY: input.SUPABASE_SECRET_KEY ?? input.SUPABASE_SERVICE_ROLE_KEY
  };
  const result = EnvSchema.safeParse(normalized);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new Error(`Invalid environment configuration.\n${lines.join('\n')}`);
  }
  if (!result.data.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Invalid environment configuration.\n  - SUPABASE_SERVICE_ROLE_KEY: Invalid input: expected string, received undefined (set either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY in your .env).'
    );
  }
  // SUPABASE_SERVICE_ROLE_KEY was checked above; narrow it so the invariant is
  // visible to TypeScript consumers.
  const envValue: ValidatedEnv = result.data as ValidatedEnv;
  const nodeEnv = envValue.NODE_ENV;
  const hasProvider = PROVIDER_KEY_VARS.some((name) => {
    const value = normalized[name];
    return typeof value === 'string' && value.trim().length > 0;
  });
  if (!hasProvider && nodeEnv !== 'test') {
    throw new Error(
      'Invalid environment configuration.\n  - At least one AI provider API key is required (e.g. OPENROUTER_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, ZAI_API_KEY or CLOUDFLARE_API_TOKEN).'
    );
  }
  return envValue;
}

export function parseOrigins(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseCsv(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export const env: ValidatedEnv = parseConfig(process.env as Record<string, string | undefined>);
export default env;