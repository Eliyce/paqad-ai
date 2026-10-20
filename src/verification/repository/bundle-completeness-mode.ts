import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type BundleCompletenessMode = 'off' | 'warn' | 'strict';

export const BUNDLE_COMPLETENESS_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_BUNDLE_COMPLETENESS_MODE: BundleCompletenessMode = 'strict';

export function resolveBundleCompletenessMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): BundleCompletenessMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('bundle_completeness'),
      local: readDotConfig(projectRoot).get('bundle_completeness'),
      env: env.PAQAD_BUNDLE_COMPLETENESS,
    },
    BUNDLE_COMPLETENESS_MODES,
    DEFAULT_BUNDLE_COMPLETENESS_MODE,
  );
}
