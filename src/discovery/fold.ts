// Discovery stage fold + completion verdict (issue #597).
//
// Folds a run's `stage-evidence.jsonl` rows into per-stage state and a single completion verdict.
// Like the feature-development fold, ordering is judged HERE (not at write time): the recorder is
// permissive so a stage can always be marked, and this is the one place that flags a later stage
// started before an earlier stage ended. A thinking stage counts as done only when it has a start,
// an end, and a real artifact digest (a bare marker pair folds inconclusive — DW-08).

import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import {
  DISCOVERY_STAGE_ORDER,
  MANDATORY_DISCOVERY_STAGES,
  discoveryStageIndex,
  isKnownDiscoveryStage,
  type DiscoveryStageId,
} from './stages.js';

/** The folded state of one stage. */
export interface FoldedDiscoveryStage {
  stage: DiscoveryStageId;
  started: boolean;
  ended: boolean;
  /** The digest of the artifact the end referenced, or null (no artifact = not proven). */
  artifactDigest: string | null;
  /** Earliest start timestamp seen, or null. */
  startedAt: string | null;
  /** Latest end timestamp seen, or null. */
  endedAt: string | null;
  /** started AND ended AND a real artifact digest. */
  complete: boolean;
}

/** One ordering violation: `later` started before `earlier` ended. */
export interface DiscoveryOrderingViolation {
  earlier: DiscoveryStageId;
  later: DiscoveryStageId;
}

export type DiscoveryVerdict = 'complete' | 'incomplete' | 'cannot-verify';

export interface FoldedDiscoveryRun {
  stages: FoldedDiscoveryStage[];
  /** Mandatory stages not yet complete. */
  missing: DiscoveryStageId[];
  orderingViolations: DiscoveryOrderingViolation[];
  verdict: DiscoveryVerdict;
}

interface StageAccumulator {
  started: boolean;
  ended: boolean;
  artifactDigest: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

function rowTime(row: SessionLedgerRow): string | null {
  const ts = row.ts ?? (row as Record<string, unknown>).recorded_at;
  return typeof ts === 'string' ? ts : null;
}

function minTime(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxTime(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/** Fold a run's stage rows into per-stage state, ordering violations, and a completion verdict. */
export function foldDiscoveryRun(rows: readonly SessionLedgerRow[]): FoldedDiscoveryRun {
  const acc = new Map<DiscoveryStageId, StageAccumulator>();
  for (const row of rows) {
    const stage = row.stage;
    if (typeof stage !== 'string' || !isKnownDiscoveryStage(stage)) {
      continue;
    }
    const entry: StageAccumulator = acc.get(stage) ?? {
      started: false,
      ended: false,
      artifactDigest: null,
      startedAt: null,
      endedAt: null,
    };
    const at = rowTime(row);
    if (row.kind === 'stage_start') {
      entry.started = true;
      entry.startedAt = minTime(entry.startedAt, at);
    } else if (row.kind === 'stage_end') {
      entry.ended = true;
      entry.endedAt = maxTime(entry.endedAt, at);
      const digest = (row as Record<string, unknown>).artifact_digest;
      if (typeof digest === 'string' && digest.length > 0) {
        entry.artifactDigest = digest;
      }
    }
    acc.set(stage, entry);
  }

  const stages: FoldedDiscoveryStage[] = DISCOVERY_STAGE_ORDER.map((stage) => {
    const entry = acc.get(stage);
    const started = entry?.started ?? false;
    const ended = entry?.ended ?? false;
    const artifactDigest = entry?.artifactDigest ?? null;
    return {
      stage,
      started,
      ended,
      artifactDigest,
      startedAt: entry?.startedAt ?? null,
      endedAt: entry?.endedAt ?? null,
      complete: started && ended && artifactDigest !== null,
    };
  });

  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const missing = MANDATORY_DISCOVERY_STAGES.filter((stage) => !byStage.get(stage)!.complete);

  const orderingViolations: DiscoveryOrderingViolation[] = [];
  for (const later of stages) {
    if (later.startedAt === null) continue;
    for (const earlier of stages) {
      if (discoveryStageIndex(earlier.stage) >= discoveryStageIndex(later.stage)) continue;
      if (earlier.endedAt !== null && later.startedAt < earlier.endedAt) {
        orderingViolations.push({ earlier: earlier.stage, later: later.stage });
      }
    }
  }

  const verdict: DiscoveryVerdict =
    missing.length === 0 && orderingViolations.length === 0
      ? 'complete'
      : rows.length === 0
        ? 'cannot-verify'
        : 'incomplete';

  return { stages, missing, orderingViolations, verdict };
}
