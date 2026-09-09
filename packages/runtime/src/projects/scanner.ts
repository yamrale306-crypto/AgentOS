import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectIntelligence } from '@agentos/schemas';

/**
 * Project scanner. Produces structured `ProjectIntelligence` from a repository
 * — it never uploads contents. `analyzeProject` is a pure function over a file
 * listing (testable without a filesystem); `scanProjectDirectory` reads the
 * metadata it needs from disk.
 */

const SENSITIVE_FILES = new Set([
  '.env',
  '.env.local',
  '.env.*.local',
  'credentials.json',
  'service_account.json',
  'id_rsa',
  'id_ed25519',
  '.npmrc',
  'auth.json',
  '.env.production',
  '.env.development'
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.git',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.pnpm-store',
  '.idea',
  '.vscode'
]);

const CONFIG_MARKERS: Array<{ files: string[]; key: string }> = [
  { files: ['bun.lockb', 'bun.lock'], key: 'bun' },
  { files: ['pnpm-lock.yaml'], key: 'pnpm' },
  { files: ['yarn.lock'], key: 'yarn' },
  { files: ['package-lock.json'], key: 'npm' },
  { files: ['pom.xml'], key: 'maven' },
  { files: ['build.gradle', 'build.gradle.kts'], key: 'gradle' },
  { files: ['Cargo.toml'], key: 'cargo' },
  { files: ['go.mod'], key: 'go' },
  { files: ['Gemfile'], key: 'bundler' },
  { files: ['requirements.txt'], key: 'pip' },
  { files: ['pyproject.toml'], key: 'python' },
  { files: ['package.json'], key: 'node' }
];

function languageFromFile(file: string): string | null {
  const dot = file.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = file.slice(dot + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    rb: 'Ruby',
    php: 'PHP',
    cs: 'C#',
    c: 'C',
    h: 'C',
    cpp: 'C++',
    hpp: 'C++',
    swift: 'Swift',
    scala: 'Scala',
    dart: 'Dart',
    sql: 'SQL',
    sh: 'Shell',
    vue: 'Vue',
    svelte: 'Svelte'
  };
  return map[ext] ?? null;
}

function isImportantFile(file: string): boolean {
  return /^(README|CLAUDE|AGENTS|LICENSE|CHANGELOG|CONTRIBUTING|SECURITY|AGENTOS|Makefile|Dockerfile)/i.test(file);
}

function envRequirementsFromFiles(files: readonly string[]): string[] {
  const vars = new Set<string>();
  for (const file of files) {
    if (SENSITIVE_FILES.has(file)) continue;
    const m = /^\.env\.([a-z.]+)$/i.exec(file);
    if (m) vars.add(`env:${m[1].toLowerCase()}`);
  }
  return Array.from(vars).slice(0, 12);
}

/** Pure analysis over a file listing. Never touches disk. */
export function analyzeProject(files: readonly string[], now: () => string | null = () => new Date().toISOString()): ProjectIntelligence {
  const languages = Array.from(new Set(files.map(languageFromFile).filter((l: string | null): l is string => l !== null))).slice(0, 12);

  const framework = files.some((f) => /\b(next\.config|nuxt\.config)/.test(f))
    ? 'Next.js'
    : files.some((f) => /\bsvelte\.config/.test(f))
      ? 'SvelteKit'
      : files.some((f) => /\bastro\.config/.test(f))
        ? 'Astro'
        : files.some((f) => /\bvite\.config/.test(f))
          ? 'Vite'
          : files.some((f) => f.startsWith('pocketbase'))
            ? 'PocketBase'
            : null;

  let packageManager: string | null = null;
  for (const marker of CONFIG_MARKERS) {
    if (marker.files.some((f) => files.includes(f))) {
      packageManager = marker.key;
      break;
    }
  }

  const appType = files.some((f) => /(^|\/)(app|pages)\/|(^|\/)src\/main\//.test(f) || /^index\.(ts|js|tsx|jsx|go|rs|py)$/.test(f))
    ? 'app'
    : 'unknown';

  return {
    languages,
    framework,
    packageManager,
    dependencies: [],
    scripts: {},
    database: null,
    architecture: [],
    importantFiles: files.filter(isImportantFile).slice(0, 20),
    envRequirements: envRequirementsFromFiles(files),
    git: { appType, hasGit: files.includes('.git/HEAD') },
    detectedAt: now()
  };
}

async function readJsonIfPresent(file: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Read the metadata needed for `analyzeProject` from an actual directory. */
export async function scanProjectDirectory(dir: string, maxFiles = 500): Promise<ProjectIntelligence> {
  const base = dir.replace(/[\\/]+$/, '');
  const files: string[] = [];
  const jsonArtifacts: Array<{ name: string; content: Record<string, unknown> | null }> = [];
  let scanned = 0;

  async function walk(current: string, depth: number): Promise<void> {
    if (scanned >= maxFiles || depth > 8) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= maxFiles) return;
      const full = join(current, entry.name);
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (SENSITIVE_FILES.has(entry.name)) continue;
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (entry.name === '.git') files.push('.git/HEAD');
        else await walk(full, depth + 1);
      } else {
        const relative = full.slice(base.length + 1).replace(/\\/g, '/');
        files.push(relative);
        scanned += 1;
        if (relative === 'package.json') {
          jsonArtifacts.push({ name: relative, content: await readJsonIfPresent(full) });
        }
      }
    }
  }

  await walk(dir, 0);

  const intelligence = analyzeProject(files);
  const pkg = jsonArtifacts[0]?.content;
  if (pkg && typeof pkg === 'object') {
    const deps = pkg['dependencies'];
    if (deps && typeof deps === 'object') {
      intelligence.dependencies = Object.keys(deps).slice(0, 40);
    }
    const scripts = pkg['scripts'];
    if (scripts && typeof scripts === 'object') {
      const entries: Array<[string, unknown]> = Object.entries(scripts);
      intelligence.scripts = Object.fromEntries(entries.filter(([, v]) => typeof v === 'string').slice(0, 20)) as Record<string, string>;
    }
  }
  return intelligence;
}