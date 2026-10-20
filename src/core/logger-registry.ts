import type { LogLevel } from './types/logging.js';
import type { EngineLogEntry, EngineLogger } from './types/logger.js';

const MAX_PAYLOAD_BYTES = 8192;
const TRUNCATED_SUMMARY_CHARS = 256;

let _logger: EngineLogger | null = null;
let _faultedOnce = false;

export function setEngineLogger(logger: EngineLogger): void {
  _logger = logger;
  _faultedOnce = false;
}

export function clearEngineLogger(): void {
  _logger = null;
  _faultedOnce = false;
}

export function getConsumerLogger(): EngineLogger | null {
  return _logger;
}

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

function markFaulted(): void {
  if (_faultedOnce) {
    return;
  }
  _faultedOnce = true;
  process.stderr.write('paqad: consumer logger faulted, reverting to stderr default\n');
}

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
