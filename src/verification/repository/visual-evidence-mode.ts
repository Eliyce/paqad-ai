import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type VisualEvidenceMode = 'warn' | 'strict';

export const VISUAL_EVIDENCE_MODES = ['warn', 'strict'] as const;

export const DEFAULT_VISUAL_EVIDENCE_MODE: VisualEvidenceMode = 'warn';

export function resolveVisualEvidenceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): VisualEvidenceMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('visual_evidence_mode'),
      local: readDotConfig(projectRoot).get('visual_evidence_mode'),
      env: env.PAQAD_VISUAL_EVIDENCE_MODE,
    },
    VISUAL_EVIDENCE_MODES,
    DEFAULT_VISUAL_EVIDENCE_MODE,
  );
}
