import 'dotenv/config';
import { loadDevKeysIntoEnv } from './credentials.js';

const fileArg = process.argv.find((a) => a.startsWith('--file='));
const onlyProvider = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1];
const includeDynamic = process.argv.includes('--include-dynamic');

loadDevKeysIntoEnv(fileArg ? fileArg.slice('--file='.length) : undefined);

void (async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://placeholder.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder';
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';

  const { logger } = await import('../src/lib/logger.js');
  const { modelRegistry, discoverOpenRouterModels } = await import('../src/ai/registry.js');
  const { tokens, providerManager, seedModelRegistry } = await import('../src/ai/runtime.js');
  const { healthMonitor } = await import('../src/ai/health.js');
  const { normalizeError } = await import('../src/ai/errors.js');
  const env = (await import('../src/lib/config.js')).default;

  seedModelRegistry();
  const discovered = await discoverOpenRouterModels(env.OPENROUTER_API_KEY, false);

  const models = modelRegistry
    .enabled()
    .filter((m) => !onlyProvider || m.providerId === onlyProvider)
    .filter((m) => includeDynamic || !m.dynamic)
    .sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));

  const prompt = 'Reply with exactly: OK';

  async function testModel(providerId: string, modelId: string): Promise<{ passed: boolean; category: string; latencyMs: number | null }> {
    const key = `${providerId}:${modelId}`;
    const token = tokens.select(providerId, { modelKey: key });
    if (!token) return { passed: false, category: 'NO_TOKEN', latencyMs: null };
    const raw = tokens.valueFor(token.id);
    if (!raw) return { passed: false, category: 'NO_TOKEN', latencyMs: null };
    const client = providerManager.clientFor(providerId, raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const started = Date.now();
    try {
      await client.chat.completions.create(
        { model: modelId, messages: [{ role: 'user', content: prompt }], max_tokens: 8, temperature: 0 },
        { signal: controller.signal }
      );
      const latencyMs = Date.now() - started;
      healthMonitor.recordSuccess(key, providerId, latencyMs);
      tokens.recordSuccess(token, { modelKey: key });
      modelRegistry.markVerified(key);
      return { passed: true, category: 'OK', latencyMs };
    } catch (e) {
      const norm = normalizeError(e);
      healthMonitor.recordFailure(key, providerId, norm.category);
      tokens.recordFailure(token, norm.category, { modelKey: key });
      return { passed: false, category: norm.category, latencyMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  console.log('\n=== AgentOS provider verification ===');
  console.log('Safe minimal ping per enabled model. No credentials are printed.\n');
  console.log(`Discovered ${discovered} OpenRouter model(s) via /models.`);

  const results: Array<{ provider: string; model: string; status: string; latency: string; category: string }> = [];
  let pass = 0;
  let fail = 0;
  let degraded = 0;

  for (const spec of models) {
    const skipCheck = healthMonitor.snapshot().find((h) => h.modelKey === spec.key);
    if (skipCheck && skipCheck.status === 'auth_error') {
      results.push({ provider: spec.providerId, model: spec.modelId, status: 'SKIP (auth)', latency: '-', category: 'AUTH_ERROR' });
      fail += 1;
      continue;
    }
    const out = await testModel(spec.providerId, spec.modelId);
    if (out.passed) {
      pass += 1;
      results.push({ provider: spec.providerId, model: spec.modelId, status: 'PASS', latency: `${out.latencyMs}ms`, category: 'OK' });
    } else if (out.category === 'RATE_LIMIT' || out.category === 'MODEL_UNAVAILABLE') {
      degraded += 1;
      results.push({ provider: spec.providerId, model: spec.modelId, status: 'DEGRADED', latency: `${out.latencyMs ?? '-'}ms`, category: out.category });
    } else if (out.category === 'TIMEOUT') {
      fail += 1;
      results.push({ provider: spec.providerId, model: spec.modelId, status: 'FAIL', latency: `${out.latencyMs ?? '-'}ms`, category: out.category });
    } else {
      fail += 1;
      results.push({ provider: spec.providerId, model: spec.modelId, status: 'FAIL', latency: `${out.latencyMs ?? '-'}ms`, category: out.category });
    }
  }

  const width = Math.max(...results.map((r) => `${r.provider}/${r.model}`.length), 24);
  console.log(`\n${'MODEL'.padEnd(width)}  STATUS     LATENCY   ERROR`);
  console.log('-'.repeat(width + 30));
  for (const r of results) {
    console.log(`${`${r.provider}/${r.model}`.padEnd(width)}  ${r.status.padEnd(9)} ${r.latency.padEnd(9)} ${r.category}`);
  }

  console.log(`\nRESULT: ${pass} PASS | ${degraded} DEGRADED | ${fail} FAIL`);
  console.log(`Providers tested: ${Array.from(new Set(results.map((r) => r.provider))).join(', ')}`);
  console.log('No API keys were printed.\n');
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Verification failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});