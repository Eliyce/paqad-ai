import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths';
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

  it('labels by model alone when no agent is recorded', async () => {
    await project({
      model: 'gpt-5',
      provider: 'openai',
      model_id: 'openai/gpt-5',
      provenance: 'declared',
    });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('openai/gpt-5');
  });

  it('falls back to the bare model when no model_id is present', async () => {
    await project({ model: 'gpt-5', provenance: 'declared' });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('gpt-5');
  });

  it('labels a human-only receipt as unattributed but records the accepter', async () => {
    await project({ accepting_human: { name: 'Bob' }, provenance: 'unknown' });
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Written by']).toBe('unattributed');
    expect(metrics['Accepted by']).toBe('Bob');
  });

  it('falls back to FAILED + unattributed when the latest receipt is undecodable', () => {
    const path = join(root, PATHS.EVIDENCE_RECEIPT_CHAIN);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ payload: '!!!bad', paqad: { receipt_hash: 'h' } })}\n`,
      'utf8',
    );
    const { section } = collectAttestation(root);
    const metrics = Object.fromEntries(section.metrics.map((m) => [m.label, m.value]));
    expect(metrics['Latest result']).toBe('FAILED');
    expect(metrics['Written by']).toBe('unattributed');
  });
});
