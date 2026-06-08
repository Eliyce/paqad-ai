import { describe, expect, it } from 'vitest';

import { scopeMutationTargets } from '@/mutation/scope.js';

describe('scopeMutationTargets', () => {
  it('keeps only mutable source files from the changed set', () => {
    const scoped = scopeMutationTargets([
      'src/feature.ts',
      'src/component.tsx',
      'lib/util.js',
      'app/service.py',
    ]);
    expect(scoped).toEqual([
      'app/service.py',
      'lib/util.js',
      'src/component.tsx',
      'src/feature.ts',
    ]);
  });

  it('excludes tests, docs, and config/manifest files', () => {
    const scoped = scopeMutationTargets([
      'src/feature.ts',
      'tests/unit/feature.test.ts',
      'src/feature.spec.ts',
      'docs/modules/x.md',
      'README.md',
      'package.json',
      'tsconfig.json',
      'scripts/setup.sh',
    ]);
    expect(scoped).toEqual(['src/feature.ts']);
  });

  it('normalises separators, de-dupes, sorts, and drops blanks', () => {
    const scoped = scopeMutationTargets(['src\\b.ts', 'src/a.ts', 'src/a.ts', '   ', 'src\\b.ts']);
    expect(scoped).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns an empty list when nothing is mutable', () => {
    expect(scopeMutationTargets(['docs/a.md', 'tests/a.test.ts'])).toEqual([]);
    expect(scopeMutationTargets([])).toEqual([]);
  });
});
