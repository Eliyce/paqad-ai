import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { isFeatureDirName } from './paths.js';

export function listFeatureDirs(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, PATHS.FEATURE_EVIDENCE_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isFeatureDirName(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
