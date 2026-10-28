import { isAbsolute, relative } from 'pathe';

import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

export { activeChangeKey, peekActiveChangeKey } from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { resolveEffectiveLane } from './effective-lane.js';
import { endStage, openStageEvidence, startStage } from './recorder.js';
import { startedAfterLastEnd } from './fold.js';
import {
  isEditStage,
  isKnownStage,
  isLaneStage,
  PRE_CODE_STAGES,
  requiredPreCodeStages,
  type StageId,
} from './stages.js';
import type { StageLane, StageSessionSource } from './types.js';

function toRelativePosix(projectRoot: string, targetPath: string): string {
  const rel = isAbsolute(targetPath) ? relative(projectRoot, targetPath) : targetPath;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

export { resolveAgentIdentity, ORCHESTRATOR_AGENT } from './agent-identity.js';

export function classifyStage(targetPath: string, projectRoot = ''): StageId | null {
  const p = projectRoot ? toRelativePosix(projectRoot, targetPath) : targetPath.replace(/\\/g, '/');

  if (p.startsWith('.paqad/') || p === '' || p.startsWith('../')) return null;

  if (
    p.startsWith('tests/') ||
    /(^|\/)__tests__\//.test(p) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)
  ) {
    return 'checks';
  }

  if (
    p.startsWith('docs/instructions/') ||
    p.startsWith('specs/') ||
    p.endsWith('.spec.md') ||
    /feature-spec/.test(p)
  ) {
    return 'specification';
  }

  if (
    /^README/i.test(p) ||
    /^CHANGELOG/i.test(p) ||
    p.startsWith('docs/') ||
    (/\.md$/.test(p) && !p.includes('/'))
  ) {
    return 'documentation_sync';
  }

  if (
    p.startsWith('src/') ||
    p.startsWith('lib/') ||
    p.startsWith('app/') ||
    p.startsWith('scripts/') ||
    p.startsWith('runtime/') ||
    /\/src\//.test(p) ||
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)
  ) {
    return 'development';
  }

  return null;
}

export interface LiveWriteInput {
  projectRoot: string;
  sessionId?: string | null;
  toolName: string;
  targetPath: string;
  adapter?: string;
  agent?: string;
  now?: () => Date;
}

export function stagesWithKind(rows: readonly SessionLedgerRow[], kind: string): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.kind === kind && typeof row.stage === 'string') set.add(row.stage);
  }
  return set;
}

export function preCodeStagesRecorded(rows: readonly SessionLedgerRow[], lane: StageLane): boolean {
  const started = stagesWithKind(rows, 'stage_start');
  return requiredPreCodeStages(lane).every((stage) => started.has(stage));
}

export function stageIsOpen(rows: readonly SessionLedgerRow[], stage: string): boolean {
  return startedAfterLastEnd(rows.filter((row) => row.stage === stage));
}

export function liveEditStage(lane: StageLane, classified: StageId): StageId {
  return isLaneStage(lane, classified) ? classified : 'development';
}

export function liveStageToStart(
  rows: readonly SessionLedgerRow[],
  lane: StageLane,
  classified: StageId,
): StageId | null {
  if (!preCodeStagesRecorded(rows, lane)) return null;
  const stage = liveEditStage(lane, classified);
  return !isEditStage(stage) || stageIsOpen(rows, stage) ? null : stage;
}

export function recordLiveStageEdit(input: LiveWriteInput): StageId | null {
  const { projectRoot, targetPath, now } = input;
  const classified = classifyStage(targetPath, projectRoot);
  if (!classified) return null;

  try {
    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    const dirName = currentFeature(projectRoot, sessionId);
    const rows = dirName ? readFeatureStageUnit(projectRoot, dirName) : [];
    const recordedLane = dirName ? readChangeConstants(projectRoot, dirName, rows).lane : null;
    const lane = resolveEffectiveLane(projectRoot, targetPath, recordedLane);
    if (!preCodeStagesRecorded(rows, lane)) return null;
    const stage = liveEditStage(lane, classified);
    if (!liveStageToStart(rows, lane, classified)) return stage;
    const ctx = {
      sessionId,
      sessionSource: input.sessionId?.trim() ? ('host' as const) : undefined,
      dirName: dirName!,
      adapter: input.adapter ?? 'claude-code',
      agent: input.agent,
      now,
    };
    for (const preCode of PRE_CODE_STAGES) {
      if (stageIsOpen(rows, preCode)) endStage(projectRoot, preCode, {}, ctx);
    }
    startStage(projectRoot, stage, ctx);
    return stage;
  } catch {
    return null;
  }
}

export interface LiveWriteBatchInput {
  projectRoot: string;
  sessionId?: string | null;
  toolName: string;
  targetPaths: readonly string[];
  adapter?: string;
  agent?: string;
  now?: () => Date;
}

export function recordLiveStageEdits(input: LiveWriteBatchInput): StageId[] {
  const recorded: StageId[] = [];
  for (const targetPath of input.targetPaths) {
    const stage = recordLiveStageEdit({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      toolName: input.toolName,
      targetPath,
      adapter: input.adapter,
      agent: input.agent,
      now: input.now,
    });
    if (stage && !recorded.includes(stage)) {
      recorded.push(stage);
    }
  }
  return recorded;
}

export type MarkedStagePhase = 'start' | 'end';

export interface MarkedStageInput {
  sessionId?: string | null;
  sessionSource?: StageSessionSource;
  agent?: string;
  agentId?: string;
  stage: string;
  phase: MarkedStagePhase;
  artifactPaths?: string[];
  adapter?: string;
  title?: string;
  issue?: string | null;
  now?: () => Date;
}

function closeOpenStagesForMarkedStart(
  projectRoot: string,
  targetStage: string,
  ctx: {
    sessionId?: string | null;
    sessionSource?: StageSessionSource;
    adapter: string;
    now?: () => Date;
  },
): void {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) return;
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const started = stagesWithKind(rows, 'stage_start');
  const ended = stagesWithKind(rows, 'stage_end');
  for (const row of rows) {
    if (row.kind !== 'stage_start' || typeof row.stage !== 'string') continue;
    const s = row.stage;
    if (s !== targetStage && started.has(s) && !ended.has(s)) {
      ended.add(s);
      try {
        endStage(
          projectRoot,
          s,
          {},
          {
            sessionId,
            sessionSource: ctx.sessionSource,
            dirName,
            adapter: ctx.adapter,
            now: ctx.now,
          },
        );
      } catch {}
    }
  }
}

export function recordMarkedStage(projectRoot: string, input: MarkedStageInput): boolean {
  if (!isKnownStage(input.stage)) return false;
  const ctx = {
    sessionId: input.sessionId,
    sessionSource: input.sessionSource,
    adapter: input.adapter ?? 'claude-code',
    agent: input.agent,
    now: input.now,
  };
  try {
    if (input.phase === 'start' && input.title !== undefined) {
      openStageEvidence(projectRoot, { ...ctx, title: input.title, issue: input.issue });
    }
    if (input.phase === 'start') {
      closeOpenStagesForMarkedStart(projectRoot, input.stage, ctx);
      startStage(projectRoot, input.stage, {
        ...ctx,
        ...(input.agentId?.trim() ? { agentId: input.agentId.trim() } : {}),
      });
    } else {
      endStage(projectRoot, input.stage, { artifactPaths: input.artifactPaths ?? [] }, ctx);
    }
    return true;
  } catch {
    return false;
  }
}
