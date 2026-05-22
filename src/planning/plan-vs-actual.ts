import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type {
  PlanVsActualDiff,
  PlanVsActualSnapshot,
  PlanningManifest,
} from '@/core/types/planning.js';

export function computePlanVsActual(
  manifest: PlanningManifest,
  actual: PlanVsActualSnapshot,
): PlanVsActualDiff {
  const plannedFiles = [...new Set(manifest.execution_slices.flatMap((slice) => slice.touches))];
  const changedFiles = [...new Set(actual.changed_files)];
  const usedFiles = [...new Set(actual.used_files ?? changedFiles)];
  const coveredCriteria = new Set(actual.covered_criteria ?? []);

  const matchedFiles = plannedFiles.filter((file) => changedFiles.includes(file));
  const coveredCount = manifest.verification_matrix.filter((criterion) =>
    coveredCriteria.has(criterion.criterion_id),
  ).length;

  return {
    scope_accuracy_pct:
      plannedFiles.length === 0 ? 100 : round((matchedFiles.length / plannedFiles.length) * 100),
    criteria_pass_rate_pct:
      manifest.verification_matrix.length === 0
        ? 100
        : round((coveredCount / manifest.verification_matrix.length) * 100),
    unplanned_files: changedFiles.filter((file) => !plannedFiles.includes(file)),
    planned_but_unused_files: plannedFiles.filter((file) => !usedFiles.includes(file)),
    uncovered_criteria: manifest.verification_matrix
      .map((criterion) => criterion.criterion_id)
      .filter((criterionId) => !coveredCriteria.has(criterionId)),
  };
}

export async function writePlanVsActual(
  root: string,
  slug: string,
  diff: PlanVsActualDiff,
): Promise<string> {
  const dir = join(root, PATHS.PLANNING_SPECS_DIR);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${slug}.plan-vs-actual.json`);
  await writeFile(filePath, JSON.stringify(diff, null, 2) + '\n', 'utf8');
  return filePath;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
