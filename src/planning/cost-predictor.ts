import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  ManifestComplexity,
  PlanningCostEntry,
  PlanningCostLog,
  PlanningLane,
} from '@/core/types/planning.js';

const DEFAULT_CEILINGS: Record<PlanningLane, number> = {
  fast: 600,
  graduated: 1800,
  full: 3500,
};

const MIN_FLOORS: Record<PlanningLane, number> = {
  fast: 400,
  graduated: 800,
  full: 1500,
};

export async function predictTokenCeiling(
  root: string,
  options: {
    lane: PlanningLane;
    complexity: ManifestComplexity;
    scope?: string;
  },
): Promise<number> {
  const log = await readCostLog(root);
  const matches = log.entries
    .filter(
      (entry) =>
        entry.classification.lane === options.lane &&
        entry.classification.complexity === options.complexity &&
        (entry.classification.scope ?? 'unknown') === (options.scope ?? 'unknown'),
    )
    .map((entry) => entry.actual_tokens)
    .sort((left, right) => left - right);

  if (matches.length < 3) {
    return DEFAULT_CEILINGS[options.lane];
  }

  const percentileIndex = Math.ceil(matches.length * 0.75) - 1;
  /* c8 ignore next */
  const p75 = matches[Math.max(percentileIndex, 0)] ?? DEFAULT_CEILINGS[options.lane];
  return Math.max(MIN_FLOORS[options.lane], Math.ceil(p75 * 1.2));
}

export async function appendCostEntry(root: string, entry: PlanningCostEntry): Promise<void> {
  const log = await readCostLog(root);
  log.entries.push(entry);
  await mkdir(join(root, PATHS.AGENCY_CACHE_DIR), { recursive: true });
  await writeFile(join(root, PATHS.PLANNING_COSTS), JSON.stringify(log, null, 2) + '\n', 'utf8');
}

export async function readCostLog(root: string): Promise<PlanningCostLog> {
  try {
    const raw = await readFile(join(root, PATHS.PLANNING_COSTS), 'utf8');
    return JSON.parse(raw) as PlanningCostLog;
  } catch {
    return { entries: [] };
  }
}
