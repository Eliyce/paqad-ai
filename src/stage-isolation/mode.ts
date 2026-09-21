// Stage-isolation enforcement mode (issue #567).
//
// `stage_isolation` decides whether each mandatory feature-development stage runs in a
// fresh, isolated host subagent (with the per-feature evidence bundle as the only shared
// memory) or in the single main context as before. It is an ENFORCED capability-mode knob:
// the tracked `configs/.config.*` value is a floor and the local `.config` / the
// `PAQAD_STAGE_ISOLATION` env may only RAISE it (turn it `on`), never lower a team `on` to
// `off`. Default is `off`, so an untouched project is byte-identical to before the feature
// (INV-1) and no one gets stage isolation without opting in.
//
// It is a registered FRAMEWORK_CONFIG_SPEC, so it is discoverable in the team config files
// and never pruned. The resolver mirrors `resolveStagesMode` (src/stage-evidence/mode.ts)
// and reuses the shared floor clamp, so there is one way to resolve a floored mode.

import { readConfigsDir, readDotConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type StageIsolationMode = 'off' | 'on';

/** Modes weakest → strictest, for the floor clamp. */
export const STAGE_ISOLATION_MODES = ['off', 'on'] as const;

/** Default off — a project is byte-identical to before the feature until it opts in. */
export const DEFAULT_STAGE_ISOLATION_MODE: StageIsolationMode = 'off';

/**
 * Resolve the stage-isolation mode for a project with the team value as a floor. The
 * tracked `configs/.config.*` value is the floor; the local `.config` and the
 * `PAQAD_STAGE_ISOLATION` env may only RAISE it to `on`. With nothing set the `off` default
 * applies, so every existing project keeps its single-context behavior until a team commit
 * (or a local opt-in) turns it on.
 */
export function resolveStageIsolation(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): StageIsolationMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('stage_isolation'),
      local: readDotConfig(projectRoot).get('stage_isolation'),
      env: env.PAQAD_STAGE_ISOLATION,
    },
    STAGE_ISOLATION_MODES,
    DEFAULT_STAGE_ISOLATION_MODE,
  );
}

/** Convenience predicate: is stage isolation turned on for this project? */
export function isStageIsolationOn(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveStageIsolation(projectRoot, env) === 'on';
}
