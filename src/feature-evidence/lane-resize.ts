import { agentOrchestratorEnabled, skillOrchestratorEnabled } from '@/authoring/config.js';
import { findAgentPaths, findSkillPaths, readSkillPathContext } from '@/authoring/paths.js';
import { readPendingImpact, type PendingImpact } from '@/stage-evidence/pending-lane.js';
import { resolveEffectiveLane } from '@/stage-evidence/effective-lane.js';

import { readFeatureRecord, updateFeatureRecord } from './feature-record.js';
import type {
  AuthoringMatchedPath,
  AuthoringPathKind,
  FeatureAuthoringLaneRaise,
  FeatureLaneMove,
  PlanStep,
} from './types.js';

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

const AUTHORING_KIND_WORDS: Record<AuthoringPathKind, { noun: string; seat: string }> = {
  skill: { noun: 'a skill', seat: 'the Skill Orchestrator' },
  agent: { noun: 'an agent', seat: 'the Agent Orchestrator' },
};

export function authoringRaiseReason(match: string | readonly AuthoringMatchedPath[]): string {
  const matches: readonly AuthoringMatchedPath[] =
    typeof match === 'string' ? [{ kind: 'skill', path: match }] : match;
  if (matches.length === 1) {
    const words = AUTHORING_KIND_WORDS[matches[0]!.kind];
    return (
      `the change creates or edits ${words.noun} (${matches[0]!.path}), so ${words.seat} sits at the ` +
      'High Table.'
    );
  }
  const parts = matches.map((entry) => `${AUTHORING_KIND_WORDS[entry.kind].noun} (${entry.path})`);
  const seats = matches.map((entry) => AUTHORING_KIND_WORDS[entry.kind].seat);
  return (
    `the change creates or edits ${parts.join(' and ')}, so ${seats.join(' and ')} sit at the ` +
    'High Table.'
  );
}

export function authoringMatches(
  projectRoot: string,
  files: readonly string[],
): AuthoringMatchedPath[] {
  const skillsOn = skillOrchestratorEnabled(projectRoot);
  const agentsOn = agentOrchestratorEnabled(projectRoot);
  if (!skillsOn && !agentsOn) return [];
  const context = readSkillPathContext(projectRoot);
  const matches: AuthoringMatchedPath[] = [];
  const skill = skillsOn ? findSkillPaths(files, context.adapters, context)[0] : undefined;
  if (skill !== undefined) matches.push({ kind: 'skill', path: skill });
  const agent = agentsOn ? findAgentPaths(files, context.adapters, context)[0] : undefined;
  if (agent !== undefined) matches.push({ kind: 'agent', path: agent });
  return matches;
}

export function authoringRaiseEnabled(projectRoot: string): boolean {
  return skillOrchestratorEnabled(projectRoot) || agentOrchestratorEnabled(projectRoot);
}

export function authoringRaisePaths(raise: FeatureAuthoringLaneRaise): AuthoringMatchedPath[] {
  return raise.paths !== undefined && raise.paths.length > 0
    ? raise.paths
    : [{ kind: 'skill', path: raise.path }];
}

export function raiseLaneForAuthoring(input: LaneRaiseInput): FeatureAuthoringLaneRaise | null {
  const record = readFeatureRecord(input.projectRoot, input.dirName);
  if (record?.lane !== 'fast' || record.lane_raised_for_authoring !== undefined) return null;
  if (!authoringRaiseEnabled(input.projectRoot)) return null;
  const candidates = [...new Set([...input.plannedFiles, ...editedFiles(input.changedFiles)])];
  const paths = authoringMatches(input.projectRoot, candidates);
  if (paths.length === 0) return null;
  const at = (input.now ?? (() => new Date()))().toISOString();
  const written = updateFeatureRecord(
    input.projectRoot,
    input.dirName,
    {
      raiseLaneForAuthoring: {
        reason: authoringRaiseReason(paths),
        path: paths[0]!.path,
        paths,
        at,
      },
    },
    input.now,
  );
  return written?.lane_raised_for_authoring?.at === at ? written.lane_raised_for_authoring : null;
}
