import { describe, expect, it } from 'vitest';

import { computeReachability, symbolKey } from '@/code-knowledge/reachability.js';

describe('computeReachability', () => {
  it('counts distinct non-test file callers and flags orphans', () => {
    const result = computeReachability({
      files: ['src/a.ts', 'src/b.ts', 'src/dead.ts', 'src/cli/index.ts'],
      importEdges: [
        { from: 'src/a.ts', to: 'src/b.ts' },
        { from: 'src/cli/index.ts', to: 'src/b.ts' },
      ],
      referenceEdges: [],
      entryFiles: new Set(['src/cli/index.ts']),
    });
    const byPath = new Map(result.files.map((f) => [f.path, f]));

    expect(byPath.get('src/b.ts')).toMatchObject({ caller_count: 2, orphan: false });
    // src/a.ts has no in-edges and is not an entry point -> orphan.
    expect(byPath.get('src/a.ts')).toMatchObject({ caller_count: 0, orphan: true });
    expect(byPath.get('src/dead.ts')).toMatchObject({ caller_count: 0, orphan: true });
    // An entry point with no in-edges is NOT orphan.
    expect(byPath.get('src/cli/index.ts')).toMatchObject({
      caller_count: 0,
      orphan: false,
      entry_point: true,
    });
  });

  it('excludes test-file callers from the count', () => {
    const result = computeReachability({
      files: ['src/util.ts'],
      importEdges: [
        { from: 'tests/util.test.ts', to: 'src/util.ts' },
        { from: 'src/util.spec.ts', to: 'src/util.ts' },
      ],
      referenceEdges: [],
      entryFiles: new Set(),
    });
    // Only test callers -> production caller_count is 0, so it reads as orphan.
    expect(result.files[0]).toMatchObject({ caller_count: 0, orphan: true });
  });

  it('does not double-count the same caller file', () => {
    const result = computeReachability({
      files: ['src/b.ts'],
      importEdges: [
        { from: 'src/a.ts', to: 'src/b.ts' },
        { from: 'src/a.ts', to: 'src/b.ts' },
      ],
      referenceEdges: [],
      entryFiles: new Set(),
    });
    expect(result.files[0]!.caller_count).toBe(1);
  });

  it('counts distinct non-test symbol callers keyed by file + name', () => {
    const result = computeReachability({
      files: ['src/lib.ts'],
      importEdges: [],
      referenceEdges: [
        { from: 'src/a.ts', to: 'src/lib.ts', symbol: 'foo' },
        { from: 'src/b.ts', to: 'src/lib.ts', symbol: 'foo' },
        { from: 'tests/x.test.ts', to: 'src/lib.ts', symbol: 'foo' },
        { from: 'src/a.ts', to: 'src/lib.ts', symbol: 'bar' },
      ],
      entryFiles: new Set(),
    });
    expect(result.symbolCallerCount.get(symbolKey('src/lib.ts', 'foo'))).toBe(2);
    expect(result.symbolCallerCount.get(symbolKey('src/lib.ts', 'bar'))).toBe(1);
  });
});
