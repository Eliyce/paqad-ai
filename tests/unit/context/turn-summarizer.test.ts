import { describe, expect, it } from 'vitest';

import { TurnSummarizer, type InferenceMessage, type InferenceProvider } from '@/context/index.js';
import type { SummarisationMessage } from '@/core/types/context.js';

/** Provider stub that replays a scripted sequence of responses. */
class StubProvider implements InferenceProvider {
  readonly calls: InferenceMessage[][] = [];
  private readonly script: Array<string | Error | 'hang'>;

  constructor(script: Array<string | Error | 'hang'>) {
    this.script = [...script];
  }

  complete(messages: InferenceMessage[]): Promise<string> {
    this.calls.push(messages);
    const next = this.script.shift() ?? '';
    if (next === 'hang') {
      return new Promise<string>(() => {
        /* never resolves — exercises the timeout/cancel path */
      });
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    return Promise.resolve(next);
  }
}

function turn(
  role: SummarisationMessage['role'],
  content: string,
  turn_id: string,
  extra: Partial<SummarisationMessage> = {},
): SummarisationMessage {
  return { role, content, turn_id, ...extra };
}

const EIGHT_TURNS: SummarisationMessage[] = [
  turn('user', 'hi', 't1'),
  turn('assistant', 'hello', 't2'),
  turn('user', 'how do I add auth', 't3'),
  turn('assistant', 'use sessions', 't4'),
  turn('user', 'what about tokens', 't5'),
  turn('assistant', 'JWT works too', 't6'),
  turn('user', 'thanks', 't7'),
  turn('assistant', 'welcome', 't8'),
];

const NORMAL_SUMMARY =
  'user said they wanted auth; assistant replied to use sessions or JWT tokens.';

describe('TurnSummarizer.summarise', () => {
  const summarizer = new TurnSummarizer();

  it('AC1: attributes speakers and reports token counts + valid_through_turn_id', async () => {
    const provider = new StubProvider([NORMAL_SUMMARY]);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary_text).toContain('user said');
    expect(result.summary_text).toContain('assistant replied');
    expect(result.input_token_count).toBeGreaterThan(0);
    expect(result.summary_token_count).toBeGreaterThan(0);
    expect(result.valid_through_turn_id).toBe('t8');
    expect(result.truncated).toBe(false);
    expect(result.preserved_turn_ids).toEqual([]);
    // The base prompt carries PII-redaction instructions into the inference call.
    expect(provider.calls[0][0].role).toBe('system');
    expect(provider.calls[0][0].content).toMatch(/PII/i);
  });

  it('AC2: re-issues with a stricter prompt then truncates at the 2000-token cap', async () => {
    const tooLong = 'a'.repeat(9000); // 2250 estimated tokens
    const provider = new StubProvider([tooLong, tooLong]);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(provider.calls).toHaveLength(2); // first + stricter retry
    expect(result.truncated).toBe(true);
    expect(result.summary_token_count).toBeLessThanOrEqual(2000);
  });

  it('AC2: a stricter retry that fits the cap is used without truncation', async () => {
    const provider = new StubProvider(['a'.repeat(9000), NORMAL_SUMMARY]);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(provider.calls).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.summary_text).toBe(NORMAL_SUMMARY);
  });

  it('AC2: an empty stricter retry falls back to truncating the over-length response', async () => {
    const provider = new StubProvider(['a'.repeat(9000), '']);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.truncated).toBe(true);
    expect(result.summary_token_count).toBeLessThanOrEqual(2000);
  });

  it('AC3: folds a prior summary into the inference input and extends the range', async () => {
    const provider = new StubProvider([NORMAL_SUMMARY]);
    const newTurns = [turn('user', 'one more thing', 't9'), turn('assistant', 'sure', 't10')];

    const result = await summarizer.summarise(newTurns, 500, {
      inferenceProvider: provider,
      priorSummary: { text: 'EARLIER_SUMMARY_MARKER', valid_through_turn_id: 't8' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.valid_through_turn_id).toBe('t10');
    const userMessage = provider.calls[0].find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('EARLIER_SUMMARY_MARKER');
  });

  it('AC3: with no new collapsible turns, the prior range is retained', async () => {
    const provider = new StubProvider([NORMAL_SUMMARY]);
    const onlyProtected = [turn('user', 'approve?', 'p1', { approval_turn: true })];

    const result = await summarizer.summarise(onlyProtected, 500, {
      inferenceProvider: provider,
      priorSummary: { text: 'PRIOR', valid_through_turn_id: 't8' },
    });

    expect(result.ok && result.valid_through_turn_id).toBe('t8');
    expect(result.ok && result.preserved_turn_ids).toEqual(['p1']);
  });

  it('AC4: excludes protected turns and records their ids', async () => {
    const provider = new StubProvider([NORMAL_SUMMARY]);
    const messages = [
      turn('user', 'normal turn', 't1'),
      turn('assistant', 'DECISION_CONTENT', 'd1', { decision_packet: true }),
      turn('user', 'APPROVAL_CONTENT', 'a1', { approval_turn: true }),
      turn('assistant', 'another normal', 't2'),
    ];

    const result = await summarizer.summarise(messages, 500, { inferenceProvider: provider });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preserved_turn_ids).toEqual(['d1', 'a1']);
    expect(result.valid_through_turn_id).toBe('t2');
    const userMessage = provider.calls[0].find((m) => m.role === 'user');
    expect(userMessage?.content).not.toContain('DECISION_CONTENT');
    expect(userMessage?.content).not.toContain('APPROVAL_CONTENT');
  });

  it('AC5: retries once on an empty body, then fails explicitly', async () => {
    const provider = new StubProvider(['', '']);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result).toEqual({ ok: false, error: 'inference-failed' });
    expect(provider.calls).toHaveLength(2);
  });

  it('AC5: an empty first body then a usable retry succeeds', async () => {
    const provider = new StubProvider(['', NORMAL_SUMMARY]);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });

    expect(result.ok && result.summary_text).toBe(NORMAL_SUMMARY);
    expect(provider.calls).toHaveLength(2);
  });

  it('fails gracefully (does not throw) when no provider is supplied', async () => {
    const result = await summarizer.summarise(EIGHT_TURNS, 500);
    expect(result).toEqual({ ok: false, error: 'inference-failed' });
  });

  it('returns inference-failed when the provider throws a non-abort error', async () => {
    const provider = new StubProvider([new Error('boom')]);
    const result = await summarizer.summarise(EIGHT_TURNS, 500, { inferenceProvider: provider });
    expect(result).toEqual({ ok: false, error: 'inference-failed' });
  });

  it('returns a timeout failure when the call exceeds the deadline', async () => {
    const provider = new StubProvider(['hang']);
    const result = await summarizer.summarise(EIGHT_TURNS, 500, {
      inferenceProvider: provider,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });

  it('returns cancelled for an already-aborted signal', async () => {
    const provider = new StubProvider([NORMAL_SUMMARY]);
    const result = await summarizer.summarise(EIGHT_TURNS, 500, {
      inferenceProvider: provider,
      signal: AbortSignal.abort(),
    });
    expect(result).toEqual({ ok: false, error: 'cancelled' });
    expect(provider.calls).toHaveLength(0);
  });

  it('returns cancelled when the caller aborts mid-flight', async () => {
    const provider = new StubProvider(['hang']);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await summarizer.summarise(EIGHT_TURNS, 500, {
      inferenceProvider: provider,
      signal: controller.signal,
      timeoutMs: 1000,
    });
    expect(result).toEqual({ ok: false, error: 'cancelled' });
  });
});

describe('TurnSummarizer.summarize (legacy heuristic path)', () => {
  it('still returns a valid SummarizedTurn with an unchanged shape', () => {
    const summarizer = new TurnSummarizer();
    const result = summarizer.summarize(
      'We decided to use Postgres. Next step: wire the schema.',
      0,
      '2024-01-01T00:00:00Z',
    );

    expect(result.turn_index).toBe(0);
    expect(result.timestamp).toBe('2024-01-01T00:00:00Z');
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.files_touched)).toBe(true);
    expect(Array.isArray(result.blockers)).toBe(true);
    expect(Array.isArray(result.next_steps)).toBe(true);
    expect(result.original_tokens).toBeGreaterThan(0);
    expect(result.summary_tokens).toBeGreaterThan(0);
  });
});
