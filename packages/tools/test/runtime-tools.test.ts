import { describe, expect, it } from 'vitest';
import { createDefaultProjectToolRegistry, resolveScopedPath, classifyShellCommand, isProtectedPath } from '../src/index.js';

describe('project-scoped runtime tools', () => {
  it('registers filesystem and shell tools with safe ids', () => {
    const registry = createDefaultProjectToolRegistry('/workspace/project');
    expect(registry.has('filesystem.read')).toBe(true);
    expect(registry.has('filesystem.write')).toBe(true);
    expect(registry.has('shell.run')).toBe(true);
    expect(registry.has('git.status')).toBe(true);
    expect(registry.has('http.request')).toBe(true);
  });

  it('rejects paths outside the project root', () => {
    expect(() => resolveScopedPath('/workspace/project', '../outside.txt')).toThrow(/outside the project/i);
    expect(() => resolveScopedPath('/workspace/project', '/etc/passwd')).toThrow(/outside the project/i);
  });

  it('blocks protected locations such as .git or .env files', () => {
    expect(isProtectedPath('/workspace/project/.git/config')).toBe(true);
    expect(isProtectedPath('/workspace/project/.env')).toBe(true);
    expect(isProtectedPath('/workspace/project/src/index.ts')).toBe(false);
  });

  it('classifies destructive commands as high risk', () => {
    expect(classifyShellCommand('rm -rf .')).toMatchObject({ riskLevel: 'high' });
    expect(classifyShellCommand('pwd && ls')).toMatchObject({ riskLevel: 'low' });
  });
});
