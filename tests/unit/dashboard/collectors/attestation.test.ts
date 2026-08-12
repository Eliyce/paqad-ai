import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChangeAuthorship } from '@/core/types/evidence-ledger';
import { collectAttestation } from '@/dashboard/collectors/attestation';
import { buildEvidenceRow } from '@/evidence/ledger';
import { projectFeatureReceipt } from '@/feature-evidence/receipt';
import { featureFilePath } from '@/feature-evidence/paths';
import { openFeatureChange } from '@/feature-evidence/stage-ledger';

describe('collectAttestation', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-attest-coll-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Issue #468 Phase B — the attestation surface reads the per-feature bundle receipts, so
  // each test opens a feature and projects its receipt (authorship now carried, D-01KZTSZ…).
  let seed = 0;
  function project(authorship?: ChangeAuthorship): void {
    seed += 1;
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: seed });
    projectFeatureReceipt(root, dir, {
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [
        buildEvidenceRow({
          ts: '2026-06-11T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'mutation-testing',
          subject_digest: 'subject-1',
          verdict: 'pass',
          strength_class: 'deterministic',
        }),
      ],
      verifierVersion: '1.0.0',
      timeVerified: '2026-06-11T00:00:00.000Z',
      ...(authorship ? { authorship } : {}),
    });
  }

  it('returns unknown band when no receipts exist', () => {
    const { section } = collectAttestation(root);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(section.summary).toMatch(/No attestation receipts/);
  });

  it('summarises the latest receipt with its author and result', () => {
    project({
      agent: 'cursor',
      model_id: 'openai/gpt-5',
      accepting_human: { name: 'Jane Dev', email: 'jane@example.com' },
      provenance: 'declared',
    });

    const { section } = collectAttestation(root);
    expect(section.band).toBe('green');
    expect(section.summary).toContain('cursor / openai/gpt-5');
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Latest result']).toBe('PASSED');
    expect(metrics['Written by']).toBe('cursor / openai/gpt-5');
    expect(metrics['Accepted by']).toBe('Jane Dev');
  });

  it('labels an unattributed receipt without throwing', () => {
    project(undefined);
    const { section } = collectAttestation(root);
    expect(section.summary).toContain('unattributed');
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Accepted by']).toBe('—');
  });

  it('labels by model alone when no agent is recorded', () => {
    project({
      model: 'gpt-5',
      provider: 'openai',
      model_id: 'openai/gpt-5',
      provenance: 'declared',
    });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('openai/gpt-5');
  });

  it('falls back to the bare model when no model_id is present', () => {
    project({ model: 'gpt-5', provenance: 'declared' });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('gpt-5');
  });

  it('labels a human-only receipt as unattributed but records the accepter', () => {
    project({ accepting_human: { name: 'Bob' }, provenance: 'unknown' });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('unattributed');
    expect(metrics['Accepted by']).toBe('Bob');
  });

  it('falls back to FAILED + unattributed when the latest receipt is undecodable', () => {
    // A bundle receipt.json that is valid JSON but whose payload will not base64-decode.
    const dir = openFeatureChange(root, 'ses_1', { adapter: 'claude-code', ulidSeed: 99 });
    const path = join(root, featureFilePath(dir, 'receipt'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        payload: '!!!bad',
        paqad: { receipt_hash: 'h', prev_receipt_hash: 'z', signing_mode: 'hash-chained' },
      }),
      'utf8',
    );
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Latest result']).toBe('FAILED');
    expect(metrics['Written by']).toBe('unattributed');
  });
});
