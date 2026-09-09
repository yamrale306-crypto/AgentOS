/**
 * AI model modes — the single source of truth for the whole repository.
 *
 * Historically this constant was duplicated in several places in the old
 * `backend/` tree. It must live here only. Every consumer imports it as
 * `import { AI_MODES } from '@agentos/schemas'`.
 */
export const AI_MODES = ['auto', 'quality', 'balanced', 'fast', 'lowcost'] as const;

export type AiMode = (typeof AI_MODES)[number];