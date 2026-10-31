import { skillOrchestratorEnabled } from '@/authoring/config.js';
import { findSkillPaths, readSkillPathContext } from '@/authoring/paths.js';
import { readPendingImpact, type PendingImpact } from '@/stage-evidence/pending-lane.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';

import { readFeatureRecord, updateFeatureRecord } from './feature-record.js';
import type { FeatureAuthoringLaneRaise, FeatureLaneMove, PlanStep } from './types.js';

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
  changesKnown: boolean;
  now?: () => Date;
}

export function planLaneResize(input: PlanLaneResizeInput): FeatureLaneMove | null {
  if (!input.changesKnown) return null;
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

export interface LaneRaiseInput {
  projectRoot: string;
  dirName: string;
  plannedFiles: readonly string[];
  changedFiles: readonly string[];
  now?: () => Date;
}

function raiseFacts(input: LaneRaiseInput): { reason: string; files: number } | null {
  const edited = editedFiles(input.changedFiles);
  if (edited.length > SMALL_CHANGE_MAX_FILES) {
    return { reason: `the change now touches ${fileCount(edited.length)}`, files: edited.length };
  }
  const sensitive = sensitivePaths(input.projectRoot, [
    ...new Set([...edited, ...input.plannedFiles]),
  ]);
  return sensitive.length > 0
    ? { reason: `the change touches a sensitive path: ${sensitive[0]}`, files: edited.length }
    : null;
}

export function laneMayRise(projectRoot: string, dirName: string): boolean {
  const record = readFeatureRecord(projectRoot, dirName);
  if (record?.lane !== 'graduated' || record.lane_raised) return false;
  return record.lane_source === 'plan' || record.lane_raised_for_authoring !== undefined;
}

export function raiseLaneIfGrown(input: LaneRaiseInput): FeatureLaneMove | null {
  if (!laneMayRise(input.projectRoot, input.dirName)) return null;
  const facts = raiseFacts(input);
  if (facts === null) return null;
  const at = (input.now ?? (() => new Date()))().toISOString();
  const written = updateFeatureRecord(
    input.projectRoot,
    input.dirName,
    { raiseLaneFromChange: { ...facts, at } },
    input.now,
  );
  return written?.lane_raised?.at === at ? written.lane_raised : null;
}

export function authoringRaiseReason(path: string): string {
  return (
    `the change creates or edits a skill (${path}), so the Skill Orchestrator sits at the ` +
    'High Table.'
  );
}

export function raiseLaneForAuthoring(input: LaneRaiseInput): FeatureAuthoringLaneRaise | null {
  const record = readFeatureRecord(input.projectRoot, input.dirName);
  if (record?.lane !== 'fast' || record.lane_raised_for_authoring !== undefined) return null;
  if (!skillOrchestratorEnabled(input.projectRoot)) return null;
  const context = readSkillPathContext(input.projectRoot);
  const candidates = [...new Set([...input.plannedFiles, ...editedFiles(input.changedFiles)])];
  const path = findSkillPaths(candidates, context.adapters, context)[0];
  if (path === undefined) return null;
  const at = (input.now ?? (() => new Date()))().toISOString();
  const written = updateFeatureRecord(
    input.projectRoot,
    input.dirName,
    { raiseLaneForAuthoring: { reason: authoringRaiseReason(path), path, at } },
    input.now,
  );
  return written?.lane_raised_for_authoring?.at === at ? written.lane_raised_for_authoring : null;
}
