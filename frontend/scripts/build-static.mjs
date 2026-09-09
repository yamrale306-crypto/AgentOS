import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, AGENTOS_STATIC_EXPORT: 'true' }
});
