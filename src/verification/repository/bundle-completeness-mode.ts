// The bundle-completeness-gate mode (issue #511, part B).
//
// The fail-closed successor to the warn-only `evidence-existence` gate. Where that check
// deliberately had no `strict` tier (the #310/#394 pre-mutation false-block history), this
// one is meant to bite: at `strict` (the default) a required-but-missing/empty/invalid
// bundle file fails the change (Needs your attention). `warn` keeps the non-blocking
// behaviour for a team that needs a bake-in; `off` disables it (and falls back to the
// deprecated evidence-existence gate).
//
// FLOORED, like every other enforced mode knob: the team-tracked `configs/.config.*` value
// is a floor; the local `.config` / `PAQAD_BUNDLE_COMPLETENESS` env may only RAISE it, never
// lower it (the C2 clamp, decision D1). With nothing set, `strict` applies and is itself the
// floor — the whole point of the gate is to fail — so a lone developer cannot silently
// weaken it; only a team commit can.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type BundleCompletenessMode = 'off' | 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const BUNDLE_COMPLETENESS_MODES = ['off', 'warn', 'strict'] as const;

/** Default: strict — a required file that is missing at end-of-change fails the change. */
export const DEFAULT_BUNDLE_COMPLETENESS_MODE: BundleCompletenessMode = 'strict';

/**
 * Resolve the bundle-completeness mode with the team value as a floor. The tracked
 * `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_BUNDLE_COMPLETENESS` env may only RAISE it. With nothing set the `strict` default
 * applies (and is itself the floor).
 */
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
