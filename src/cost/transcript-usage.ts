// Read the host's own token usage out of a Claude Code transcript (issue #639, Parts 13 and 23).
//
// Claude Code writes one JSONL line per transcript event. An assistant message is written as
// several lines (one per content block: thinking, text, each tool call), and every one of those
// lines repeats the message's `usage` object under the same `message.id`. Summing every line
// would count a message two, three or more times, so usage is folded per message id first and
// summed after. When the repeated lines disagree (an early line can carry a smaller running
// `output_tokens`), the largest figure per field wins, which is the message's final count.
//
// The reader streams the file in fixed chunks, so a transcript of tens of megabytes is never
// held whole in memory, and it never throws on a bad line: a line that is not JSON is skipped and
// counted, and a JSON line that is not an assistant message with usage is skipped. It can start
// at a stored byte offset and returns the offset where it stopped, so a caller that stores the
// offset reads only what was appended since (Part 23). A trailing line with no newline that does
// not parse yet is left for the next read rather than counted as bad: the host may still be
// writing it.

import { closeSync, openSync, readSync } from 'node:fs';

/** Token counts by kind. `cache_write` is the whole cache write; the two TTL splits are a part of it. */
export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /** The 5 minute cache write, when the host reported the split (0 when it did not). */
  cache_write_5m: number;
  /** The 1 hour cache write, when the host reported the split (0 when it did not). */
  cache_write_1h: number;
  /** input + output + cache_read + cache_write. */
  total: number;
}

/** One assistant message's usage, counted once. */
export interface TranscriptUsageMessage {
  id: string;
  model: string | null;
  /** The time of the first line written for the message, or null when the line carried none. */
  timestamp: string | null;
  usage: TokenUsage;
}

export interface TranscriptUsage {
  totals: TokenUsage;
  /** Totals per model id; a message with no model is counted under `unknown`. */
  by_model: Record<string, TokenUsage>;
  /** Every counted message, in the order it first appeared. */
  messages: TranscriptUsageMessage[];
  /** The byte offset just past the last complete line read. Pass it back as `fromOffset`. */
  end_offset: number;
  /** Lines that were not JSON. Lines that are JSON but carry no usage are not counted here. */
  bad_lines: number;
}

export interface ReadTranscriptUsageOptions {
  /** Count only messages at or after this time (ISO 8601). */
  since?: string;
  /** Count only messages at or before this time (ISO 8601). */
  until?: string;
  /** Start reading at this byte offset (a value stored from an earlier read). */
  fromOffset?: number;
  /** Chunk size in bytes, injectable so a test can cross chunk boundaries. */
  chunkBytes?: number;
}

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const UNKNOWN_MODEL = 'unknown';

/** A usage object with every count at zero. */
export function emptyTokenUsage(): TokenUsage {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_write: 0,
    cache_write_5m: 0,
    cache_write_1h: 0,
    total: 0,
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function withTotal(usage: TokenUsage): TokenUsage {
  return {
    ...usage,
    total: usage.input + usage.output + usage.cache_read + usage.cache_write,
  };
}

/** Read one host `usage` object into token kinds. */
function usageFrom(raw: Record<string, unknown>): TokenUsage {
  const breakdown = asRecord(raw.cache_creation);
  return withTotal({
    input: count(raw.input_tokens),
    output: count(raw.output_tokens),
    cache_read: count(raw.cache_read_input_tokens),
    cache_write: count(raw.cache_creation_input_tokens),
    cache_write_5m: count(breakdown?.ephemeral_5m_input_tokens),
    cache_write_1h: count(breakdown?.ephemeral_1h_input_tokens),
    total: 0,
  });
}

/** The larger figure per field: the final count of a message written over several lines. */
export function maxTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return withTotal({
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cache_read: Math.max(a.cache_read, b.cache_read),
    cache_write: Math.max(a.cache_write, b.cache_write),
    cache_write_5m: Math.max(a.cache_write_5m, b.cache_write_5m),
    cache_write_1h: Math.max(a.cache_write_1h, b.cache_write_1h),
    total: 0,
  });
}

/** Add `b` into a copy of `a`. */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return withTotal({
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    cache_write_5m: a.cache_write_5m + b.cache_write_5m,
    cache_write_1h: a.cache_write_1h + b.cache_write_1h,
    total: 0,
  });
}

/** Parse one line, or `undefined` when it is not JSON. */
function parseLine(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Fold one parsed transcript event into the per-message map. */
function foldEvent(parsed: unknown, byId: Map<string, TranscriptUsageMessage>): void {
  const event = asRecord(parsed);
  const message = asRecord(event?.message);
  const rawUsage = asRecord(message?.usage);
  const id = typeof message?.id === 'string' && message.id.length > 0 ? message.id : null;
  if (event?.type !== 'assistant' || !rawUsage || !id) return;
  const usage = usageFrom(rawUsage);
  const existing = byId.get(id);
  if (existing) {
    existing.usage = maxTokenUsage(existing.usage, usage);
    return;
  }
  byId.set(id, {
    id,
    model: typeof message?.model === 'string' && message.model.length > 0 ? message.model : null,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : null,
    usage,
  });
}

function parseBound(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function inWindow(message: TranscriptUsageMessage, since?: number, until?: number): boolean {
  if (since === undefined && until === undefined) return true;
  const at = message.timestamp === null ? Number.NaN : Date.parse(message.timestamp);
  // A message with no readable time cannot be placed in a window, so a windowed read skips it.
  if (Number.isNaN(at)) return false;
  if (since !== undefined && at < since) return false;
  return until === undefined || at <= until;
}

/** Where a line scan stopped and how many lines were not JSON. */
export interface TranscriptScan {
  /** The byte offset just past the last complete line read. */
  endOffset: number;
  badLines: number;
}

export interface ScanTranscriptOptions {
  fromOffset?: number;
  chunkBytes?: number;
}

/**
 * Stream a JSONL transcript from `fromOffset`, handing each parsed line to `onEvent`. A line that
 * is not JSON is counted, never thrown; a trailing line with no newline is handed over only when
 * it already parses. Throws only on an I/O fault (a missing or unreadable file).
 */
export function scanTranscriptLines(
  path: string,
  onEvent: (event: unknown) => void,
  options: ScanTranscriptOptions = {},
): TranscriptScan {
  const start = Math.max(0, Math.floor(options.fromOffset ?? 0));
  const chunkBytes = Math.max(1, Math.floor(options.chunkBytes ?? DEFAULT_CHUNK_BYTES));
  const result: TranscriptScan = { endOffset: start, badLines: 0 };
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(chunkBytes);
    let position = start;
    // Bytes of an unfinished line carried into the next chunk. Kept as bytes, not text, so a
    // multi-byte character split across two chunks is decoded whole.
    let pending: Buffer = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, buffer, 0, chunkBytes, position);
      if (read === 0) break;
      position += read;
      const data: Buffer = Buffer.concat([pending, buffer.subarray(0, read)]);
      let lineStart = 0;
      let newline = data.indexOf(NEWLINE, lineStart);
      while (newline !== -1) {
        const text = data.subarray(lineStart, newline).toString('utf8').trim();
        if (text.length > 0) {
          const parsed = parseLine(text);
          if (parsed === undefined) result.badLines += 1;
          else onEvent(parsed);
        }
        lineStart = newline + 1;
        newline = data.indexOf(NEWLINE, lineStart);
      }
      result.endOffset = position - (data.length - lineStart);
      pending = Buffer.from(data.subarray(lineStart));
    }
    // A last line with no newline: count it only when it is already whole JSON.
    const tail = pending.toString('utf8').trim();
    const parsed = tail.length > 0 ? parseLine(tail) : undefined;
    if (parsed !== undefined) {
      onEvent(parsed);
      result.endOffset += pending.length;
    }
  } finally {
    closeSync(fd);
  }
  return result;
}

/**
 * Read a transcript's usage, counting each assistant message once. Never throws: a missing or
 * unreadable file reads as no usage, with `end_offset` left at `fromOffset` so a stored offset
 * is not lost.
 */
export function readTranscriptUsage(
  path: string,
  options: ReadTranscriptUsageOptions = {},
): TranscriptUsage {
  const byId = new Map<string, TranscriptUsageMessage>();
  let scan: TranscriptScan = {
    endOffset: Math.max(0, Math.floor(options.fromOffset ?? 0)),
    badLines: 0,
  };
  try {
    scan = scanTranscriptLines(path, (event) => foldEvent(event, byId), options);
  } catch {
    // Missing or unreadable: report what was read so far rather than throw. The caller decides
    // what no usage means (the High Table keeps the seat's self-reported estimate, AC-41).
  }

  const since = parseBound(options.since);
  const until = parseBound(options.until);
  const messages = [...byId.values()].filter((message) => inWindow(message, since, until));
  let totals = emptyTokenUsage();
  const byModel: Record<string, TokenUsage> = {};
  for (const message of messages) {
    totals = addTokenUsage(totals, message.usage);
    const model = message.model ?? UNKNOWN_MODEL;
    byModel[model] = addTokenUsage(byModel[model] ?? emptyTokenUsage(), message.usage);
  }
  return {
    totals,
    by_model: byModel,
    messages,
    end_offset: scan.endOffset,
    bad_lines: scan.badLines,
  };
}
