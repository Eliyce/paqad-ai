import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type StagesMode = 'off' | 'warn' | 'strict';

export const STAGES_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_STAGES_MODE: StagesMode = 'strict';

export function resolveStagesMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): StagesMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('stages_mode'),
      local: readDotConfig(projectRoot).get('stages_mode'),
      env: env.PAQAD_STAGES_MODE,
    },
    STAGES_MODES,
    DEFAULT_STAGES_MODE,
  );
}
