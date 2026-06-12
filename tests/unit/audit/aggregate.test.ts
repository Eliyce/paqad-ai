import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import { PATHS } from '@/core/constants/paths';
import type { ChangeAuthorship } from '@/core/types/evidence-ledger';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger';
import { projectReceipt } from '@/evidence/receipt/project';

function row(code: string, ts: string, detail?: string) {
  return buildEvidenceRow({
    ts,
    engine: 'verification-gate',
    code,
    subject_digest: 'subj-1',
    verdict: 'pass',
    strength_class: 'deterministic',
    ...(detail !== undefined ? { detail } : {}),
  });
}

async function project(root: string, ts: string, authorship?: ChangeAuthorship, files = 1) {
  return projectReceipt({
    projectRoot: root,
    fileDigests: Array.from({ length: files }, (_, i) => ({
      name: `src/f${i}.ts`,
      sha256: `sha-${i}`,
    })),
    rows: [row('mutation-testing', ts)],
    verifierVersion: '9.9.9',
    timeVerified: ts,
    ...(authorship !== undefined ? { authorship } : {}),
  });
}

describe('aggregateSiemEvents', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-agg-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns nothing when there is no ledger or chain', () => {
    expect(aggregateSiemEvents(root)).toEqual([]);
  });

  it('maps evidence rows, carrying detail through', () => {
    appendEvidenceRows(root, [
      row('code-tests-lint', '2026-06-10T00:00:00.000Z', 'all green'),
      row('mutation-testing', '2026-06-10T01:00:00.000Z'),
    ]);
    const events = aggregateSiemEvents(root);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kind === 'evidence')).toBe(true);
    expect(events[0].detail).toBe('all green');
    expect(events[1].detail).toBeUndefined();
  });

  it('maps a sound receipt into a sealed attestation with full authorship', async () => {
    await project(
      root,
      '2026-06-11T00:00:00.000Z',
      {
        agent: 'claude-code',
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        model_id: 'anthropic/claude-opus-4-8',
        accepting_human: { name: 'Ada', email: 'ada@example.com' },
        provenance: 'declared',
      },
      2,
    );

    const events = aggregateSiemEvents(root);
    const attestation = events.find((e) => e.kind === 'attestation');
    expect(attestation?.sealed).toBe(true);
    expect(attestation?.verdict).toBe('PASSED');
    expect(attestation?.subjects).toHaveLength(2);
    expect(attestation?.authorship?.model_id).toBe('anthropic/claude-opus-4-8');
    expect(attestation?.authorship?.accepting_human).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(attestation?.detail).toMatch(/chain sealed/);
  });

  it('handles partial and human-only authorship shapes', async () => {
    await project(root, '2026-06-11T00:00:00.000Z', { provenance: 'unknown' });
    await project(root, '2026-06-11T00:10:00.000Z', {
      accepting_human: { name: 'NameOnly' },
      provenance: 'declared',
    });
    await project(root, '2026-06-11T00:20:00.000Z', {
      accepting_human: { email: 'email@only.test' },
      provenance: 'declared',
    });

    const attestations = aggregateSiemEvents(root).filter((e) => e.kind === 'attestation');
    expect(attestations[0].authorship).toEqual({ provenance: 'unknown' });
    expect(attestations[1].authorship?.accepting_human).toEqual({ name: 'NameOnly' });
    expect(attestations[2].authorship?.accepting_human).toEqual({ email: 'email@only.test' });
  });

  it('marks a tampered, undecodable receipt as unsealed with no predicate', async () => {
    await project(root, '2026-06-11T00:00:00.000Z'); // a sound genesis receipt
    // Append a receipt the reader accepts (has paqad.receipt_hash) but whose
    // payload is not valid JSON and whose prev link is wrong → unsealed + null.
    const chainPath = join(root, PATHS.EVIDENCE_RECEIPT_CHAIN);
    mkdirSync(dirname(chainPath), { recursive: true });
    appendFileSync(
      chainPath,
      JSON.stringify({
        payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from('not-json').toString('base64'),
        signatures: [{ keyid: 'paqad-hash-chain', sig: 'bogus' }],
        paqad: { signing_mode: 'hash-chained', prev_receipt_hash: 'wrong', receipt_hash: 'bogus' },
      }) + '\n',
      'utf8',
    );

    const attestations = aggregateSiemEvents(root).filter((e) => e.kind === 'attestation');
    expect(attestations).toHaveLength(2);
    const tampered = attestations.find((e) => e.receipt_hash === 'bogus');
    expect(tampered?.sealed).toBe(false);
    expect(tampered?.verdict).toBe('unknown');
    expect(tampered?.ts).toBe('');
    expect(tampered?.detail).toBeUndefined();
    expect(tampered?.authorship).toBeUndefined();
    expect(tampered?.subjects).toEqual([]);
  });

  it('returns one chronological stream, oldest first', async () => {
    appendEvidenceRows(root, [row('code-tests-lint', '2026-06-09T00:00:00.000Z')]);
    await project(root, '2026-06-12T00:00:00.000Z');
    const events = aggregateSiemEvents(root);
    expect(events[0].ts <= events[events.length - 1].ts).toBe(true);
    expect(events[0].kind).toBe('evidence');
  });
});
