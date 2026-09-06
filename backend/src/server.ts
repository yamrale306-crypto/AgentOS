import { createApp } from './app.js';
import env from './lib/config.js';
import { logger } from './lib/logger.js';
import { recoverInterruptedTasks } from './lib/taskStore.js';

async function start(): Promise<void> {
  try {
    const recovered = await recoverInterruptedTasks();
    if (recovered > 0) logger.warn('interrupted_tasks_recovered', { count: recovered });
  } catch (error) {
    logger.error('interrupted_task_recovery_failed', {}, error);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info('server_started', { port: env.PORT, environment: env.NODE_ENV });
  });
}

start().catch((error) => logger.error('server_start_failed', {}, error));