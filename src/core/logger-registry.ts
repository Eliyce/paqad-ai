/**
 * Consumer-pluggable logger registry (PQD-105).
 *
 * Holds the single consumer logger the engine delivers structured logs to, plus
 * the {@link engineLog} dispatch every library module calls instead of `console.*`.
 *
 * Design contract:
 * - Fire-and-forget: a consumer logger that blocks or returns a slow promise
 *   never stalls engine work — the engine never awaits {@link EngineLogger.log}.
 * - Fault isolation: a synchronous throw or a rejected promise from the consumer
 *   logger is caught here and never propagates to the caller. The first fault
 *   emits exactly one notice through the stderr default; after that the logger
 *   is treated as faulted and logs fall through to the stderr default silently.
 * - Replacement, not fan-out: installing a logger replaces the previous one,
 *   which receives no further entries (and the fault flag resets).
 * - Safe default: with no logger installed, `warn`/`error` go to `process.stderr`
 *   and `debug`/`info` are dropped, so engine warnings stay visible in dev
 *   without forcing the consumer to install a logger.
 */

import type { LogLevel } from './types/logging.js';
import type { EngineLogEntry, EngineLogger } from './types/logger.js';

/** Maximum serialised payload size before truncation. */
const MAX_PAYLOAD_BYTES = 8192;
/** Length of the summary kept when a payload is truncated. */
const TRUNCATED_SUMMARY_CHARS = 256;

let _logger: EngineLogger | null = null;
let _faultedOnce = false;

/**
 * Install the consumer logger. Replaces any previously installed logger (the
 * previous logger receives no further entries) and resets the fault flag so the
 * new logger gets a clean slate.
 */
export function setEngineLogger(logger: EngineLogger): void {
  _logger = logger;
  _faultedOnce = false;
}

/** Revert to the safe stderr default. The previously installed logger is dropped. */
export function clearEngineLogger(): void {
  _logger = null;
  _faultedOnce = false;
}

/**
 * The currently installed consumer logger, or `null` when the safe default is
 * active. Named `getConsumerLogger` (not `getEngineLogger`) because the engine
 * already exports a `getEngineLogger()` returning the internal structured JSON
 * logger (PQD-96) — a distinct concern from the consumer injection seam here.
 */
export function getConsumerLogger(): EngineLogger | null {
  return _logger;
}

/** Replace an oversized or non-serialisable payload with a truncation marker. */
function clampPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (payload === undefined) {
    return undefined;
  }
  let serialised: string;
  try {
    serialised = JSON.stringify(payload);
  } catch {
    return { __truncated: true, summary: String(payload).slice(0, TRUNCATED_SUMMARY_CHARS) };
  }
  if (serialised.length <= MAX_PAYLOAD_BYTES) {
    return payload;
  }
  return { __truncated: true, summary: serialised.slice(0, TRUNCATED_SUMMARY_CHARS) };
}

/** The safe default sink: warn/error to stderr, debug/info dropped. */
function writeDefault(
  level: LogLevel,
  message: string,
  payload: Record<string, unknown> | undefined,
): void {
  if (level !== 'warn' && level !== 'error') {
    return;
  }
  const suffix = payload === undefined ? '' : ` ${JSON.stringify(payload)}`;
  process.stderr.write(`paqad [${level}] ${message}${suffix}\n`);
}

/** Mark the logger faulted and emit the one-time fallback notice. */
function markFaulted(): void {
  if (_faultedOnce) {
    return;
  }
  _faultedOnce = true;
  process.stderr.write('paqad: consumer logger faulted, reverting to stderr default\n');
}

/**
 * The single internal logging entry-point for library modules — call this
 * instead of `console.*`. Delivers to the installed consumer logger when one is
 * present and healthy, otherwise to the safe stderr default. Never throws.
 */
export function engineLog(
  level: LogLevel,
  message: string,
  payload?: Record<string, unknown>,
): void {
  const safePayload = clampPayload(payload);
  const logger = _logger;

  if (logger === null || _faultedOnce) {
    writeDefault(level, message, safePayload);
    return;
  }

  const entry: EngineLogEntry = {
    level,
    message,
    ...(safePayload !== undefined ? { payload: safePayload } : {}),
  };

  try {
    const result = logger.log(entry);
    if (result !== undefined && typeof (result as Promise<void>).then === 'function') {
      void (result as Promise<void>).then(undefined, () => {
        markFaulted();
        writeDefault(level, message, safePayload);
      });
    }
  } catch {
    markFaulted();
    writeDefault(level, message, safePayload);
  }
}
