import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type AiAttributionMode = 'keep' | 'strip';

export const AI_ATTRIBUTION_MODES = ['keep', 'strip'] as const;

export const DEFAULT_AI_ATTRIBUTION_MODE: AiAttributionMode = 'strip';

export function resolveAiAttributionMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AiAttributionMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('ai_attribution'),
      local: readDotConfig(projectRoot).get('ai_attribution'),
      env: env.PAQAD_AI_ATTRIBUTION,
    },
    AI_ATTRIBUTION_MODES,
    DEFAULT_AI_ATTRIBUTION_MODE,
  );
}

export function shouldStripAiAttribution(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveAiAttributionMode(projectRoot, env) === 'strip';
}
