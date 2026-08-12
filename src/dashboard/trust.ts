// Issue #146 — the Trust area behind the dashboard: evidence timeline,
// receipt cards, AI-BOM. Read-only by design (editable evidence is
// worthless), so every function here is a projection over the ledgers the
// verification pipeline already writes — no mutation routes exist at all.

import type {
  ChangeAuthorship,
  ComplianceCitation,
  EvidenceLedgerRow,
  ReceiptEnvelope,
  ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';
import { verifyReceiptSeal } from '@/evidence/receipt/dsse.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import type { AiBomDocument } from '@/evidence/receipt/ai-bom.js';
import { readAllFeatureEvidence } from '@/feature-evidence/projections.js';
import {
  latestFeatureReceipt,
  projectAiBomFromFeatures,
  readAllFeatureReceipts,
} from '@/feature-evidence/receipt.js';
import { buildEvidenceComment } from '@/verification/evidence-markdown.js';

export interface EvidenceFeedQuery {
  /** Filter on the gate name / finding code (`row.code`). */
  gate?: string;
  /** Filter on the verdict (`pass` | `fail` | `inconclusive` | `blocked`). */
  verdict?: string;
  /** Cap on returned rows. Default 200, max 1000. */
  limit?: number;
}

export interface EvidenceFeed {
  generatedAt: string;
  /** Total rows in the ledger before filtering — lets the UI say "x of y". */
  total: number;
  /** Newest first, filtered, capped at `limit`. */
  rows: EvidenceLedgerRow[];
}

const DEFAULT_EVIDENCE_LIMIT = 200;
const MAX_EVIDENCE_LIMIT = 1000;

/** The evidence ledger shaped for the timeline: newest first, filtered, capped. */
export function buildEvidenceFeed(
  projectRoot: string,
  query: EvidenceFeedQuery = {},
): EvidenceFeed {
  const all = readAllFeatureEvidence(projectRoot);
  const limit = Math.min(
    Math.max(1, Math.trunc(query.limit ?? DEFAULT_EVIDENCE_LIMIT)),
    MAX_EVIDENCE_LIMIT,
  );
  const rows = all
    .slice()
    .reverse()
    .filter((row) => (query.gate ? row.code === query.gate : true))
    .filter((row) => (query.verdict ? row.verdict === query.verdict : true))
    .slice(0, limit);
  return { generatedAt: new Date().toISOString(), total: all.length, rows };
}

export interface ReceiptCard {
  /** Position in the chain, 0 = genesis. */
  index: number;
  receipt_hash: string;
  prev_receipt_hash: string;
  signing_mode: ReceiptEnvelope['paqad']['signing_mode'];
  /** True when the hash chain recomputes cleanly up to and including this link. */
  sealed: boolean;
  time_verified: string | null;
  verification_result: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | null;
  authorship: ChangeAuthorship | null;
  /** Issue #122 — which legal clauses the passing gates produce evidence toward. */
  compliance: ComplianceCitation[];
  /** Issue #123 — the frozen-context reproducibility stamp, or null when absent. */
  reproducibility: ReproducibilityStampPredicate | null;
  /** The graded checks the receipt covers. */
  checks: Pick<EvidenceLedgerRow, 'code' | 'engine' | 'verdict' | 'strength_class'>[];
  /** Changed files attested by the receipt. */
  subjects: { name: string; digest: string }[];
}

export interface ReceiptFeed {
  generatedAt: string;
  /** Index of the first broken chain link, or null when the chain is sound. */
  brokenAt: number | null;
  /** Newest first. */
  receipts: ReceiptCard[];
}

/**
 * The per-feature receipts shaped as cards, newest first, each with its own seal status
 * (issue #468 Phase B). After the cutover there is no single whole-project chain — each
 * feature bundle carries its own self-chained receipt — so every card is verified
 * INDEPENDENTLY (`verifyReceiptSeal`) and `brokenAt` reports the first card (newest first)
 * whose bytes do not recompute, preserving the UI's "something is broken" signal.
 */
export function buildReceiptFeed(projectRoot: string): ReceiptFeed {
  const decoded = readAllFeatureReceipts(projectRoot).map((envelope) => ({
    envelope,
    statement: decodeReceiptStatement(envelope),
  }));
  // Newest first by decoded `time_verified` (ISO-8601, so a lexical sort is chronological).
  decoded.sort((a, b) =>
    (b.statement?.predicate.time_verified ?? '').localeCompare(
      a.statement?.predicate.time_verified ?? '',
    ),
  );
  let brokenAt: number | null = null;
  const receipts = decoded.map(({ envelope, statement }, index): ReceiptCard => {
    const predicate = statement?.predicate ?? null;
    const sealed = verifyReceiptSeal(envelope);
    if (!sealed && brokenAt === null) {
      brokenAt = index;
    }
    return {
      index,
      receipt_hash: envelope.paqad.receipt_hash,
      prev_receipt_hash: envelope.paqad.prev_receipt_hash,
      signing_mode: envelope.paqad.signing_mode,
      sealed,
      time_verified: predicate?.time_verified ?? null,
      verification_result: predicate?.verification_result ?? null,
      authorship: predicate?.change_authorship ?? null,
      compliance: predicate?.compliance_citations ?? [],
      reproducibility: predicate?.reproducibility ?? null,
      checks: (predicate?.rows ?? []).map((row) => ({
        code: row.code,
        engine: row.engine,
        verdict: row.verdict,
        strength_class: row.strength_class,
      })),
      subjects: (statement?.subject ?? []).map((subject) => ({
        name: subject.name,
        digest: subject.digest.sha256,
      })),
    };
  });
  return { generatedAt: new Date().toISOString(), brokenAt, receipts };
}

/**
 * The whole-project CycloneDX AI-BOM, projected on demand from the union of the feature
 * bundles (issue #468 Phase B, D5), or null when no bundle carries a receipt yet. The
 * tool version + verification time are taken from the latest per-feature receipt so the
 * projected document matches the record it summarizes, with no separate version source.
 */
export function readAiBomDocument(projectRoot: string): AiBomDocument | null {
  const latest = latestFeatureReceipt(projectRoot);
  if (latest === null) return null;
  const predicate = decodeReceiptStatement(latest)?.predicate ?? null;
  return projectAiBomFromFeatures(
    projectRoot,
    predicate?.verifier.version ?? '0.0.0-dev',
    predicate?.time_verified ?? '',
  );
}

/**
 * The "Copy as PR comment" payload — the exact Markdown `paqad-ai evidence`
 * prints, so the web page and the CLI never disagree. Null when no
 * verification evidence exists yet.
 */
export function buildPrCommentMarkdown(projectRoot: string, sha?: string): string | null {
  return buildEvidenceComment(projectRoot, sha);
}
