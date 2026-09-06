import 'dotenv/config';
import { z } from 'zod';

export const AI_MODES = ['auto', 'quality', 'balanced', 'fast', 'lowcost'] as const;
export type AiMode = (typeof AI_MODES)[number];

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(10000),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required. Get it from Supabase Dashboard > Project Settings > API.'),

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
  OPENCODE_API_KEY: z.string().optional(),

  // --- Routing / model selection ---
  AI_DEFAULT_MODE: z.enum(AI_MODES).default('auto'),
  AI_DEFAULT_MODEL: z.string().optional(),
  AI_ROUTING_ENABLED: z.coerce.boolean().default(true),
  MAX_MODEL_ATTEMPTS: z.coerce.number().int().positive().max(10).default(6),

  MAX_STEPS: z.coerce.number().int().positive().max(30).default(8),
  MAX_SEARCHES: z.coerce.number().int().positive().max(20).default(5),
  DAILY_TASK_LIMIT: z.coerce.number().int().positive().max(1000).default(10),
  DAILY_SEARCH_LIMIT: z.coerce.number().int().positive().max(10000).default(50),
  MAX_ACTIVE_TASKS_PER_USER: z.coerce.number().int().positive().max(10).default(2),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().max(600000).default(90000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppEnv = z.infer<typeof EnvSchema>;

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

export function parseConfig(input: Record<string, string | undefined>): AppEnv {
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new Error(`Invalid environment configuration.\n${lines.join('\n')}`);
  }
  const envValue = result.data;
  const nodeEnv = envValue.NODE_ENV;
  const hasProvider = PROVIDER_KEY_VARS.some((name) => {
    const value = input[name];
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

export const env: AppEnv = parseConfig(process.env as Record<string, string | undefined>);
export default env;