// Per-feature receipt + AI-BOM projection (issue #343 Workstream B, finishing #339 Phase 6).
//
// The whole-project receipt (#118) is built from a verification run's graded gate rows and
// snapshotted at `.paqad/ledger/receipt.dsse.json` / `ai-bom.json`. This projects the SAME
// real rows into the active feature's bundle as `receipt.json` + `ai-bom.json`, so each
// feature carries its own attested receipt and CycloneDX AI-BOM — the two reserved-but-
// unwritten bundle files (`FEATURE_BUNDLE_FILES.receipt` / `.aiBom`). The whole-project
// AI-BOM/receipt can then be PROJECTED on demand from the union of the feature bundles
// (`projectAiBomFromFeatures`) instead of being authored continuously.
//
// Reuse over reinvention: the in-toto statement, DSSE signing, and CycloneDX rendering are
// the existing `src/evidence/receipt/*` primitives, run on the feature's own rows. The
// per-feature receipt is hash-chained to the feature's OWN prior receipt (a self-contained
// chain), never the whole-project chain, so a feature bundle is a portable, verifiable unit.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  EvidenceFileDigest,
  EvidenceLedgerRow,
  ReceiptEnvelope,
} from '@/core/types/evidence-ledger.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { buildAiBom, type AiBomDocument } from '@/evidence/receipt/ai-bom.js';
import { signReceipt } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';

import { listFeatureDirs } from './delivery.js';
import { featureFilePath } from './paths.js';

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

function readJson<T>(absPath: string): T | null {
  try {
    return JSON.parse(readFileSync(absPath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Tolerant read of a feature bundle's signed `receipt.json`, or null when absent/corrupt. */
export function readFeatureReceipt(projectRoot: string, dirName: string): ReceiptEnvelope | null {
  return readJson<ReceiptEnvelope>(join(projectRoot, featureFilePath(dirName, 'receipt')));
}

/** Tolerant read of a feature bundle's `ai-bom.json`, or null when absent/corrupt. */
export function readFeatureAiBom(projectRoot: string, dirName: string): AiBomDocument | null {
  return readJson<AiBomDocument>(join(projectRoot, featureFilePath(dirName, 'aiBom')));
}

export interface ProjectFeatureReceiptInput {
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  verifierVersion: string;
  timeVerified: string;
  /**
   * Which bundle files to persist, mirroring the whole-project receipt's independent gating
   * (#187) so per-feature honours the SAME enterprise flags: `receipt` ⇐ `evidence_ledger`,
   * `aiBom` ⇐ `ai_bom`. Both default to `true`. The statement/envelope/AI-BOM are always
   * computed (and returned) even when a write is gated off.
   */
  write?: { receipt?: boolean; aiBom?: boolean };
}

export interface ProjectFeatureReceiptResult {
  envelope: ReceiptEnvelope;
  aiBom: AiBomDocument;
  receiptPath: string;
  aiBomPath: string;
}

/**
 * Build + sign + write a feature bundle's `receipt.json` AND `ai-bom.json` from the feature's
 * own graded rows. The receipt is hash-chained to the feature's OWN prior receipt (so the
 * bundle is a self-contained, tamper-evident unit), and the AI-BOM is the CycloneDX view of
 * the same statement. Both writes are atomic. Returns the paths (project-relative) written.
 */
export function projectFeatureReceipt(
  projectRoot: string,
  dirName: string,
  input: ProjectFeatureReceiptInput,
): ProjectFeatureReceiptResult {
  const statement = buildInTotoStatement({
    fileDigests: input.fileDigests,
    rows: input.rows,
    verifierVersion: input.verifierVersion,
    timeVerified: input.timeVerified,
  });
  const prior = readFeatureReceipt(projectRoot, dirName);
  const envelope = signReceipt({
    statement,
    prevReceiptHash: prior?.paqad?.receipt_hash ?? ZERO_DIGEST,
    mode: 'hash-chained',
  });
  const aiBom = buildAiBom({ statement, toolVersion: input.verifierVersion });

  const receiptRel = featureFilePath(dirName, 'receipt');
  const aiBomRel = featureFilePath(dirName, 'aiBom');
  if (input.write?.receipt ?? true) {
    atomicWriteJson(join(projectRoot, receiptRel), envelope);
  }
  if (input.write?.aiBom ?? true) {
    atomicWriteJson(join(projectRoot, aiBomRel), aiBom);
  }
  return { envelope, aiBom, receiptPath: receiptRel, aiBomPath: aiBomRel };
}

/**
 * Project the just-the-AI-BOM slice of a feature bundle without (re)writing the receipt —
 * the CycloneDX view of the feature's own rows. Used when only the AI-BOM is wanted (e.g. the
 * `ai_bom` enterprise flag is on but `evidence_ledger` is off). Writes `ai-bom.json`; returns it.
 */
export function projectFeatureAiBom(
  projectRoot: string,
  dirName: string,
  input: ProjectFeatureReceiptInput,
): AiBomDocument {
  const statement = buildInTotoStatement({
    fileDigests: input.fileDigests,
    rows: input.rows,
    verifierVersion: input.verifierVersion,
    timeVerified: input.timeVerified,
  });
  const aiBom = buildAiBom({ statement, toolVersion: input.verifierVersion });
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'aiBom')), aiBom);
  return aiBom;
}

/**
 * Project the WHOLE-PROJECT AI-BOM on demand from the union of every feature bundle's own
 * receipt (issue #343 B) — the replacement for authoring a continuous whole-project ledger.
 * Each feature receipt's statement carries its graded rows and file subjects; the union is
 * rebuilt into one statement and rendered as a single CycloneDX AI-BOM. Feature dirs whose
 * receipt is missing/corrupt are skipped. `null` when no feature carries a receipt.
 */
export function projectAiBomFromFeatures(
  projectRoot: string,
  verifierVersion: string,
  timeVerified: string,
): AiBomDocument | null {
  const fileDigests: EvidenceFileDigest[] = [];
  const rows: EvidenceLedgerRow[] = [];
  const seenSubjects = new Set<string>();
  const seenRows = new Set<string>();
  let any = false;

  for (const dirName of listFeatureDirs(projectRoot)) {
    const receipt = readFeatureReceipt(projectRoot, dirName);
    if (!receipt) continue;
    const statement = decodeReceiptStatement(receipt);
    if (!statement) continue;
    any = true;
    for (const subject of statement.subject) {
      const key = `${subject.name}\0${subject.digest.sha256}`;
      if (seenSubjects.has(key)) continue;
      seenSubjects.add(key);
      fileDigests.push({ name: subject.name, sha256: subject.digest.sha256 });
    }
    for (const row of statement.predicate.rows) {
      if (seenRows.has(row.content_hash)) continue;
      seenRows.add(row.content_hash);
      rows.push(row);
    }
  }

  if (!any) return null;
  const statement = buildInTotoStatement({ fileDigests, rows, verifierVersion, timeVerified });
  return buildAiBom({ statement, toolVersion: verifierVersion });
}
