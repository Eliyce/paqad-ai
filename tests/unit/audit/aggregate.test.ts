import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import type { ChangeAuthorship, EvidenceLedgerRow } from '@/core/types/evidence-ledger';
import { buildEvidenceRow } from '@/evidence/ledger';
import { appendFeatureEvidenceRows } from '@/feature-evidence/bundle-ledgers';
import { featureFilePath } from '@/feature-evidence/paths';
import { projectFeatureReceipt } from '@/feature-evidence/receipt';
import { openFeatureChange } from '@/feature-evidence/stage-ledger';

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

// Issue #468 Phase B — evidence + attestation are projected from the per-feature bundles,
// so each seed opens a feature and writes into it (a fresh feature per receipt so each is
// its own independently-sealed bundle).
let seed = 0;
function openFeature(root: string): string {
  seed += 1;
  // A unique title is the "new work" signal that mints a DISTINCT bundle (issue #339); without
  // it openFeatureChange resolves the already-active feature and every seed lands in one dir.
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: `f${seed}`,
    issue: null,
    ulidSeed: seed,
  });
}

function seedEvidence(root: string, rows: EvidenceLedgerRow[]): void {
  openFeature(root);
  appendFeatureEvidenceRows(root, 'ses_1', rows);
}

function project(root: string, ts: string, authorship?: ChangeAuthorship, files = 1): void {
  const dir = openFeature(root);
  projectFeatureReceipt(root, dir, {
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
    seedEvidence(root, [
      row('code-tests-lint', '2026-06-10T00:00:00.000Z', 'all green'),
      row('mutation-testing', '2026-06-10T01:00:00.000Z'),
    ]);
    const events = aggregateSiemEvents(root);
    const evidence = events.filter((e) => e.kind === 'evidence');
    expect(evidence).toHaveLength(2);
    expect(evidence[0].detail).toBe('all green');
    expect(evidence[1].detail).toBeUndefined();
  });

  it('maps a sound receipt into a sealed attestation with full authorship', () => {
    project(
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

  it('handles partial and human-only authorship shapes', () => {
    project(root, '2026-06-11T00:00:00.000Z', { provenance: 'unknown' });
    project(root, '2026-06-11T00:10:00.000Z', {
      accepting_human: { name: 'NameOnly' },
      provenance: 'declared',
    });
    project(root, '2026-06-11T00:20:00.000Z', {
      accepting_human: { email: 'email@only.test' },
      provenance: 'declared',
    });

    const attestations = aggregateSiemEvents(root).filter((e) => e.kind === 'attestation');
    expect(attestations[0].authorship).toEqual({ provenance: 'unknown' });
    expect(attestations[1].authorship?.accepting_human).toEqual({ name: 'NameOnly' });
    expect(attestations[2].authorship?.accepting_human).toEqual({ email: 'email@only.test' });
  });

  it('marks a tampered, undecodable receipt as unsealed with no predicate', () => {
    project(root, '2026-06-11T00:00:00.000Z'); // a sound receipt in its own bundle
    // A second feature bundle whose receipt.json is valid JSON but whose payload is not
    // valid JSON and whose seal does not recompute → unsealed + null predicate.
    const dir = openFeature(root);
    const path = join(root, featureFilePath(dir, 'receipt'));
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      JSON.stringify({
        payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from('not-json').toString('base64'),
        signatures: [{ keyid: 'paqad-hash-chain', sig: 'bogus' }],
        paqad: { signing_mode: 'hash-chained', prev_receipt_hash: 'wrong', receipt_hash: 'bogus' },
      }),
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

  it('returns one chronological stream, oldest first', () => {
    seedEvidence(root, [row('code-tests-lint', '2026-06-09T00:00:00.000Z')]);
    project(root, '2026-06-12T00:00:00.000Z');
    const events = aggregateSiemEvents(root);
    expect(events[0].ts <= events[events.length - 1].ts).toBe(true);
    expect(events[0].kind).toBe('evidence');
  });
});
