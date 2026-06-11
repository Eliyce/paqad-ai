import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectAttestation } from '@/dashboard/collectors/attestation';
import { buildEvidenceRow } from '@/evidence/ledger';
import { projectReceipt } from '@/evidence/receipt/project';

describe('collectAttestation', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-attest-coll-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function project(authorship?: Parameters<typeof projectReceipt>[0]['authorship']) {
    return projectReceipt({
      projectRoot: root,
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
      authorship,
    });
  }

  it('returns unknown band when no receipts exist', () => {
    const { section } = collectAttestation(root);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
    expect(section.summary).toMatch(/No attestation receipts/);
  });

  it('summarises the latest receipt with its author and result', async () => {
    await project({
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

  it('labels an unattributed receipt without throwing', async () => {
    await project(undefined);
    const { section } = collectAttestation(root);
    expect(section.summary).toContain('unattributed');
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Accepted by']).toBe('—');
  });
});
