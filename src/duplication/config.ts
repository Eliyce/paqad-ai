// Duplication-gate configuration (issue #358).
//
// Three knobs, all registered in FRAMEWORK_CONFIG_SPECS so they are discoverable in the team
// config files (RULE-16):
//   - duplication_mode — off | warn | strict, a FLOORED capability mode (like rule_compliance
//     and stages_mode): the team value is a floor, local/env may only RAISE it. Default `warn`
//     for the two-cycle bake-in the issue asks for.
//   - duplication_similarity_threshold — the minimum similarity (0..1) for a blocking finding.
//   - duplication_min_lines — the minimum meaningful-line span a candidate must have to score.
//
// The numeric knobs are ordinary LOCAL-WINS values (not floored) read from the layered map; a
// malformed or out-of-range value falls back to the default rather than throwing.

import { readConfigsDir, readDotConfig, resolveNumericConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type DuplicationMode = 'off' | 'warn' | 'strict';

/** Modes weakest → strictest, for the floor clamp. */
export const DUPLICATION_MODES = ['off', 'warn', 'strict'] as const;

/** Ship warn (issue #358): surface findings for two release cycles before flipping to strict. */
export const DEFAULT_DUPLICATION_MODE: DuplicationMode = 'warn';

/** Conservative — precision over recall for a blocking-capable gate (issue #358). */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

/** The lower edge of the heuristic (review-only) band below the blocking threshold. */
export const HEURISTIC_BAND_FLOOR = 0.8;

/** Minimum meaningful (non-blank) lines a candidate must span to be scored. */
export const DEFAULT_MIN_LINES = 8;

export interface DuplicationConfig {
  mode: DuplicationMode;
  similarityThreshold: number;
  minLines: number;
}

/** Resolve all three duplication knobs for a project across the config surfaces. */
export function resolveDuplicationConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DuplicationConfig {
  return {
    mode: resolveDuplicationMode(projectRoot, env),
    similarityThreshold: resolveNumericConfig(
      projectRoot,
      env,
      'duplication_similarity_threshold',
      DEFAULT_SIMILARITY_THRESHOLD,
      (value) => value > 0 && value <= 1,
    ),
    minLines: resolveNumericConfig(
      projectRoot,
      env,
      'duplication_min_lines',
      DEFAULT_MIN_LINES,
      (value) => Number.isInteger(value) && value >= 1,
    ),
  };
}

/** Resolve `duplication_mode` with the team value as a floor (local/env may only raise it). */
export function resolveDuplicationMode(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): DuplicationMode {
  return resolveFlooredMode(
    {
      team: readConfigsDir(projectRoot).merged.get('duplication_mode'),
      local: readDotConfig(projectRoot).get('duplication_mode'),
      env: env.PAQAD_DUPLICATION_MODE,
    },
    DUPLICATION_MODES,
    DEFAULT_DUPLICATION_MODE,
  );
}
