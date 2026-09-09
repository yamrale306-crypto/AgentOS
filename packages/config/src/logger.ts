import env from './env.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[env.LOG_LEVEL];
}

const SENSITIVE_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]{10,}/g,
  /Bearer\s+[^\s]+/gi
];

export function redact(value: string): string {
  let out = value;
  for (const pattern of SENSITIVE_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

function write(level: LogLevel, event: string, data?: Record<string, unknown>, error?: unknown) {
  if (!shouldLog(level)) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: 'agentos-backend',
    event
  };
  if (data) {
    for (const [key, value] of Object.entries(data)) entry[key] = typeof value === 'string' ? redact(value) : value;
  }
  if (error !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    entry.error = redact(message);
    if (level === 'error' && error instanceof Error && error.stack) {
      entry.stack = redact(error.stack);
    }
  }
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, data?: Record<string, unknown>, error?: unknown) => write('debug', event, data, error),
  info: (event: string, data?: Record<string, unknown>, error?: unknown) => write('info', event, data, error),
  warn: (event: string, data?: Record<string, unknown>, error?: unknown) => write('warn', event, data, error),
  error: (event: string, data?: Record<string, unknown>, error?: unknown) => write('error', event, data, error)
};