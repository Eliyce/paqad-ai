import { describe, expect, it } from 'vitest';

import {
  countMeaningfulChangedLines,
  isMeaningfulLine,
} from '@/change-metrics/meaningful-lines.js';

import { codeLines, makeProject, writeFile } from './helpers.js';

describe('isMeaningfulLine', () => {
  it('keeps real code lines', () => {
    expect(isMeaningfulLine('const x = 1;')).toBe(true);
    expect(isMeaningfulLine('  return value; // trailing comment still counts')).toBe(true);
  });

  it('drops blank lines', () => {
    expect(isMeaningfulLine('')).toBe(false);
    expect(isMeaningfulLine('   \t ')).toBe(false);
  });

  it('drops full-line comments across the common markers', () => {
    for (const line of ['// a', '/* a', ' * a', '*/', '# a', '<!-- a', '--> ', '-- sql']) {
      expect(isMeaningfulLine(line)).toBe(false);
    }
  });
});

describe('countMeaningfulChangedLines', () => {
  it('counts only non-blank, non-comment added lines of the changed files', async () => {
    const root = makeProject();
    // 5 meaningful + 1 blank + 1 comment = 5 meaningful.
    writeFile(root, 'src/a.ts', `${codeLines(5)}\n\n// a comment line`);
    const count = await countMeaningfulChangedLines({ projectRoot: root, changedFiles: ['src/a.ts'] });
    expect(count).toBe(5);
  });

  it('sums across multiple changed files and skips files with no added ranges', async () => {
    const root = makeProject();
    writeFile(root, 'src/a.ts', codeLines(3));
    writeFile(root, 'src/b.ts', codeLines(4));
    // A file that is empty contributes no ranges (and no lines).
    writeFile(root, 'src/empty.ts', '   \n  \n');
    const count = await countMeaningfulChangedLines({
      projectRoot: root,
      changedFiles: ['src/a.ts', 'src/b.ts', 'src/empty.ts'],
    });
    expect(count).toBe(7);
  });

  it('returns 0 for an empty changed-files list', async () => {
    const root = makeProject();
    const count = await countMeaningfulChangedLines({ projectRoot: root, changedFiles: [] });
    expect(count).toBe(0);
  });
});
