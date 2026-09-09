import { createApp } from './app.js';
import { initAiRuntime } from '@agentos/ai';
import env from '@agentos/config';
import { logger } from '@agentos/config';

async function start(): Promise<void> {
  initAiRuntime();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('server_started', { port: env.PORT, environment: env.NODE_ENV });
  });
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info('server_shutdown_requested', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => logger.error('server_start_failed', {}, error));