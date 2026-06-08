import type { LogLevel, RedactionAllowlist, StructuredLogRecord } from '../types/logging.js';
import { DEFAULT_REDACTION_ALLOWLIST, redactFields } from './redaction.js';

/** Numeric ordering used for level-threshold suppression. */
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Options for {@link createLogger}. */
export interface CreateLoggerOptions {
  /** Runtime name stamped on every record, e.g. `'engine'`. */
  runtime: string;
  /** Minimum level to emit. Lines below this threshold are dropped. Default `'info'`. */
  level?: LogLevel;
  /** Field names to redact. Default {@link DEFAULT_REDACTION_ALLOWLIST}. */
  allowlist?: RedactionAllowlist;
  /** Correlation id stamped on every record from this logger, when set. */
  correlationId?: string;
  /** Sink for serialised lines. Default writes to `process.stdout`. Test seam. */
  writeLine?: (line: string) => void;
  /** Timestamp source. Default `() => new Date().toISOString()`. Test seam. */
  now?: () => string;
}

/** Structured logger emitting one JSON line per call. */
export interface StructuredLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
  /** Number of values redacted since creation or the last reset. */
  getRedactionCount(): number;
  resetRedactionCount(): void;
  setLevel(level: LogLevel): void;
  setAllowlist(list: RedactionAllowlist): void;
  /**
   * Returns a logger that stamps `correlation_id` on every line and shares this
   * logger's mutable state (level, allowlist, redaction counter, sink), so a
   * correlation id injected at a run's entry point appears on every line of
   * that run without losing the shared configuration.
   */
  withCorrelation(correlationId: string): StructuredLogger;
}

/** Mutable state shared between a logger and its {@link withCorrelation} children. */
interface LoggerState {
  runtime: string;
  level: LogLevel;
  allowlist: RedactionAllowlist;
  redactionCount: number;
  writeLine: (line: string) => void;
  now: () => string;
}

function makeLogger(state: LoggerState, correlationId?: string): StructuredLogger {
  function emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[state.level]) {
      return;
    }

    const { redacted, count } = redactFields(fields ?? {}, state.allowlist);
    state.redactionCount += count;

    const record: StructuredLogRecord = {
      ...redacted,
      level,
      timestamp: state.now(),
      runtime: state.runtime,
      event,
      ...(correlationId !== undefined ? { correlation_id: correlationId } : {}),
    };

    state.writeLine(`${JSON.stringify(record)}\n`);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    log: (level, event, fields) => emit(level, event, fields),
    getRedactionCount: () => state.redactionCount,
    resetRedactionCount: () => {
      state.redactionCount = 0;
    },
    setLevel: (level) => {
      state.level = level;
    },
    setAllowlist: (list) => {
      state.allowlist = list;
    },
    withCorrelation: (id) => makeLogger(state, id),
  };
}

/** Creates a structured logger. The `writeLine`/`now` seams keep tests off real I/O. */
export function createLogger(options: CreateLoggerOptions): StructuredLogger {
  const state: LoggerState = {
    runtime: options.runtime,
    level: options.level ?? 'info',
    allowlist: options.allowlist ?? DEFAULT_REDACTION_ALLOWLIST,
    redactionCount: 0,
    writeLine: options.writeLine ?? ((line) => void process.stdout.write(line)),
    now: options.now ?? (() => new Date().toISOString()),
  };
  return makeLogger(state, options.correlationId);
}
