import { vi } from 'vitest';

const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-a-real-secret',
  OPENROUTER_API_KEY: 'sk-test-key-not-a-real-secret',
  LOG_LEVEL: 'error'
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

vi.stubEnv('NODE_ENV', 'test');