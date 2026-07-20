import { describe, expect, it } from 'vitest';

import {
  buildDuplicationReport,
  readDuplicationReport,
  recordDuplicationRun,
  summarizeFindings,
  writeDuplicationReport,
  DUPLICATION_EVIDENCE_DOC_TYPE,
} from '@/duplication/report.js';
import { readLatestProjectEvent } from '@/session-ledger/project-ledger.js';
import type { DuplicationFinding } from '@/duplication/types.js';

import { makeGitProject } from './helpers.js';

function finding(kind: DuplicationFinding['kind'], start = 1): DuplicationFinding {
  return {
    file: 'src/a.ts',
    line_range: { start, end: start + 7 },
    matched_file: 'src/b.ts',
    matched_line_range: { start: 1, end: 8 },
    similarity: kind === 'deterministic' ? 0.95 : 0.85,
    matched_callers: 2,
    corroborated: false,
    kind,
    message: 'msg',
  };
}

const config = { mode: 'strict' as const, similarityThreshold: 0.9, minLines: 8 };

describe('summarizeFindings', () => {
  it('counts each band and blocks only in strict with a deterministic finding', () => {
    const summary = summarizeFindings(
      [finding('deterministic'), finding('heuristic', 20)],
      'strict',
    );
    expect(summary.counts).toEqual({ deterministic: 1, heuristic: 1 });
    expect(summary.blocking).toBe(true);
  });

  it('never blocks in warn mode', () => {
    expect(summarizeFindings([finding('deterministic')], 'warn').blocking).toBe(false);
  });

  it('does not block when only heuristic findings exist', () => {
    expect(summarizeFindings([finding('heuristic')], 'strict').blocking).toBe(false);
  });
});

describe('buildDuplicationReport', () => {
  it('carries config, counts, timing, and resolved decisions', () => {
    const report = buildDuplicationReport({
      findings: [finding('deterministic')],
      config,
      elapsedMs: 42,
      now: '2026-07-20T00:00:00.000Z',
      resolvedDecisions: ['D-1'],
    });
    expect(report.mode).toBe('strict');
    expect(report.similarity_threshold).toBe(0.9);
    expect(report.min_lines).toBe(8);
    expect(report.elapsed_ms).toBe(42);
    expect(report.blocking).toBe(true);
    expect(report.resolved_decisions).toEqual(['D-1']);
  });

  it('omits resolved_decisions when there are none', () => {
    const report = buildDuplicationReport({ findings: [], config, elapsedMs: 1, now: 'x' });
    expect(report.resolved_decisions).toBeUndefined();
  });
});

describe('write / read report', () => {
  it('round-trips the report through the cache', () => {
    const root = makeGitProject();
    const report = buildDuplicationReport({
      findings: [finding('heuristic')],
      config,
      elapsedMs: 5,
      now: 'x',
    });
    writeDuplicationReport(root, report);
    expect(readDuplicationReport(root)).toEqual(report);
  });

  it('returns null when no report is cached', () => {
    expect(readDuplicationReport(makeGitProject())).toBeNull();
  });
});

describe('recordDuplicationRun', () => {
  it('folds the run counts onto the session ledger', () => {
    const root = makeGitProject();
    const report = buildDuplicationReport({
      findings: [finding('deterministic')],
      config,
      elapsedMs: 3,
      now: 'x',
    });
    recordDuplicationRun(root, report);
    const row = readLatestProjectEvent(root, DUPLICATION_EVIDENCE_DOC_TYPE, () => true);
    expect(row?.mode).toBe('strict');
    expect(row?.blocking).toBe(true);
  });
});
