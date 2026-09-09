import { randomUUID } from 'node:crypto';
import env from '@agentos/config';
import { logger } from '@agentos/config';
import { initAiRuntime } from '@agentos/ai';
import { claimNextTask, heartbeatTask } from '@agentos/database';
import { runTask } from './agent/agent.js';

const workerId = `worker-${randomUUID()}`;
let stopping = false;

initAiRuntime();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function processOne(): Promise<boolean> {
  const task = await claimNextTask(workerId, env.WORKER_LEASE_SECONDS, env.WORKER_MAX_ATTEMPTS);
  if (!task?.id) return false;
  const taskId = String(task.id);
  logger.info('task_claimed', { task_id: taskId, worker_id: workerId, attempt: task.attempt_count });
  const interval = setInterval(() => {
    heartbeatTask(taskId, workerId, env.WORKER_LEASE_SECONDS)
      .then((owned) => { if (!owned) logger.warn('task_lease_lost', { task_id: taskId, worker_id: workerId }); })
      .catch((error) => logger.error('task_heartbeat_failed', { task_id: taskId }, error));
  }, Math.max(1000, Math.floor(env.WORKER_LEASE_SECONDS * 500)));
  try {
    await runTask(taskId, workerId);
  } finally {
    clearInterval(interval);
  }
  return true;
}

async function start(): Promise<void> {
  logger.info('worker_started', { worker_id: workerId });
  while (!stopping) {
    try {
      if (!await processOne()) await sleep(env.WORKER_POLL_MS);
    } catch (error) {
      logger.error('worker_loop_error', { worker_id: workerId }, error);
      await sleep(env.WORKER_POLL_MS);
    }
  }
  logger.info('worker_stopped', { worker_id: workerId });
}

function stop(signal: string): void { stopping = true; logger.info('worker_shutdown_requested', { signal, worker_id: workerId }); }
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
start().catch((error) => { logger.error('worker_start_failed', { worker_id: workerId }, error); process.exitCode = 1; });