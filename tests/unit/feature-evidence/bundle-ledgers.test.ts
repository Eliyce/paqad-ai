import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendFeatureEvidenceRows,
  appendRuleRun,
  mirrorRagRow,
  readChangeMetrics,
  readDuplication,
  readFeatureEvidence,
  readRuleRun,
  resolveRagHome,
} from '@/feature-evidence/bundle-ledgers.js';
import { chatRagPath, featureFilePath } from '@/feature-evidence/paths.js';
import { validateEnvelopeHeader } from '@/feature-evidence/schema.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { readUnitFile, stampSessionRow } from '@/session-ledger/ledger.js';
import type { ChangeMetrics } from '@/change-metrics/types.js';
import type { DuplicationReport } from '@/duplication/report.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-bundle-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Route first workflows',
    issue: '339',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

/** Issue #581 — a bundle row opens with the six-field header, for the change the dir names. */
function expectBundleHeader(row: Record<string, unknown>, docType: string, dir: string): void {
  expect(Object.keys(row).slice(0, 6)).toEqual([
    'schema_version',
    'doc_type',
    'change',
    'session_id',
    'recorded_at',
    'content_hash',
  ]);
  expect(row).toMatchObject({
    schema_version: 2,
    doc_type: docType,
    change: dir.slice(-26),
    session_id: 'ses_1',
  });
  expect(validateEnvelopeHeader(row)).toEqual([]);
  expect(row).not.toHaveProperty('ts');
}

describe('RAG two-home routing', () => {
  it('routes to _chat when no feature is active (the one-prompt lag)', () => {
    const root = tempRoot();
    expect(resolveRagHome(root, 'ses_1')).toBe(chatRagPath('ses_1'));
  });

  it('routes to the active feature bundle once a feature is open', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(resolveRagHome(root, 'ses_1')).toBe(`.paqad/ledger/feature-evidence/${dir}/rag.jsonl`);
  });

  it('mirrorRagRow writes the stamped row into the resolved home', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const stamped = stampSessionRow('paqad.rag-evidence', 'ses_1', { kind: 'retrieval' });
    mirrorRagRow(root, 'ses_1', stamped);
    const rows = readUnitFile(root, `.paqad/ledger/feature-evidence/${dir}/rag.jsonl`);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('retrieval');
  });

  // Issue #581 — the bundle copy is re-stamped with the bundle header and no adapter; the
  // _chat home is not a bundle and keeps the recorder's row.
  it('re-stamps a bundle-bound RAG row as paqad.rag with no adapter', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const at = new Date('2026-09-25T01:02:03.000Z');
    const stamped = stampSessionRow(
      'paqad.rag-evidence',
      'ses_1',
      { kind: 'called', conversation_ordinal: 3, adapter: 'claude-code' },
      { now: () => at },
    );
    mirrorRagRow(root, 'ses_1', stamped);
    const [row] = readUnitFile(root, featureFilePath(dir, 'rag')) as Record<string, unknown>[];
    expectBundleHeader(row!, 'paqad.rag', dir);
    expect(row).toMatchObject({ kind: 'called', conversation_ordinal: 3 });
    expect(row!.recorded_at).toBe(at.toISOString());
    expect(row).not.toHaveProperty('adapter');
    expect(row).not.toHaveProperty('ts');
  });

  it('keeps the recorder row as stamped in the _chat home', () => {
    const root = tempRoot();
    const stamped = stampSessionRow('paqad.rag-evidence', 'ses_1', {
      kind: 'open',
      adapter: 'claude-code',
    });
    mirrorRagRow(root, 'ses_1', stamped);
    expect(readUnitFile(root, chatRagPath('ses_1'))).toEqual([stamped]);
  });

  it('mirrorRagRow is best-effort — a bad root never throws', () => {
    const stamped = stampSessionRow('paqad.rag-evidence', 'ses_1', { kind: 'retrieval' });
    expect(() => mirrorRagRow('\0not-a-real-root', 'ses_1', stamped)).not.toThrow();
  });
});

describe('per-feature rule-run.jsonl', () => {
  it('appends a rule-run row into the active feature and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const row = appendRuleRun(root, 'ses_1', {
      kind: 'findings',
      counts: { deterministic: 2, heuristic: 1, skipped: 0 },
      blocking: true,
    });
    expect(row).not.toBeNull();
    const rows = readRuleRun(root, dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'findings', blocking: true });
    // Issue #581 — the bundle header, and no adapter on the row (AC-4, AC-6).
    expectBundleHeader(rows[0] as unknown as Record<string, unknown>, 'paqad.rule-run', dir);
    expect(rows[0]).not.toHaveProperty('adapter');
  });

  it('is a no-op (null) when no feature is active', () => {
    const root = tempRoot();
    expect(appendRuleRun(root, 'ses_1', { kind: 'drift', counts: {}, blocking: false })).toBeNull();
  });
});

function duplicationReport(): DuplicationReport {
  return {
    schema_version: 1,
    generated_at: '2026-08-12T00:00:00.000Z',
    mode: 'strict',
    similarity_threshold: 0.8,
    min_lines: 5,
    elapsed_ms: 12,
    findings: [],
    counts: { deterministic: 1, heuristic: 2 },
    blocking: true,
  };
}

function changeMetrics(): ChangeMetrics {
  return {
    dup_new_pct: 4.2,
    reuse_rate: 1.5,
    meaningful_changed_lines: 40,
    inputs: {
      flagged_lines: 2,
      reuse_calls: 3,
      duplication_report_present: true,
      index_present: true,
    },
  };
}

function gradedRows() {
  return [
    buildEvidenceRow({
      ts: '2026-08-12T00:00:00.000Z',
      engine: 'verification-gate',
      code: 'code-tests-lint',
      subject_digest: 'abc123',
      verdict: 'pass',
      strength_class: 'deterministic',
    }),
    buildEvidenceRow({
      ts: '2026-08-12T00:00:00.000Z',
      engine: 'quality-ratchet',
      code: 'coverage',
      subject_digest: 'abc123',
      verdict: 'pass',
      strength_class: 'deterministic',
    }),
  ];
}

describe('per-feature duplication.jsonl (issue #468)', () => {
  it('appends a duplication row into the active feature and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const row = appendDuplicationRun(root, 'ses_1', duplicationReport());
    expect(row).not.toBeNull();
    const rows = readDuplication(root, dir);
    expect(rows).toHaveLength(1);
    // Issue #581 — doc_type is the file stem, paqad.duplication.
    expectBundleHeader(rows[0] as unknown as Record<string, unknown>, 'paqad.duplication', dir);
    expect(rows[0]).toMatchObject({
      counts: { deterministic: 1, heuristic: 2 },
      similarity_threshold: 0.8,
      min_lines: 5,
      mode: 'strict',
      blocking: true,
    });
  });

  it('is a no-op (null) when no feature is active', () => {
    const root = tempRoot();
    expect(appendDuplicationRun(root, 'ses_1', duplicationReport())).toBeNull();
  });

  it('swallows an internal failure (best-effort) and returns null', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const throwingClock = () => {
      throw new Error('boom');
    };
    expect(appendDuplicationRun(root, 'ses_1', duplicationReport(), throwingClock)).toBeNull();
    expect(readDuplication(root, dir)).toHaveLength(0);
  });
});

describe('per-feature change-metrics.jsonl (issue #468)', () => {
  it('appends a change-metrics row into the active feature and reads it back', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const row = appendChangeMetrics(root, 'ses_1', changeMetrics());
    expect(row).not.toBeNull();
    const rows = readChangeMetrics(root, dir);
    expect(rows).toHaveLength(1);
    expectBundleHeader(rows[0] as unknown as Record<string, unknown>, 'paqad.change-metrics', dir);
    expect(rows[0]).toMatchObject({
      dup_new_pct: 4.2,
      reuse_rate: 1.5,
      meaningful_changed_lines: 40,
      flagged_lines: 2,
      reuse_calls: 3,
    });
  });

  it('is a no-op (null) when no feature is active', () => {
    const root = tempRoot();
    expect(appendChangeMetrics(root, 'ses_1', changeMetrics())).toBeNull();
  });

  it('swallows an internal failure (best-effort) and returns null', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const throwingClock = () => {
      throw new Error('boom');
    };
    expect(appendChangeMetrics(root, 'ses_1', changeMetrics(), throwingClock)).toBeNull();
    expect(readChangeMetrics(root, dir)).toHaveLength(0);
  });
});

describe('per-feature evidence.jsonl (issue #468, D5)', () => {
  it('appends the graded rows with the bundle header and reads them back (issue #581)', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const rows = gradedRows();
    const written = appendFeatureEvidenceRows(root, 'ses_1', rows);
    expect(written).toHaveLength(2);
    const readBack = readFeatureEvidence(root, dir);
    expect(readBack).toHaveLength(2);
    expect(readBack[0]).toMatchObject({ code: 'code-tests-lint', verdict: 'pass' });
    // What was written is what reads back, in the one row view (ts filled from recorded_at).
    expect(readBack).toEqual(written);
    expect(readBack[0]).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.evidence',
      change: dir.slice(-26),
      session_id: 'ses_1',
      recorded_at: rows[0].ts,
      ts: rows[0].ts,
    });
    // On disk the header leads and the old `ts` is not written (AC-4).
    const line = JSON.parse(
      readFileSync(join(root, featureFilePath(dir, 'evidence')), 'utf8').split('\n')[0]!,
    ) as Record<string, unknown>;
    expect(Object.keys(line).slice(0, 6)).toEqual([
      'schema_version',
      'doc_type',
      'change',
      'session_id',
      'recorded_at',
      'content_hash',
    ]);
    expect(line).not.toHaveProperty('ts');
  });

  it('is a no-op ([]) when no feature is active', () => {
    const root = tempRoot();
    expect(appendFeatureEvidenceRows(root, 'ses_1', gradedRows())).toEqual([]);
  });

  it('is a no-op ([]) for an empty row set even with an active feature', () => {
    const root = tempRoot();
    activeFeature(root);
    expect(appendFeatureEvidenceRows(root, 'ses_1', [])).toEqual([]);
  });

  it('swallows an internal failure (best-effort) and returns []', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    // A circular row makes the JSONL stringify inside the writer throw.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      appendFeatureEvidenceRows(root, 'ses_1', [
        circular as unknown as ReturnType<typeof buildEvidenceRow>,
      ]),
    ).toEqual([]);
    expect(readFeatureEvidence(root, dir)).toHaveLength(0);
  });
});
