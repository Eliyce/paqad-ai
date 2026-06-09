/**
 * Consumer-pluggable logger contract (PQD-105).
 *
 * A consumer of the `paqad-ai` package (e.g. the desktop app) can hand the
 * engine its own logger at init via {@link setEngineLogger}. Every structured
 * log the engine would otherwise drop into an internal `console.*` call is then
 * delivered to that logger so the consumer can surface engine activity in its
 * own UI without polling log files.
 *
 * This is distinct from the internal structured JSON logger in
 * `src/core/logging/` (PQD-96): that emits JSON lines for the engine's own
 * runtimes; this is a single injection seam the consumer owns. The shared
 * {@link LogLevel} union is reused so both contracts speak the same severities.
 */

import type { LogLevel } from './logging.js';

/**
 * A single structured log the engine hands to the consumer's logger. `payload`
 * is an optional bag of structured fields; oversized payloads are truncated
 * with a `{ __truncated: true }` marker before delivery.
 */
export interface EngineLogEntry {
  level: LogLevel;
  message: string;
  payload?: Record<string, unknown>;
}

/**
 * The contract a consumer implements and installs via {@link setEngineLogger}.
 *
 * `log` may return a promise (e.g. an async sink such as an HTTP endpoint), but
 * the engine never awaits it — calls are fire-and-forget so a slow or blocking
 * logger can never stall engine work. Log ordering is therefore not guaranteed
 * for async loggers. The engine catches any synchronous throw or rejected
 * promise and continues; it must not throw back to the caller.
 */
export interface EngineLogger {
  log(entry: EngineLogEntry): void | Promise<void>;
}
