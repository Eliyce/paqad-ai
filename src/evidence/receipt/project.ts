// Issue #118 — project a receipt at merge time from a window of ledger rows.
//
// Reads the change's evidence window, builds the in-toto Statement, signs it
// into a DSSE envelope (hash-chained locally), appends the envelope to the
// tamper-evident receipt chain, and writes the latest receipt + the CycloneDX
// AI-BOM view. Every write is atomic (temp + rename) so a crash never leaves a
// half-written receipt; the chain append is the one append-only file.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  type ChangeAuthorship,
  type ComplianceCitation,
  type EvidenceFileDigest,
  type EvidenceLedgerRow,
  type InTotoStatement,
  type ReceiptEnvelope,
  type ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';

import { ZERO_DIGEST } from '../digests.js';
import { buildInTotoStatement } from './statement.js';
import { signReceipt, detectSigningMode } from './dsse.js';
import { buildAiBom, type AiBomDocument } from './ai-bom.js';

function chainPath(projectRoot: string): string {
  return join(projectRoot, PATHS.EVIDENCE_RECEIPT_CHAIN);
}

/** Read the receipt chain (append-only JSONL); malformed lines are skipped. */
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
    } catch {
      // Tolerant reader: a mid-crash append must not poison the chain.
    }
  }
  return out;
}

/** The chain link the next receipt embeds — the last receipt's hash, or
 *  {@link ZERO_DIGEST} at genesis. */
export function latestReceiptHash(projectRoot: string): string {
  const chain = readReceiptChain(projectRoot);
  return chain.length === 0 ? ZERO_DIGEST : chain[chain.length - 1].paqad.receipt_hash;
}

/** Decode a receipt envelope's wrapped in-toto Statement, or `null` when the
 *  base64 payload is unparseable. */
export function decodeReceiptStatement(envelope: ReceiptEnvelope): InTotoStatement | null {
  try {
    return JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')) as InTotoStatement;
  } catch {
    return null;
  }
}

/**
 * Issue #120 — the change authorship attested by the most recent receipt, or
 * `null` when no receipt exists or it carried no authorship. The single source
 * of truth every surface (PR comment, dashboard) reads, so the moat is shown
 * from the signed record rather than re-derived per surface.
 */
export function latestReceiptAuthorship(projectRoot: string): ChangeAuthorship | null {
  const chain = readReceiptChain(projectRoot);
  if (chain.length === 0) return null;
  const statement = decodeReceiptStatement(chain[chain.length - 1]);
  return statement?.predicate.change_authorship ?? null;
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
  /** Issue #120 — who wrote/accepted the change, folded into the predicate. */
  authorship?: ChangeAuthorship;
  /** Issue #122 — `gate → clause` citations from the active compliance packs. */
  complianceCitations?: readonly ComplianceCitation[];
  /** Issue #123 — the frozen-context reproducibility stamp. */
  reproducibility?: ReproducibilityStampPredicate;
  env?: NodeJS.ProcessEnv;
}

export interface ProjectReceiptResult {
  envelope: ReceiptEnvelope;
  aiBom: AiBomDocument;
  receiptPath: string;
  aiBomPath: string;
}

/**
 * Build + sign + persist a receipt and its AI-BOM. The signing *mode* is
 * detected from the environment (CI+opt-in → keyless intent), but the actual
 * signature degrades honestly to the hash chain when keyless isn't obtainable —
 * see {@link signReceipt}.
 */
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

  // Mode detection is recorded for transparency even though the local signer
  // always hash-chains; this is where a CI keyless signer would slot in.
  detectSigningMode(input.env ?? {});

  const envelope = signReceipt({
    statement,
    prevReceiptHash: latestReceiptHash(input.projectRoot),
    mode: 'hash-chained',
  });

  const aiBom = buildAiBom({ statement, toolVersion: input.verifierVersion });

  const receiptPath = join(input.projectRoot, PATHS.EVIDENCE_RECEIPT);
  const aiBomPath = join(input.projectRoot, PATHS.EVIDENCE_AI_BOM);

  // Append to the tamper-evident chain first, then write the latest snapshots.
  const chain = chainPath(input.projectRoot);
  mkdirSync(dirname(chain), { recursive: true });
  appendFileSync(chain, `${JSON.stringify(envelope)}\n`, 'utf8');

  await atomicWriteJson(receiptPath, envelope);
  await atomicWriteJson(aiBomPath, aiBom);

  return { envelope, aiBom, receiptPath, aiBomPath };
}
