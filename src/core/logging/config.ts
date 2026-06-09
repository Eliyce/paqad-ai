import type { LogLevel, RedactionAllowlist } from '../types/logging.js';
import { createLogger, type StructuredLogger } from './logger.js';
import { DEFAULT_REDACTION_ALLOWLIST } from './redaction.js';

/** Resolved logging configuration for a runtime. */
export interface LoggingConfig {
  level: LogLevel;
  allowlist: RedactionAllowlist;
  runtime: string;
}

const VALID_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && VALID_LEVELS.has(value as LogLevel);
}

/**
 * Builds a logging config. The level threshold comes from `PAQAD_LOG_LEVEL`
 * (default `'info'`, invalid values ignored), then any explicit overrides win.
 */
export function loadLoggingConfig(overrides?: Partial<LoggingConfig>): LoggingConfig {
  const envLevel = process.env.PAQAD_LOG_LEVEL;
  return {
    level: isLogLevel(envLevel) ? envLevel : 'info',
    allowlist: DEFAULT_REDACTION_ALLOWLIST,
    runtime: 'engine',
    ...overrides,
  };
}

/**
 * Applies a new config to an existing logger instance in place. The instance is
 * not replaced, so concurrent holders keep logging without dropping or
 * duplicating any line across the reload (AC4 — hot reload without loss).
 */
export function reloadLoggingConfig(logger: StructuredLogger, config: LoggingConfig): void {
  logger.setLevel(config.level);
  logger.setAllowlist(config.allowlist);
}

let engineLogger: StructuredLogger | undefined;

/** Lazy singleton logger for the engine runtime. */
export function getEngineLogger(): StructuredLogger {
  if (engineLogger === undefined) {
    const config = loadLoggingConfig();
    engineLogger = createLogger({
      runtime: config.runtime,
      level: config.level,
      allowlist: config.allowlist,
    });
  }
  return engineLogger;
}
