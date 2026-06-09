import { getEngineLogger } from '../../core/logging/index.js';

/**
 * CLI logger facade. Delegates to the engine's structured logger so CLI-side
 * log lines share the same JSON shape, redaction, and correlation contract as
 * the rest of the engine. The four method names are preserved for backward
 * compatibility; they now emit a structured line and return `void`.
 */
export const logger = {
  info(message: string): void {
    getEngineLogger().info(message);
  },
  success(message: string): void {
    getEngineLogger().log('info', 'success', { message });
  },
  warning(message: string): void {
    getEngineLogger().warn(message);
  },
  error(message: string): void {
    getEngineLogger().error(message);
  },
};
