import { z } from 'zod';

export const planSchema = z.object({
  goal: z.string().min(1).max(500),
  steps: z.array(z.string().min(1).max(300)).min(2).max(5)
});

export const verificationSchema = z.object({
  complete: z.boolean(),
  reason: z.string().max(1000),
  missing: z.string().max(1000).optional().nullable()
});

export const webSearchArgsSchema = z.object({
  query: z.string().min(3).max(300)
});

export const DEFAULT_PLAN = { goal: '', steps: ['Research the topic', 'Synthesize findings', 'Verify the result'] };

export const DEFAULT_VERIFICATION = {
  complete: false,
  reason: 'Verification could not be completed because the model output was malformed.',
  missing: 'Could not confirm the answer satisfies the goal.'
};