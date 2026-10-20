import type { ClassificationResult } from '../core/types/classification.js';
import type {
  ApiMessage,
  ConversationRebuildResult,
  DisplayMessage,
  RetrievedChunkRef,
} from '../core/types/conversation.js';
import { RebuildFailedError } from '../core/types/conversation.js';
import type { SummarizedTurn } from '../core/types/context.js';
import { emitContextTruncated } from '../module-decisions/events.js';

import type { ContextBudgetOptimizer } from './budget-optimizer.js';
import { computeContextHash } from './context-hash.js';
import { resolveActiveLineage } from './conversation-lineage.js';
import type { RebuildCache } from './rebuild-cache.js';
import { TurnSummarizer } from './turn-summarizer.js';

const KEEP_RECENT_TURNS = 2;

export interface RebuildInput {
  displayMessages: DisplayMessage[];
  classifierOutput: Pick<ClassificationResult, 'retrieval_needed' | 'context_budget_hint'>;
  retrievedChunks?: { chunkId: string; content: string }[];
  budgetTokens: number;
  summarizer?: TurnSummarizer;
  optimizer?: ContextBudgetOptimizer;
  cache?: RebuildCache;
  audit?: { projectRoot: string; sessionId: string };
}

export async function rebuildApiConversation(
  input: RebuildInput,
): Promise<ConversationRebuildResult> {
  const { budgetTokens } = input;

  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) {
    throw new RebuildFailedError(`invalid budgetTokens: ${String(budgetTokens)}`);
  }

  const cache = input.cache;
  const cacheKey = cache
    ? cache.computeKey(input.displayMessages, {
        classifierOutput: input.classifierOutput,
        retrievedChunks: input.retrievedChunks ?? null,
        budgetTokens,
      })
    : undefined;
  if (cache) {
    const cached = cache.get(cacheKey as string);
    if (cached) {
      return cached;
    }
  }

  const summarizer = input.summarizer ?? new TurnSummarizer();

  const lineage = resolveActiveLineage(input.displayMessages);

  const retrievalNeeded = input.classifierOutput.retrieval_needed === true;
  const chunks = retrievalNeeded ? (input.retrievedChunks ?? []) : [];
  const retrievalTokens = chunks.reduce(
    (sum, chunk) => sum + summarizer.estimateTokens(chunk.content),
    0,
  );
  const historyBudget = budgetTokens - retrievalTokens;

  const overBudget = (msgs: DisplayMessage[]): boolean =>
    estimateMessagesTokens(summarizer, msgs) > historyBudget;

  let working = lineage.slice();
  if (overBudget(working) && input.optimizer && working.length > KEEP_RECENT_TURNS) {
    working = await summariseOlderTurns(input.optimizer, working);
  }

  let truncated = false;
  let truncatedTurnCount = 0;
  let tokensReclaimed = 0;
  while (overBudget(working) && working.length > 1) {
    const [dropped, ...rest] = working;
    tokensReclaimed += summarizer.estimateTokens(dropped.content);
    working = rest;
    truncated = true;
    truncatedTurnCount += 1;
  }

  const messages: ApiMessage[] = working.map(toApiMessage);
  const retrievedChunkIds: string[] = [];
  if (chunks.length > 0) {
    const refs = insertRetrieval(messages, chunks);
    for (const ref of refs) {
      retrievedChunkIds.push(ref.chunkId);
    }
  }

  const contextHash = computeContextHash({
    lineage,
    classifierOutput: input.classifierOutput,
    retrievedChunks: chunks,
    budgetTokens,
    summarizerMode: input.optimizer ? 'optimizer' : 'deterministic-regex',
    truncated,
    truncatedTurnCount,
  });

  const result: ConversationRebuildResult = {
    messages,
    retrievedChunkIds,
    truncated,
    truncatedTurnCount,
    contextHash,
  };

  if (truncated && input.audit) {
    emitContextTruncated(input.audit.projectRoot, {
      sessionId: input.audit.sessionId,
      turnsDropped: truncatedTurnCount,
      tokensReclaimed,
    });
  }

  if (cache) {
    cache.set(cacheKey as string, result);
  }

  return result;
}

async function summariseOlderTurns(
  optimizer: ContextBudgetOptimizer,
  working: DisplayMessage[],
): Promise<DisplayMessage[]> {
  const olderCount = working.length - KEEP_RECENT_TURNS;
  const older = working.slice(0, olderCount);
  let summaries: SummarizedTurn[];
  try {
    summaries = await optimizer.summarizeTurns(
      older.map((m) => ({ text: m.content, timestamp: m.createdAt })),
      olderCount,
    );
  } catch (error) {
    throw new RebuildFailedError(
      `summarisation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return [buildSummaryMessage(summaries, older), ...working.slice(olderCount)];
}

function estimateMessagesTokens(summarizer: TurnSummarizer, msgs: DisplayMessage[]): number {
  return msgs.reduce((sum, m) => sum + summarizer.estimateTokens(m.content), 0);
}

function toApiMessage(message: DisplayMessage): ApiMessage {
  return { role: message.role, content: message.content };
}

function buildSummaryMessage(
  summaries: SummarizedTurn[],
  originals: DisplayMessage[],
): DisplayMessage {
  const lines = summaries.map((summary, index) => {
    const parts: string[] = [];
    if (summary.decisions.length > 0) parts.push(`decisions: ${summary.decisions.join('; ')}`);
    if (summary.files_touched.length > 0) parts.push(`files: ${summary.files_touched.join(', ')}`);
    if (summary.blockers.length > 0) parts.push(`blockers: ${summary.blockers.join('; ')}`);
    if (summary.next_steps.length > 0) parts.push(`next: ${summary.next_steps.join('; ')}`);
    return `Turn ${index + 1}: ${parts.length > 0 ? parts.join(' | ') : '(no salient content)'}`;
  });
  const earliest = originals[0];
  return {
    id: `summary:${earliest.id}`,
    role: 'system',
    content: `Summary of ${summaries.length} earlier turns:\n${lines.join('\n')}`,
    createdAt: earliest.createdAt,
  };
}

function insertRetrieval(
  messages: ApiMessage[],
  chunks: { chunkId: string; content: string }[],
): RetrievedChunkRef[] {
  const firstNonSystem = messages.findIndex((m) => m.role !== 'system');
  const position = firstNonSystem === -1 ? messages.length : firstNonSystem;
  const content = `Retrieved context:\n${chunks.map((chunk) => chunk.content).join('\n\n')}`;
  messages.splice(position, 0, { role: 'system', content });
  return chunks.map((chunk) => ({ chunkId: chunk.chunkId, position }));
}
