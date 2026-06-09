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
import { resolveActiveLineage } from './conversation-lineage.js';
import type { RebuildCache } from './rebuild-cache.js';
import { TurnSummarizer } from './turn-summarizer.js';

// PQD-171 Step 3 — deterministic per-turn API-conversation rebuild.
//
// Reshapes a display conversation into the clean API conversation for the next
// turn: active branch only, summarised-then-truncated to fit the model window,
// with retrieved chunks inserted at the budgeted position. Pure apart from the
// optional audit-event write; the same inputs always yield the same result.

/** Recent turns kept verbatim when summarising older history under pressure. */
const KEEP_RECENT_TURNS = 2;

/** Inputs to {@link rebuildApiConversation}. */
export interface RebuildInput {
  /** Full persisted conversation (stopped/edited/branched messages included). */
  displayMessages: DisplayMessage[];
  /** Classifier signals that drive retrieval and budgeting. */
  classifierOutput: Pick<ClassificationResult, 'retrieval_needed' | 'context_budget_hint'>;
  /** Chunks to fold in when `classifierOutput.retrieval_needed` is true. */
  retrievedChunks?: { chunkId: string; content: string }[];
  /** Token budget for the next turn (the model window from the budget enforcer). */
  budgetTokens: number;
  /** Token estimator + (legacy) summariser; defaults to a fresh instance. */
  summarizer?: TurnSummarizer;
  /** Compresses older turns before truncation; absent ⇒ straight to truncation. */
  optimizer?: ContextBudgetOptimizer;
  /** When provided, a hit skips the classifier and budget passes entirely. */
  cache?: RebuildCache;
  /** When set, a truncation also writes a durable `context.truncated` event. */
  audit?: { projectRoot: string; sessionId: string };
}

/**
 * Rebuild the API conversation for the next turn from a display conversation.
 *
 * Excludes stopped and discarded turns, follows only the active branch, and —
 * when the active branch plus retrieval exceeds `budgetTokens` — first compresses
 * older turns via the optimizer, then drops the oldest turns and reports
 * `truncated`. Retrieved chunks are inserted after any leading system context.
 *
 * Throws {@link RebuildFailedError} (no retry) when `budgetTokens` is malformed
 * or the optimizer throws.
 */
export async function rebuildApiConversation(
  input: RebuildInput,
): Promise<ConversationRebuildResult> {
  const { budgetTokens } = input;

  // Malformed budget breakdown ⇒ structured failure, never a retry (AC5).
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

  // 1. Active branch only, chronological.
  const lineage = resolveActiveLineage(input.displayMessages);

  // 2. Retrieval counts toward the window (history + retrieval combined).
  const retrievalNeeded = input.classifierOutput.retrieval_needed === true;
  const chunks = retrievalNeeded ? (input.retrievedChunks ?? []) : [];
  const retrievalTokens = chunks.reduce(
    (sum, chunk) => sum + summarizer.estimateTokens(chunk.content),
    0,
  );
  const historyBudget = budgetTokens - retrievalTokens;

  const overBudget = (msgs: DisplayMessage[]): boolean =>
    estimateMessagesTokens(summarizer, msgs) > historyBudget;

  // 3a. Compress older turns first when an optimizer is available.
  let working = lineage.slice();
  if (overBudget(working) && input.optimizer && working.length > KEEP_RECENT_TURNS) {
    working = await summariseOlderTurns(input.optimizer, working);
  }

  // 3b. Truncate the oldest turns if still over (keep at least the newest).
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

  // 4. Map to API messages and insert retrieval after leading system context.
  const messages: ApiMessage[] = working.map(toApiMessage);
  const retrievedChunkIds: string[] = [];
  if (chunks.length > 0) {
    const refs = insertRetrieval(messages, chunks);
    for (const ref of refs) {
      retrievedChunkIds.push(ref.chunkId);
    }
  }

  const result: ConversationRebuildResult = {
    messages,
    retrievedChunkIds,
    truncated,
    truncatedTurnCount,
  };

  // 5. Durable audit signal (the synchronous flag is always on the result).
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

/** Replace all-but-the-newest turns with one attributed summary message. */
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

/** Compact, deterministic system message standing in for the collapsed turns. */
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

/** Insert one system message carrying the chunks after any leading system context. */
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
