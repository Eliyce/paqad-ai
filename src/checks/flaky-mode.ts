import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type ChecksFlakyMode = 'pass' | 'warn' | 'fail';

export const CHECKS_FLAKY_MODES = ['pass', 'warn', 'fail'] as const;

export const DEFAULT_CHECKS_FLAKY_MODE: ChecksFlakyMode = 'warn';

export function resolveChecksFlakyMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ChecksFlakyMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('checks_flaky_under_parallel'),
      local: readDotConfig(projectRoot).get('checks_flaky_under_parallel'),
      env: env.PAQAD_CHECKS_FLAKY_UNDER_PARALLEL,
    },
    CHECKS_FLAKY_MODES,
    DEFAULT_CHECKS_FLAKY_MODE,
  );
}
