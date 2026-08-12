// Issue #468, Phase A — the dual-write parity window proof.
//
// Phase A lands the NEW per-feature bundle writers alongside the untouched old-home
// writers. This suite drives BOTH writers for the same input and asserts the bundle row
// carries the same payload as the old-home row, so Phase B (reader re-point) and Phase C
// (writer cutover) can depend on the new writers with confidence. RAG and rule-run
// already dual-write (issue #339 Phase 4), so the new-in-Phase-A types are covered here:
// duplication, change-metrics, and the graded evidence rows.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendChangeMetrics,
  appendDuplicationRun,
  appendFeatureEvidenceRows,
  readChangeMetrics,
  readDuplication,
  readFeatureEvidence,
} from '@/feature-evidence/bundle-ledgers.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { recordChangeMetrics } from '@/change-metrics/ledger.js';
import { recordDuplicationRun, type DuplicationReport } from '@/duplication/report.js';
import { DUPLICATION_EVIDENCE_DOC_TYPE } from '@/duplication/report.js';
import { CHANGE_METRICS_DOC_TYPE } from '@/change-metrics/ledger.js';
import { appendEvidenceRows, buildEvidenceRow, readEvidenceLedger } from '@/evidence/ledger.js';
import { readProjectEvents } from '@/session-ledger/project-ledger.js';
import type { ChangeMetrics } from '@/change-metrics/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-parity-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function active(root: string): string {
  return openFeatureChange(root, 'ses_1', { adapter: 'claude-code', issue: '468', ulidSeed: 1 });
}

function duplicationReport(): DuplicationReport {
  return {
    schema_version: 1,
    generated_at: '2026-08-12T00:00:00.000Z',
    mode: 'strict',
    similarity_threshold: 0.82,
    min_lines: 6,
    elapsed_ms: 9,
    findings: [],
    counts: { deterministic: 1, heuristic: 3 },
    blocking: true,
  };
}

function changeMetrics(): ChangeMetrics {
  return {
    dup_new_pct: 7.5,
    reuse_rate: 2.25,
    meaningful_changed_lines: 88,
    inputs: {
      flagged_lines: 5,
      reuse_calls: 2,
      duplication_report_present: true,
      index_present: true,
    },
  };
}

describe('#468 Phase A dual-write parity', () => {
  it('duplication: bundle row payload equals the old-home project-ledger row', () => {
    const root = tempRoot();
    const dir = active(root);
    const report = duplicationReport();

    recordDuplicationRun(root, report); // old home
    appendDuplicationRun(root, 'ses_1', report); // new home

    const oldRows = readProjectEvents(root, DUPLICATION_EVIDENCE_DOC_TYPE).filter(
      (r) => r.kind !== 'open',
    );
    const newRows = readDuplication(root, dir);
    expect(oldRows).toHaveLength(1);
    expect(newRows).toHaveLength(1);

    const payload = (r: Record<string, unknown>) => ({
      counts: r.counts,
      similarity_threshold: r.similarity_threshold,
      min_lines: r.min_lines,
      mode: r.mode,
      blocking: r.blocking,
    });
    expect(payload(newRows[0])).toEqual(payload(oldRows[0]));
  });

  it('change-metrics: bundle row payload equals the old-home project-ledger row', () => {
    const root = tempRoot();
    const dir = active(root);
    const metrics = changeMetrics();

    recordChangeMetrics(root, metrics); // old home
    appendChangeMetrics(root, 'ses_1', metrics); // new home

    const oldRows = readProjectEvents(root, CHANGE_METRICS_DOC_TYPE).filter(
      (r) => r.kind !== 'open',
    );
    const newRows = readChangeMetrics(root, dir);
    expect(oldRows).toHaveLength(1);
    expect(newRows).toHaveLength(1);

    const payload = (r: Record<string, unknown>) => ({
      dup_new_pct: r.dup_new_pct,
      reuse_rate: r.reuse_rate,
      meaningful_changed_lines: r.meaningful_changed_lines,
      flagged_lines: r.flagged_lines,
      reuse_calls: r.reuse_calls,
    });
    expect(payload(newRows[0])).toEqual(payload(oldRows[0]));
  });

  it('evidence: bundle rows are byte-identical to the old-home ledger rows', () => {
    const root = tempRoot();
    const dir = active(root);
    const rows = [
      buildEvidenceRow({
        ts: '2026-08-12T00:00:00.000Z',
        engine: 'verification-gate',
        code: 'code-tests-lint',
        subject_digest: 'sd',
        verdict: 'pass',
        strength_class: 'deterministic',
      }),
    ];

    appendEvidenceRows(root, rows); // old home (top-level)
    appendFeatureEvidenceRows(root, 'ses_1', rows); // new home (bundle)

    expect(readFeatureEvidence(root, dir)).toEqual(readEvidenceLedger(root));
  });

  it('the first-prompt lag: no active feature writes only the old home', () => {
    const root = tempRoot();
    recordDuplicationRun(root, duplicationReport());
    expect(appendDuplicationRun(root, 'ses_1', duplicationReport())).toBeNull();
    // Old home has the row; no bundle exists to hold a new-home row.
    expect(
      readProjectEvents(root, DUPLICATION_EVIDENCE_DOC_TYPE).filter((r) => r.kind !== 'open'),
    ).toHaveLength(1);
  });
});
