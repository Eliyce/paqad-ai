import { describe, expect, it } from 'vitest';

import {
  loadCorpus,
  meaningfulLineCount,
  readFileText,
  resolveChunkLineRange,
  toRelative,
} from '@/duplication/corpus.js';

import { makeGitProject, writeChunkIndex, writeProjectFile } from './helpers.js';

describe('resolveChunkLineRange', () => {
  const fileText = 'line1\nline2\ntarget-a\ntarget-b\nline5\n';

  it('resolves a multi-line span to its 1-based range', () => {
    expect(resolveChunkLineRange(fileText, 'target-a\ntarget-b')).toEqual({ start: 3, end: 4 });
  });

  it('returns null when the content is absent', () => {
    expect(resolveChunkLineRange(fileText, 'not-here')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(resolveChunkLineRange(fileText, '')).toBeNull();
  });
});

describe('meaningfulLineCount', () => {
  it('counts only non-blank lines', () => {
    expect(meaningfulLineCount('a\n\n  \nb\n')).toBe(2);
  });
});

describe('toRelative', () => {
  it('reduces an absolute source path to project-relative', () => {
    expect(toRelative('/root', '/root/src/a.ts')).toBe('src/a.ts');
  });
  it('passes a relative path through, normalizing separators', () => {
    expect(toRelative('/root', 'src\\a.ts')).toBe('src/a.ts');
  });
});

describe('readFileText', () => {
  it('reads an existing file', async () => {
    const root = makeGitProject();
    writeProjectFile(root, 'src/a.ts', 'hello');
    expect(await readFileText(root, 'src/a.ts')).toBe('hello');
  });
  it('returns null for a missing file', async () => {
    const root = makeGitProject();
    expect(await readFileText(root, 'nope.ts')).toBeNull();
  });
});

describe('loadCorpus', () => {
  it('loads chunks and excludes the changed files', async () => {
    const root = makeGitProject();
    writeChunkIndex(root, {
      'src/keep.ts': 'export const keep = 1;',
      'src/changed.ts': 'export const changed = 2;',
    });
    const corpus = await loadCorpus({ projectRoot: root, changedFiles: ['src/changed.ts'] });
    expect(corpus.map((chunk) => chunk.file)).toEqual(['src/keep.ts']);
  });

  it('returns an empty corpus when no index exists', async () => {
    const root = makeGitProject();
    const corpus = await loadCorpus({ projectRoot: root, changedFiles: [] });
    expect(corpus).toEqual([]);
  });
});
