import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(10000),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required. Get it from Supabase Dashboard > Project Settings > API.'),
  OPENROUTER_API_KEY: z.string().min(1, 'OPENROUTER_API_KEY is required. Get it from https://openrouter.ai/keys.'),
  OPENROUTER_MODEL_PRIMARY: z.string().min(1, 'OPENROUTER_MODEL_PRIMARY is required. Example: openrouter/free'),
  OPENROUTER_MODEL_FALLBACK: z.string().min(1, 'OPENROUTER_MODEL_FALLBACK is required. Example: google/gemma-4-26b-a4b-it:free'),
  MAX_STEPS: z.coerce.number().int().positive().max(30).default(8),
  MAX_SEARCHES: z.coerce.number().int().positive().max(20).default(5),
  DAILY_TASK_LIMIT: z.coerce.number().int().positive().max(1000).default(10),
  DAILY_SEARCH_LIMIT: z.coerce.number().int().positive().max(10000).default(50),
  MAX_ACTIVE_TASKS_PER_USER: z.coerce.number().int().positive().max(10).default(2),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().max(600000).default(90000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppEnv = z.infer<typeof EnvSchema>;

export function parseConfig(input: Record<string, string | undefined>): AppEnv {
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new Error(`Invalid environment configuration.\n${lines.join('\n')}`);
  }
  return result.data;
}

export function parseOrigins(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export const env: AppEnv = parseConfig(process.env as Record<string, string | undefined>);
export default env;