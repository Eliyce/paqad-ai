import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type MutationMode = 'off' | 'warn' | 'strict';

export const MUTATION_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_MUTATION_MODE: MutationMode = 'off';

export function resolveMutationMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): MutationMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('mutation_mode'),
      local: readDotConfig(projectRoot).get('mutation_mode'),
      env: env.PAQAD_MUTATION_MODE,
    },
    MUTATION_MODES,
    DEFAULT_MUTATION_MODE,
  );
}
