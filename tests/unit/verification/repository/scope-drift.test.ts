import { describe, expect, it } from 'vitest';

import { collectScopeDriftPaths } from '@/verification/repository/scope-drift.js';

describe('collectScopeDriftPaths', () => {
  it('returns no drift when the boundary is empty', () => {
    expect(collectScopeDriftPaths(['src/a.ts', 'lib/b.ts'], [])).toEqual([]);
  });

  it('returns no drift when every changed file sits under the boundary', () => {
    expect(
      collectScopeDriftPaths(['src/feature/a.ts', 'src/feature/b.ts'], ['src/feature']),
    ).toEqual([]);
  });

  it('flags files outside the boundary, sorted and de-duplicated', () => {
    expect(
      collectScopeDriftPaths(
        ['src/feature/a.ts', 'src/unrelated/x.ts', 'src/unrelated/x.ts', 'lib/y.ts'],
        ['src/feature', 'tests'],
      ),
    ).toEqual(['lib/y.ts', 'src/unrelated/x.ts']);
  });

  it('treats an exact file boundary entry as in scope', () => {
    expect(collectScopeDriftPaths(['package.json'], ['package.json'])).toEqual([]);
  });

  it('normalizes leading ./ and backslashes before comparing', () => {
    expect(
      collectScopeDriftPaths(['./src/feature/a.ts', 'src\\feature\\b.ts'], ['src/feature']),
    ).toEqual([]);
  });

  it('does not treat a sibling prefix as inside the boundary', () => {
    expect(collectScopeDriftPaths(['src/featureX/a.ts'], ['src/feature'])).toEqual([
      'src/featureX/a.ts',
    ]);
  });
});
