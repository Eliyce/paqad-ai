// The mutation_mode knob (issue #293, Option A). Mutation testing on changed code is opt-in:
// `off` (the default) runs nothing, `warn` reads a surviving mutant as Inconclusive, and `strict`
// fails the check on one. It runs only on the ci-backstop and git-backstop origins, which fire
// when a project calls runtime/scripts/verify-backstop.mjs from its own CI or pre-push hook, and
// never at the end of an agent turn (decision D-01M5AM6S3Z36HR2NRKN2XYNZWW).
//
// FLOORED like every enforced mode knob: the team-tracked `configs/.config.*` value is the floor;
// the local `.config` and `PAQAD_MUTATION_MODE` may only RAISE it (off < warn < strict), never
// lower it. With nothing set the `off` default applies. Mirrors src/checks/flaky-mode.ts.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type MutationMode = 'off' | 'warn' | 'strict';

/** Modes weakest to strictest, for the floor clamp. */
export const MUTATION_MODES = ['off', 'warn', 'strict'] as const;

/** Default: off. Mutation testing is slow and needs a project-supplied tool, so it is opt-in. */
export const DEFAULT_MUTATION_MODE: MutationMode = 'off';

/**
 * Resolve `mutation_mode` with the team value as a floor. The tracked `configs/.config.*` value is
 * the floor; the local `.config` and the `PAQAD_MUTATION_MODE` env may only RAISE it. With nothing
 * set the `off` default applies.
 */
export function resolveMutationMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): MutationMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('mutation_mode'),
      local: readDotConfig(projectRoot).get('mutation_mode'),
      env: env.PAQAD_MUTATION_MODE,
    },
    MUTATION_MODES,
    DEFAULT_MUTATION_MODE,
  );
}
