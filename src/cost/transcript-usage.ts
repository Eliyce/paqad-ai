import { closeSync, openSync, readSync } from 'node:fs';

export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_5m: number;
  cache_write_1h: number;
  total: number;
}

export interface TranscriptUsageMessage {
  id: string;
  model: string | null;
  timestamp: string | null;
  usage: TokenUsage;
}

export interface TranscriptUsage {
  totals: TokenUsage;
  by_model: Record<string, TokenUsage>;
  messages: TranscriptUsageMessage[];
  end_offset: number;
  bad_lines: number;
}

export interface ReadTranscriptUsageOptions {
  since?: string;
  until?: string;
  fromOffset?: number;
  chunkBytes?: number;
}

const DEFAULT_CHUNK_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const UNKNOWN_MODEL = 'unknown';

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

function parseLine(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

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
  if (Number.isNaN(at)) return false;
  if (since !== undefined && at < since) return false;
  return until === undefined || at <= until;
}

export interface TranscriptScan {
  endOffset: number;
  badLines: number;
}

export interface ScanTranscriptOptions {
  fromOffset?: number;
  chunkBytes?: number;
}

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
  } catch {}

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
