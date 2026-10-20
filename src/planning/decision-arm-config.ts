import { resolveFlooredMode } from '@/core/floored-mode.js';
import { readConfigsDir, readDotConfig, resolveNumericConfig } from '@/core/framework-config.js';

export type DecisionArmMode = 'off' | 'warn' | 'strict';

export const DECISION_ARM_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_DECISION_ARM_MODE: DecisionArmMode = 'warn';

export const DEFAULT_PLAN_THRESHOLD = 0.85;

export const DEFAULT_MAX_PER_CHANGE = 1;

export interface DecisionArmConfig {
  mode: DecisionArmMode;
  planThreshold: number;
  maxPerChange: number;
}

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
