import { badRequest } from './errors.js';

export function validatePrompt(prompt: unknown): string {
  if (typeof prompt !== 'string') throw badRequest('prompt must be a string.');
  const trimmed = prompt.trim();
  if (trimmed.length < 3) throw badRequest('Prompt must be at least 3 characters.');
  if (trimmed.length > 4000) throw badRequest('Prompt must be 4000 characters or fewer.');
  return trimmed;
}