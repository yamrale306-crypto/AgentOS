import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCredentialLine, validateFormat, mask } from './credentials.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DIR, '..');
const ENV_PATH = path.join(REPO_ROOT, '.env');

const readOnly = process.argv.includes('--read-only') || process.env.IMPORT_READ_ONLY === '1';

function loadExistingEnv(): Map<string, string> {
  const existing = new Map<string, string>();
  if (!fs.existsSync(ENV_PATH)) return existing;
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) existing.set(key, val.replace(/^["']|["']$/g, ''));
  }
  return existing;
}

function writeEnv(map: Map<string, string>): void {
  const lines = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

function main(): void {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith('--file='));
  const keysPath = fileArg
    ? path.resolve(process.cwd(), fileArg.slice('--file='.length))
    : path.join(REPO_ROOT, 'Dev Keys.txt');

  if (!fs.existsSync(keysPath)) {
    console.error(`Key file not found: ${keysPath}`);
    console.error('Pass --file=<path> to point at a local credentials file.');
    process.exit(1);
  }

  const lines = fs.readFileSync(keysPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const envMap = loadExistingEnv();
  const unknownLabels: string[] = [];
  const report: Array<{ provider: string; status: string; detail: string }> = [];
  const entries: Array<[string, string]> = [];

  for (const line of lines) {
    const parsed = parseCredentialLine(line);
    if (!parsed) {
      const label = line.split('=')[0]?.trim() || 'unknown';
      unknownLabels.push(label);
      continue;
    }
    if (parsed.provider === 'opencode') {
      report.push({ provider: 'opencode', status: 'Detected', detail: 'Not an AgentOS AI provider — skipped.' });
      continue;
    }
    if (parsed.envVars.length === 0) {
      report.push({ provider: parsed.provider, status: 'Unknown credential format', detail: 'Expected an API token or account ID+token pair.' });
      continue;
    }
    for (const check of parsed.checks) {
      if (check.envVar && !check.value) {
        report.push({ provider: parsed.provider, status: 'Invalid', detail: `Missing ${check.envVar}.` });
      }
    }
    let allValid = true;
    for (const [envVar, value] of parsed.envVars) {
      const fsCheck = validateFormat(envVar, value);
      if (fsCheck !== 'valid') allValid = false;
      entries.push([envVar, value]);
    }
    const existingOk = parsed.envVars.every(([k]) => envMap.has(k) && envMap.get(k)?.trim() !== '');
    report.push({
      provider: parsed.provider,
      status: allValid ? (existingOk ? 'Valid' : 'Detected') : 'Invalid',
      detail: `env: ${parsed.envVars.map(([k]) => k).join(', ')} | format ${allValid ? 'looks valid' : 'looks invalid'} | ${readOnly ? 'read-only' : existingOk ? 'already present' : 'will be added'}`
    });
  }

  const merged = new Map(envMap);
  for (const [k, v] of entries) merged.set(k, v);

  console.log('\n=== AgentOS key importer ===');
  console.log(`Source: ${path.basename(keysPath)} (local)`);
  console.log(`Mode: ${readOnly ? 'READ-ONLY (no files written)' : 'merge into ' + path.relative(REPO_ROOT, ENV_PATH)}`);
  console.log('\nDiscovered credentials:');
  if (report.length === 0) console.log('  (none recognized)');
  for (const r of report) console.log(`  ${r.provider}: ${r.status} — ${r.detail}`);

  if (unknownLabels.length > 0) {
    console.log('\nUnknown credential formats (not guessed, values hidden):');
    for (const label of unknownLabels) console.log(`  ${label}: unknown`);
  }

  console.log('\nMapped environment variables (values masked):');
  const sortedKeys = Array.from(merged.keys()).sort();
  for (const k of sortedKeys) {
    if (/KEY|TOKEN|SECRET/i.test(k)) {
      console.log(`  ${k}=${mask(merged.get(k) ?? '')}`);
    }
  }

  const toAdd = entries.filter(([k]) => !envMap.has(k));
  if (!readOnly) {
    writeEnv(merged);
    console.log(`\nWrote ${merged.size} env vars to ${path.relative(REPO_ROOT, ENV_PATH)} (${toAdd.length} new).`);
  } else if (toAdd.length > 0) {
    console.log(`\nRead-only mode: ${toAdd.length} new env var(s) NOT written.`);
  }
  console.log('Raw key values were never printed.\n');
}

main();