import type { LogLevel, RedactionAllowlist, StructuredLogRecord } from '../types/logging.js';
import { DEFAULT_REDACTION_ALLOWLIST, redactFields } from './redaction.js';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface CreateLoggerOptions {
  runtime: string;
  level?: LogLevel;
  allowlist?: RedactionAllowlist;
  correlationId?: string;
  writeLine?: (line: string) => void;
  now?: () => string;
}

export interface StructuredLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
  getRedactionCount(): number;
  resetRedactionCount(): void;
  setLevel(level: LogLevel): void;
  setAllowlist(list: RedactionAllowlist): void;
  withCorrelation(correlationId: string): StructuredLogger;
}

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
