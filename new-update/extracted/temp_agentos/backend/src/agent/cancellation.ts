import { getStatus } from '../lib/taskStore.js';
import { isActiveStatus } from '../types.js';

const cancelledLocally = new Set<string>();

export class CancelledTaskError extends Error {
  constructor() {
    super('Task was cancelled.');
    this.name = 'CancelledTaskError';
  }
}

export function requestCancellation(taskId: string): void {
  cancelledLocally.add(taskId);
}

export function clearCancellation(taskId: string): void {
  cancelledLocally.delete(taskId);
}

export function isCancelledLocally(taskId: string): boolean {
  return cancelledLocally.has(taskId);
}

export async function assertRunning(taskId: string): Promise<void> {
  if (isCancelledLocally(taskId)) throw new CancelledTaskError();
  const status = await getStatus(taskId);
  if (status === null || !isActiveStatus(status)) throw new CancelledTaskError();
}