import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { resolveEffectiveLane } from './effective-lane.js';
import { classifyStage, liveStageToStart } from './live-writer.js';
import { type StageId } from './stages.js';

export const STAGE_NARRATION: Record<StageId, string> = {
  ticket_intake: 'picking up the ticket and reading what it needs',
  planning: 'planning this out, checking which module it touches',
  specification: 'writing the spec before any code',
  development: 'building it to the spec',
  review: 'reviewing the change for regressions',
  checks: 'running the gates: format, tests, build, rules',
  documentation_sync: 'syncing the docs this change touched',
  delivery: 'delivering per the branch and PR conventions',
};

export function stageNarrationLine(stage: string): string {
  const text = STAGE_NARRATION[stage as StageId];
  return text ? `**▸ paqad** · ${text}` : '';
}

export interface NarrateStageInput {
  projectRoot: string;
  sessionId?: string | null;
  targetPath: string;
}

export function narrateStageEntry(input: NarrateStageInput): string | null {
  const stage = classifyStage(input.targetPath, input.projectRoot);
  if (!stage) return null;

  try {
    const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
    const dirName = currentFeature(input.projectRoot, sessionId);
    const rows = dirName ? readFeatureStageUnit(input.projectRoot, dirName) : [];
    const recordedLane = dirName
      ? readChangeConstants(input.projectRoot, dirName, rows).lane
      : null;
    const lane = resolveEffectiveLane(input.projectRoot, input.targetPath, recordedLane);
    const toStart = liveStageToStart(rows, lane, stage);
    return toStart ? stageNarrationLine(toStart) : null;
  } catch {
    return null;
  }
}

export function markerNarrationLine(stage: string, phase: 'start' | 'end'): string {
  if (!STAGE_NARRATION[stage as StageId]) return '';
  if (phase === 'end') return '';
  return stageNarrationLine(stage);
}

export function markerBatchNarration(markers: readonly { stage: string; phase: string }[]): string {
  const lines: string[] = [];
  for (const marker of markers) {
    const line = markerNarrationLine(marker.stage, marker.phase === 'start' ? 'start' : 'end');
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
