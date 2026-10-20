import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type EvidenceExistenceMode = 'off' | 'warn';

export const EVIDENCE_EXISTENCE_MODES = ['off', 'warn'] as const;

export const DEFAULT_EVIDENCE_EXISTENCE_MODE: EvidenceExistenceMode = 'warn';

export function resolveEvidenceExistenceMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): EvidenceExistenceMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('evidence_existence_gate'),
      local: readDotConfig(projectRoot).get('evidence_existence_gate'),
      env: env.PAQAD_EVIDENCE_EXISTENCE_GATE,
    },
    EVIDENCE_EXISTENCE_MODES,
    DEFAULT_EVIDENCE_EXISTENCE_MODE,
  );
}
