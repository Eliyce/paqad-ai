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
//
// Issue #581 — the receipt seals the bundle's `evidence.jsonl` instead of copying its rows:
// the predicate carries `evidence_sha256` (the file's bytes at seal time) and
// `evidence_line_count`, so the rows are stored once. Late gates append rows after sealing,
// so a verifier re-hashes only the sealed prefix. Those later rows are not covered by the
// seal, so a reader shows them as unsealed rather than as rows the receipt vouches for. A
// receipt sealed before #581 still carries `predicate.rows` and every reader here falls back
// to them.
//
// Both files also carry the one envelope header (issue #581, FR-5), each in the slot its
// standard format allows: the receipt in its top-level `paqad` block, outside the signed DSSE
// payload (so the chain bytes are unchanged; `time_verified` stays inside the payload, owned
// by the SLSA-VSA shape), and the AI-BOM as `paqad:<field>` CycloneDX `metadata.properties`.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { sha256Hex } from '@/compliance/markdown.js';
import type {
  ChangeAuthorship,
  ComplianceCitation,
  EvidenceFileDigest,
  EvidenceLedgerRow,
  EvidenceSeal,
  InTotoStatement,
  MetricsPredicate,
  ReceiptEnvelope,
  ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { parseEvidenceRows } from '@/evidence/ledger.js';
import { buildAiBom, type AiBomDocument } from '@/evidence/receipt/ai-bom.js';
import { signReceipt } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
// Issue #468 Phase B — import from the leaf `envelope.js`, NOT `project.js`: this module
// is now imported BY `project.js` (for `latestFeatureReceipt`), so importing it back would
// form a cycle.
import { decodeReceiptStatement } from '@/evidence/receipt/envelope.js';

import { documentSessionId } from './bundle-document.js';
import { listFeatureDirs } from './delivery.js';
import {
  buildEnvelopeHeader,
  rowRecordedAt,
  toAiBomProperties,
  withReceiptHeader,
} from './envelope.js';
import { computeContentHash } from './mint.js';
import { featureChangeKey, featureFilePath } from './paths.js';

/** Doc type of a bundle's `receipt.json` (`paqad.<file-stem>`, issue #581). */
export const RECEIPT_DOC_TYPE = 'paqad.receipt';
/** Version 2 (issue #581): the envelope header in the `paqad` block. */
export const RECEIPT_SCHEMA_VERSION = 2;

/** Doc type of a bundle's `ai-bom.json` (issue #581). */
export const AI_BOM_DOC_TYPE = 'paqad.ai-bom';
/** Version 2 (issue #581): the envelope header in `metadata.properties`. */
export const AI_BOM_SCHEMA_VERSION = 2;

interface BundleHeaderIdentity {
  projectRoot: string;
  dirName: string;
  sessionId?: string | null;
  /** The run time: the statement's `time_verified`. */
  recordedAt: string;
}

/**
 * The receipt with the envelope header in its `paqad` block. `content_hash` is the
 * `receipt_hash` the chain already carries (the SHA-256 of the signed PAE and the prior
 * link), so the header names the same bytes the chain does without a second hash.
 */
function withFeatureReceiptHeader(
  envelope: ReceiptEnvelope,
  identity: BundleHeaderIdentity,
): ReceiptEnvelope {
  const header = buildEnvelopeHeader({
    docType: RECEIPT_DOC_TYPE,
    change: featureChangeKey(identity.dirName),
    sessionId: documentSessionId(identity.projectRoot, identity.dirName, identity.sessionId),
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    contentHash: envelope.paqad.receipt_hash,
    now: () => new Date(identity.recordedAt),
  });
  return { ...envelope, paqad: withReceiptHeader(header, envelope.paqad) };
}

/**
 * The AI-BOM with the envelope header first in its `metadata.properties`. `content_hash` is
 * {@link computeContentHash} over the document as built, before the header is added.
 */
function withFeatureAiBomHeader(
  aiBom: AiBomDocument,
  identity: BundleHeaderIdentity,
): AiBomDocument {
  const header = buildEnvelopeHeader({
    docType: AI_BOM_DOC_TYPE,
    change: featureChangeKey(identity.dirName),
    sessionId: documentSessionId(identity.projectRoot, identity.dirName, identity.sessionId),
    schemaVersion: AI_BOM_SCHEMA_VERSION,
    contentHash: computeContentHash(aiBom as unknown as Record<string, unknown>),
    now: () => new Date(identity.recordedAt),
  });
  return {
    ...aiBom,
    metadata: {
      ...aiBom.metadata,
      properties: [...toAiBomProperties(header), ...aiBom.metadata.properties],
    },
  };
}

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

/**
 * The specification line for the end-of-change receipt (issue #547, FR-12.3), read from the
 * frozen spec's `pipeline` section (issue #581, `produced`) or an older record's `provenance`
 * block (`pipeline_produced`). `experts` is the run's expert summary where one is known. Absent
 * input renders today's plain line, so a pre-#547 record is unchanged. Pure and deterministic.
 */
export function specificationReceiptLine(
  provenance?: (
    | { produced: boolean; pipeline_produced?: never }
    | { pipeline_produced: boolean; produced?: never }
  ) & {
    manual_reason?: string;
    experts?: { roles: string[]; accepted: number; declined: number; conflicts: number };
  },
): string {
  if (!provenance) return '🟢 specification: recorded';
  if (provenance.produced ?? provenance.pipeline_produced) {
    const experts = provenance.experts;
    if (experts && experts.roles.length > 0) {
      const conflicts =
        experts.conflicts > 0
          ? ` (${experts.conflicts} conflict${experts.conflicts === 1 ? '' : 's'} decided)`
          : '';
      return `🟢 specification: pipeline-produced, experts: ${experts.roles.join(', ')}${conflicts}`;
    }
    return '🟢 specification: pipeline-produced';
  }
  if (provenance.manual_reason !== undefined && provenance.manual_reason.length > 0) {
    return `🟡 specification: frozen without the pipeline (reason: ${provenance.manual_reason})`;
  }
  return '🟡 specification: frozen without the pipeline';
}

/** Tolerant read of a feature bundle's signed `receipt.json`, or null when absent/corrupt. */
export function readFeatureReceipt(projectRoot: string, dirName: string): ReceiptEnvelope | null {
  return readJson<ReceiptEnvelope>(join(projectRoot, featureFilePath(dirName, 'receipt')));
}

/** Tolerant read of a feature bundle's `ai-bom.json`, or null when absent/corrupt. */
export function readFeatureAiBom(projectRoot: string, dirName: string): AiBomDocument | null {
  return readJson<AiBomDocument>(join(projectRoot, featureFilePath(dirName, 'aiBom')));
}

/**
 * Issue #468 Phase B — every feature bundle's `receipt.json`, in feature-dir order, skipping
 * any dir with no receipt yet. The whole-project projection of the retired append-only
 * receipt chain: after the cutover each bundle keeps its own self-chained receipt, so the
 * "all receipts" view is the union of the per-feature receipts. Each verifies independently
 * (issue #468, AC-10) via `verifyReceiptSeal`.
 */
export function readAllFeatureReceipts(projectRoot: string): ReceiptEnvelope[] {
  return readAllFeatureReceiptEntries(projectRoot).map((entry) => entry.envelope);
}

/** One bundle's receipt together with the bundle it came from. */
export interface FeatureReceiptEntry {
  dirName: string;
  envelope: ReceiptEnvelope;
}

/**
 * Every feature bundle's `receipt.json` with its dir name, in feature-dir order. The dir name
 * is what a reader needs to find the rows a post-#581 receipt sealed in `evidence.jsonl`.
 */
export function readAllFeatureReceiptEntries(projectRoot: string): FeatureReceiptEntry[] {
  const entries: FeatureReceiptEntry[] = [];
  for (const dirName of listFeatureDirs(projectRoot)) {
    const envelope = readFeatureReceipt(projectRoot, dirName);
    if (envelope) {
      entries.push({ dirName, envelope });
    }
  }
  return entries;
}

function readText(absPath: string): string {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * The first `lineCount` newline-terminated lines of `raw`, or null when `raw` holds fewer.
 * The bytes a seal covers: at seal time the file ended on its last sealed line, so the prefix
 * is byte-identical to the file as it was then, however many lines were appended since.
 */
function sealedPrefix(raw: string, lineCount: number): string | null {
  let end = 0;
  for (let line = 0; line < lineCount; line += 1) {
    const newline = raw.indexOf('\n', end);
    if (newline === -1) return null;
    end = newline + 1;
  }
  return raw.slice(0, end);
}

/**
 * Issue #581 — seal a bundle's `evidence.jsonl` as it stands now: the SHA-256 of every
 * complete line and how many there are. A trailing partial line (a write in flight) is left
 * out, so the seal only ever covers whole rows. An absent file seals as zero lines.
 */
export function sealFeatureEvidence(projectRoot: string, dirName: string): EvidenceSeal {
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'evidence')));
  const complete = raw.slice(0, raw.lastIndexOf('\n') + 1);
  const lineCount = complete.length === 0 ? 0 : complete.split('\n').length - 1;
  return { sha256: sha256Hex(complete), line_count: lineCount };
}

/**
 * Issue #581 — whether the `evidence.jsonl` lines a receipt sealed are still the bytes it
 * sealed. `true` when the first `evidence_line_count` lines re-hash to `evidence_sha256`;
 * `false` when they do not or the file lost lines; `null` for a receipt that carries its
 * own rows (sealed before #581), which has nothing in `evidence.jsonl` to check.
 */
export function verifyEvidenceSeal(
  projectRoot: string,
  dirName: string,
  statement: InTotoStatement,
): boolean | null {
  const { evidence_sha256: sha256, evidence_line_count: lineCount } = statement.predicate;
  if (sha256 === undefined || lineCount === undefined) return null;
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'evidence')));
  const prefix = sealedPrefix(raw, lineCount);
  return prefix !== null && sha256Hex(prefix) === sha256;
}

/** The graded rows of a receipt's run, split by whether its evidence seal covers them. */
export interface ReceiptEvidenceRows {
  /** The rows the receipt vouches for: carried in it, or in the sealed lines of evidence.jsonl. */
  sealed: EvidenceLedgerRow[];
  /**
   * Rows of the same run appended after sealing (the late gates). `evidence_sha256` does not
   * cover them, so they are shown as unsealed, never attributed to the receipt.
   */
  unsealed: EvidenceLedgerRow[];
}

/**
 * The graded rows of a receipt's run. A pre-#581 receipt carries them in `predicate.rows`, all
 * sealed. A sealing receipt does not, so they are the bundle's `evidence.jsonl` rows of that same
 * verification run (every row is stamped with the run's completion time, which is also the
 * receipt's `time_verified`, so earlier runs' rows are left out). `evidenceRows` is the file in
 * line order; the first `sealedRowCount` of them sit in the lines the seal covers, which is
 * `evidence_line_count` because the evidence writer puts exactly one row on each line.
 */
export function splitReceiptEvidenceRows(
  statement: InTotoStatement,
  evidenceRows: readonly EvidenceLedgerRow[],
  sealedRowCount: number = statement.predicate.evidence_line_count ?? 0,
): ReceiptEvidenceRows {
  const carried = statement.predicate.rows;
  if (Array.isArray(carried)) return { sealed: [...carried], unsealed: [] };
  const time = statement.predicate.time_verified;
  const ofRun = (row: EvidenceLedgerRow): boolean =>
    rowRecordedAt(row as unknown as Record<string, unknown>) === time;
  return {
    sealed: evidenceRows.slice(0, sealedRowCount).filter(ofRun),
    unsealed: evidenceRows.slice(sealedRowCount).filter(ofRun),
  };
}

/** The rows a receipt vouches for: {@link splitReceiptEvidenceRows}, sealed part only. */
export function receiptEvidenceRows(
  statement: InTotoStatement,
  evidenceRows: readonly EvidenceLedgerRow[],
): EvidenceLedgerRow[] {
  return splitReceiptEvidenceRows(statement, evidenceRows).sealed;
}

/**
 * {@link splitReceiptEvidenceRows} read straight from a bundle's `evidence.jsonl`, counting the
 * rows in the sealed lines exactly (an unreadable line there is not a row). A file that lost
 * sealed lines has no sealed rows left: every row of the run reads as unsealed.
 */
export function readReceiptEvidenceRows(
  projectRoot: string,
  dirName: string,
  statement: InTotoStatement,
): ReceiptEvidenceRows {
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'evidence')));
  const lineCount = statement.predicate.evidence_line_count ?? 0;
  const prefix = sealedPrefix(raw, lineCount);
  return splitReceiptEvidenceRows(
    statement,
    parseEvidenceRows(raw),
    prefix === null ? 0 : parseEvidenceRows(prefix).length,
  );
}

/**
 * Issue #468 Phase B — the most-recent per-feature receipt across all bundles, by decoded
 * `time_verified` (ISO-8601, so a lexical max is chronological). The replacement for
 * "the last link in the whole-project chain": every "latest receipt" surface (authorship,
 * compliance/reproducibility extras) reads this so they agree. A receipt whose statement
 * cannot be decoded carries no `time_verified` and loses ties to a decodable one; `null`
 * when no bundle carries a receipt.
 */
export function latestFeatureReceipt(projectRoot: string): ReceiptEnvelope | null {
  let latest: ReceiptEnvelope | null = null;
  let latestTime = '';
  for (const receipt of readAllFeatureReceipts(projectRoot)) {
    const time = decodeReceiptStatement(receipt)?.predicate.time_verified ?? '';
    if (latest === null || time >= latestTime) {
      latest = receipt;
      latestTime = time;
    }
  }
  return latest;
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
  /** Issue #362 — the per-change shape metrics to carry on this receipt's predicate.
   *  Omitted when none were computed, so the statement stays byte-identical to before. */
  metrics?: MetricsPredicate;
  /**
   * Issue #468 Phase B — the same trust predicates the whole-project receipt carries, so a
   * per-feature receipt is a COMPLETE attestation record once it becomes the only one (D5):
   * who wrote/accepted the change (#120), the `gate → clause` compliance citations (#122),
   * and the frozen-context reproducibility stamp (#123). Each is omitted from the predicate
   * when absent, so a receipt without them stays byte-identical to before this change.
   */
  authorship?: ChangeAuthorship;
  complianceCitations?: readonly ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
  /** The session running the verification, stamped on the file headers (issue #581). */
  sessionId?: string | null;
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
    ...(input.metrics !== undefined ? { metrics: input.metrics } : {}),
    ...(input.authorship !== undefined ? { authorship: input.authorship } : {}),
    ...(input.complianceCitations !== undefined
      ? { complianceCitations: input.complianceCitations }
      : {}),
    ...(input.reproducibility !== undefined ? { reproducibility: input.reproducibility } : {}),
    evidenceSeal: sealFeatureEvidence(projectRoot, dirName),
  });
  const prior = readFeatureReceipt(projectRoot, dirName);
  const identity = {
    projectRoot,
    dirName,
    sessionId: input.sessionId,
    recordedAt: input.timeVerified,
  };
  const envelope = withFeatureReceiptHeader(
    signReceipt({
      statement,
      prevReceiptHash: prior?.paqad?.receipt_hash ?? ZERO_DIGEST,
      mode: 'hash-chained',
    }),
    identity,
  );
  const aiBom = withFeatureAiBomHeader(
    buildAiBom({ statement, toolVersion: input.verifierVersion }),
    identity,
  );

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
    evidenceSeal: sealFeatureEvidence(projectRoot, dirName),
  });
  const aiBom = withFeatureAiBomHeader(
    buildAiBom({ statement, toolVersion: input.verifierVersion }),
    { projectRoot, dirName, sessionId: input.sessionId, recordedAt: input.timeVerified },
  );
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'aiBom')), aiBom);
  return aiBom;
}

/**
 * Project the WHOLE-PROJECT AI-BOM on demand from the union of every feature bundle's own
 * receipt (issue #343 B) — the replacement for authoring a continuous whole-project ledger.
 * Each feature receipt stands for its graded rows (carried, or in the sealed lines of the
 * bundle's `evidence.jsonl` since #581) and file subjects; the union is
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
    // Only the rows the receipt vouches for: a row appended after its seal is not its evidence.
    for (const row of readReceiptEvidenceRows(projectRoot, dirName, statement).sealed) {
      if (seenRows.has(row.content_hash)) continue;
      seenRows.add(row.content_hash);
      rows.push(row);
    }
  }

  if (!any) return null;
  const statement = buildInTotoStatement({ fileDigests, rows, verifierVersion, timeVerified });
  return buildAiBom({ statement, toolVersion: verifierVersion });
}
