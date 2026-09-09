import { z } from 'zod';

export const planSchema = z.object({
  goal: z.string().min(1).max(500),
  steps: z.array(z.string().min(1).max(300)).min(2).max(5)
});

export const DEFAULT_PLAN = { goal: '', steps: ['Research the topic', 'Synthesize findings', 'Verify the result'] };