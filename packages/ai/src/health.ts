import type { AiErrorCategory } from './errors.js';

export type ModelHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'rate_limited' | 'model_unavailable' | 'auth_error' | 'disabled';

export interface ModelHealthRecord {
  modelKey: string;
  providerId: string;
  status: ModelHealthStatus;
  avgLatencyMs: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: AiErrorCategory | null;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
  rateLimitedUntil: number;
  disabled: boolean;
}

const EWMA_ALPHA = 0.3;
const DEGRADED_THRESHOLD = 2;
const UNAVAILABLE_THRESHOLD = 5;
const RECOVERY_DELAY_MS = 90_000;

export class HealthMonitor {
  private readonly records = new Map<string, ModelHealthRecord>();

  ensure(modelKey: string, providerId: string): ModelHealthRecord {
    let record = this.records.get(modelKey);
    if (!record) {
      record = {
        modelKey,
        providerId,
        status: 'unknown',
        avgLatencyMs: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureCategory: null,
        consecutiveFailures: 0,
        successCount: 0,
        failureCount: 0,
        rateLimitedUntil: 0,
        disabled: false
      };
      this.records.set(modelKey, record);
    }
    return record;
  }

  recordSuccess(modelKey: string, providerId: string, latencyMs: number, now = Date.now()): ModelHealthRecord {
    const record = this.ensure(modelKey, providerId);
    record.avgLatencyMs = record.avgLatencyMs === null ? latencyMs : record.avgLatencyMs * (1 - EWMA_ALPHA) + latencyMs * EWMA_ALPHA;
    record.successCount += 1;
    record.consecutiveFailures = 0;
    record.lastSuccessAt = now;
    record.rateLimitedUntil = 0;
    record.lastFailureCategory = null;
    if (record.status === 'unknown') record.status = 'healthy';
    else if (record.status === 'rate_limited' || record.status === 'degraded' || record.status === 'model_unavailable') record.status = 'healthy';
    return record;
  }

  recordFailure(modelKey: string, providerId: string, category: AiErrorCategory, now = Date.now()): ModelHealthRecord {
    const record = this.ensure(modelKey, providerId);
    record.failureCount += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = now;
    record.lastFailureCategory = category;
    if (category === 'AUTH_ERROR') {
      record.status = 'auth_error';
      return record;
    }
    if (category === 'RATE_LIMIT') {
      record.status = 'rate_limited';
      record.rateLimitedUntil = now + Math.min(60_000 * 2 ** Math.min(record.consecutiveFailures, 3), 5 * 60_000);
      return record;
    }
    if (category === 'MODEL_UNAVAILABLE') {
      record.status = 'model_unavailable';
      return record;
    }
    if (record.consecutiveFailures >= UNAVAILABLE_THRESHOLD) {
      record.status = 'model_unavailable';
    } else if (record.consecutiveFailures >= DEGRADED_THRESHOLD) {
      record.status = 'degraded';
    }
    return record;
  }

  shouldSkip(modelKey: string, now = Date.now()): boolean {
    const record = this.records.get(modelKey);
    if (!record) return false;
    if (record.disabled) return true;
    if (record.status === 'auth_error') return true;
    if (record.status === 'model_unavailable' && Date.now() - (record.lastFailureAt ?? 0) < RECOVERY_DELAY_MS) return true;
    if (record.status === 'rate_limited' && record.rateLimitedUntil > now) return true;
    if (record.status === 'degraded' && record.rateLimitedUntil > now) return true;
    return false;
  }

  disable(modelKey: string): void {
    const record = this.records.get(modelKey);
    if (record) record.disabled = true;
  }

  enable(modelKey: string): void {
    const record = this.records.get(modelKey);
    if (record) record.disabled = false;
    else this.ensure(modelKey, '');
  }

  reset(): void {
    this.records.clear();
  }

  snapshot(): ModelHealthRecord[] {
    return Array.from(this.records.values()).map((r) => ({ ...r }));
  }
}

export type { ModelHealthRecord as HealthRecord };

export const healthMonitor = new HealthMonitor();