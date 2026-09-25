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
//
// Issue #581 (FR-5) — every row written into a bundle here (rule-run, duplication,
// change-metrics, evidence, and the bundle copy of a RAG row) is stamped by the envelope's
// `stampBundleRow`: the six-field header, with `change` the folder-name ULID and
// `recorded_at` in place of `ts`, then the row's own fields. `doc_type` is the same on every
// row of a file (`paqad.<file-stem>`). No row carries the `adapter`: the host is a session
// constant of the change, stored once in feature.json. Readers take the time through
// `rowRecordedAt`, so a bundle written before #581 still reads.

import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { readEvidenceRowsAt } from '@/evidence/ledger.js';
import {
  allocateOrdinal,
  appendStampedRowToUnit,
  currentOrdinal,
  readUnitFile,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { DuplicationReport } from '@/duplication/report.js';

import { ENVELOPE_HEADER_KEYS, stampBundleRow } from './envelope.js';
import { chatRagPath, featureChangeKey, featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

/** Doc type stamped on a per-feature `rule-run.jsonl` row. */
export const RULE_RUN_DOC_TYPE = 'paqad.rule-run';
/** Version 2 (issue #581): the envelope header, no `adapter`. Version 1 rows still read. */
export const RULE_RUN_SCHEMA_VERSION = 2;

/**
 * Doc type stamped on a per-feature `duplication.jsonl` row (issue #468, Phase A). Issue
 * #581 renamed it from `paqad.duplication-run` so it matches the file stem; a reader maps the
 * old name through `normalizeDocType`.
 */
export const DUPLICATION_RUN_DOC_TYPE = 'paqad.duplication';
export const DUPLICATION_RUN_SCHEMA_VERSION = 2;

/** Doc type stamped on a per-feature `change-metrics.jsonl` row (issue #468, Phase A). */
export const CHANGE_METRICS_RUN_DOC_TYPE = 'paqad.change-metrics';
export const CHANGE_METRICS_RUN_SCHEMA_VERSION = 2;

/** Doc type of a feature bundle's `rag.jsonl` row (issue #581; the `_chat` home keeps its own). */
export const BUNDLE_RAG_DOC_TYPE = 'paqad.rag';
export const BUNDLE_RAG_SCHEMA_VERSION = 2;

/** Doc type of a feature bundle's `evidence.jsonl` row (issue #581). */
export const BUNDLE_EVIDENCE_DOC_TYPE = 'paqad.evidence';
export const BUNDLE_EVIDENCE_SCHEMA_VERSION = 2;

/** The keys a session-ledger or evidence row carries that the bundle header replaces. */
const ROW_HEADER_KEYS: ReadonlySet<string> = new Set([...ENVELOPE_HEADER_KEYS, 'ts']);

/** A row without its own header keys (and `ts`), ready to be re-stamped for a bundle. */
function rowBody(
  row: Record<string, unknown>,
  drop: readonly string[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !ROW_HEADER_KEYS.has(key) && !drop.includes(key)),
  );
}

/** Stamp one row for the bundle `dirName` names (issue #581, FR-5). */
function stampFeatureRow(
  dirName: string,
  sessionId: string,
  docType: string,
  schemaVersion: number,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  return stampBundleRow({
    docType,
    change: featureChangeKey(dirName),
    sessionId,
    schemaVersion,
    row,
    now,
  }) as unknown as SessionLedgerRow;
}

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
 *
 * Issue #581 — a row bound for a feature bundle is re-stamped with the bundle header
 * (`doc_type` `paqad.rag`, `change`, `recorded_at` = the row's own time) and without the
 * `adapter`, which the bundle keeps in feature.json. The `_chat` home is not a bundle and
 * keeps the recorder's row as it was stamped.
 */
export function mirrorRagRow(
  projectRoot: string,
  sessionId: string,
  stampedRow: SessionLedgerRow,
): void {
  try {
    const dirName = currentFeature(projectRoot, sessionId);
    if (!dirName) {
      appendStampedRowToUnit(projectRoot, chatRagPath(sessionId), stampedRow);
      return;
    }
    const bundleRow = stampFeatureRow(
      dirName,
      sessionId,
      BUNDLE_RAG_DOC_TYPE,
      BUNDLE_RAG_SCHEMA_VERSION,
      rowBody(stampedRow, ['adapter']),
      () => new Date(stampedRow.ts),
    );
    appendStampedRowToUnit(projectRoot, featureFilePath(dirName, 'rag'), bundleRow);
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
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      RULE_RUN_DOC_TYPE,
      RULE_RUN_SCHEMA_VERSION,
      {
        kind: entry.kind,
        counts: entry.counts,
        blocking: entry.blocking,
        note: entry.note ?? null,
        ...(entry.backfilled ? { backfilled: true } : {}),
      },
      entry.now,
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
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      DUPLICATION_RUN_DOC_TYPE,
      DUPLICATION_RUN_SCHEMA_VERSION,
      {
        counts: report.counts,
        similarity_threshold: report.similarity_threshold,
        min_lines: report.min_lines,
        mode: report.mode,
        blocking: report.blocking,
        ...(backfilled ? { backfilled: true } : {}),
      },
      now,
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
    const stamped = stampFeatureRow(
      dirName,
      sessionId,
      CHANGE_METRICS_RUN_DOC_TYPE,
      CHANGE_METRICS_RUN_SCHEMA_VERSION,
      {
        dup_new_pct: metrics.dup_new_pct,
        reuse_rate: metrics.reuse_rate,
        meaningful_changed_lines: metrics.meaningful_changed_lines,
        flagged_lines: metrics.inputs.flagged_lines,
        reuse_calls: metrics.inputs.reuse_calls,
        ...(backfilled ? { backfilled: true } : {}),
      },
      now,
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
 * `evidence.jsonl`. A no-op (returns `[]`) when no feature is active or the row set is
 * empty. Best-effort.
 *
 * Issue #581 — each row is re-stamped with the bundle header: `doc_type` `paqad.evidence`,
 * `change`, `session_id`, and `recorded_at` = the row's own `ts` (the run time a sealing
 * receipt's `time_verified` names, so the receipt still finds its rows). `content_hash` is
 * the bundle row hash. The returned rows are what was written, read back in the
 * {@link EvidenceLedgerRow} view (`ts` = `recorded_at`).
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
    const written: EvidenceLedgerRow[] = [];
    for (const row of rows) {
      const stamped = stampFeatureRow(
        dirName,
        sessionId,
        BUNDLE_EVIDENCE_DOC_TYPE,
        BUNDLE_EVIDENCE_SCHEMA_VERSION,
        rowBody(row as unknown as Record<string, unknown>),
        () => new Date(row.ts),
      );
      appendStampedRowToUnit(projectRoot, path, stamped);
      written.push({ ...(stamped as unknown as EvidenceLedgerRow), ts: row.ts });
    }
    return written;
  } catch {
    return [];
  }
}

/** Tolerant read of a feature's `evidence.jsonl` graded gate rows. */
export function readFeatureEvidence(projectRoot: string, dirName: string): EvidenceLedgerRow[] {
  return readEvidenceRowsAt(projectRoot, featureFilePath(dirName, 'evidence'));
}
