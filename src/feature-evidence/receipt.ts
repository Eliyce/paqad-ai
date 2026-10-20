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

export const RECEIPT_DOC_TYPE = 'paqad.receipt';
export const RECEIPT_SCHEMA_VERSION = 2;

export const AI_BOM_DOC_TYPE = 'paqad.ai-bom';
export const AI_BOM_SCHEMA_VERSION = 2;

interface BundleHeaderIdentity {
  projectRoot: string;
  dirName: string;
  sessionId?: string | null;
  recordedAt: string;
}

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

export function specificationReceiptLine(
  provenance?: (
    | { produced: boolean; pipeline_produced?: never }
    | { pipeline_produced: boolean; produced?: never }
  ) & {
    manual_reason?: string;
    experts?: {
      roles: string[];
      accepted: number;
      declined: number;
      conflicts: number;
      standing?: number;
      on_call?: string[];
      renamed?: number;
    };
  },
): string {
  if (!provenance) return '🟢 specification: recorded';
  if (provenance.produced ?? provenance.pipeline_produced) {
    const experts = provenance.experts;
    if (experts && experts.standing !== undefined) {
      const onCall = experts.on_call ?? [];
      const roster =
        onCall.length > 0
          ? `${experts.standing} standing + ${onCall.join(', ')}`
          : `${experts.standing} standing`;
      const c = experts.conflicts;
      const w = experts.renamed ?? 0;
      const clauses: string[] = [];
      if (c > 0) clauses.push(`${c} conflicts, all decided`);
      if (w > 0) clauses.push(`${w} wording fixed`);
      const tail = clauses.length > 0 ? ` (${clauses.join('; ')})` : '';
      return `🟢 specification: pipeline-produced, experts: ${roster}${tail}`;
    }
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

export function readFeatureReceipt(projectRoot: string, dirName: string): ReceiptEnvelope | null {
  return readJson<ReceiptEnvelope>(join(projectRoot, featureFilePath(dirName, 'receipt')));
}

export function readFeatureAiBom(projectRoot: string, dirName: string): AiBomDocument | null {
  return readJson<AiBomDocument>(join(projectRoot, featureFilePath(dirName, 'aiBom')));
}

export function readAllFeatureReceipts(projectRoot: string): ReceiptEnvelope[] {
  return readAllFeatureReceiptEntries(projectRoot).map((entry) => entry.envelope);
}

export interface FeatureReceiptEntry {
  dirName: string;
  envelope: ReceiptEnvelope;
}

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

function sealedPrefix(raw: string, lineCount: number): string | null {
  let end = 0;
  for (let line = 0; line < lineCount; line += 1) {
    const newline = raw.indexOf('\n', end);
    if (newline === -1) return null;
    end = newline + 1;
  }
  return raw.slice(0, end);
}

export function sealFeatureEvidence(projectRoot: string, dirName: string): EvidenceSeal {
  const raw = readText(join(projectRoot, featureFilePath(dirName, 'evidence')));
  const complete = raw.slice(0, raw.lastIndexOf('\n') + 1);
  const lineCount = complete.length === 0 ? 0 : complete.split('\n').length - 1;
  return { sha256: sha256Hex(complete), line_count: lineCount };
}

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

export interface ReceiptEvidenceRows {
  sealed: EvidenceLedgerRow[];
  unsealed: EvidenceLedgerRow[];
}

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

export function receiptEvidenceRows(
  statement: InTotoStatement,
  evidenceRows: readonly EvidenceLedgerRow[],
): EvidenceLedgerRow[] {
  return splitReceiptEvidenceRows(statement, evidenceRows).sealed;
}

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
  write?: { receipt?: boolean; aiBom?: boolean };
  metrics?: MetricsPredicate;
  authorship?: ChangeAuthorship;
  complianceCitations?: readonly ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
  sessionId?: string | null;
}

export interface ProjectFeatureReceiptResult {
  envelope: ReceiptEnvelope;
  aiBom: AiBomDocument;
  receiptPath: string;
  aiBomPath: string;
}

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
