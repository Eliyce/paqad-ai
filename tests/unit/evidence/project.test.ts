import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type {
  ChangeAuthorship,
  EvidenceLedgerRow,
  ReceiptEnvelope,
} from '@/core/types/evidence-ledger.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { verifyReceiptChain } from '@/evidence/receipt/dsse.js';
import {
  decodeReceiptStatement,
  latestReceiptAuthorship,
  latestReceiptHash,
  projectReceipt,
  readReceiptChain,
} from '@/evidence/receipt/project.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { projectFeatureReceipt } from '@/feature-evidence/receipt.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

/**
 * Issue #468 Phase B — `latestReceiptAuthorship` now reads the per-feature bundle receipts,
 * so its tests seed a feature bundle receipt (with optional authorship) rather than the
 * whole-project chain.
 */
let featureSeed = 0;
function projectFeature(root: string, authorship?: ChangeAuthorship): void {
  featureSeed += 1;
  const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: featureSeed });
  projectFeatureReceipt(root, dir, {
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [row('mutation-testing')],
    verifierVersion: '1.0.0',
    timeVerified: '2026-06-11T00:00:00.000Z',
    ...(authorship ? { authorship } : {}),
  });
}

/** Append a raw line to the receipt chain to exercise the tolerant reader. */
function appendChainLine(root: string, line: string): void {
  const path = join(root, PATHS.EVIDENCE_RECEIPT_CHAIN);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${line}\n`, 'utf8');
}

function row(code: string): EvidenceLedgerRow {
  return buildEvidenceRow({
    ts: '2026-06-11T00:00:00.000Z',
    engine: 'verification-gate',
    code,
    subject_digest: 'subject-1',
    verdict: 'pass',
    strength_class: 'deterministic',
  });
}

async function project(root: string, code: string) {
  return projectReceipt({
    projectRoot: root,
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [row(code)],
    verifierVersion: '1.0.0',
    timeVerified: '2026-06-11T00:00:00.000Z',
  });
}

describe('projectReceipt', () => {
  it('writes the receipt + AI-BOM snapshots and appends to the chain', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    const result = await project(root, 'mutation-testing');

    expect(existsSync(join(root, PATHS.EVIDENCE_RECEIPT))).toBe(true);
    expect(existsSync(join(root, PATHS.EVIDENCE_AI_BOM))).toBe(true);
    expect(existsSync(join(root, PATHS.EVIDENCE_RECEIPT_CHAIN))).toBe(true);

    const snapshot = JSON.parse(readFileSync(join(root, PATHS.EVIDENCE_RECEIPT), 'utf8'));
    expect(snapshot.paqad.receipt_hash).toBe(result.envelope.paqad.receipt_hash);
  });

  it('builds a verifiable chain across successive merges', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    const first = await project(root, 'mutation-testing');
    const second = await project(root, 'spec-review');

    expect(second.envelope.paqad.prev_receipt_hash).toBe(first.envelope.paqad.receipt_hash);
    expect(latestReceiptHash(root)).toBe(second.envelope.paqad.receipt_hash);

    const chain = readReceiptChain(root);
    expect(chain).toHaveLength(2);
    expect(verifyReceiptChain(chain)).toBeNull();
  });

  it('reads back the authorship attested by the latest feature receipt (#468 Phase B)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    expect(latestReceiptAuthorship(root)).toBeNull();

    projectFeature(root, {
      agent: 'claude-code',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      model_id: 'anthropic/claude-opus-4-8',
      accepting_human: { name: 'Jane', email: 'jane@example.com' },
      provenance: 'declared',
    });

    expect(latestReceiptAuthorship(root)).toMatchObject({
      agent: 'claude-code',
      model_id: 'anthropic/claude-opus-4-8',
      accepting_human: { name: 'Jane' },
      provenance: 'declared',
    });
  });

  it('returns null authorship when the feature receipt carried none', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    projectFeature(root);
    expect(latestReceiptAuthorship(root)).toBeNull();
  });

  it('skips a malformed chain line without poisoning the read', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    await project(root, 'mutation-testing');
    appendChainLine(root, '{ not json');
    appendChainLine(root, '');
    expect(readReceiptChain(root)).toHaveLength(1);
  });

  it('decodeReceiptStatement returns null for an undecodable payload', () => {
    const envelope = {
      payload: '!!!not-base64-json',
      paqad: { receipt_hash: 'h' },
    } as ReceiptEnvelope;
    expect(decodeReceiptStatement(envelope)).toBeNull();
  });

  it('latestReceiptAuthorship returns null when the latest feature payload is undecodable', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-receipt-'));
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 7 });
    const path = join(root, featureFilePath(dir, 'receipt'));
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({ payload: '!!!not-base64-json', paqad: { receipt_hash: 'h' } }),
      'utf8',
    );
    expect(latestReceiptAuthorship(root)).toBeNull();
  });
});
