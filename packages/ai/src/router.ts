import type { ModelSpec } from './catalog.js';
import { modelRegistry } from './registry.js';
import { healthMonitor } from './health.js';
import { AI_MODES } from '@agentos/schemas';

export type AiMode = (typeof AI_MODES)[number];

export type TaskCategory =
  | 'RESEARCH_PLANNING'
  | 'WEB_RESEARCH_ANALYSIS'
  | 'SOURCE_SUMMARIZATION'
  | 'FACT_VERIFICATION'
  | 'LONG_FORM_SYNTHESIS'
  | 'STRUCTURED_EXTRACTION'
  | 'FAST_SIMPLE_ANSWER'
  | 'CODING_TECHNICAL'
  | 'VISION_IMAGE'
  | 'EMBEDDING'
  | 'UTILITY_CLASSIFICATION';

export type AgentStage = 'planning' | 'research' | 'analyzing' | 'verifying' | 'synthesis' | 'general';

const KEYWORD_GROUPS: Array<{ category: TaskCategory; keywords: string[] }> = [
  { category: 'CODING_TECHNICAL', keywords: ['code', 'bug', 'debug', 'function', 'api', 'program', 'javascript', 'python', 'sql', 'regex', 'algorithm', 'implement'] },
  { category: 'FACT_VERIFICATION', keywords: ['verify', 'fact', 'true or false', 'is it true', 'accurate', 'confirm', 'proof'] },
  { category: 'STRUCTURED_EXTRACTION', keywords: ['extract', 'list all', 'table of', 'json', 'schema', 'parse', 'summarize into'] },
  { category: 'SOURCE_SUMMARIZATION', keywords: ['summarize', 'summary of', 'in short', 'tl;dr', 'condense', 'brief summary'] },
  { category: 'LONG_FORM_SYNTHESIS', keywords: ['comprehensive', 'detailed report', 'in depth', 'long-form', 'write an essay', 'full review'] },
  { category: 'VISION_IMAGE', keywords: ['image', 'photo', 'picture', 'diagram', 'screenshot', 'visual', 'ocr', 'describe what you see'] },
  { category: 'FAST_SIMPLE_ANSWER', keywords: ['what is', 'who is', 'when', 'define', 'short answer', 'quick answer', 'one sentence', 'briefly'] },
  { category: 'EMBEDDING', keywords: ['embed', 'embedding', 'vector', 'semantic search'] }
];

function wordMatcher(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}

export function classifyTask(prompt: string): TaskCategory {
  const lower = prompt.toLowerCase();
  let best: TaskCategory | null = null;
  let bestScore = 0;
  for (const group of KEYWORD_GROUPS) {
    let score = 0;
    for (const kw of group.keywords) {
      if (wordMatcher(kw).test(lower)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = group.category;
    }
  }
  return best ?? 'WEB_RESEARCH_ANALYSIS';
}

export interface CapabilityRequirements {
  tools?: boolean;
  vision?: boolean;
  structured?: boolean;
  embeddings?: boolean;
}

export interface RouteRequest {
  stage: AgentStage;
  mode: AiMode;
  override?: string | null;
  requirements?: CapabilityRequirements;
  estimatedContextChars?: number;
  maxCandidates?: number;
  forceIncludeDisabled?: boolean;
  prompt?: string;
}

export interface RouteDecision {
  candidates: ModelSpec[];
  category: TaskCategory;
}

const STAGE_REQUIREMENTS: Record<AgentStage, CapabilityRequirements> = {
  planning: { structured: true },
  research: { tools: true },
  analyzing: { tools: true },
  verifying: { structured: true },
  synthesis: {},
  general: {}
};

const STAGE_QUALITY_WEIGHT: Record<AgentStage, number> = {
  planning: 1.6,
  research: 0.9,
  analyzing: 1.1,
  verifying: 1.8,
  synthesis: 1.5,
  general: 1.0
};

const STAGE_SPEED_WEIGHT: Record<AgentStage, number> = {
  planning: 0.7,
  research: 1.2,
  analyzing: 1.0,
  verifying: 0.6,
  synthesis: 0.8,
  general: 1.0
};

function stageRequirements(stage: AgentStage, explicit?: CapabilityRequirements): CapabilityRequirements {
  return { ...STAGE_REQUIREMENTS[stage], ...explicit };
}

function satisfies(spec: ModelSpec, req: CapabilityRequirements): boolean {
  if (req.tools && !spec.capabilities.tools) return false;
  if (req.vision && !spec.capabilities.vision) return false;
  if (req.structured && !spec.capabilities.structuredOutput) return false;
  if (req.embeddings && !spec.capabilities.embeddings) return false;
  return true;
}

function resolveOverride(override: string | undefined | null): ModelSpec | null {
  if (!override) return null;
  const trimmed = override.trim();
  if (!trimmed) return null;
  const exact = modelRegistry.get(trimmed);
  if (exact) return exact;
  const found = modelRegistry.enabled().find((s) => s.modelId.toLowerCase() === trimmed.toLowerCase());
  return found ?? null;
}

export interface ScoredCandidate {
  spec: ModelSpec;
  score: number;
}

function latencyScoreFor(spec: ModelSpec): number {
  const record = healthMonitor.ensure(spec.key, spec.providerId);
  if (record.avgLatencyMs === null) return 12;
  if (record.avgLatencyMs < 1500) return 20;
  if (record.avgLatencyMs < 4000) return 16;
  if (record.avgLatencyMs < 10000) return 10;
  if (record.avgLatencyMs < 30000) return 5;
  return 2;
}

function healthScoreFor(spec: ModelSpec): number {
  const record = healthMonitor.ensure(spec.key, spec.providerId);
  switch (record.status) {
    case 'healthy':
      return 20;
    case 'unknown':
      return 12;
    case 'degraded':
      return 4;
    case 'rate_limited':
      return 0;
    case 'model_unavailable':
      return 0;
    case 'auth_error':
      return 0;
    default:
      return 0;
  }
}

function isHardExcluded(spec: ModelSpec): boolean {
  const record = healthMonitor.ensure(spec.key, spec.providerId);
  if (record.disabled) return true;
  if (record.status === 'auth_error') return true;
  return false;
}

function scoreCandidate(
  spec: ModelSpec,
  req: CapabilityRequirements,
  reqChars: number,
  stage: AgentStage,
  mode: AiMode,
  qualityWeight: number,
  speedWeight: number
): number {
  let capabilityFit = 50;
  if (req.tools && spec.capabilities.tools) capabilityFit += 15;
  if (req.structured && spec.capabilities.structuredOutput) capabilityFit += 15;
  if (req.vision && spec.capabilities.vision) capabilityFit += 15;
  if (req.embeddings && spec.capabilities.embeddings) capabilityFit += 15;

  let contextFit = 0;
  if (reqChars > 0 && spec.contextWindow !== null) {
    contextFit = spec.contextWindow >= reqChars ? 15 : Math.max(-25, (spec.contextWindow / reqChars) * 10);
  }

  const qualityScore = spec.qualityScore * (mode === 'quality' ? 2.2 : mode === 'auto' ? qualityWeight : qualityWeight * 0.9);
  const speedScore = spec.speedScore * (mode === 'fast' ? 2.2 : mode === 'quality' ? 0.5 : speedWeight);
  const costScore = mode === 'lowcost' ? 10 - spec.costPriority * 1.5 : 5 - spec.costPriority * 0.5;
  const priorityBon = Math.min(25, Math.max(0, 100 - spec.priority) * 0.5);

  return (
    capabilityFit +
    contextFit +
    healthScoreFor(spec) +
    latencyScoreFor(spec) +
    qualityScore +
    speedScore +
    costScore +
    priorityBon
  );
}

export function route(req: RouteRequest): RouteDecision {
  const { stage, mode } = req;
  const maxCandidates = req.maxCandidates ?? 6;
  const reqChars = req.estimatedContextChars ?? 0;
  const requirements = stageRequirements(stage, req.requirements);
  const category = classifyTask(req.prompt ?? '');

  const overrideSpec = resolveOverride(req.override);
  const pool = modelRegistry.enabled();

  const primary: ModelSpec[] = [];
  const relaxed: ModelSpec[] = [];

  for (const spec of pool) {
    if (overrideSpec && spec.key === overrideSpec.key) continue;
    if (isHardExcluded(spec)) continue;
    if (healthMonitor.shouldSkip(spec.key)) {
      relaxed.push(spec);
      continue;
    }
    if (satisfies(spec, requirements)) primary.push(spec);
    else relaxed.push(spec);
  }

  const rank = (list: ModelSpec[]): ModelSpec[] =>
    list
      .map((spec) => ({
        spec,
        score: scoreCandidate(
          spec,
          requirements,
          reqChars,
          stage,
          mode,
          STAGE_QUALITY_WEIGHT[stage],
          STAGE_SPEED_WEIGHT[stage]
        )
      }))
      .sort((a, b) => b.score - a.score)
      .map((s) => s.spec);

  let ordered = rank(primary);
  if (ordered.length < 2) {
    const relaxedOrdered = rank(relaxed);
    for (const spec of relaxedOrdered) {
      if (ordered.length >= maxCandidates) break;
      ordered.push(spec);
    }
  }

  if (overrideSpec) {
    ordered = [overrideSpec, ...ordered];
  }

  const unique: ModelSpec[] = [];
  const seen = new Set<string>();
  for (const spec of ordered) {
    if (seen.has(spec.key)) continue;
    seen.add(spec.key);
    unique.push(spec);
    if (unique.length >= maxCandidates) break;
  }

  return { candidates: unique, category };
}

export function describeRoute(decision: RouteDecision): string[] {
  return decision.candidates.map((spec) => `${spec.providerId}/${spec.modelId}`);
}