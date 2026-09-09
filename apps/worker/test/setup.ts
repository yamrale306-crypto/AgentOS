import { vi } from 'vitest';

const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '10000',
  FRONTEND_ORIGIN: 'http://localhost:3000,http://localhost:3001',
  APP_URL: 'http://localhost:3000',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-a-real-secret',
  OPENROUTER_API_KEY: 'sk-test-key-not-a-real-secret',
  OPENROUTER_MODEL_PRIMARY: 'test/primary-model',
  OPENROUTER_MODEL_FALLBACK: 'test/fallback-model',
  MAX_STEPS: '8',
  MAX_SEARCHES: '5',
  DAILY_TASK_LIMIT: '10',
  DAILY_SEARCH_LIMIT: '50',
  MAX_ACTIVE_TASKS_PER_USER: '2',
  MODEL_TIMEOUT_MS: '90000',
  ADMIN_EMAILS: 'a@b.c',
  LOG_LEVEL: 'error'
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

vi.stubEnv('NODE_ENV', 'test');