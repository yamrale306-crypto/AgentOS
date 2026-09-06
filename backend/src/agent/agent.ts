import OpenAI from 'openai';
import env from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { chatWithFallback, structuredWithFallback } from './model.js';
import type { AiMode } from '../ai/router.js';
import { planSchema, verificationSchema, webSearchArgsSchema, DEFAULT_PLAN, DEFAULT_VERIFICATION } from './schemas.js';
import { SYSTEM_PROMPT, PLAN_PROMPT, VERIFY_PROMPT, SYNTHESIS_PROMPT } from './prompts.js';
import { webSearch, isProbablyRateLimited, type SearchResult } from '../tools/webSearch.js';
import { assertRunning, clearCancellation, CancelledTaskError } from './cancellation.js';
import { getTaskByAdminId, transition, markFailed, incrementSearchUsage } from '../lib/taskStore.js';
import { ACTIVE_STATUSES, type TaskStatus } from '../types.js';

type TaskRow = Record<string, unknown>;

const AI_MODES = ['auto', 'quality', 'balanced', 'fast', 'lowcost'];

function validMode(value: unknown): AiMode {
  const mode = typeof value === 'string' ? value : 'auto';
  return (AI_MODES as string[]).includes(mode) ? (mode as AiMode) : 'auto';
}

const webSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the public web and return a few title, URL and snippet results for the given query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A specific search query.' } },
      required: ['query'],
      additionalProperties: false
    }
  }
};

const MAX_SOURCES_STORED = 40;
const MAX_ERROR_LENGTH = 2000;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function collectSources(sources: SearchResult[], incoming: SearchResult[]): SearchResult[] {
  const seen = new Set(sources.map((s) => s.url));
  for (const item of incoming) {
    if (seen.has(item.url)) continue;
    if (sources.length >= MAX_SOURCES_STORED) break;
    seen.add(item.url);
    sources.push({ title: item.title, url: item.url, snippet: item.snippet });
  }
  return sources;
}

function toolReply(toolCallId: string, payload: unknown): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(payload)
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

export async function runTask(taskId: string): Promise<void> {
  let task: TaskRow;
  try {
    task = await getTaskByAdminId(taskId);
  } catch {
    // Task vanished before start.
    logger.warn('task_not_found_on_start', { task_id: taskId });
    return;
  }

  const userId = str(task.user_id);
  const prompt = str(task.prompt);
  const modelMode = validMode(task.model_mode);
  const modelOverride = str(task.model) || null;
  let steps = 1;
  let searchesUsedTask = num(task.searches_used);
  let sources: SearchResult[] = Array.isArray(task.sources) ? (task.sources as SearchResult[]) : [];
  let lastProvider = '';
  let lastModel = '';
  let anyFallback = false;

  const routeOpts = { mode: modelMode, override: modelOverride, prompt };

  try {
    await assertRunning(taskId);
    await transition(taskId, ['queued'], {
      status: 'planning',
      current_step: 'Creating a research plan',
      steps_used: steps,
      searches_used: searchesUsedTask
    });

    await assertRunning(taskId);
    const planned = await structuredWithFallback(
      planSchema,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${PLAN_PROMPT}\n${prompt}` }
      ],
      { ...DEFAULT_PLAN, goal: prompt || DEFAULT_PLAN.goal },
      { stage: 'planning', ...routeOpts }
    );
    if (!planned.ok) logger.warn('plan_parse_failed', { task_id: taskId });
    const plan = planned.value;
    lastProvider = planned.provider;
    lastModel = planned.model;
    anyFallback = anyFallback || planned.fallback;
    await transition(taskId, ['planning'], { plan, model_used: planned.model, model_mode: modelMode, model: modelOverride, steps_used: steps });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
      { role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` }
    ];

    let draft = '';

    for (let i = 0; i < env.MAX_STEPS; i++) {
      await assertRunning(taskId);

      const canSearchThisTask = searchesUsedTask < env.MAX_SEARCHES;
      const phase: TaskStatus = canSearchThisTask ? 'searching' : 'analyzing';
      const phaseLabel = canSearchThisTask ? 'Researching the web' : 'Synthesizing findings';
      await transition(taskId, ACTIVE_STATUSES, {
        status: phase,
        current_step: phaseLabel,
        steps_used: steps,
        searches_used: searchesUsedTask
      });

      await assertRunning(taskId);
      const step = await chatWithFallback(messages, [webSearchTool], { stage: 'research', ...routeOpts });
      lastProvider = step.provider;
      lastModel = step.model;
      anyFallback = anyFallback || step.fallback;
      steps += 1;
      await transition(taskId, ACTIVE_STATUSES, {
        model_used: lastModel,
        steps_used: steps,
        searches_used: searchesUsedTask
      });

      const message = step.response.choices[0]?.message;
      if (!message) throw new Error('AI returned an empty response.');
      messages.push(message);

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        draft = message.content ?? '';
        break;
      }

      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function' || toolCall.function.name !== 'web_search') {
          messages.push(toolReply(toolCall.id, { error: 'Unknown tool requested.' }));
          continue;
        }
        if (!canSearchThisTask) {
          messages.push(toolReply(toolCall.id, { error: `Search limit of ${env.MAX_SEARCHES} reached for this task.` }));
          continue;
        }
        await assertRunning(taskId);

        let rawArgs: unknown;
        try {
          rawArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          messages.push(toolReply(toolCall.id, { error: 'Invalid search arguments. Provide valid JSON with a non-empty query string.' }));
          continue;
        }
        const parsed = webSearchArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          messages.push(toolReply(toolCall.id, { error: 'Invalid search arguments. Provide a non-empty query string.' }));
          continue;
        }

        const quota = await incrementSearchUsage(userId, env.DAILY_SEARCH_LIMIT);
        if (quota.over) {
          messages.push(toolReply(toolCall.id, { error: 'Daily search quota reached. Stop searching and synthesize from what you have.' }));
          continue;
        }

        await assertRunning(taskId);
        try {
          const results = await webSearch(parsed.data.query, 5);
          searchesUsedTask += 1;
          sources = collectSources(sources, results);
          messages.push(toolReply(toolCall.id, results));
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Search failed';
          if (isProbablyRateLimited(message)) logger.warn('search_rate_limited', { task_id: taskId });
          else logger.warn('search_failed', { task_id: taskId, query: parsed.data.query }, e);
          messages.push(toolReply(toolCall.id, { error: message }));
        }
      }

      if (!draft && steps >= env.MAX_STEPS) {
        draft = 'Research reached the maximum number of steps. The agent could not produce a final answer within the allowed budget.';
        break;
      }
    }

    if (!draft) {
      await assertRunning(taskId);
      const synthesis = await chatWithFallback(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'assistant', content: `User goal:\n${prompt}` },
          { role: 'assistant', content: `${SYNTHESIS_PROMPT}\n${prompt}` },
          ...messages
        ],
        undefined,
        { stage: 'synthesis', ...routeOpts }
      );
      lastProvider = synthesis.provider;
      lastModel = synthesis.model;
      anyFallback = anyFallback || synthesis.fallback;
      draft = synthesis.response.choices[0]?.message?.content ?? 'The agent could not produce a final answer.';
      steps += 1;
    }

    await assertRunning(taskId);
    await transition(taskId, ACTIVE_STATUSES, {
      status: 'verifying',
      current_step: 'Verifying the answer',
      steps_used: steps
    });

    await assertRunning(taskId);
    const verification = await structuredWithFallback(
      verificationSchema,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `User goal:\n${prompt}\n\nDraft answer:\n${draft}\n\n${VERIFY_PROMPT}` }
      ],
      DEFAULT_VERIFICATION,
      { stage: 'verifying', ...routeOpts }
    );
    if (!verification.ok) logger.warn('verification_parse_failed', { task_id: taskId });
    lastProvider = verification.provider;
    lastModel = verification.model;
    anyFallback = anyFallback || verification.fallback;

    const verifiedLabel = verification.value.complete ? 'yes' : 'partial';
    const missingLine = verification.value.missing ? `\n- Missing: ${verification.value.missing}` : '';
    const result = `${draft}\n\n---\n\n### Agent verification\n\n- Verified: ${verifiedLabel}\n- Reason: ${verification.value.reason}${missingLine}`;

    await assertRunning(taskId);
    await transition(taskId, ACTIVE_STATUSES, {
      status: 'completed',
      current_step: 'Completed',
      result,
      sources,
      model_used: lastModel,
      provider_used: lastProvider || null,
      fallback_used: anyFallback,
      steps_used: steps + 1,
      searches_used: searchesUsedTask,
      completed_at: new Date().toISOString()
    });

    logger.info('task_completed', {
      task_id: taskId,
      provider: lastProvider || 'none',
      model: lastModel,
      mode: modelMode,
      fallback_used: anyFallback,
      steps: steps + 1,
      searches: searchesUsedTask,
      sources: sources.length
    });
  } catch (e) {
    if (e instanceof CancelledTaskError) {
      logger.info('task_cancelled', { task_id: taskId });
      return;
    }
    const errorMessage = e instanceof Error ? e.message : 'Unknown agent error';
    logger.error('task_failed', { task_id: taskId }, e);
    try {
      await markFailed(taskId, errorMessage.slice(0, MAX_ERROR_LENGTH));
    } catch (failErr) {
      logger.warn('task_failed_mark_failed', { task_id: taskId }, failErr);
    }
  } finally {
    clearCancellation(taskId);
  }
}