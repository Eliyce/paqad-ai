import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  appendEvidenceRows,
  buildEvidenceRow,
  computeRowContentHash,
  readEvidenceLedger,
  readEvidenceWindow,
  type NewEvidenceRow,
} from '@/evidence/ledger.js';

function newRow(overrides: Partial<NewEvidenceRow> = {}): NewEvidenceRow {
  return {
    ts: '2026-06-11T00:00:00.000Z',
    engine: 'verification-gate',
    code: 'mutation-testing',
    subject_digest: 'abc',
    verdict: 'pass',
    strength_class: 'deterministic',
    ...overrides,
  };
}

describe('content_hash', () => {
  it('excludes ts so the same finding de-dups across re-runs', () => {
    const a = buildEvidenceRow(newRow({ ts: '2026-01-01T00:00:00.000Z' }));
    const b = buildEvidenceRow(newRow({ ts: '2026-12-31T23:59:59.000Z' }));
    expect(a.content_hash).toBe(b.content_hash);
  });

  it('changes when an identity field changes', () => {
    const pass = computeRowContentHash(newRow({ verdict: 'pass' }));
    const fail = computeRowContentHash(newRow({ verdict: 'fail' }));
    expect(pass).not.toBe(fail);
  });
});

describe('appendEvidenceRows / readEvidenceLedger', () => {
  it('round-trips appended rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-'));
    appendEvidenceRows(root, [
      buildEvidenceRow(newRow()),
      buildEvidenceRow(newRow({ code: 'spec-review', strength_class: 'llm-judged' })),
    ]);
    appendEvidenceRows(root, [buildEvidenceRow(newRow({ code: 'ac-test-mapping' }))]);

    const rows = readEvidenceLedger(root);
    expect(rows.map((r) => r.code)).toEqual(['mutation-testing', 'spec-review', 'ac-test-mapping']);
  });

  it('is a no-op for an empty batch and returns [] when absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-'));
    appendEvidenceRows(root, []);
    expect(readEvidenceLedger(root)).toEqual([]);
  });

  it('skips malformed lines so a mid-crash write cannot poison the reader', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-'));
    appendEvidenceRows(root, [buildEvidenceRow(newRow())]);
    appendFileSync(join(root, PATHS.EVIDENCE_LEDGER), '{ this is not json\n', 'utf8');
    appendEvidenceRows(root, [buildEvidenceRow(newRow({ code: 'spec-review' }))]);

    const rows = readEvidenceLedger(root);
    expect(rows.map((r) => r.code)).toEqual(['mutation-testing', 'spec-review']);
  });

  it('filters a window by subject_digest', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ledger-'));
    appendEvidenceRows(root, [
      buildEvidenceRow(newRow({ subject_digest: 'change-1' })),
      buildEvidenceRow(newRow({ subject_digest: 'change-2', code: 'spec-review' })),
    ]);
    expect(readEvidenceWindow(root, 'change-1').map((r) => r.code)).toEqual(['mutation-testing']);
  });
});
