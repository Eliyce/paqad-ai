import { execa } from 'execa';

import type { DeliveryShell } from './runner.js';

export function createDeliveryShell(cwd: string): DeliveryShell {
  return {
    async run(command, args) {
      try {
        const result = await execa(command, args, { cwd, reject: false });
        return {
          /* v8 ignore start -- execa always returns string stdout/stderr; the ?? '' guards a never-null path */
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          /* v8 ignore stop */
          /* v8 ignore next -- execa always yields a numeric exitCode with reject:false */
          exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
        };
        /* v8 ignore start -- defensive: execa rarely throws when reject:false, but a spawn-level failure (ENOENT) must still degrade, not crash */
      } catch (error) {
        return {
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
          exitCode: 1,
        };
      }
      /* v8 ignore stop */
    },
  };
}
