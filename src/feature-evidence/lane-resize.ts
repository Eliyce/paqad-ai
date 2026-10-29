import { readPendingImpact, type PendingImpact } from '@/stage-evidence/pending-lane.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';

import { readFeatureRecord, updateFeatureRecord } from './feature-record.js';
import type { FeatureLaneMove, PlanStep } from './types.js';

export const SMALL_CHANGE_MAX_FILES = 8;

const RISKY_DATABASE_IMPACTS: ReadonlySet<string> = new Set(['schema-change', 'data-migration']);
const RISKY_API_IMPACTS: ReadonlySet<string> = new Set(['breaking-change']);

export function planFiles(steps: readonly PlanStep[] | undefined): string[] {
  return [...new Set((steps ?? []).flatMap((step) => step.files ?? []))];
}

export function sensitivePaths(projectRoot: string, files: readonly string[]): string[] {
  return files.filter((file) => resolveEffectiveLane(projectRoot, file, 'graduated') === 'full');
}

export function isRiskyImpact(impact: PendingImpact | null): boolean {
  return (
    impact === null ||
    RISKY_DATABASE_IMPACTS.has(impact.database_impact) ||
    RISKY_API_IMPACTS.has(impact.api_impact)
  );
}

export function editedFiles(changedFiles: readonly string[]): string[] {
  return [...new Set(changedFiles)].filter((file) => !/^\.paqad(\/|$)/.test(file));
}

export function fileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

export interface PlanLaneResizeInput {
  projectRoot: string;
  sessionId: string;
  dirName: string;
  steps: readonly PlanStep[] | undefined;
  changedFiles: readonly string[];
  now?: () => Date;
}

export function planLaneResize(input: PlanLaneResizeInput): FeatureLaneMove | null {
  const record = readFeatureRecord(input.projectRoot, input.dirName);
  if (record?.lane !== 'full' || record.lane_source !== 'classifier' || record.lane_resized) {
    return null;
  }
  const files = planFiles(input.steps);
  if (
    files.length > SMALL_CHANGE_MAX_FILES ||
    sensitivePaths(input.projectRoot, files).length > 0 ||
    isRiskyImpact(readPendingImpact(input.projectRoot, input.sessionId)) ||
    editedFiles(input.changedFiles).length > 0
  ) {
    return null;
  }
  const at = (input.now ?? (() => new Date()))().toISOString();
  const written = updateFeatureRecord(
    input.projectRoot,
    input.dirName,
    {
      resizeLaneFromPlan: {
        reason: `the plan touches ${fileCount(files.length)}, none sensitive, no schema or breaking API change`,
        files: files.length,
        at,
      },
    },
    input.now,
  );
  return written?.lane_source === 'plan' && written.lane_resized?.at === at
    ? written.lane_resized
    : null;
}
