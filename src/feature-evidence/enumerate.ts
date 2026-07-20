// Bundle-container enumeration (issue #404 — extracted from `delivery.ts`).
//
// Listing the feature bundles is the lowest-level whole-project read in this module:
// the delivery reconciler, the projections, and the session-rotation adoption all need
// it. It lived in `delivery.ts`, which also imports `currentFeature` from the stage
// ledger — so adoption reaching for it there would have closed an import cycle
// (adoption → delivery → stage-ledger → adoption). It is a leaf here instead: paths and
// `readdir`, nothing else. `delivery.ts` re-exports it, so every existing caller is
// untouched.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { isFeatureDirName } from './paths.js';

/** Every feature dir name under the evidence container (excludes `_session`/junk). */
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
