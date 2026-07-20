import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCorpus } from '@/duplication/corpus.js';
import { readDuplicationReport } from '@/duplication/report.js';
import { collectAddedRanges } from '@/duplication/hunks.js';
import { corroborateWithJscpd } from '@/duplication/jscpd.js';

import { makeGitProject, writeProjectFile } from './helpers.js';

describe('duplication edge cases', () => {
  it('readDuplicationReport returns null on a corrupt report file', () => {
    const root = makeGitProject();
    writeProjectFile(root, '.paqad/scripts/rules/.cache/duplication.json', 'not json{');
    expect(readDuplicationReport(root)).toBeNull();
  });

  it('loadCorpus degrades to empty when the only index (vectors) is corrupt', async () => {
    const root = makeGitProject();
    // No chunk index; a corrupt vector index forces the FileVectorIndex.load throw path.
    writeProjectFile(root, '.paqad/vectors/index.json', '{ broken');
    writeProjectFile(root, '.paqad/vectors/meta.json', '{}');
    expect(await loadCorpus({ projectRoot: root, changedFiles: [] })).toEqual([]);
  });

  it('collectAddedRanges skips a path that resolves to a directory, not a file', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/base.ts', 'x\n');
    // An untracked "changed file" that is actually a directory — readFile throws, degrades to none.
    mkdirSync(join(root, 'src/adir'), { recursive: true });
    writeFileSync(join(root, 'src/adir/inner.ts'), 'y\n');
    const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['src/adir'] });
    expect(ranges).toEqual([]);
  });

  it('corroborateWithJscpd yields an empty set when jscpd is absent', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/a.ts', 'x\n');
    expect(
      (await corroborateWithJscpd({ projectRoot: root, changedFiles: ['src/a.ts'] })).size,
    ).toBe(0);
  });
});
