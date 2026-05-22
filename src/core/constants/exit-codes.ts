import type { ExitCode } from '../types/hook.js';

export const HOOK_EXIT_CODES = {
  ALLOW: 0,
  ERROR: 1,
  BLOCK: 2,
} as const satisfies Record<string, ExitCode>;
