// Always-on stage-evidence finalizer (issue #247 C1 / Phase 3).
//
// Called from the verification backstop (run-repository-verification) AFTER the
// global enabled-check and BEFORE the enterprise/AI-BOM block — so it runs for any
// enabled onboarded project regardless of enterprise flags, and is a pure no-op
// when paqad is disabled (the caller already returned). This module imports NO
// enterprise code (proven by the import-boundary test). Best-effort: a failure here
// never changes the verification verdict.
//
// At completion this is the end-of-change gate firing automatically on every
// hook-capable provider (Claude Stop, Codex/Gemini completion): it verifies the
// change the agent recorded. When a code diff exists but no record was opened (a
// provider with no live hooks, or an agent that skipped the verbs), it writes a
// single inferred-git backstop record anchored to the real working-tree delta and
// verifies that — honestly `incomplete`, never a false `complete`.

import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { type SessionLedgerRow } from '@/session-ledger/ledger.js';

import { endStage, openStageEvidence } from './recorder.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { verifyChange, type VerifyResult } from './verify.js';

export interface FinalizeStageEvidenceInput {
  adapter: string;
  /** Host session id when known; else resolved from the machine-local cache. */
  sessionId?: string | null;
  /** Number of files in the change's working-tree delta (0 = no code change). */
  changedFilesCount?: number;
  /** The git working-tree delta digest, for the inferred-git backstop record. */
  subjectDigest?: string | null;
  /**
   * Whether the change is feature development (issue #310). The feature-development
   * completeness gate applies only to a change that touches product source; a
   * documentation-only / framework-internal change is not a feature being built, so
   * `false` makes finalize a no-op (mirrors the pre-mutation gate's docs skip). When
   * omitted (undefined) the change is treated as feature development — a fail-closed
   * default that preserves the pre-#310 behaviour for any caller that does not
   * classify the diff.
   */
  isFeatureDevChange?: boolean;
  now?: () => Date;
}

/**
 * Verify the open change (or write an inferred-git backstop record for an untracked
 * code diff, then verify). Returns the verdict, or null when there is nothing to
 * finalize (no open change and no code diff) or on any error.
 */
export function finalizeStageEvidence(
  projectRoot: string,
  input: FinalizeStageEvidenceInput,
): VerifyResult | null {
  try {
    // Scope (issue #310): the feature-development completeness gate applies only to a
    // feature-development change. A documentation-only / framework-internal change
    // (isFeatureDevChange === false) is not a feature being built — there are no code
    // stages to verify — so finalize is a no-op, mirroring the pre-mutation gate's
    // docs skip. undefined stays feature-dev (fail-closed) for callers that do not
    // classify the diff.
    if (input.isFeatureDevChange === false) {
      return null;
    }

    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    let dirName = currentFeature(projectRoot, sessionId);

    // Re-verify each completion (issue #321): the backstop fires on every Stop and
    // each change earns its OWN verdict. There is no verify-once early return — a
    // passing change is CLOSED below (its active pointer cleared), so a later Stop sees
    // no active feature and no-ops rather than re-stacking verifies; an open
    // (incomplete) change is legitimately re-verified as the agent runs its redo loop.
    // The redo cap (verify.ts) counts only failures since the last stage mutation, so
    // re-verifying never spuriously trips it.
    if (dirName) {
      const existing = readFeatureStageUnit(projectRoot, dirName);
      // Turn-boundary end (fix A partner): the PreToolUse live writer leaves the
      // last started stage open — there is no "last edit" signal pre-mutation. End
      // any still-open live-mark stage_start now, stamping ended_at from the
      // completion clock, so no started stage lacks an end time (R5) before folding.
      endDanglingLiveStages(projectRoot, sessionId, dirName, existing, input);
      // Development backfill (issue #310): a real code change must show a development
      // stage. When the pre-code stages were recorded (an active feature) but no
      // development row exists — the live writer defers development until
      // planning/specification exist (F2), so a single same-turn edit whose
      // planning/spec landed via the capability-gate sweep AFTER the writer ran never
      // gets a live development mark — infer it from the working-tree delta, so a
      // genuine code change is never falsely 'incomplete' for a missing development row.
      backfillMissingDevelopment(projectRoot, sessionId, dirName, input);
    } else {
      // No record open. Only write a backstop record when a real code change exists;
      // otherwise there is nothing to prove (a read-only or no-op turn).
      if (!input.changedFilesCount || input.changedFilesCount <= 0) {
        return null;
      }
      dirName = openStageEvidence(projectRoot, {
        sessionId,
        adapter: input.adapter,
        now: input.now,
      }).dirName;
      appendInferredDevelopment(projectRoot, sessionId, dirName, input);
    }

    const result = verifyChange(projectRoot, {
      sessionId,
      dirName,
      adapter: input.adapter,
      now: input.now,
    });

    // Close on pass (issue #321): a passing change has earned its verdict, so record a
    // `close` row and clear the active feature. The next stage/edit then opens a FRESH
    // feature — so change #2+ in a session no longer free-rides on change #1's markers,
    // and the pre-code gate re-arms for each change. An incomplete/blocked change stays
    // open for the agent's redo loop (re-verified next Stop).
    if (result.ok) {
      appendClose(projectRoot, sessionId, dirName, input, result.verdict);
      closeActiveFeature(projectRoot, sessionId, input.now);
    }
    return result;
  } catch {
    // Best-effort: never let stage-evidence finalization break verification.
    return null;
  }
}

/** Append the `kind:'close'` row that brackets a passing change (issue #321). It marks
 *  the change complete on the ledger before the `.open` pointer advances, so the
 *  open…close bracket is inspectable (one per change). Best-effort caller-side. */
function appendClose(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  input: FinalizeStageEvidenceInput,
  verdict: string,
): void {
  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: 'close',
      adapter: input.adapter,
      event_status: 'completed',
      note: `closed; verdict=${verdict}`,
    },
    input.now,
  );
}

/**
 * End every live-mark stage that was started but not ended this change (the
 * PreToolUse writer's last open stage), stamping ended_at from the completion
 * clock. Best-effort per stage — a recorder error never breaks finalization.
 */
function endDanglingLiveStages(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  rows: readonly SessionLedgerRow[],
  input: FinalizeStageEvidenceInput,
): void {
  const started = new Set<string>();
  const ended = new Set<string>();
  for (const row of rows) {
    if (typeof row.stage !== 'string') continue;
    if (row.kind === 'stage_start' && row.evidence_source === 'live-mark') started.add(row.stage);
    if (row.kind === 'stage_end') ended.add(row.stage);
  }
  for (const stage of started) {
    if (ended.has(stage)) continue;
    try {
      endStage(
        projectRoot,
        stage,
        {},
        {
          sessionId,
          dirName,
          adapter: input.adapter,
          now: input.now,
        },
      );
    } catch {
      /* best-effort: one stage failing to close never breaks the fold */
    }
  }
}

/**
 * Backfill an inferred-git `development` row (issue #310) when a feature-development
 * change with a real working-tree delta carries no development stage yet. The live
 * writer defers a development mark until the pre-code stages exist (F2), so a single
 * same-turn edit whose planning/specification landed via the capability-gate sweep
 * AFTER the writer ran never gets a live development row. Without this, a genuine code
 * change would fold to `incomplete` purely for a missing development row. Best-effort.
 */
function backfillMissingDevelopment(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  input: FinalizeStageEvidenceInput,
): void {
  if (!input.changedFilesCount || input.changedFilesCount <= 0) {
    return;
  }
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const hasDevelopment = rows.some(
    (row) =>
      row.stage === 'development' && (row.kind === 'stage_start' || row.kind === 'stage_end'),
  );
  if (hasDevelopment) {
    return;
  }
  appendInferredDevelopment(projectRoot, sessionId, dirName, input);
}

/** Append the inferred-git `development` backstop row for an untracked code diff —
 *  an end-only development stage anchored to the working-tree delta digest. Shared by
 *  the no-record path and the #310 development backfill so both mint an identical row. */
function appendInferredDevelopment(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  input: FinalizeStageEvidenceInput,
): void {
  appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      kind: 'stage_end',
      adapter: input.adapter,
      stage: 'development',
      event_status: 'inferred',
      evidence_source: 'inferred-git',
      subject_digest: input.subjectDigest ?? null,
    },
    input.now,
  );
}
