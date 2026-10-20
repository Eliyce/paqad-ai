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
  readAllFeatureReceiptEntries,
  readReceiptEvidenceRows,
  verifyEvidenceSeal,
} from '@/feature-evidence/receipt.js';
import { buildEvidenceComment } from '@/verification/evidence-markdown.js';

export interface EvidenceFeedQuery {
  gate?: string;
  verdict?: string;
  limit?: number;
}

export interface EvidenceFeed {
  generatedAt: string;
  total: number;
  rows: EvidenceLedgerRow[];
}

const DEFAULT_EVIDENCE_LIMIT = 200;
const MAX_EVIDENCE_LIMIT = 1000;

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
  index: number;
  receipt_hash: string;
  prev_receipt_hash: string;
  signing_mode: ReceiptEnvelope['paqad']['signing_mode'];
  sealed: boolean;
  time_verified: string | null;
  verification_result: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | null;
  authorship: ChangeAuthorship | null;
  compliance: ComplianceCitation[];
  reproducibility: ReproducibilityStampPredicate | null;
  checks: (Pick<EvidenceLedgerRow, 'code' | 'engine' | 'verdict' | 'strength_class'> & {
    sealed: boolean;
  })[];
  subjects: { name: string; digest: string }[];
}

export interface ReceiptFeed {
  generatedAt: string;
  brokenAt: number | null;
  receipts: ReceiptCard[];
}

export function buildReceiptFeed(projectRoot: string): ReceiptFeed {
  const decoded = readAllFeatureReceiptEntries(projectRoot).map(({ dirName, envelope }) => ({
    dirName,
    envelope,
    statement: decodeReceiptStatement(envelope),
  }));
  decoded.sort((a, b) =>
    (b.statement?.predicate.time_verified ?? '').localeCompare(
      a.statement?.predicate.time_verified ?? '',
    ),
  );
  let brokenAt: number | null = null;
  const receipts = decoded.map(({ dirName, envelope, statement }, index): ReceiptCard => {
    const predicate = statement?.predicate ?? null;
    const sealed =
      verifyReceiptSeal(envelope) &&
      (statement === null || verifyEvidenceSeal(projectRoot, dirName, statement) !== false);
    const rows =
      statement === null
        ? { sealed: [], unsealed: [] }
        : readReceiptEvidenceRows(projectRoot, dirName, statement);
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
      checks: [
        ...rows.sealed.map((row) => ({ row, sealed: true })),
        ...rows.unsealed.map((row) => ({ row, sealed: false })),
      ].map(({ row, sealed }) => ({
        code: row.code,
        engine: row.engine,
        verdict: row.verdict,
        strength_class: row.strength_class,
        sealed,
      })),
      subjects: (statement?.subject ?? []).map((subject) => ({
        name: subject.name,
        digest: subject.digest.sha256,
      })),
    };
  });
  return { generatedAt: new Date().toISOString(), brokenAt, receipts };
}

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

export function buildPrCommentMarkdown(projectRoot: string, sha?: string): string | null {
  return buildEvidenceComment(projectRoot, sha);
}
