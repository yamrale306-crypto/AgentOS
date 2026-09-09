import OpenAI from 'openai';
import env from '@agentos/config';
import { logger } from '@agentos/config';
import { chatWithFallback, structuredWithFallback } from '@agentos/ai';
import type { AiMode } from '@agentos/ai';
import { planSchema, verificationSchema, webSearchArgsSchema, DEFAULT_PLAN, DEFAULT_VERIFICATION, ACTIVE_STATUSES, AI_MODES, type TaskStatus, type SearchResult } from '@agentos/schemas';
import { SYSTEM_PROMPT, PLAN_PROMPT, VERIFY_PROMPT, SYNTHESIS_PROMPT } from './prompts.js';
import { webSearchTool, workerAgent, workerPolicy, policyCheckForSearch } from './tools.js';
import { isProbablyRateLimited } from '@agentos/tools';
import { assertRunning, clearCancellation, CancelledTaskError } from './cancellation.js';
import { getTaskByAdminId, transition, markFailed, incrementSearchUsage } from '@agentos/database';
import { RunSession } from './session.js';

type TaskRow = Record<string, unknown>;

function validMode(value: unknown): AiMode {
  const mode = typeof value === 'string' ? value : 'auto';
  return (AI_MODES as readonly string[]).includes(mode) ? (mode as AiMode) : 'auto';
}

const openAiWebSearchTool: OpenAI.Chat.Completions.ChatCompletionTool = {
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

export async function runTask(taskId: string, workerId?: string): Promise<void> {
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
  const routeOpts = { mode: modelMode, override: modelOverride, prompt };

  // Open the durable run session: creates a fresh run row, or — after a worker
  // crash — resumes the paused run from its latest checkpoint (no re-planning).
  const session = await RunSession.open(task, workerId);
  const resumed = session.resumed;
  // Fresh runs seed their budget from the task row; resumed runs restore what
  // the checkpoint captured (which already includes the task's prior usage).
  let steps = session.state.steps;
  let searchesUsedTask = resumed ? session.state.searchesUsedTask : num(task.searches_used);
  let sources: SearchResult[] = resumed
    ? session.state.sources
    : (Array.isArray(task.sources) ? (task.sources as SearchResult[]) : []);
  let lastProvider = session.state.lastProvider;
  let lastModel = session.state.lastModel;
  let anyFallback = session.state.anyFallback;
  let plan = session.state.plan ?? null;
  let draft = session.state.draft;
  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  try {
    await assertRunning(taskId);

    if (!resumed) {
      await session.transition('PLANNING');
      await session.appendStep('planning.context', { goal: prompt, modelMode, modelOverride });
      await transition(taskId, ['queued'], {
        status: 'planning',
        current_step: 'Creating a research plan',
        steps_used: steps,
        searches_used: searchesUsedTask
      }, workerId);

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
      plan = planned.value;
      lastProvider = planned.provider;
      lastModel = planned.model;
      anyFallback = anyFallback || planned.fallback;
      await transition(taskId, ['planning'], { plan, model_used: planned.model, model_mode: modelMode, model: modelOverride, steps_used: steps }, workerId);
      await session.appendStep('planning.plan', { plan });

      messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
        { role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` }
      ];
      session.state.messages = messages;
      session.state.plan = plan;
      session.state.lastProvider = lastProvider;
      session.state.lastModel = lastModel;
      session.state.anyFallback = anyFallback;
      session.state.stage = 'research';
      await session.checkpoint();
      await session.transition('EXECUTING');
    } else {
      // Resume path: restore the message thread captured at the recovery point.
      messages = Array.isArray(session.state.messages) && session.state.messages.length > 0
        ? (session.state.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[])
        : [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
          { role: 'assistant', content: `Plan: ${JSON.stringify(plan)}` }
        ];
    }

    // Research loop — skipped when resuming past the research stage.
    if (!resumed || session.state.stage === 'research') {
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
        }, workerId);

        await assertRunning(taskId);
        const step = await chatWithFallback(messages, [openAiWebSearchTool], { stage: 'research', ...routeOpts });
        lastProvider = step.provider;
        lastModel = step.model;
        anyFallback = anyFallback || step.fallback;
        steps += 1;
        await transition(taskId, ACTIVE_STATUSES, {
          model_used: lastModel,
          steps_used: steps,
          searches_used: searchesUsedTask
        }, workerId);

        const message = step.response.choices[0]?.message;
        if (!message) throw new Error('AI returned an empty response.');
        messages.push(message);

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          draft = message.content ?? '';
          session.state.draft = draft;
          await session.checkpoint();
          break;
        }

        for (const toolCall of toolCalls) {
          const isWebSearch = toolCall.type === 'function' && toolCall.function.name === 'web_search';
          const rawArguments = toolCall.type === 'function' ? (toolCall.function.arguments ?? '') : '';
          if (!isWebSearch) {
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: { raw: rawArguments }, error: 'Unknown tool requested.', riskLevel: 'low', policyDecision: { outcome: 'deny', reason: 'unknown tool' } });
            messages.push(toolReply(toolCall.id, { error: 'Unknown tool requested.' }));
            continue;
          }
          if (!canSearchThisTask) {
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: { raw: rawArguments }, error: `Search limit of ${env.MAX_SEARCHES} reached for this task.`, riskLevel: 'low', policyDecision: { outcome: 'deny', reason: 'task limit' } });
            messages.push(toolReply(toolCall.id, { error: `Search limit of ${env.MAX_SEARCHES} reached for this task.` }));
            continue;
          }
          await assertRunning(taskId);

          let rawArgs: unknown;
          try {
            rawArgs = JSON.parse(rawArguments || '{}');
          } catch {
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: { raw: rawArguments }, error: 'Invalid search arguments.', riskLevel: 'low', policyDecision: { outcome: 'deny', reason: 'invalid arguments' } });
            messages.push(toolReply(toolCall.id, { error: 'Invalid search arguments. Provide valid JSON with a non-empty query string.' }));
            continue;
          }
          const parsed = webSearchArgsSchema.safeParse(rawArgs);
          if (!parsed.success) {
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: { raw: toolCall.function.arguments }, error: 'Invalid search arguments.', riskLevel: 'low', policyDecision: { outcome: 'deny', reason: 'invalid arguments' } });
            messages.push(toolReply(toolCall.id, { error: 'Invalid search arguments. Provide a non-empty query string.' }));
            continue;
          }

          // Policy gate: the model's tool request only executes after the shared
          // PolicyEngine approves it. Denied/approval-required requests are fed
          // back to the model as tool errors — never executed.
          const policyDecision = workerPolicy.evaluate(webSearchTool, workerAgent, policyCheckForSearch(userId));
          if (policyDecision.outcome !== 'approve') {
            const reason = policyDecision.outcome === 'deny' ? policyDecision.reason : `Approval required: ${policyDecision.reason}`;
            logger.warn('search_policy_denied', { task_id: taskId, outcome: policyDecision.outcome });
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: parsed.data, policyDecision, error: `Search blocked by policy. ${reason}`, riskLevel: 'low' });
            messages.push(toolReply(toolCall.id, { error: `Search blocked by policy. ${reason}` }));
            continue;
          }

          const quota = await incrementSearchUsage(userId, env.DAILY_SEARCH_LIMIT);
          if (quota.over) {
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: parsed.data, policyDecision, error: 'Daily search quota reached.', riskLevel: 'low' });
            messages.push(toolReply(toolCall.id, { error: 'Daily search quota reached. Stop searching and synthesize from what you have.' }));
            continue;
          }

          await assertRunning(taskId);
          const startedAt = Date.now();
          const searchOutcome = await webSearchTool.execute(parsed.data, { runId: taskId, taskId, agentId: 'researcher', userId });
          const latencyMs = Date.now() - startedAt;
          if (searchOutcome.ok) {
            searchesUsedTask += 1;
            sources = collectSources(sources, searchOutcome.data);
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: parsed.data, output: searchOutcome.data, policyDecision, riskLevel: 'low', latencyMs });
            await session.appendStep('research.search', { query: parsed.data.query }, searchOutcome.data);
            messages.push(toolReply(toolCall.id, searchOutcome.data));
          } else {
            const message = searchOutcome.error;
            if (isProbablyRateLimited(message)) logger.warn('search_rate_limited', { task_id: taskId });
            else logger.warn('search_failed', { task_id: taskId, query: parsed.data.query }, new Error(message));
            await session.recordToolCall({ toolId: 'web_search', stepId: null, input: parsed.data, policyDecision, error: message, riskLevel: 'low', latencyMs });
            messages.push(toolReply(toolCall.id, { error: message }));
          }
        }

        session.state.messages = messages;
        session.state.sources = sources;
        session.state.searchesUsedTask = searchesUsedTask;
        session.state.steps = steps;
        session.state.stage = 'research';
        await session.checkpoint();

        if (!draft && steps >= env.MAX_STEPS) {
          draft = 'Research reached the maximum number of steps. The agent could not produce a final answer within the allowed budget.';
          session.state.draft = draft;
          await session.checkpoint();
          break;
        }
      }

      if (!draft) {
        await assertRunning(taskId);
        session.state.stage = 'synthesis';
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
        session.state.draft = draft;
        session.state.messages = messages;
        session.state.sources = sources;
        session.state.searchesUsedTask = searchesUsedTask;
        session.state.steps = steps;
        session.state.stage = 'verifying';
        await session.appendStep('synthesis.draft', undefined, draft, lastModel);
        await session.checkpoint();
      }
    }

    // Verification — always runs (fresh or resumed at any stage).
    await assertRunning(taskId);
    await session.transition('VERIFYING');
    await transition(taskId, ACTIVE_STATUSES, {
      status: 'verifying',
      current_step: 'Verifying the answer',
      steps_used: steps
    }, workerId);

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
    }, workerId);

    await session.appendStep('verifying.result', { verification: verification.value }, result, lastModel);
    await session.finish({
      result,
      sources: sources.map((s) => s.url),
      searches: searchesUsedTask,
      steps: steps + 1,
      model: lastModel,
      provider: lastProvider || null,
      fallback_used: anyFallback,
      verification: verification.value
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
      try {
        await session.cancel();
      } catch (cancelErr) {
        logger.warn('run_cancel_failed', { task_id: taskId }, cancelErr);
      }
      logger.info('task_cancelled', { task_id: taskId });
      return;
    }
    const errorMessage = e instanceof Error ? e.message : 'Unknown agent error';
    logger.error('task_failed', { task_id: taskId }, e);
    try {
      await session.fail(errorMessage.slice(0, MAX_ERROR_LENGTH));
    } catch (failErr) {
      logger.warn('run_failed_mark', { task_id: taskId }, failErr);
    }
    try {
      if (workerId) await markFailed(taskId, errorMessage.slice(0, MAX_ERROR_LENGTH), workerId);
      else await markFailed(taskId, errorMessage.slice(0, MAX_ERROR_LENGTH));
    } catch (failErr) {
      logger.warn('task_failed_mark_failed', { task_id: taskId }, failErr);
    }
  } finally {
    clearCancellation(taskId);
  }
}