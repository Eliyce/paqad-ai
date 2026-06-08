import type {
  SummarisationMessage,
  SummariseFailure,
  SummariseResult,
  SummarizedTurn,
} from '../core/types/context.js';

import type { InferenceMessage, InferenceProvider } from './inference-provider.js';

/** Hard cap on the summary size (best-effort, char/4 estimate). */
const SUMMARY_TOKEN_CAP = 2000;

/** Default inference deadline (AC: 30-second timeout). */
const DEFAULT_TIMEOUT_MS = 30_000;

const BASE_SYSTEM_PROMPT = [
  'You compress an older slice of a conversation into a faithful rolling summary.',
  'Attribute every collapsed turn explicitly: prefix each user turn with "user said"',
  'and each assistant turn with "assistant replied". Preserve decisions, blockers,',
  'and next steps. Redact any PII (names, emails, phone numbers, secrets) — never',
  `echo it back. Keep the summary under ${SUMMARY_TOKEN_CAP} tokens.`,
].join(' ');

const STRICT_SYSTEM_PROMPT = [
  BASE_SYSTEM_PROMPT,
  'CRITICAL: your previous attempt was too long. Be much terser — collapse',
  'aggressively and stay well under the token cap while keeping the attribution tags.',
].join(' ');

const ALT_SYSTEM_PROMPT = [
  'Summarise the conversation slice below as a bulleted recap.',
  'Tag each collapsed turn with "user said" or "assistant replied".',
  'Drop all PII. Be concise.',
].join(' ');

/** Options for {@link TurnSummarizer.summarise}. */
export interface SummariseOptions {
  /** Prior rolling summary to fold in (the summarise-the-summary path, AC3). */
  priorSummary?: { text: string; valid_through_turn_id: string };
  /** Workspace model-tier preference forwarded to the provider's selection. */
  summaryModelPreference?: 'local' | 'cheapest' | 'default';
  /** Cancellation signal; already-aborted yields a `cancelled` failure. */
  signal?: AbortSignal;
  /** Provider that performs the actual inference; absent ⇒ graceful failure. */
  inferenceProvider?: InferenceProvider;
  /** Inference deadline; defaults to the 30-second contract. Mainly for tests. */
  timeoutMs?: number;
}

export class TurnSummarizer {
  summarize(turnText: string, turnIndex: number, timestamp: string): SummarizedTurn {
    const summarized: SummarizedTurn = {
      turn_index: turnIndex,
      timestamp,
      decisions: this.extractDecisions(turnText).slice(0, 3),
      files_touched: this.extractFilesTouched(turnText),
      blockers: this.extractBlockers(turnText).slice(0, 2),
      next_steps: this.extractNextSteps(turnText).slice(0, 2),
      original_tokens: this.estimateTokens(turnText),
      summary_tokens: 0,
    };

    summarized.summary_tokens = this.estimateTokens(JSON.stringify(summarized));
    return summarized;
  }

  private extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    const patterns = [
      /(?:decided to|chose|going with|will use|using)\s+([^.\n]{10,80})/gi,
      /(?:going to|selected|picked)\s+([^.\n]{10,80})/gi,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        decisions.push(match[1].trim());
      }
    }
    return [...new Set(decisions)];
  }

  private extractFilesTouched(text: string): string[] {
    const files: string[] = [];
    const filePattern = /(?:src|app|lib|tests?|routes?|config|docs?)\/[\w/.-]+\.\w{1,6}/g;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      files.push(match[0]);
    }
    return [...new Set(files)];
  }

  private extractBlockers(text: string): string[] {
    const blockers: string[] = [];
    const pattern =
      /(?:blocked by|waiting on|can't proceed|cannot proceed|error:)\s+([^.\n]{5,100})/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      blockers.push(match[1].trim());
    }
    return blockers;
  }

  private extractNextSteps(text: string): string[] {
    const steps: string[] = [];
    const pattern = /(?:next step|next:|remaining:|TODO:|- \[ \])\s*([^.\n]{5,100})/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      steps.push(match[1].trim());
    }
    return steps;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Collapse older user+assistant turns into a single attributed rolling summary
   * via an injected {@link InferenceProvider} (PQD-169).
   *
   * Protected turns (`decision_packet`/`approval_turn`) are excluded from the
   * collapsed span and reported in `preserved_turn_ids`. A `priorSummary` is
   * folded in to summarise-the-summary. The result never exceeds the 2,000-token
   * cap: an over-length response is re-issued with a stricter prompt and, if
   * still over, truncated with `truncated: true`. An empty/malformed body is
   * retried once with an alternate template before failing. Timeouts (30 s),
   * cancellation, and a missing provider all return an explicit, non-partial
   * failure result so the caller can fall back without losing the prior summary.
   *
   * Token counts are best-effort (character/4); the cap is approximate.
   */
  async summarise(
    messages: SummarisationMessage[],
    targetTokenCount: number,
    opts: SummariseOptions = {},
  ): Promise<SummariseResult> {
    const provider = opts.inferenceProvider;
    if (!provider) {
      return { ok: false, error: 'inference-failed' };
    }
    if (opts.signal?.aborted) {
      return { ok: false, error: 'cancelled' };
    }

    const preserved_turn_ids: string[] = [];
    const collapsible: SummarisationMessage[] = [];
    for (const message of messages) {
      if (message.decision_packet || message.approval_turn) {
        preserved_turn_ids.push(message.turn_id);
      } else {
        collapsible.push(message);
      }
    }

    const valid_through_turn_id =
      collapsible.at(-1)?.turn_id ?? opts.priorSummary?.valid_through_turn_id ?? '';

    const segments: string[] = [];
    if (opts.priorSummary) {
      segments.push(`Prior summary:\n${opts.priorSummary.text}`);
    }
    for (const message of collapsible) {
      segments.push(`${message.role}: ${message.content}`);
    }
    const inputText = segments.join('\n');
    const input_token_count = this.estimateTokens(inputText);
    const targetInstruction = `Aim for roughly ${Math.max(0, targetTokenCount)} tokens.`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // First attempt; an empty/malformed body is retried once with an alternate
    // template before we give up (AC5).
    const first = await this.invoke(
      provider,
      `${BASE_SYSTEM_PROMPT} ${targetInstruction}`,
      inputText,
      timeoutMs,
      opts.signal,
    );
    if (!first.ok) {
      return first;
    }
    let summaryText = first.text;
    if (!isUsable(summaryText)) {
      const retry = await this.invoke(
        provider,
        `${ALT_SYSTEM_PROMPT} ${targetInstruction}`,
        inputText,
        timeoutMs,
        opts.signal,
      );
      if (!retry.ok) {
        return retry;
      }
      if (!isUsable(retry.text)) {
        return { ok: false, error: 'inference-failed' };
      }
      summaryText = retry.text;
    }

    // Hard cap: re-issue with a stricter prompt, then truncate as a last resort (AC2).
    let truncated = false;
    summaryText = summaryText.trim();
    if (this.estimateTokens(summaryText) > SUMMARY_TOKEN_CAP) {
      const stricter = await this.invoke(
        provider,
        `${STRICT_SYSTEM_PROMPT} ${targetInstruction}`,
        inputText,
        timeoutMs,
        opts.signal,
      );
      if (!stricter.ok) {
        return stricter;
      }
      if (isUsable(stricter.text)) {
        summaryText = stricter.text.trim();
      }
      if (this.estimateTokens(summaryText) > SUMMARY_TOKEN_CAP) {
        summaryText = this.truncateToTokenCap(summaryText);
        truncated = true;
      }
    }

    return {
      ok: true,
      summary_text: summaryText,
      valid_through_turn_id,
      input_token_count,
      summary_token_count: this.estimateTokens(summaryText),
      truncated,
      preserved_turn_ids,
    };
  }

  /** Slice text down to the token cap using the char/4 estimate. */
  private truncateToTokenCap(text: string): string {
    return text.slice(0, SUMMARY_TOKEN_CAP * 4);
  }

  /**
   * Run one provider call under a merged timeout+cancellation signal. Classifies
   * the outcome so the caller only ever sees a typed success or failure.
   */
  private async invoke(
    provider: InferenceProvider,
    systemPrompt: string,
    inputText: string,
    timeoutMs: number,
    callerSignal?: AbortSignal,
  ): Promise<{ ok: true; text: string } | SummariseFailure> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

    const inferenceMessages: InferenceMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: inputText },
    ];

    try {
      const text = await raceAbort(
        provider.complete(inferenceMessages, { timeoutMs, signal }),
        signal,
      );
      return { ok: true, text };
    } catch {
      if (signal.aborted) {
        const reason = signal.reason as { name?: string } | undefined;
        return { ok: false, error: reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled' };
      }
      return { ok: false, error: 'inference-failed' };
    }
  }
}

function isUsable(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0;
}

/**
 * Reject as soon as `signal` aborts, even if `promise` never settles (a provider
 * that ignores the signal must still be abandonable at the deadline).
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
