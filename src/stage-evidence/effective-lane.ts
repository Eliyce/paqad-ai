import type { Lane } from '@/core/types/routing.js';
import { resolvePathSensitivity } from '@/module-map/sensitivity.js';

import { type StageLane } from './types.js';

export function resolveEffectiveLane(
  projectRoot: string,
  targetPath: string | undefined,
  recordedLane: StageLane,
): Lane {
  if (targetPath && resolvePathSensitivity(projectRoot, targetPath) === 'high') {
    return 'full';
  }
  return recordedLane ?? 'full';
}
