// Evidence-armed decision-pause configuration (issue #361).
//
// Three knobs, all registered in FRAMEWORK_CONFIG_SPECS so they are discoverable in the team
// config files (RULE-16), and resolved exactly the way the duplication gate's knobs are:
//   - decision_arm_mode — off | warn | strict, a FLOORED capability mode (like duplication_mode
//     and rule_compliance): the team value is a floor, local/env may only RAISE it. Default
//     `warn`, so arming ships computing-and-reporting and mints nothing until a team opts in.
//     A minted packet BLOCKS edits through the existing decision-pause gate, so the same
//     two-cycle bake-in issue #358 used applies here.
//   - decision_arm_plan_threshold — the minimum name similarity (0..1) that counts as a fork.
//   - decision_arm_max_per_change — how many pauses one change may open.
//
// The numeric knobs are ordinary LOCAL-WINS values (not floored) read through the shared
// `resolveNumericConfig`; a malformed or out-of-range value falls back to the default.

import { resolveFlooredMode } from '@/core/floored-mode.js';
import { readConfigsDir, readDotConfig, resolveNumericConfig } from '@/core/framework-config.js';

export type DecisionArmMode = 'off' | 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const DECISION_ARM_MODES = ['off', 'warn', 'strict'] as const;

/**
 * Ship warn (issue #361): compute and report the fork for two release cycles before any team
 * lets it open a blocking pause. `off` reproduces pre-#361 behaviour exactly.
 */
export const DEFAULT_DECISION_ARM_MODE: DecisionArmMode = 'warn';

/** Name similarity at or above this counts as a reuse fork worth asking about. */
export const DEFAULT_PLAN_THRESHOLD = 0.85;

/** Only the strongest fork per change is asked about; a change is never interrogated twice. */
export const DEFAULT_MAX_PER_CHANGE = 1;

export interface DecisionArmConfig {
  mode: DecisionArmMode;
  planThreshold: number;
  maxPerChange: number;
}

/** Resolve all three arming knobs for a project across the config surfaces. */
export function resolveDecisionArmConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DecisionArmConfig {
  return {
    mode: resolveDecisionArmMode(projectRoot, env),
    planThreshold: resolveNumericConfig(
      projectRoot,
      env,
      'decision_arm_plan_threshold',
      DEFAULT_PLAN_THRESHOLD,
      (value) => value > 0 && value <= 1,
    ),
    maxPerChange: resolveNumericConfig(
      projectRoot,
      env,
      'decision_arm_max_per_change',
      DEFAULT_MAX_PER_CHANGE,
      (value) => Number.isInteger(value) && value >= 0,
    ),
  };
}

/** Resolve `decision_arm_mode` with the team value as a floor (local/env may only raise it). */
export function resolveDecisionArmMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DecisionArmMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('decision_arm_mode'),
      local: readDotConfig(projectRoot).get('decision_arm_mode'),
      env: env.PAQAD_DECISION_ARM_MODE,
    },
    DECISION_ARM_MODES,
    DEFAULT_DECISION_ARM_MODE,
  );
}
