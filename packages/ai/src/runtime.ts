import env from '@agentos/config';
import { TokenManager } from './token-manager.js';
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

let initialized = false;

/**
 * Explicit one-time initialisation of the shared AI runtime.
 *
 * Model seeding and provider discovery are intentionally NOT triggered at
 * module import time (they used to be, via side effects in the old backend).
 * Every process that bottlenecks on AI (the worker and the API) must call
 * this once during startup.
 */
export function initAiRuntime(): void {
  if (initialized) return;
  seedModelRegistry();
  void startModelDiscovery();
  initialized = true;
}