import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { verifyReceiptChain } from '@/evidence/receipt/dsse.js';
import { latestReceiptHash, projectReceipt, readReceiptChain } from '@/evidence/receipt/project.js';

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
});
