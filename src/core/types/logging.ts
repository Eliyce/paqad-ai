/**
 * Canonical structured-logging contract shared across the three Paqad runtimes
 * (engine CLI, desktop Electron app, API). Defining these shapes in the engine
 * lets the desktop and API import a single source of truth for log records,
 * the redaction allowlist, and the correlation-id field rather than each
 * runtime maintaining its own copy.
 */

/** Severity levels, ordered debug < info < warn < error. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * One emitted log line. Always JSON-serialisable. `correlation_id` is present
 * whenever the line belongs to a request flow that crosses runtimes so a
 * support engineer can join the full flow by that identifier alone. The open
 * index signature carries any additional structured fields the caller passes.
 */
export interface StructuredLogRecord {
  level: LogLevel;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Runtime name, e.g. `'engine'`, `'desktop'`, `'api'`. */
  runtime: string;
  /** Stable event name, e.g. `'verification.started'`. */
  event: string;
  /** Shared identifier joining lines across runtimes, when one exists. */
  correlation_id?: string;
  [key: string]: unknown;
}

/** Field names whose values must be redacted before a line is emitted. */
export type RedactionAllowlist = readonly string[];

/**
 * Record of a single redaction. Runtimes can implement their own operational
 * counter backed by this shape so redaction metrics stay consistent.
 */
export interface RedactionEvent {
  field: string;
  placeholder: string;
  timestamp: string;
}
