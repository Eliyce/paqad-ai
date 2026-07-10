// On-screen stage narration (RCA Step 5a — the visible-on-entry line).
//
// The narration contract says paqad speaks ONE plain-English line as it enters each
// feature-development stage, so the developer sees the framework working stage by stage
// (docs/instructions/rules/coding/feature-development.md). The model narrates that in
// prose, but a deterministic backstop guarantees it even when the model forgets: the
// stage-writer PreToolUse hook prints the line the FIRST time a change enters a stage.
//
// This module is the pure, coverage-counted logic. `narrateStageEntry` is a READ-ONLY
// predicate — it never writes a ledger row — that returns the line to print IFF this
// edit would newly enter a stage, mirroring exactly the entry decision the live writer
// makes (it reuses the writer's own `stagesWithKind` / `highestStartedIndex`, so the
// two can never drift). First-entry idempotency is keyed on the stage-evidence ledger,
// so a second edit within the same stage prints nothing.

import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import {
  classifyStage,
  highestStartedIndex,
  preCodeStagesRecorded,
  stagesWithKind,
} from './live-writer.js';
import { stageIndex, type StageId } from './stages.js';

/**
 * The plain-English line for each stage, verbatim from the narration contract's
 * examples (feature-development.md — "Announce each stage"). Total over StageId so a
 * new stage can never be silently unnarrated.
 */
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

/** The branded status line for entering `stage`, or '' for an unknown stage id. */
export function stageNarrationLine(stage: string): string {
  const text = STAGE_NARRATION[stage as StageId];
  return text ? `▸ paqad · ${text}` : '';
}

export interface NarrateStageInput {
  projectRoot: string;
  sessionId?: string | null;
  targetPath: string;
}

/**
 * The narration line to print for one mutating edit, or null when this edit does NOT
 * newly enter a stage (non-stage-bearing file, a stage already entered this change, or
 * an out-of-order edit the writer would ignore). Read-only and best-effort: any
 * resolution/IO error yields null so the hook stays a silent, non-blocking writer.
 */
export function narrateStageEntry(input: NarrateStageInput): string | null {
  const stage = classifyStage(input.targetPath, input.projectRoot);
  if (!stage) return null;

  try {
    const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
    const dirName = currentFeature(input.projectRoot, sessionId);
    const rows = dirName ? readFeatureStageUnit(input.projectRoot, dirName) : [];
    // F2 (issue #310): mirror the live writer's defer — until the pre-code stages
    // (planning, specification) are recorded, a file edit records no stage, so it
    // enters none and narrates nothing (a docs-only or pre-planning edit stays quiet).
    if (!preCodeStagesRecorded(rows)) {
      return null;
    }
    // Already recording this stage → not a first entry (idempotent, prints once).
    if (stagesWithKind(rows, 'stage_start').has(stage)) {
      return null;
    }
    // Out of order (an earlier stage after a later one already began): the writer
    // records nothing, so narrate nothing.
    const highest = highestStartedIndex(rows);
    if (highest >= 0 && stageIndex(stage) < highest) {
      return null;
    }
    return stageNarrationLine(stage);
  } catch {
    return null;
  }
}

/**
 * The visible line for a marker-recorded stage boundary. Issue #325 inverts the
 * cadence: the per-marker END line duplicated the model's own prose, and the honest
 * end-of-change receipt now carries each stage's done-state, so the END boundary is
 * no longer spoken (only the START — the "entering this stage" signal — narrates).
 * The ledger write is unchanged: recording is non-negotiable, only the second spoken
 * line is dropped. '' for an unknown stage id, mirroring `stageNarrationLine`.
 */
export function markerNarrationLine(stage: string, phase: 'start' | 'end'): string {
  if (!STAGE_NARRATION[stage as StageId]) return '';
  if (phase === 'end') return '';
  return stageNarrationLine(stage);
}

/** One user-visible narration block for a batch of just-recorded markers, or ''
 *  when nothing was recorded. Order follows the recording order. */
export function markerBatchNarration(markers: readonly { stage: string; phase: string }[]): string {
  const lines: string[] = [];
  for (const marker of markers) {
    const line = markerNarrationLine(marker.stage, marker.phase === 'start' ? 'start' : 'end');
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
