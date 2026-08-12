import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChangeAuthorship, EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { buildEvidencePacket } from '@/dashboard/export-packet.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { featureFilePath, formatFeatureDirName } from '@/feature-evidence/paths.js';
import { projectFeatureReceipt } from '@/feature-evidence/receipt.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

// Issue #468 Phase B — the packet composes the bundle-projected feeds, so seed bundles.
function seedBundleEvidence(root: string, rows: EvidenceLedgerRow[]): void {
  const dir = formatFeatureDirName({ issue: null, slug: 'x', ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const path = join(root, featureFilePath(dir, 'evidence'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

let seed = 0;
function projectFeature(root: string, ts: string, authorship?: ChangeAuthorship): string {
  seed += 1;
  const dir = openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: `f${seed}`,
    issue: null,
    ulidSeed: seed,
  });
  projectFeatureReceipt(root, dir, {
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [
      buildEvidenceRow({
        ts,
        engine: 'verification-gate',
        code: 'spec-review',
        subject_digest: 'subject-1',
        verdict: 'pass',
        strength_class: 'deterministic',
      }),
    ],
    verifierVersion: '1.0.0',
    timeVerified: ts,
    ...(authorship ? { authorship } : {}),
  });
  return dir;
}

describe('buildEvidencePacket', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-export-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('renders an empty-state packet on a bare project', () => {
    const packet = buildEvidencePacket(root);
    expect(packet.json.evidence.rows).toEqual([]);
    expect(packet.json.receipts.receipts).toEqual([]);
    expect(packet.json.aiBom).toBeNull();
    expect(packet.markdown).toContain('No receipts yet');
    expect(packet.html).toContain('<!doctype html>');
    expect(packet.html).toContain('No gate runs recorded yet.');
    expect(packet.html).not.toContain('<script');
  });

  it('includes evidence rows, a project title, and escapes html', () => {
    seedBundleEvidence(root, [
      buildEvidenceRow({
        ts: '2026-06-12T00:00:00Z',
        engine: 'vitest',
        code: 'tests<script>',
        subject_digest: 'sha256:abc',
        verdict: 'pass',
        strength_class: 'strong',
      }),
    ]);

    const packet = buildEvidencePacket(root, { projectName: 'Demo & Co' });
    expect(packet.projectName).toBe('Demo & Co');
    expect(packet.html).toContain('Demo &amp; Co');
    expect(packet.html).toContain('tests&lt;script&gt;');
    expect(packet.html).not.toContain('tests<script>');
    expect(packet.markdown).toContain('PASS tests<script>');
  });

  it('renders sealed receipts with authorship in both forms', () => {
    projectFeature(root, '2026-06-11T00:00:00.000Z');

    const packet = buildEvidencePacket(root);
    expect(packet.json.receipts.receipts).toHaveLength(1);
    expect(packet.markdown).toContain('Sealed');
    expect(packet.markdown).toContain('1 checks, result PASSED');
    expect(packet.html).toContain('sealed');
    expect(packet.html).not.toContain('No receipts yet');
  });

  it('renders the model-id voucher and a broken-link receipt', () => {
    // A sound feature receipt carrying model-id authorship (newest ts → first card)...
    projectFeature(root, '2026-06-11T01:00:00.000Z', {
      agent: 'claude-code',
      model_id: 'anthropic/claude-opus-4-8',
      provenance: 'declared',
    });
    // ...and a second feature whose receipt bytes are tampered (seal=false branch).
    const dir = openFeatureChange(root, 'ses_1', {
      adapter: 'claude-code',
      title: 'tampered',
      issue: null,
      ulidSeed: 999,
    });
    writeFileSync(
      join(root, featureFilePath(dir, 'receipt')),
      JSON.stringify({
        payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from('not-json').toString('base64'),
        signatures: [{ keyid: 'paqad-hash-chain', sig: 'bogus' }],
        paqad: { signing_mode: 'hash-chained', prev_receipt_hash: 'wrong', receipt_hash: 'bogus' },
      }),
      'utf8',
    );

    const packet = buildEvidencePacket(root);
    expect(packet.html).toContain('claude-code'); // author present
    expect(packet.html).toContain('anthropic/claude-opus-4-8'); // model-id voucher branch
    expect(packet.html).toContain('broken link'); // unsealed receipt branch
  });
});
