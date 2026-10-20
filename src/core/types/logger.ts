import type { LogLevel } from './logging.js';

export interface EngineLogEntry {
  level: LogLevel;
  message: string;
  payload?: Record<string, unknown>;
}

export interface EngineLogger {
  log(entry: EngineLogEntry): void | Promise<void>;
}
