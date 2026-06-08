import { describe, expect, it } from 'vitest';

import { solveReachability } from '@/traceability/reachability.js';

describe('solveReachability', () => {
  it('marks files transitively imported by an anchor as used', () => {
    // anchor -> a -> b ; c is imported by nothing reachable.
    const result = solveReachability({
      edges: [
        { from: 'src/anchor.ts', to: 'src/a.ts' },
        { from: 'src/a.ts', to: 'src/b.ts' },
        { from: 'src/dead.ts', to: 'src/c.ts' },
      ],
      anchors: ['src/anchor.ts'],
      universe: ['src/anchor.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/dead.ts'],
    });

    expect(result.used.has('src/a.ts')).toBe(true);
    expect(result.used.has('src/b.ts')).toBe(true);
    // c is only reached from dead.ts, which no anchor reaches.
    expect(result.used.has('src/c.ts')).toBe(false);
    expect(result.orphans).toEqual(['src/c.ts', 'src/dead.ts']);
  });

  it('does not rescue a dead cluster that only imports itself', () => {
    // Two files import each other but neither is reachable from an anchor.
    const result = solveReachability({
      edges: [
        { from: 'src/dead-a.ts', to: 'src/dead-b.ts' },
        { from: 'src/dead-b.ts', to: 'src/dead-a.ts' },
        { from: 'src/anchor.ts', to: 'src/used.ts' },
      ],
      anchors: ['src/anchor.ts'],
      universe: ['src/anchor.ts', 'src/used.ts', 'src/dead-a.ts', 'src/dead-b.ts'],
    });

    expect(result.orphans).toEqual(['src/dead-a.ts', 'src/dead-b.ts']);
    expect(result.used.has('src/used.ts')).toBe(true);
  });

  it('records a sample of importers as evidence of use', () => {
    const result = solveReachability({
      edges: [
        { from: 'src/anchor.ts', to: 'src/shared.ts' },
        { from: 'src/anchor.ts', to: 'src/other.ts' },
        { from: 'src/other.ts', to: 'src/shared.ts' },
      ],
      anchors: ['src/anchor.ts'],
      universe: ['src/anchor.ts', 'src/other.ts', 'src/shared.ts'],
    });

    expect(result.reachedFrom.get('src/shared.ts')).toEqual(
      expect.arrayContaining(['src/anchor.ts', 'src/other.ts']),
    );
  });

  it('treats every file as orphan when there are no anchors', () => {
    const result = solveReachability({
      edges: [{ from: 'src/a.ts', to: 'src/b.ts' }],
      anchors: [],
      universe: ['src/a.ts', 'src/b.ts'],
    });

    expect(result.used.size).toBe(0);
    expect(result.orphans).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
