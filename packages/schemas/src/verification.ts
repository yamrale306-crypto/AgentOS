import { z } from 'zod';

export const verificationSchema = z.object({
  complete: z.boolean(),
  reason: z.string().max(1000),
  missing: z.string().max(1000).optional().nullable()
});

export const DEFAULT_VERIFICATION = {
  complete: false,
  reason: 'Verification could not be completed because the model output was malformed.',
  missing: 'Could not confirm the answer satisfies the goal.'
};