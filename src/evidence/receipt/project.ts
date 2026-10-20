import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  type ChangeAuthorship,
  type ComplianceCitation,
  type EvidenceFileDigest,
  type EvidenceLedgerRow,
  type ReceiptEnvelope,
  type ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';

import { ZERO_DIGEST } from '../digests.js';
import { buildInTotoStatement } from './statement.js';
import { signReceipt, detectSigningMode } from './dsse.js';
import { buildAiBom, type AiBomDocument } from './ai-bom.js';
import { latestFeatureReceipt } from '@/feature-evidence/receipt.js';

export { decodeReceiptStatement } from './envelope.js';
import { decodeReceiptStatement } from './envelope.js';

function chainPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_RECEIPT_CHAIN);
}

export function readReceiptChain(projectRoot: string): ReceiptEnvelope[] {
  const path = chainPath(projectRoot);
  if (!existsSync(path)) return [];
  const out: ReceiptEnvelope[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as ReceiptEnvelope;
      if (parsed?.paqad?.receipt_hash) out.push(parsed);
    } catch {}
  }
  return out;
}

export function latestReceiptHash(projectRoot: string): string {
  const chain = readReceiptChain(projectRoot);
  return chain.length === 0 ? ZERO_DIGEST : chain[chain.length - 1].paqad.receipt_hash;
}

export function latestReceiptAuthorship(projectRoot: string): ChangeAuthorship | null {
  const latest = latestFeatureReceipt(projectRoot);
  if (latest === null) return null;
  const statement = decodeReceiptStatement(latest);
  return statement?.predicate.change_authorship ?? null;
}

export function latestReceiptTrustExtras(projectRoot: string): {
  compliance: ComplianceCitation[];
  reproducibility: ReproducibilityStampPredicate | null;
} {
  const latest = latestFeatureReceipt(projectRoot);
  if (latest === null) return { compliance: [], reproducibility: null };
  const statement = decodeReceiptStatement(latest);
  return {
    compliance: statement?.predicate.compliance_citations ?? [],
    reproducibility: statement?.predicate.reproducibility ?? null,
  };
}

async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, targetPath);
}

export interface ProjectReceiptInput {
  projectRoot: string;
  fileDigests: readonly EvidenceFileDigest[];
  rows: readonly EvidenceLedgerRow[];
  verifierVersion: string;
  timeVerified: string;
  authorship?: ChangeAuthorship;
  complianceCitations?: readonly ComplianceCitation[];
  reproducibility?: ReproducibilityStampPredicate;
  env?: NodeJS.ProcessEnv;
  write?: {
    evidenceReceipt?: boolean;
    aiBom?: boolean;
  };
}

export interface ProjectReceiptResult {
  envelope: ReceiptEnvelope;
  aiBom: AiBomDocument;
  receiptPath: string;
  aiBomPath: string;
}

export async function projectReceipt(input: ProjectReceiptInput): Promise<ProjectReceiptResult> {
  const statement = buildInTotoStatement({
    fileDigests: input.fileDigests,
    rows: input.rows,
    verifierVersion: input.verifierVersion,
    timeVerified: input.timeVerified,
    authorship: input.authorship,
    complianceCitations: input.complianceCitations,
    reproducibility: input.reproducibility,
  });

  detectSigningMode(input.env ?? {});

  const envelope = signReceipt({
    statement,
    prevReceiptHash: latestReceiptHash(input.projectRoot),
    mode: 'hash-chained',
  });

  const aiBom = buildAiBom({ statement, toolVersion: input.verifierVersion });

  const receiptPath = join(input.projectRoot, PATHS.EVIDENCE_RECEIPT);
  const aiBomPath = join(input.projectRoot, PATHS.EVIDENCE_AI_BOM);

  const writeEvidenceReceipt = input.write?.evidenceReceipt ?? true;
  const writeAiBom = input.write?.aiBom ?? true;

  if (writeEvidenceReceipt) {
    const chain = chainPath(input.projectRoot);
    mkdirSync(dirname(chain), { recursive: true });
    appendFileSync(chain, `${JSON.stringify(envelope)}\n`, 'utf8');
    await atomicWriteJson(receiptPath, envelope);
  }

  if (writeAiBom) {
    await atomicWriteJson(aiBomPath, aiBom);
  }

  return { envelope, aiBom, receiptPath, aiBomPath };
}
