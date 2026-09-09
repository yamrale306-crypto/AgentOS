import * as cheerio from 'cheerio';
import { spawn } from 'node:child_process';
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { createToolRegistry, type AgentTool, type ToolRegistry } from '@agentos/runtime';
import type { SearchResult, ToolContext, ToolResult } from '@agentos/schemas';

export type { SearchResult };

export interface SearchOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number, options?: SearchOptions): Promise<SearchResult[]>;
}

const PROTECTED_PATH_MARKERS = ['.git', '.env', '.ssh', '.npmrc', '.pypirc', '.aws', '.azure', '.config', 'credentials', 'secrets', 'token', 'key'];

export function isProtectedPath(candidate: string): boolean {
  const normalized = normalize(candidate).replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/');
  if (segments.includes('.git') || segments.includes('.ssh') || segments.includes('.aws') || segments.includes('.azure')) return true;
  if (segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))) return true;
  if (segments.some((segment) => segment === 'credentials' || segment === 'secrets' || segment === 'private_key' || segment === 'id_rsa' || segment === 'id_ed25519')) return true;
  const name = basename(normalized);
  return ['.npmrc', '.pypirc', '.gitignore', '.env', 'credentials', 'secrets'].includes(name) || /\.(pem|key|p12|pfx|crt|cer)$/i.test(name);
}

export function resolveScopedPath(projectRoot: string, targetPath: string): string {
  const root = normalize(resolve(projectRoot)).replace(/\\/g, '/');
  const absolute = isAbsolute(targetPath) ? normalize(resolve(targetPath)).replace(/\\/g, '/') : normalize(resolve(root, targetPath)).replace(/\\/g, '/');
  const relativePath = relative(root, absolute);
  const isInside = relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('../') && !relativePath.startsWith('..\\'));
  if (!isInside || absolute === root) {
    const needed = relativePath || '.';
    throw new Error(`Path is outside the project root: ${targetPath} (${needed})`);
  }
  if (isProtectedPath(absolute)) {
    throw new Error(`Protected path rejected: ${targetPath}`);
  }
  return absolute;
}

function toRelativePath(projectRoot: string, targetPath: string): string {
  const absolute = resolve(projectRoot, targetPath);
  return relative(projectRoot, absolute).replace(/\\/g, '/');
}

async function walkDirectory(dir: string, root: string, maxResults = 200): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist' || entry.name === 'build') continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkDirectory(fullPath, root, maxResults - results.length);
      results.push(...nested);
    } else {
      const relativePath = relative(root, fullPath).replace(/\\/g, '/');
      if (!relativePath || relativePath.startsWith('..')) continue;
      if (isProtectedPath(fullPath)) continue;
      results.push(relativePath);
    }
  }
  return results;
}

export function classifyShellCommand(command: string): { riskLevel: 'low' | 'medium' | 'high' | 'critical'; reason: string; blocked: boolean } {
  const trimmed = command.trim();
  if (!trimmed) return { riskLevel: 'low', reason: 'Empty command', blocked: false };
  const lower = trimmed.toLowerCase();
  if (/\b(sudo|su\s|chmod\s+777|systemctl|service\s+|shutdown|reboot|mkfs|mount|docker\s+rm|kubectl\s+delete|terraform\s+destroy|aws\s+.*delete|gcloud\s+.*delete)/i.test(trimmed)) {
    return { riskLevel: 'critical', reason: 'System-level or destructive infrastructure command', blocked: true };
  }
  if ((/\b(rm\s+-rf|rm\s+-r|del\s+)/i.test(trimmed)) || (/\b(git\s+reset\s+--hard|git\s+clean\s+-fdx|git\s+clean\s+-fd|git\s+push\s+--force|git\s+checkout\s+--\s+\.)/i.test(trimmed))) {
    return { riskLevel: 'high', reason: 'Destructive command detected', blocked: false };
  }
  if (/\b(pnpm\s+(install|build|test|lint)|npm\s+(install|run|test)|yarn\s+(install|build)|cargo\s+build|go\s+test|pytest|vitest|tsc\b|eslint\b|next\s+build)/i.test(trimmed)) {
    return { riskLevel: 'medium', reason: 'Project build or dependency command', blocked: false };
  }
  if (/\b(git\s+(status|diff|log|branch|checkout|add|commit)|pwd|ls\b|cat\b|find\b|grep\b|sed\b|head\b|tail\b|echo\b)/i.test(trimmed)) {
    return { riskLevel: 'low', reason: 'Read-only command', blocked: false };
  }
  return { riskLevel: 'medium', reason: 'Unclassified command', blocked: false };
}

export function createDefaultProjectToolRegistry(projectRoot: string): ToolRegistry {
  const registry = createToolRegistry();
  const root = normalize(resolve(projectRoot));

  const filesystemReadTool: AgentTool<{ path: string; encoding?: 'utf8' | 'binary'; maxBytes?: number }, { path: string; content: string | Uint8Array }> = {
    id: 'filesystem.read',
    version: '1.0.0',
    description: 'Read a file from the project-scoped workspace.',
    category: 'filesystem',
    inputSchema: z.object({
      path: z.string().min(1),
      encoding: z.enum(['utf8', 'binary']).optional().default('utf8'),
      maxBytes: z.number().int().positive().max(5_000_000).optional()
    }),
    outputSchema: z.object({
      path: z.string(),
      content: z.union([z.string(), z.instanceof(Uint8Array)])
    }),
    permissions: [{ action: 'read', resource: 'filesystem' }],
    riskLevel: 'low',
    async execute(input, context) {
      try {
        const resolved = resolveScopedPath(root, input.path);
        const data = await readFile(resolved);
        const limit = input.maxBytes ?? context.limits?.maxBytes ?? 2_000_000;
        const buffer = data.length > limit ? data.slice(0, limit) : data;
        const content = input.encoding === 'binary' ? buffer : new TextDecoder('utf-8').decode(buffer);
        return { ok: true, data: { path: relative(root, resolved).replace(/\\/g, '/'), content } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Filesystem read failed', retryable: false };
      }
    }
  };

  const filesystemWriteTool: AgentTool<{ path: string; content: string; append?: boolean }, { path: string; bytesWritten: number }> = {
    id: 'filesystem.write',
    version: '1.0.0',
    description: 'Write a file within the project-scoped workspace.',
    category: 'filesystem',
    inputSchema: z.object({
      path: z.string().min(1),
      content: z.string(),
      append: z.boolean().optional().default(false)
    }),
    outputSchema: z.object({ path: z.string(), bytesWritten: z.number() }),
    permissions: [{ action: 'write', resource: 'filesystem' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const resolved = resolveScopedPath(root, input.path);
        const parent = dirname(resolved);
        await mkdir(parent, { recursive: true });
        const existing = await stat(resolved).catch(() => null);
        const text = input.append && existing ? `${(await readFile(resolved, 'utf8'))}${input.content}` : input.content;
        await writeFile(resolved, text, 'utf8');
        return { ok: true, data: { path: relative(root, resolved).replace(/\\/g, '/'), bytesWritten: Buffer.byteLength(text, 'utf8') } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Filesystem write failed', retryable: false };
      }
    }
  };

  const filesystemListTool: AgentTool<{ path?: string; maxResults?: number }, { path: string; entries: Array<{ name: string; type: 'file' | 'directory' }> }> = {
    id: 'filesystem.list',
    version: '1.0.0',
    description: 'List files and directories under a project-scoped path.',
    category: 'filesystem',
    inputSchema: z.object({ path: z.string().optional().default('.'), maxResults: z.number().int().positive().max(200).optional() }),
    outputSchema: z.object({ path: z.string(), entries: z.array(z.object({ name: z.string(), type: z.enum(['file', 'directory']) })) }),
    permissions: [{ action: 'read', resource: 'filesystem' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const target = resolveScopedPath(root, input.path ?? '.');
        const entries = await readdir(target, { withFileTypes: true });
        const limited: Array<{ name: string; type: 'file' | 'directory' }> = entries.slice(0, input.maxResults ?? 200).map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }));
        return { ok: true, data: { path: relative(root, target).replace(/\\/g, '/'), entries: limited } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Filesystem list failed', retryable: false };
      }
    }
  };

  const filesystemSearchTool: AgentTool<{ path?: string; pattern?: string; maxResults?: number }, { path: string; matches: string[] }> = {
    id: 'filesystem.search',
    version: '1.0.0',
    description: 'Search for file names or content under the project root.',
    category: 'filesystem',
    inputSchema: z.object({ path: z.string().optional().default('.'), pattern: z.string().optional(), maxResults: z.number().int().positive().max(200).optional() }),
    outputSchema: z.object({ path: z.string(), matches: z.array(z.string()) }),
    permissions: [{ action: 'read', resource: 'filesystem' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const target = resolveScopedPath(root, input.path ?? '.');
        const matches = await walkDirectory(target, root, input.maxResults ?? 200);
        const filtered = input.pattern ? matches.filter((item) => item.toLowerCase().includes(input.pattern!.toLowerCase())) : matches;
        return { ok: true, data: { path: relative(root, target).replace(/\\/g, '/'), matches: filtered.slice(0, input.maxResults ?? 200) } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Filesystem search failed', retryable: false };
      }
    }
  };

  const filesystemCreateDirTool: AgentTool<{ path: string }, { path: string; created: boolean }> = {
    id: 'filesystem.create_directory',
    version: '1.0.0',
    description: 'Create a directory inside the project scope.',
    category: 'filesystem',
    inputSchema: z.object({ path: z.string().min(1) }),
    outputSchema: z.object({ path: z.string(), created: z.boolean() }),
    permissions: [{ action: 'write', resource: 'filesystem' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const resolved = resolveScopedPath(root, input.path);
        await mkdir(resolved, { recursive: true });
        return { ok: true, data: { path: relative(root, resolved).replace(/\\/g, '/'), created: true } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Directory creation failed', retryable: false };
      }
    }
  };

  const filesystemMoveTool: AgentTool<{ from: string; to: string }, { from: string; to: string }> = {
    id: 'filesystem.move',
    version: '1.0.0',
    description: 'Move or rename a project-scoped file or directory.',
    category: 'filesystem',
    inputSchema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    outputSchema: z.object({ from: z.string(), to: z.string() }),
    permissions: [{ action: 'write', resource: 'filesystem' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const source = resolveScopedPath(root, input.from);
        const destination = resolveScopedPath(root, input.to);
        await mkdir(dirname(destination), { recursive: true });
        await rename(source, destination);
        return { ok: true, data: { from: relative(root, source).replace(/\\/g, '/'), to: relative(root, destination).replace(/\\/g, '/') } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Move failed', retryable: false };
      }
    }
  };

  const filesystemCopyTool: AgentTool<{ from: string; to: string }, { from: string; to: string }> = {
    id: 'filesystem.copy',
    version: '1.0.0',
    description: 'Copy a project-scoped file or directory.',
    category: 'filesystem',
    inputSchema: z.object({ from: z.string().min(1), to: z.string().min(1) }),
    outputSchema: z.object({ from: z.string(), to: z.string() }),
    permissions: [{ action: 'write', resource: 'filesystem' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const source = resolveScopedPath(root, input.from);
        const destination = resolveScopedPath(root, input.to);
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { recursive: true, force: true });
        return { ok: true, data: { from: relative(root, source).replace(/\\/g, '/'), to: relative(root, destination).replace(/\\/g, '/') } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Copy failed', retryable: false };
      }
    }
  };

  const filesystemDeleteTool: AgentTool<{ path: string; recursive?: boolean }, { path: string; deleted: boolean }> = {
    id: 'filesystem.delete',
    version: '1.0.0',
    description: 'Delete a project-scoped file or directory after policy approval.',
    category: 'filesystem',
    inputSchema: z.object({ path: z.string().min(1), recursive: z.boolean().optional().default(false) }),
    outputSchema: z.object({ path: z.string(), deleted: z.boolean() }),
    permissions: [{ action: 'delete', resource: 'filesystem' }],
    riskLevel: 'high',
    async execute(input) {
      try {
        const resolved = resolveScopedPath(root, input.path);
        await rm(resolved, { recursive: input.recursive ?? false, force: true });
        return { ok: true, data: { path: relative(root, resolved).replace(/\\/g, '/'), deleted: true } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Delete failed', retryable: false };
      }
    }
  };

  const shellRunTool: AgentTool<{ command: string; cwd?: string; timeoutMs?: number }, { command: string; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; riskLevel: 'low' | 'medium' | 'high' | 'critical' }> = {
    id: 'shell.run',
    version: '1.0.0',
    description: 'Run a scoped, policy-audited shell command in the project workspace.',
    category: 'terminal',
    inputSchema: z.object({
      command: z.string().min(1).max(2000),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().positive().max(120000).optional().default(30000)
    }),
    outputSchema: z.object({ command: z.string(), exitCode: z.number().nullable(), stdout: z.string(), stderr: z.string(), timedOut: z.boolean(), riskLevel: z.enum(['low', 'medium', 'high', 'critical']) }),
    permissions: [{ action: 'execute', resource: 'terminal' }],
    riskLevel: 'medium',
    async execute(input) {
      const classification = classifyShellCommand(input.command);
      if (classification.blocked || classification.riskLevel === 'critical') {
        return { ok: false, error: `Command blocked by policy: ${classification.reason}`, retryable: false };
      }
      const workingDirectory = input.cwd ? resolveScopedPath(root, input.cwd) : root;
      const startedAt = Date.now();
      const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', process.platform === 'win32' ? ['-Command', input.command] : ['-lc', input.command], {
        cwd: workingDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: process.env.PATH ?? '' }
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, input.timeoutMs ?? 30000);
      child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
      const exitCode = await new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
      }).finally(() => clearTimeout(timer));
      const duration = Date.now() - startedAt;
      return {
        ok: true,
        data: {
          command: input.command,
          exitCode,
          stdout: stdout.slice(0, 12000),
          stderr: stderr.slice(0, 12000),
          timedOut,
          riskLevel: classification.riskLevel
        }
      };
    }
  };

  const gitStatusTool: AgentTool<{ path?: string }, { path: string; output: string }> = {
    id: 'git.status',
    version: '1.0.0',
    description: 'Inspect the current git status inside the project scope.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.') }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'read', resource: 'git' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand('git status --short --branch', workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git status failed', retryable: false };
      }
    }
  };

  const gitDiffTool: AgentTool<{ path?: string }, { path: string; output: string }> = {
    id: 'git.diff',
    version: '1.0.0',
    description: 'Show the current git diff for the project.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.') }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'read', resource: 'git' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand('git diff --no-ext-diff --stat && git diff --no-ext-diff -- .', workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git diff failed', retryable: false };
      }
    }
  };

  const gitLogTool: AgentTool<{ path?: string; maxEntries?: number }, { path: string; output: string }> = {
    id: 'git.log',
    version: '1.0.0',
    description: 'Read the recent git history for the project.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.'), maxEntries: z.number().int().positive().max(20).optional().default(10) }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'read', resource: 'git' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand(`git log -n ${input.maxEntries ?? 10} --oneline --decorate`, workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git log failed', retryable: false };
      }
    }
  };

  const gitBranchTool: AgentTool<{ path?: string }, { path: string; output: string }> = {
    id: 'git.branch',
    version: '1.0.0',
    description: 'List local git branches for the project.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.') }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'read', resource: 'git' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand('git branch --all', workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git branch failed', retryable: false };
      }
    }
  };

  const gitCheckoutTool: AgentTool<{ path?: string; branch: string }, { path: string; output: string }> = {
    id: 'git.checkout',
    version: '1.0.0',
    description: 'Check out a git branch within the project scope.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.'), branch: z.string().min(1) }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'write', resource: 'git' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        if (input.branch.includes('--force')) return { ok: false, error: 'Force checkout is denied by default.', retryable: false };
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand(`git checkout ${quoteShellArgument(input.branch)}`, workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git checkout failed', retryable: false };
      }
    }
  };

  const gitAddTool: AgentTool<{ path?: string; files?: string[] }, { path: string; output: string }> = {
    id: 'git.add',
    version: '1.0.0',
    description: 'Stage changes in the project repository.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.'), files: z.array(z.string()).optional() }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'write', resource: 'git' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const specs = (input.files ?? []).map((file) => quoteShellArgument(file)).join(' ');
        const result = await runCommand(specs ? `git add ${specs}` : 'git add -A', workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git add failed', retryable: false };
      }
    }
  };

  const gitCommitTool: AgentTool<{ path?: string; message: string }, { path: string; output: string }> = {
    id: 'git.commit',
    version: '1.0.0',
    description: 'Create a git commit for staged project changes.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.'), message: z.string().min(1).max(500) }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'write', resource: 'git' }],
    riskLevel: 'high',
    async execute(input) {
      try {
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const result = await runCommand(`git commit -m ${quoteShellArgument(input.message)}`, workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git commit failed', retryable: false };
      }
    }
  };

  const gitPushTool: AgentTool<{ path?: string; remote?: string; branch?: string; force?: boolean }, { path: string; output: string }> = {
    id: 'git.push',
    version: '1.0.0',
    description: 'Push committed project changes to a remote repository.',
    category: 'git',
    inputSchema: z.object({ path: z.string().optional().default('.'), remote: z.string().optional().default('origin'), branch: z.string().optional(), force: z.boolean().optional().default(false) }),
    outputSchema: z.object({ path: z.string(), output: z.string() }),
    permissions: [{ action: 'push', resource: 'git' }],
    riskLevel: 'high',
    async execute(input) {
      try {
        if (input.force) return { ok: false, error: 'Force-push is denied by default.', retryable: false };
        const workingDirectory = resolveScopedPath(root, input.path ?? '.');
        const target = input.branch ? ` ${quoteShellArgument(input.branch)}` : '';
        const result = await runCommand(`git push ${quoteShellArgument(input.remote ?? 'origin')}${target}`, workingDirectory);
        return { ok: true, data: { path: relative(root, workingDirectory).replace(/\\/g, '/'), output: result.stdout || result.stderr || '' } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Git push failed', retryable: false };
      }
    }
  };

  const httpRequestTool: AgentTool<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; followRedirects?: boolean }, { status: number; statusText: string; headers: Record<string, string>; body: string }> = {
    id: 'http.request',
    version: '1.0.0',
    description: 'Send a scoped HTTP request with explicit method, timeout, and redirect controls.',
    category: 'http',
    inputSchema: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      url: z.string().url(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
      timeoutMs: z.number().int().positive().max(30000).optional().default(10000),
      followRedirects: z.boolean().optional().default(false)
    }),
    outputSchema: z.object({ status: z.number(), statusText: z.string(), headers: z.record(z.string(), z.string()), body: z.string() }),
    permissions: [{ action: 'request', resource: 'http' }],
    riskLevel: 'medium',
    async execute(input) {
      try {
        const parsed = new URL(input.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https URLs are permitted.');
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname.endsWith('.local')) {
          throw new Error('Local-only network endpoints are blocked in the default policy.');
        }
        const response = await fetch(input.url, {
          method: input.method,
          headers: input.headers ?? {},
          body: input.body,
          redirect: input.followRedirects ? 'follow' : 'manual',
          signal: AbortSignal.timeout(input.timeoutMs ?? 10000)
        });
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        const text = await response.text();
        return { ok: true, data: { status: response.status, statusText: response.statusText, headers, body: text.slice(0, 12000) } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'HTTP request failed', retryable: true };
      }
    }
  };

  const webFetchTool: AgentTool<{ url: string; timeoutMs?: number }, { title: string; url: string; snippet: string }> = {
    id: 'web.fetch',
    version: '1.0.0',
    description: 'Fetch a public web page for analysis and synthesis.',
    category: 'web',
    inputSchema: z.object({ url: z.string().url(), timeoutMs: z.number().int().positive().max(30000).optional().default(15000) }),
    outputSchema: z.object({ title: z.string(), url: z.string(), snippet: z.string() }),
    permissions: [{ action: 'fetch', resource: 'web' }],
    riskLevel: 'low',
    async execute(input) {
      try {
        const response = await fetch(input.url, { method: 'GET', signal: AbortSignal.timeout(input.timeoutMs ?? 15000) });
        if (!response.ok) return { ok: false, error: `Fetch failed with HTTP ${response.status}`, retryable: true };
        const html = await response.text();
        const parsed = cheerio.load(html);
        const title = parsed('title').first().text().trim() || 'Untitled';
        const snippet = parsed('body').text().replace(/\s+/g, ' ').trim().slice(0, 400);
        return { ok: true, data: { title, url: input.url, snippet } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Web fetch failed', retryable: true };
      }
    }
  };

  const webSearchToolAlias: AgentTool<{ query: string }, SearchResult[]> = {
    id: 'web.search',
    version: '1.0.0',
    description: 'Search the public web and return a few title, URL and snippet results.',
    category: 'search',
    inputSchema: z.object({ query: z.string().min(3).max(300) }),
    outputSchema: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
    permissions: [{ action: 'search', resource: 'web' }],
    riskLevel: 'low',
    async execute(input) {
      const results = await webSearch(input.query, 5);
      return { ok: true, data: results };
    }
  };

  for (const tool of [
    filesystemReadTool,
    filesystemWriteTool,
    filesystemListTool,
    filesystemSearchTool,
    filesystemCreateDirTool,
    filesystemMoveTool,
    filesystemCopyTool,
    filesystemDeleteTool,
    shellRunTool,
    gitStatusTool,
    gitDiffTool,
    gitLogTool,
    gitBranchTool,
    gitCheckoutTool,
    gitAddTool,
    gitCommitTool,
    gitPushTool,
    httpRequestTool,
    webFetchTool,
    webSearchToolAlias
  ]) {
    registry.register(tool);
  }

  return registry;
}

function quoteShellArgument(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'bash', process.platform === 'win32' ? ['-Command', command] : ['-lc', command], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise<number | null>((resolve) => { child.on('close', (code) => resolve(code)); });
  if (exitCode !== 0 && !stderr) {
    throw new Error(`Command failed with exit code ${exitCode ?? 'unknown'}: ${stdout.slice(0, 200)}`);
  }
  if (exitCode !== 0) {
    throw new Error(stderr.slice(0, 500) || stdout.slice(0, 500));
  }
  return { stdout: stdout.slice(0, 12000), stderr: stderr.slice(0, 12000), exitCode };
}

export class SearchRateLimitError extends Error {
  constructor(message = 'Search provider is rate limiting requests. Try again shortly.') {
    super(message);
    this.name = 'SearchRateLimitError';
  }
}

export class SearchProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchProviderError';
  }
}

export class DuckDuckGoSearchError extends SearchProviderError {
  constructor(
    message: string,
    public readonly kind: 'timeout' | 'http' | 'parse' | 'no_results'
  ) {
    super(message);
    this.name = 'DuckDuckGoSearchError';
  }
}

export function isProbablyRateLimited(message: string): boolean {
  return /rate limit|too many requests|anomaly|blocked|429/i.test(message);
}

function sanitizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function sanitizeSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const url = normalizeUrl(r.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = r.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (title && url) out.push({ title, url, snippet: sanitizeSnippet(r.snippet ?? '') });
  }
  return out;
}

function normalizeUrl(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed;
    return null;
  } catch {
    return null;
  }
}

export function decodeDuckDuckGoUrl(href: string): string {
  if (!href) return href;
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    if (url.hostname === 'duckduckgo.com' && (url.pathname === '/l/' || url.pathname === '/l')) {
      const target = url.searchParams.get('uddg');
      if (target) return target;
    }
    return href.startsWith('//') ? `https:${href}` : href;
  } catch {
    return href;
  }
}

export function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const $ = cheerio.load(html);
  const out: SearchResult[] = [];
  $('.result').each((_, el) => {
    if (out.length >= limit) return;
    const a = $(el).find('.result__a').first();
    const title = a.text().replace(/\s+/g, ' ').trim();
    const rawHref = a.attr('href') ?? '';
    const url = decodeDuckDuckGoUrl(rawHref);
    const snippet = $(el).find('.result__snippet').first().text();
    if (title && url) out.push({ title, url, snippet: sanitizeSnippet(snippet) });
  });
  return sanitizeSearchResults(out);
}

export async function duckDuckGoSearch(query: string, limit = 5, options?: SearchOptions): Promise<SearchResult[]> {
  const timeoutMs = options?.timeoutMs ?? 10000;
  const retryDelayMs = options?.retryDelayMs;
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; AgentOS/1.0; +https://agentos.app)',
          accept: 'text/html'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) {
        const results = parseDuckDuckGoHtml(await response.text(), limit);
        if (results.length === 0) throw new DuckDuckGoSearchError('No search results returned for this query.', 'no_results');
        return results;
      }

      if (response.status === 429 || response.status === 202) {
        if (attempt === 0) {
          await waitBeforeRetry(retryDelayMs);
          continue;
        }
        throw new SearchRateLimitError(response.status === 202 ? 'Search provider is temporarily throttling this network.' : undefined);
      }

      if (response.status >= 500 && attempt === 0) {
        await waitBeforeRetry(retryDelayMs);
        continue;
      }

      throw new DuckDuckGoSearchError(`Search provider returned HTTP ${response.status}.`, 'http');
    } catch (e) {
      if (e instanceof SearchRateLimitError || e instanceof DuckDuckGoSearchError) throw e;
      if (attempt === 0 && isRetryableSearchError(e)) {
        await waitBeforeRetry(retryDelayMs);
        continue;
      }
      if (e instanceof Error && e.name === 'TimeoutError') {
        throw new DuckDuckGoSearchError('Search provider timed out.', 'timeout');
      }
      throw new DuckDuckGoSearchError(`Search request failed: ${e instanceof Error ? e.message : 'unknown error'}`, 'parse');
    }
  }
  throw new DuckDuckGoSearchError('Search provider request failed after retry.', 'http');
}

function isRetryableSearchError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /fetch failed|network|econnreset|eai_again/i.test(error.message));
}

async function waitBeforeRetry(configuredDelayMs?: number): Promise<void> {
  const delayMs = configuredDelayMs ?? 100 + Math.floor(Math.random() * 250);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  async search(query: string, limit: number, options?: SearchOptions): Promise<SearchResult[]> {
    return duckDuckGoSearch(query, limit, options);
  }
}

export const searchProvider: SearchProvider = new DuckDuckGoProvider();

export async function webSearch(query: string, limit = 5, options?: SearchOptions): Promise<SearchResult[]> {
  return searchProvider.search(query, limit, options);
}