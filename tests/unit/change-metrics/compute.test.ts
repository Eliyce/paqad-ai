import { describe, expect, it } from 'vitest';

import {
  computeChangeMetrics,
  crossFileReuseCalls,
  flaggedNewCodeLines,
} from '@/change-metrics/compute.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';

import {
  codeLines,
  finding,
  makeProject,
  writeDuplicationCache,
  writeFile,
  writeIndex,
} from './helpers.js';

describe('flaggedNewCodeLines', () => {
  it('unions overlapping spans so a line is never counted twice', () => {
    const flagged = flaggedNewCodeLines([
      finding('src/a.ts', 1, 10), // 10 lines
      finding('src/a.ts', 5, 14), // overlaps 5–10, adds 11–14 → union 1–14 = 14
    ]);
    expect(flagged).toBe(14);
  });

  it('sums distinct lines across files', () => {
    const flagged = flaggedNewCodeLines([finding('src/a.ts', 1, 3), finding('src/b.ts', 1, 2)]);
    expect(flagged).toBe(5);
  });
});

describe('crossFileReuseCalls', () => {
  const index = (edges: CodeKnowledgeIndex['reference_edges']): CodeKnowledgeIndex => ({
    schema_version: 1,
    header: {
      generated_at: 'x',
      branch: null,
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: [],
    files: [],
    import_edges: [],
    reference_edges: edges,
    dependencies: [],
  });

  it('counts only edges from a changed file into an untouched file', () => {
    const calls = crossFileReuseCalls(
      index([
        { from: 'src/new.ts', to: 'src/existing.ts', symbol: 'a' }, // counts
        { from: 'src/new.ts', to: 'src/other-changed.ts', symbol: 'b' }, // target changed → skip
        { from: 'src/unchanged.ts', to: 'src/existing.ts', symbol: 'c' }, // source unchanged → skip
      ]),
      ['src/new.ts', 'src/other-changed.ts'],
    );
    expect(calls).toBe(1);
  });
});

describe('computeChangeMetrics', () => {
  it('AC-1: one finding spanning 10 of 100 meaningful lines → dup_new_pct 10, renders on the receipt', async () => {
    const root = makeProject();
    writeFile(root, 'src/a.ts', codeLines(100));
    writeDuplicationCache(root, [finding('src/a.ts', 1, 10)]);

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/a.ts'] });
    expect(metrics.meaningful_changed_lines).toBe(100);
    expect(metrics.dup_new_pct).toBe(10);
    expect(metrics.inputs.flagged_lines).toBe(10);
    expect(metrics.inputs.duplication_report_present).toBe(true);
  });

  it('AC-1: a clean change (report present, no findings) → 0%', async () => {
    const root = makeProject();
    writeFile(root, 'src/a.ts', codeLines(20));
    writeDuplicationCache(root, []);

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/a.ts'] });
    expect(metrics.dup_new_pct).toBe(0);
  });

  it('AC-2: 3 cross-file calls across 50 meaningful lines → reuse_rate 6.0', async () => {
    const root = makeProject();
    writeFile(root, 'src/new.ts', codeLines(50));
    writeIndex(root, [
      { from: 'src/new.ts', to: 'src/existing.ts', symbol: 'a' },
      { from: 'src/new.ts', to: 'src/existing.ts', symbol: 'b' },
      { from: 'src/new.ts', to: 'src/other.ts', symbol: 'c' },
    ]);

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/new.ts'] });
    expect(metrics.meaningful_changed_lines).toBe(50);
    expect(metrics.reuse_rate).toBe(6);
    expect(metrics.inputs.reuse_calls).toBe(3);
    expect(metrics.inputs.index_present).toBe(true);
  });

  it('AC-2: index absent → reuse_rate n/a (null) with an honest input flag', async () => {
    const root = makeProject();
    writeFile(root, 'src/new.ts', codeLines(50));

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/new.ts'] });
    expect(metrics.reuse_rate).toBeNull();
    expect(metrics.inputs.index_present).toBe(false);
  });

  it('duplication report absent → dup_new_pct n/a (null)', async () => {
    const root = makeProject();
    writeFile(root, 'src/new.ts', codeLines(10));

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/new.ts'] });
    expect(metrics.dup_new_pct).toBeNull();
    expect(metrics.inputs.duplication_report_present).toBe(false);
  });

  it('no meaningful changed lines → both metrics n/a even when the caches are present', async () => {
    const root = makeProject();
    writeFile(root, 'src/blank.ts', '\n// only a comment\n\n');
    writeDuplicationCache(root, []);
    writeIndex(root, [{ from: 'src/blank.ts', to: 'src/existing.ts', symbol: 'a' }]);

    const metrics = await computeChangeMetrics({
      projectRoot: root,
      changedFiles: ['src/blank.ts'],
    });
    expect(metrics.meaningful_changed_lines).toBe(0);
    expect(metrics.dup_new_pct).toBeNull();
    expect(metrics.reuse_rate).toBeNull();
  });

  it('clamps dup_new_pct to 100 when flagged spans exceed meaningful lines', async () => {
    const root = makeProject();
    // 2 meaningful lines but a finding span of 10 lines (e.g. spanning blanks/comments).
    writeFile(root, 'src/a.ts', 'const a = 1;\nconst b = 2;');
    writeDuplicationCache(root, [finding('src/a.ts', 1, 10)]);

    const metrics = await computeChangeMetrics({ projectRoot: root, changedFiles: ['src/a.ts'] });
    expect(metrics.dup_new_pct).toBe(100);
  });
});
