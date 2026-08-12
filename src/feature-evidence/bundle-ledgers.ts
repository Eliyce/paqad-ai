// Per-feature bundle ledgers (issue #339, Phase 4): rule-run.jsonl + the RAG two-home
// router. These re-home feature-scoped evidence into the bundle so a feature dir holds
// its whole workflow record, not just the stage spine.
//
// - RAG two-home routing: retrieval fires at prompt-submit, BEFORE a feature is minted
//   at planning-start, so a rag row routes to the ACTIVE feature's `rag.jsonl` when one
//   exists, else to the session's `_chat/<session>/rag.jsonl` home. A new feature's first
//   prompt therefore lands in `_chat` and is feature-attributed from prompt 2 (the
//   documented one-prompt lag), achieved purely by routing on the active feature.
// - rule-run.jsonl: which rules fired on THIS change, appended into the active feature's
//   bundle (a no-op when no feature is active). Rows are stamped + hashed by the shared
//   session-ledger primitives, so the bytes are script-owned.

import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { readEvidenceRowsAt } from '@/evidence/ledger.js';
import {
  allocateOrdinal,
  appendStampedRowToUnit,
  currentOrdinal,
  readUnitFile,
  stampSessionRow,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { DuplicationReport } from '@/duplication/report.js';

import { chatRagPath, featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

/** Doc type stamped on a per-feature `rule-run.jsonl` row. */
export const RULE_RUN_DOC_TYPE = 'paqad.rule-run';
export const RULE_RUN_SCHEMA_VERSION = 1;

/** Doc type stamped on a per-feature `duplication.jsonl` row (issue #468, Phase A). */
export const DUPLICATION_RUN_DOC_TYPE = 'paqad.duplication-run';
export const DUPLICATION_RUN_SCHEMA_VERSION = 1;

/** Doc type stamped on a per-feature `change-metrics.jsonl` row (issue #468, Phase A). */
export const CHANGE_METRICS_RUN_DOC_TYPE = 'paqad.change-metrics';
export const CHANGE_METRICS_RUN_SCHEMA_VERSION = 1;

/**
 * The project-relative home a RAG row for `sessionId` belongs to: the active feature's
 * `rag.jsonl` when a feature is open, else the session's `_chat` retrieval ledger. This
 * is the whole of the two-home routing — the one-prompt lag falls out of "no active
 * feature yet ⇒ chat".
 */
export function resolveRagHome(projectRoot: string, sessionId: string): string {
  const dirName = currentFeature(projectRoot, sessionId);
  return dirName ? featureFilePath(dirName, 'rag') : chatRagPath(sessionId);
}

/**
 * DocType whose session-ledger directory coincides exactly with `_chat/<session>`
 * (`join('.paqad/ledger', '_chat', session)` === `chatDir(session)`), so the RAG
 * conversation ordinal — the `.open` pointer and the race-safe exclusive-create
 * allocation markers — lives in the same `_chat` home as the chat `rag.jsonl` rows
 * (issue #468 Phase C). Reusing the canonical session-ledger allocator keeps the
 * background worker, the TS recorder, and the mjs prompt seam on one ordinal.
 */
const CHAT_ORDINAL_DOC = '_chat';

/** Allocate the next RAG conversation ordinal in the session's `_chat` home. */
export function allocateChatOrdinal(projectRoot: string, sessionId: string): number {
  return allocateOrdinal(projectRoot, CHAT_ORDINAL_DOC, sessionId);
}

/** The current open RAG conversation ordinal for the session's `_chat` home, or 0. */
export function currentChatOrdinal(projectRoot: string, sessionId: string): number {
  return currentOrdinal(projectRoot, CHAT_ORDINAL_DOC, sessionId);
}

/**
 * Best-effort mirror of an already-stamped RAG row into its two-home destination (the
 * active feature's bundle or `_chat`). Additive: the session-substrate write the RAG
 * recorder already does is untouched; this co-locates the same row with the feature it
 * served. Never throws — RAG recording must never break the prompt path.
 */
export function mirrorRagRow(
  projectRoot: string,
  sessionId: string,
  stampedRow: SessionLedgerRow,
): void {
  try {
    appendStampedRowToUnit(projectRoot, resolveRagHome(projectRoot, sessionId), stampedRow);
  } catch {
    // Best-effort: a mirror failure is invisible to the runtime path.
  }
}

/** A per-change rule-run entry — which rules fired and the outcome. */
export interface RuleRunEntry {
  /** `findings` (a rule-script run) or `drift` (the reconciler), mirroring rule-ledger. */
  kind: 'findings' | 'drift';
  /** Finding-code or category counts for this run. */
  counts: Record<string, number>;
  /** Whether this run blocks (a strict deterministic violation). */
  blocking: boolean;
  adapter?: string;
  note?: string | null;
  /** Issue #468 Phase C — true when minted by the existence gate's backfill (not a live run). */
  backfilled?: boolean;
  now?: () => Date;
}

/**
 * Append a rule-run row into the ACTIVE feature's `rule-run.jsonl`, recording which
 * rules fired on this change. A no-op (returns null) when no feature is active — a
 * rule run outside a feature-development change has no bundle to attach to. Best-effort:
 * a failure never breaks enforcement. Returns the stamped row (or null).
 */
export function appendRuleRun(
  projectRoot: string,
  sessionId: string,
  entry: RuleRunEntry,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const stamped = stampSessionRow(
      RULE_RUN_DOC_TYPE,
      sessionId,
      {
        kind: entry.kind,
        counts: entry.counts,
        blocking: entry.blocking,
        adapter: entry.adapter ?? 'claude-code',
        note: entry.note ?? null,
        ...(entry.backfilled ? { backfilled: true } : {}),
      },
      { schemaVersion: RULE_RUN_SCHEMA_VERSION, now: entry.now },
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'ruleRun'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

/** Tolerant read of a feature's `rule-run.jsonl` rows. */
export function readRuleRun(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'ruleRun'));
}

/**
 * Issue #468, Phase A — append one duplication row into the ACTIVE feature's
 * `duplication.jsonl`, recording the scan's counts/threshold/mode for this change. A
 * no-op (returns null) when no feature is active, mirroring {@link appendRuleRun}. The
 * payload fields match the old-home `recordDuplicationRun` row so the parity window can
 * prove the two agree. Additive and best-effort: a failure never breaks the scan.
 */
export function appendDuplicationRun(
  projectRoot: string,
  sessionId: string,
  report: DuplicationReport,
  now?: () => Date,
  backfilled = false,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const stamped = stampSessionRow(
      DUPLICATION_RUN_DOC_TYPE,
      sessionId,
      {
        counts: report.counts,
        similarity_threshold: report.similarity_threshold,
        min_lines: report.min_lines,
        mode: report.mode,
        blocking: report.blocking,
        ...(backfilled ? { backfilled: true } : {}),
      },
      { schemaVersion: DUPLICATION_RUN_SCHEMA_VERSION, now },
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'duplication'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

/** Tolerant read of a feature's `duplication.jsonl` rows. */
export function readDuplication(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'duplication'));
}

/**
 * Issue #468, Phase A — append one change-metrics row into the ACTIVE feature's
 * `change-metrics.jsonl`. A no-op (returns null) when no feature is active, mirroring
 * {@link appendRuleRun}. The payload fields match the old-home `recordChangeMetrics` row
 * so the parity window can prove the two agree. Additive and best-effort.
 */
export function appendChangeMetrics(
  projectRoot: string,
  sessionId: string,
  metrics: ChangeMetrics,
  now?: () => Date,
  backfilled = false,
): SessionLedgerRow | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  try {
    const stamped = stampSessionRow(
      CHANGE_METRICS_RUN_DOC_TYPE,
      sessionId,
      {
        dup_new_pct: metrics.dup_new_pct,
        reuse_rate: metrics.reuse_rate,
        meaningful_changed_lines: metrics.meaningful_changed_lines,
        flagged_lines: metrics.inputs.flagged_lines,
        reuse_calls: metrics.inputs.reuse_calls,
        ...(backfilled ? { backfilled: true } : {}),
      },
      { schemaVersion: CHANGE_METRICS_RUN_SCHEMA_VERSION, now },
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'changeMetrics'), stamped);
    return stamped;
  } catch {
    return null;
  }
}

/** Tolerant read of a feature's `change-metrics.jsonl` rows. */
export function readChangeMetrics(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'changeMetrics'));
}

/**
 * Issue #468, Phase A (D5) — append the graded gate rows into the ACTIVE feature's
 * `evidence.jsonl`. The rows are already self-stamped {@link EvidenceLedgerRow}s (their
 * own `content_hash` identity), so they are written verbatim — no re-stamping — beside
 * the identical top-level `.paqad/ledger/evidence.jsonl` write, which is untouched here.
 * A no-op (returns `[]`) when no feature is active or the row set is empty. Best-effort.
 */
export function appendFeatureEvidenceRows(
  projectRoot: string,
  sessionId: string,
  rows: readonly EvidenceLedgerRow[],
): EvidenceLedgerRow[] {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName || rows.length === 0) {
    return [];
  }
  try {
    const path = featureFilePath(dirName, 'evidence');
    for (const row of rows) {
      // `EvidenceLedgerRow` carries its own envelope; append it verbatim as one JSONL
      // line via the shared writer (which only stringifies). Cast is the shape bridge.
      appendStampedRowToUnit(projectRoot, path, row as unknown as SessionLedgerRow);
    }
    return [...rows];
  } catch {
    return [];
  }
}

/** Tolerant read of a feature's `evidence.jsonl` graded gate rows. */
export function readFeatureEvidence(projectRoot: string, dirName: string): EvidenceLedgerRow[] {
  return readEvidenceRowsAt(projectRoot, featureFilePath(dirName, 'evidence'));
}
