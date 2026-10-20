import { getEngineLogger } from '../../core/logging/index.js';

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
