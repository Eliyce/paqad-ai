import { describe, expect, it } from 'vitest';

import { affectsBehaviour } from '@/fix-protocol/affects-behaviour.js';

describe('affectsBehaviour', () => {
  it('treats a real code line change as behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'src/foo.ts', added_lines: ['return x + 1;'], removed_lines: ['return x;'] }],
    });
    expect(verdict.affects).toBe(true);
    expect(verdict.behavioural_evidence).toEqual(['src/foo.ts: return x + 1;']);
  });

  it('treats a comment-only change as non-behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [
        {
          path: 'src/foo.ts',
          added_lines: ['// clarify the intent', '  // and another note'],
          removed_lines: ['// old comment'],
        },
      ],
    });
    expect(verdict.affects).toBe(false);
    expect(verdict.behavioural_evidence).toEqual([]);
  });

  it('treats block-comment and blank lines as non-behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [
        {
          path: 'src/foo.ts',
          added_lines: ['/**', ' * documented', ' */', '   '],
          removed_lines: [''],
        },
      ],
    });
    expect(verdict.affects).toBe(false);
  });

  it('treats edits confined to documentation files as non-behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'docs/modules/x.md', added_lines: ['# New heading'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(false);
  });

  it('flags a mix of a comment and a code change as behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [
        { path: 'README.md', added_lines: ['docs only'], removed_lines: [] },
        { path: 'src/bar.ts', added_lines: ['const enabled = true;'], removed_lines: [] },
      ],
    });
    expect(verdict.affects).toBe(true);
    expect(verdict.behavioural_evidence).toEqual(['src/bar.ts: const enabled = true;']);
  });

  it('defaults an unknown file type with code lines to behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'config.weird', added_lines: ['flag = on'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(true);
  });

  it('defaults a code change with comment markers from another language to behaviour-affecting', () => {
    // `#` is not a comment in .ts; the line is code, so it stays behaviour-affecting.
    const verdict = affectsBehaviour({
      files: [{ path: 'src/baz.ts', added_lines: ['# not a ts comment'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(true);
  });

  it('treats a python # comment as non-behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'scripts/run.py', added_lines: ['# explain step'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(false);
  });

  it('defaults a file with no recorded line detail to behaviour-affecting', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'src/foo.ts', added_lines: [], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(true);
    expect(verdict.behavioural_evidence).toEqual(['src/foo.ts']);
  });

  it('defaults an empty change set to behaviour-affecting', () => {
    const verdict = affectsBehaviour({ files: [] });
    expect(verdict.affects).toBe(true);
    expect(verdict.behavioural_evidence).toEqual([]);
  });

  it('treats a file with no extension as behaviour-affecting when it has code lines', () => {
    const verdict = affectsBehaviour({
      files: [{ path: 'Makefile', added_lines: ['build:'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(true);
  });
});
