import env from '../lib/config.js';
import { TokenManager } from './tokenManager.js';
import { createAiRuntime, type ProviderManager } from './providers.js';
import { modelRegistry, discoverOpenRouterModels } from './registry.js';

export const tokens = new TokenManager();

export const aiRuntime = createAiRuntime(env as Parameters<typeof createAiRuntime>[0], tokens);

export const providerManager: ProviderManager = aiRuntime.providerManager;

export function seedModelRegistry(): void {
  modelRegistry.seedFromEnv({
    OPENROUTER_MODEL_PRIMARY: env.OPENROUTER_MODEL_PRIMARY,
    OPENROUTER_MODEL_FALLBACK: env.OPENROUTER_MODEL_FALLBACK
  });
}

let discoveryPromise: Promise<number> | null = null;

export function startModelDiscovery(): Promise<number> {
  if (discoveryPromise) return discoveryPromise;
  discoveryPromise = discoverOpenRouterModels(env.OPENROUTER_API_KEY, env.NODE_ENV === 'test');
  return discoveryPromise;
}