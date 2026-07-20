import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectAddedRanges,
  lineInRanges,
  parseUnifiedDiff,
  rangesOverlap,
} from '@/duplication/hunks.js';

import { commitAll, makeGitProject, writeProjectFile } from './helpers.js';

describe('parseUnifiedDiff', () => {
  it('extracts new-side added ranges from a multi-line hunk', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -0,0 +13,5 @@',
      '+a',
      '+b',
    ].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      { file: 'src/foo.ts', ranges: [{ start: 13, end: 17 }] },
    ]);
  });

  it('treats a bare +count as one line', () => {
    const diff = '+++ b/x.ts\n@@ -1 +2 @@\n+one';
    expect(parseUnifiedDiff(diff)).toEqual([{ file: 'x.ts', ranges: [{ start: 2, end: 2 }] }]);
  });

  it('records no range for a pure deletion (+c,0)', () => {
    const diff = '+++ b/x.ts\n@@ -3,2 +2,0 @@';
    expect(parseUnifiedDiff(diff)).toEqual([{ file: 'x.ts', ranges: [] }]);
  });

  it('ignores a /dev/null new side (a deleted file)', () => {
    const diff = 'diff --git a/gone.ts b/gone.ts\n--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@';
    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  it('handles multiple files and multiple hunks', () => {
    const diff = [
      '+++ b/a.ts',
      '@@ -1,0 +1,2 @@',
      '@@ -5,0 +10,1 @@',
      '+++ b/b.ts',
      '@@ -0,0 +1,3 @@',
    ].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        file: 'a.ts',
        ranges: [
          { start: 1, end: 2 },
          { start: 10, end: 10 },
        ],
      },
      { file: 'b.ts', ranges: [{ start: 1, end: 3 }] },
    ]);
  });
});

describe('lineInRanges / rangesOverlap', () => {
  const ranges = [{ start: 5, end: 8 }];
  it('detects a line inside a range', () => {
    expect(lineInRanges(6, ranges)).toBe(true);
    expect(lineInRanges(9, ranges)).toBe(false);
  });
  it('detects overlap and non-overlap', () => {
    expect(rangesOverlap(3, 6, ranges)).toBe(true);
    expect(rangesOverlap(9, 12, ranges)).toBe(false);
  });
});

describe('collectAddedRanges', () => {
  it('returns nothing for an empty file list', async () => {
    expect(await collectAddedRanges({ projectRoot: '/tmp', changedFiles: [] })).toEqual([]);
  });

  it('parses a tracked modification against HEAD', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/a.ts', 'line1\nline2\n');
    commitAll(root);
    writeFileSync(join(root, 'src/a.ts'), 'line1\nline2\nline3\nline4\n');
    const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['src/a.ts'] });
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.file).toBe('src/a.ts');
    expect(ranges[0]!.ranges).toEqual([{ start: 3, end: 4 }]);
  });

  it('treats an untracked new file as wholly added', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/base.ts', 'x\n');
    commitAll(root);
    writeProjectFile(root, 'src/new.ts', 'a\nb\nc\n');
    const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['src/new.ts'] });
    expect(ranges).toEqual([{ file: 'src/new.ts', ranges: [{ start: 1, end: 4 }] }]);
  });

  it('gives an empty-content untracked file no ranges', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/base.ts', 'x\n');
    commitAll(root);
    writeProjectFile(root, 'src/empty.ts', '   \n');
    const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['src/empty.ts'] });
    expect(ranges).toEqual([{ file: 'src/empty.ts', ranges: [] }]);
  });

  it('skips a changed file that no longer exists on disk', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/base.ts', 'x\n');
    commitAll(root);
    const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['src/ghost.ts'] });
    expect(ranges).toEqual([]);
  });
});
