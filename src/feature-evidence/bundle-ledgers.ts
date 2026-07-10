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

import {
  appendStampedRowToUnit,
  readUnitFile,
  stampSessionRow,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { chatRagPath, featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

/** Doc type stamped on a per-feature `rule-run.jsonl` row. */
export const RULE_RUN_DOC_TYPE = 'paqad.rule-run';
export const RULE_RUN_SCHEMA_VERSION = 1;

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
