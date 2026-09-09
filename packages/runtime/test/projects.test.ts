import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/projects/scanner.js';

const MONOREPO = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  '.git/HEAD',
  'apps/api/src/app.ts',
  'apps/worker/src/agent/agent.ts',
  'packages/ai/src/index.ts',
  'packages/runtime/src/policy.ts',
  'frontend/package.json',
  'frontend/next.config.ts',
  'frontend/app/page.tsx',
  '.env.example',
  '.env.local',
  'README.md',
  'LICENSE',
  'node_modules/.cache/x'
];

const PYTHON_REPO = ['pyproject.toml', 'requirements.txt', 'src/main.py', 'tests/test_main.py', 'CONFTEST.py'];

describe('analyzeProject', () => {
  it('detects languages, framework, package manager and git', () => {
    const info = analyzeProject(MONOREPO, () => '2026-01-01T00:00:00.000Z');
    expect(info.languages).toEqual(['TypeScript']);
    expect(info.framework).toBe('Next.js');
    expect(info.packageManager).toBe('pnpm');
    expect(info.git.hasGit).toBe(true);
    expect(info.git.appType).toBe('app');
    expect(info.importantFiles).toEqual(expect.arrayContaining(['README.md', 'LICENSE']));
    expect(info.detectedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('excludes env.local but records env requirements from .env.example', () => {
    const info = analyzeProject(MONOREPO);
    expect(info.envRequirements).toEqual(['env:example']);
  });

  it('handles a python repo', () => {
    const info = analyzeProject(PYTHON_REPO);
    expect(info.languages).toContain('Python');
    expect(info.packageManager).toBe('pip');
    expect(info.framework).toBeNull();
  });

  it('handles an empty listing without crashing', () => {
    const info = analyzeProject([]);
    expect(info.languages).toEqual([]);
    expect(info.importantFiles).toEqual([]);
    expect(info.git.hasGit).toBe(false);
  });
});