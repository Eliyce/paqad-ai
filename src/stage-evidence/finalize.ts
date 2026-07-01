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
  appendSessionEvent,
  currentOrdinal,
  readSessionUnit,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { endStage, openStageEvidence } from './recorder.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { validateStageEvidenceRow } from './schema.js';
import { STAGE_EVIDENCE_DOC_TYPE, STAGE_EVIDENCE_SCHEMA_VERSION } from './types.js';
import { verifyChange, type VerifyResult } from './verify.js';

export interface FinalizeStageEvidenceInput {
  adapter: string;
  /** Host session id when known; else resolved from the machine-local cache. */
  sessionId?: string | null;
  /** Number of files in the change's working-tree delta (0 = no code change). */
  changedFilesCount?: number;
  /** The git working-tree delta digest, for the inferred-git backstop record. */
  subjectDigest?: string | null;
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
    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    let ordinal = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);

    // Verify-once: the backstop fires on every completion, but the agent owns the
    // redo loop (its explicit `verify` calls). If the open change already carries a
    // verify row, leave it — don't auto-stack verifies (which would trip the redo
    // cap spuriously).
    if (ordinal > 0) {
      const existing = readSessionUnit(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId, ordinal);
      if (existing.some((row) => row.kind === 'verify')) {
        return null;
      }
      // Turn-boundary end (fix A partner): the PreToolUse live writer leaves the
      // last started stage open — there is no "last edit" signal pre-mutation. End
      // any still-open live-mark stage_start now, stamping ended_at from the
      // completion clock, so no started stage lacks an end time (R5) before folding.
      endDanglingLiveStages(projectRoot, sessionId, ordinal, existing, input);
    }

    if (ordinal === 0) {
      // No record open. Only write a backstop record when a real code change exists;
      // otherwise there is nothing to prove (a read-only or no-op turn).
      if (!input.changedFilesCount || input.changedFilesCount <= 0) {
        return null;
      }
      ordinal = openStageEvidence(projectRoot, {
        sessionId,
        adapter: input.adapter,
        now: input.now,
      }).ordinal;
      appendSessionEvent(
        projectRoot,
        STAGE_EVIDENCE_DOC_TYPE,
        sessionId,
        ordinal,
        {
          kind: 'stage_end',
          conversation_ordinal: ordinal,
          adapter: input.adapter,
          stage: 'development',
          event_status: 'inferred',
          evidence_source: 'inferred-git',
          subject_digest: input.subjectDigest ?? null,
        },
        {
          schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
          validate: (row: SessionLedgerRow) => validateStageEvidenceRow(row),
          now: input.now,
        },
      );
    }

    return verifyChange(projectRoot, {
      sessionId,
      ordinal,
      adapter: input.adapter,
      now: input.now,
    });
  } catch {
    // Best-effort: never let stage-evidence finalization break verification.
    return null;
  }
}

/**
 * End every live-mark stage that was started but not ended this change (the
 * PreToolUse writer's last open stage), stamping ended_at from the completion
 * clock. Best-effort per stage — a recorder error never breaks finalization.
 */
function endDanglingLiveStages(
  projectRoot: string,
  sessionId: string,
  ordinal: number,
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
          ordinal,
          adapter: input.adapter,
          now: input.now,
        },
      );
    } catch {
      /* best-effort: one stage failing to close never breaks the fold */
    }
  }
}
