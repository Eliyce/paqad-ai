import type {
  SummarisationMessage,
  SummariseFailure,
  SummariseResult,
  SummarizedTurn,
} from '../core/types/context.js';

import type { InferenceMessage, InferenceProvider } from './inference-provider.js';

const SUMMARY_TOKEN_CAP = 2000;

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

export interface SummariseOptions {
  priorSummary?: { text: string; valid_through_turn_id: string };
  summaryModelPreference?: 'local' | 'cheapest' | 'default';
  signal?: AbortSignal;
  inferenceProvider?: InferenceProvider;
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
    return [...new Set(findTouchedFilePaths(text))];
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

  private truncateToTokenCap(text: string): string {
    return text.slice(0, SUMMARY_TOKEN_CAP * 4);
  }

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

const TOUCHED_PATH_START = /(?:src|app|lib|tests?|routes?|config|docs?)\/[\w/.-]+/g;
const WORD_CHAR = /\w/;

export function findTouchedFilePaths(text: string): string[] {
  const files: string[] = [];
  TOUCHED_PATH_START.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOUCHED_PATH_START.exec(text)) !== null) {
    const run = match[0];
    const bodyStart = run.indexOf('/') + 1;
    const end = touchedPathEnd(run, bodyStart);
    if (end === -1) continue;
    files.push(run.slice(0, end));
    TOUCHED_PATH_START.lastIndex = match.index + end;
  }
  return files;
}

function touchedPathEnd(run: string, bodyStart: number): number {
  for (let dot = run.length - 2; dot > bodyStart; dot -= 1) {
    if (run[dot] !== '.' || !WORD_CHAR.test(run[dot + 1]!)) continue;
    let end = dot + 1;
    while (end < run.length && end - dot <= 6 && WORD_CHAR.test(run[end]!)) end += 1;
    return end;
  }
  return -1;
}
