// The effective lane a code edit is actually held to (issue #324, shared for #590).
//
// Lifted out of `src/kernel/capability.ts` so BOTH sides that must agree on a
// fast-lane change — the pre-mutation edit gate (`stagesCapability`) and the live
// stage writer (`recordLiveStageEdit` / narration) — derive the lane the same way,
// from one function, for a given target path. Keeping it in a leaf module (rather
// than exporting it from capability.ts) avoids an import cycle: capability.ts →
// narration.ts → live-writer.ts would close back onto capability.ts if the writer
// imported the resolver from there.

import type { Lane } from '@/core/types/routing.js';
import { resolvePathSensitivity } from '@/module-map/sensitivity.js';

import { type StageLane } from './types.js';

/**
 * The lane this edit is actually held to (issue #324). A path mapping to a
 * `sensitivity: high` module floors the lane to `full` — a deterministic, no-LLM
 * risk signal that overrides whatever the classifier recorded. Otherwise the
 * recorded lane governs; a null recorded lane fails safe to `full` (INV-4 — the
 * floor only ever tightens, never silently relaxes the spec requirement).
 */
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
