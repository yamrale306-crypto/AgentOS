import fs from 'node:fs';
import path from 'node:path';

export function mask(value: string): string {
  return value.length <= 8 ? '***' : `${value.slice(0, 3)}***${value.slice(-4)}`;
}

export interface CredentialCheck {
  envVar: string;
  value: string;
}

export interface ParsedCredential {
  provider: string;
  envVars: Array<[string, string]>;
  checks: CredentialCheck[];
}

export function validateFormat(envVar: string, value: string): 'valid' | 'invalid' | 'unknown' {
  switch (envVar) {
    case 'DEEPSEEK_API_KEY':
      return /^sk-[A-Za-z0-9_-]{8,}$/.test(value) ? 'valid' : 'invalid';
    case 'OPENROUTER_API_KEY':
      return /^sk-or-v1-[A-Za-z0-9_-]{10,}$/.test(value) ? 'valid' : 'invalid';
    case 'GROQ_API_KEY':
      return /^gsk_[A-Za-z0-9_-]{8,}$/.test(value) ? 'valid' : 'invalid';
    case 'GEMINI_API_KEY':
      return /^(AIza|AQ\.)[A-Za-z0-9_.\-]{10,}$/.test(value) ? 'valid' : 'invalid';
    case 'ZAI_API_KEY':
      return /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(value) ? 'valid' : 'invalid';
    case 'CLOUDFLARE_API_TOKEN':
      return /^cfat_[A-Za-z0-9_-]{10,}$/.test(value) ? 'valid' : 'invalid';
    case 'CLOUDFLARE_ACCOUNT_ID':
      return /^[A-Za-z0-9_-]{10,}$/.test(value) ? 'valid' : 'invalid';
    case 'SUPABASE_URL':
      return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(value) ? 'valid' : 'invalid';
    case 'SUPABASE_SERVICE_ROLE_KEY':
      return /^sb_(secret_)?[A-Za-z0-9_-]{10,}$/.test(value) ? 'valid' : 'invalid';
    default:
      return 'unknown';
  }
}

export function parseCredentialLine(line: string): ParsedCredential | null {
  const idx = line.indexOf('=');
  if (idx <= 0) return null;
  const label = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  const lower = label.toLowerCase();

  if (lower.includes('deepseek')) {
    return { provider: 'DeepSeek', envVars: [['DEEPSEEK_API_KEY', value]], checks: [{ envVar: 'DEEPSEEK_API_KEY', value }] };
  }
  if (lower.includes('openrouter')) {
    return { provider: 'OpenRouter', envVars: [['OPENROUTER_API_KEY', value]], checks: [{ envVar: 'OPENROUTER_API_KEY', value }] };
  }
  if (lower.includes('groq')) {
    return { provider: 'Groq', envVars: [['GROQ_API_KEY', value]], checks: [{ envVar: 'GROQ_API_KEY', value }] };
  }
  if (lower.includes('gemini')) {
    return { provider: 'Google Gemini', envVars: [['GEMINI_API_KEY', value]], checks: [{ envVar: 'GEMINI_API_KEY', value }] };
  }
  if (lower.includes('z.ai') || lower.includes('zhipu') || lower.includes('zai')) {
    return { provider: 'Z.ai', envVars: [['ZAI_API_KEY', value]], checks: [{ envVar: 'ZAI_API_KEY', value }] };
  }
  if (lower.includes('cloudflare')) {
    const tokenMatch = /(cfat_[A-Za-z0-9_-]{8,})/.exec(line);
    const idMatch = /API\s+ID\s*=\s*([A-Za-z0-9_-]{10,})/i.exec(line);
    const envVars: Array<[string, string]> = [];
    if (tokenMatch) envVars.push(['CLOUDFLARE_API_TOKEN', tokenMatch[1]]);
    if (idMatch) envVars.push(['CLOUDFLARE_ACCOUNT_ID', idMatch[1]]);
    return {
      provider: 'Cloudflare',
      envVars,
      checks: [
        { envVar: 'CLOUDFLARE_API_TOKEN', value: tokenMatch?.[1] ?? '' },
        { envVar: 'CLOUDFLARE_ACCOUNT_ID', value: idMatch?.[1] ?? '' }
      ]
    };
  }
  if (lower.includes('supabase')) {
    const urlMatch = /(https:\/\/[a-z0-9-]+\.supabase\.co)/i.exec(line);
    const keyMatch = /Key\s*=\s*(\S+)/i.exec(line) ?? /(sb_(?:secret_)?[A-Za-z0-9_-]{10,})/.exec(line);
    const envVars: Array<[string, string]> = [];
    if (urlMatch) envVars.push(['SUPABASE_URL', urlMatch[1]]);
    if (keyMatch) envVars.push(['SUPABASE_SERVICE_ROLE_KEY', keyMatch[1]]);
    return {
      provider: 'Supabase',
      envVars,
      checks: [
        { envVar: 'SUPABASE_URL', value: urlMatch?.[1] ?? '' },
        { envVar: 'SUPABASE_SERVICE_ROLE_KEY', value: keyMatch?.[1] ?? '' }
      ]
    };
  }
  if (lower.includes('opencode')) {
    return { provider: 'opencode', envVars: [], checks: [] };
  }
  return null;
}

function findDevKeysPath(): string {
  const candidates = [
    process.env.DEV_KEYS_FILE
  ].filter(Boolean) as string[];
  if (candidates[0]) return path.resolve(candidates[0]);
  for (const dir of [process.cwd(), process.cwd() + '/..']) {
    const p = path.join(dir, 'Dev Keys.txt');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

export function loadDevKeysIntoEnv(keysPath?: string): { entries: Array<[string, string]>; detected: number } {
  const resolved = keysPath ?? findDevKeysPath();
  const entries: Array<[string, string]> = [];
  let detected = 0;
  if (!resolved || !fs.existsSync(resolved)) return { entries, detected };

  const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const parsed = parseCredentialLine(line);
    if (!parsed) continue;
    detected += 1;
    for (const [envVar, value] of parsed.envVars) {
      if (process.env[envVar]) continue;
      entries.push([envVar, value]);
      process.env[envVar] = value;
    }
  }
  return { entries, detected };
}