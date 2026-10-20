import { readConfigsDir, readDotConfig, resolveNumericConfig } from '@/core/framework-config.js';
import { resolveFlooredMode } from '@/core/floored-mode.js';

export type DuplicationMode = 'off' | 'warn' | 'strict';

export const DUPLICATION_MODES = ['off', 'warn', 'strict'] as const;

export const DEFAULT_DUPLICATION_MODE: DuplicationMode = 'warn';

export const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

export const HEURISTIC_BAND_FLOOR = 0.8;

export const DEFAULT_MIN_LINES = 8;

export interface DuplicationConfig {
  mode: DuplicationMode;
  similarityThreshold: number;
  minLines: number;
}

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
