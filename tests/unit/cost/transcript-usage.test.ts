import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  addTokenUsage,
  emptyTokenUsage,
  readTranscriptUsage,
  scanTranscriptLines,
} from '@/cost/transcript-usage.js';

// Issue #639, Parts 13 and 23: the host's own token usage, read from a Claude Code transcript.
// A message is written as several lines that repeat one usage object under one message id, so the
// reader must count each message once.

const roots: string[] = [];
function tempFile(lines: string[], trailingNewline = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-transcript-usage-'));
  roots.push(dir);
  const path = join(dir, 'agent.jsonl');
  writeFileSync(path, lines.join('\n') + (trailingNewline ? '\n' : ''), 'utf8');
  return path;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface UsageInput {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  split?: { m5: number; h1: number };
}

function assistant(
  id: string,
  usage: UsageInput,
  options: { model?: string; at?: string; block?: string } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: options.at ?? '2026-10-19T10:00:00.000Z',
    message: {
      id,
      model: options.model ?? 'claude-opus-5-5',
      role: 'assistant',
      content: [{ type: options.block ?? 'text', text: 'x' }],
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
        ...(usage.split
          ? {
              cache_creation: {
                ephemeral_5m_input_tokens: usage.split.m5,
                ephemeral_1h_input_tokens: usage.split.h1,
              },
            }
          : {}),
      },
    },
  });
}

const USER = JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } });

describe('readTranscriptUsage (#639 Parts 13 and 23)', () => {
  it('counts a message written over several lines once, by message id', () => {
    const path = tempFile([
      USER,
      assistant(
        'msg_1',
        { input: 2, output: 8, cacheRead: 4760, cacheWrite: 15741 },
        { block: 'thinking' },
      ),
      assistant(
        'msg_1',
        { input: 2, output: 8, cacheRead: 4760, cacheWrite: 15741 },
        { block: 'tool_use' },
      ),
      assistant('msg_2', { input: 1, output: 300, cacheRead: 20000 }),
    ]);
    const usage = readTranscriptUsage(path);
    expect(usage.messages.map((message) => message.id)).toEqual(['msg_1', 'msg_2']);
    expect(usage.totals).toEqual({
      input: 3,
      output: 308,
      cache_read: 24760,
      cache_write: 15741,
      cache_write_5m: 0,
      cache_write_1h: 0,
      total: 3 + 308 + 24760 + 15741,
    });
  });

  it('keeps the largest figure when the repeated lines of one message disagree', () => {
    const path = tempFile([
      assistant('msg_1', { input: 5, output: 8 }),
      assistant('msg_1', { input: 5, output: 420 }),
    ]);
    expect(readTranscriptUsage(path).totals.output).toBe(420);
  });

  it('reads the 5 minute and 1 hour cache write split when the host reports it', () => {
    const path = tempFile([
      assistant('msg_1', { cacheWrite: 1500, split: { m5: 1000, h1: 500 } }),
      assistant('msg_2', { cacheWrite: 200 }),
    ]);
    const { totals } = readTranscriptUsage(path);
    expect(totals.cache_write).toBe(1700);
    expect(totals.cache_write_5m).toBe(1000);
    expect(totals.cache_write_1h).toBe(500);
  });

  it('groups usage by model, with a message that names no model under unknown', () => {
    const path = tempFile([
      assistant('msg_1', { input: 10, output: 20 }, { model: 'claude-opus-5-5' }),
      assistant('msg_2', { input: 1, output: 2 }, { model: 'claude-haiku-5-5' }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_3', usage: { input_tokens: 7 } } }),
    ]);
    const { by_model: byModel } = readTranscriptUsage(path);
    expect(Object.keys(byModel).sort()).toEqual(['claude-haiku-5-5', 'claude-opus-5-5', 'unknown']);
    expect(byModel['claude-opus-5-5']!.total).toBe(30);
    expect(byModel.unknown!.input).toBe(7);
  });

  it('skips a line that is not JSON, counts it, and never throws', () => {
    const path = tempFile([
      '{not json',
      assistant('msg_1', { input: 4, output: 6 }),
      'garbage',
      JSON.stringify({ type: 'assistant', message: { id: 'msg_x' } }),
      JSON.stringify({ type: 'system', message: { id: 'msg_y', usage: { input_tokens: 9 } } }),
      '',
    ]);
    const usage = readTranscriptUsage(path);
    expect(usage.bad_lines).toBe(2);
    expect(usage.totals.total).toBe(10);
    expect(usage.messages).toHaveLength(1);
  });

  it('ignores negative, fractional and non-number counts honestly', () => {
    const path = tempFile([
      JSON.stringify({
        type: 'assistant',
        message: {
          id: 'msg_1',
          usage: { input_tokens: -5, output_tokens: 3.9, cache_read_input_tokens: 'x' },
        },
      }),
    ]);
    expect(readTranscriptUsage(path).totals).toEqual({ ...emptyTokenUsage(), output: 3, total: 3 });
  });

  it('reads a missing file as no usage, keeping the stored offset', () => {
    const usage = readTranscriptUsage(join(tmpdir(), 'paqad-no-such-transcript.jsonl'), {
      fromOffset: 42,
    });
    expect(usage.messages).toEqual([]);
    expect(usage.totals.total).toBe(0);
    expect(usage.end_offset).toBe(42);
  });

  it('reads only the bytes appended since a stored offset', () => {
    const path = tempFile([assistant('msg_1', { input: 10, output: 10 })]);
    const first = readTranscriptUsage(path);
    expect(first.totals.total).toBe(20);
    appendFileSync(path, assistant('msg_2', { input: 1, output: 1 }) + '\n');
    const next = readTranscriptUsage(path, { fromOffset: first.end_offset });
    expect(next.messages.map((message) => message.id)).toEqual(['msg_2']);
    expect(next.totals.total).toBe(2);
    const whole = readTranscriptUsage(path);
    expect(first.totals.total + next.totals.total).toBe(whole.totals.total);
  });

  it('leaves an unfinished last line for the next read, but counts a whole one', () => {
    const partial = tempFile(
      [assistant('msg_1', { input: 1 }), '{"type":"assistant","mess'],
      false,
    );
    const usage = readTranscriptUsage(partial);
    expect(usage.messages).toHaveLength(1);
    expect(usage.bad_lines).toBe(0);
    const firstLineBytes = Buffer.byteLength(assistant('msg_1', { input: 1 }) + '\n');
    expect(usage.end_offset).toBe(firstLineBytes);

    const whole = tempFile(
      [assistant('msg_1', { input: 1 }), assistant('msg_2', { input: 2 })],
      false,
    );
    const read = readTranscriptUsage(whole);
    expect(read.messages).toHaveLength(2);
    expect(read.end_offset).toBe(
      Buffer.byteLength(
        [assistant('msg_1', { input: 1 }), assistant('msg_2', { input: 2 })].join('\n'),
      ),
    );
  });

  it('streams across chunk boundaries, multi-byte text included, with the same result', () => {
    const lines = [
      assistant('msg_1', { input: 3, output: 4 }),
      JSON.stringify({ type: 'user', message: { content: 'naïve café ✓ ünïcödé' } }),
      assistant('msg_2', { input: 5, output: 6 }),
    ];
    const path = tempFile(lines);
    const small = readTranscriptUsage(path, { chunkBytes: 7 });
    const big = readTranscriptUsage(path);
    expect(small.totals).toEqual(big.totals);
    expect(small.bad_lines).toBe(0);
    expect(small.end_offset).toBe(big.end_offset);
  });

  it('counts only messages inside a since/until window', () => {
    const path = tempFile([
      assistant('msg_1', { input: 1 }, { at: '2026-10-19T09:00:00.000Z' }),
      assistant('msg_2', { input: 10 }, { at: '2026-10-19T10:00:00.000Z' }),
      assistant('msg_3', { input: 100 }, { at: '2026-10-19T11:00:00.000Z' }),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'msg_4', usage: { input_tokens: 1000 } },
      }),
    ]);
    const usage = readTranscriptUsage(path, {
      since: '2026-10-19T09:30:00.000Z',
      until: '2026-10-19T10:30:00.000Z',
    });
    expect(usage.totals.input).toBe(10);
    // A bad bound is ignored rather than dropping everything.
    expect(readTranscriptUsage(path, { since: 'not a date' }).totals.input).toBe(1111);
  });

  it('adds two usage objects field by field', () => {
    const a = { ...emptyTokenUsage(), input: 1, cache_write: 2, cache_write_1h: 2, total: 3 };
    expect(addTokenUsage(a, a)).toEqual({
      ...a,
      input: 2,
      cache_write: 4,
      cache_write_1h: 4,
      total: 6,
    });
  });

  it('scanTranscriptLines throws on a missing file so callers can tell it from an empty one', () => {
    expect(() => scanTranscriptLines(join(tmpdir(), 'paqad-missing.jsonl'), () => {})).toThrow();
  });
});
