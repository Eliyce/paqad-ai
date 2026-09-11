// The checks_flaky_under_parallel mode (issue #554, Part F.1). What a test that fails in the
// parallel run but passes every isolated re-run does: `warn` (default) never blocks and records it
// with one receipt line, `pass` records only, `fail` blocks. FLOORED like every enforced mode knob
// — the team-tracked `configs/.config.*` value is the floor; local `.config` / `PAQAD_*` may only
// RAISE it (order pass < warn < fail), never lower. Mirrors bundle-completeness-mode.ts.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type ChecksFlakyMode = 'pass' | 'warn' | 'fail';

/** Modes weakest → strictest, for the floor clamp. */
export const CHECKS_FLAKY_MODES = ['pass', 'warn', 'fail'] as const;

/** Default: warn — a pass-alone test is recorded and gets one receipt line, but never blocks. */
export const DEFAULT_CHECKS_FLAKY_MODE: ChecksFlakyMode = 'warn';

/**
 * Resolve the checks-flaky mode with the team value as a floor. The tracked `configs/.config.*`
 * value is the floor; the local `.config` and the `PAQAD_CHECKS_FLAKY_UNDER_PARALLEL` env may only
 * RAISE it. With nothing set the `warn` default applies (and is itself the floor).
 */
export function resolveChecksFlakyMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ChecksFlakyMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('checks_flaky_under_parallel'),
      local: readDotConfig(projectRoot).get('checks_flaky_under_parallel'),
      env: env.PAQAD_CHECKS_FLAKY_UNDER_PARALLEL,
    },
    CHECKS_FLAKY_MODES,
    DEFAULT_CHECKS_FLAKY_MODE,
  );
}
