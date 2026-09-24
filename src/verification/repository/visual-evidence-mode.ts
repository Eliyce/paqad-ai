// The visual-evidence-gate mode (issue #551).
//
// Governs how firmly the visual-evidence gate enforces once `visual_evidence` is on and a
// change is frontend-triggering. `warn` (the default) reads an environmental miss (browser
// not provisioned, app not reachable, a failed selector, an absent/partial manifest, a
// hash/size mismatch) as Inconclusive without blocking; `strict` FAILS the change on the same
// misses. Since issue #579, `strict` also fails a frontend change with nothing captured because
// no documented flow or capture script exists, unless screenshots were attached
// (`paqad-ai visual-evidence attach`) or a waiver decision for the change was resolved (the
// gate then reads skipped, never pass). Under `warn` those skips stay skipped and print a skip
// line in the verdict. `capture-script-invalid` stays a documented skip in both modes.
//
// FLOORED, like every other enforced mode knob: the team-tracked `configs/.config.*` value is
// a floor; the local `.config` / `PAQAD_VISUAL_EVIDENCE_MODE` env may only RAISE it (warn →
// strict), never lower it. With nothing set `warn` applies and is the floor.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type VisualEvidenceMode = 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const VISUAL_EVIDENCE_MODES = ['warn', 'strict'] as const;

/** Default: warn — an environmental miss reads Inconclusive without blocking the change. */
export const DEFAULT_VISUAL_EVIDENCE_MODE: VisualEvidenceMode = 'warn';

/**
 * Resolve the visual-evidence mode with the team value as a floor. The tracked
 * `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_VISUAL_EVIDENCE_MODE` env may only RAISE it (warn → strict). With nothing set the
 * `warn` default applies (and is itself the floor).
 */
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
