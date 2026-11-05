import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectAddedRanges } from '@/duplication/hunks.js';
import { readChangeDiff } from '@/fix-protocol/fix-change.js';
import { addedLinesSince } from '@/pipeline/git-paths.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function repo(): { root: string; commit: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-git-paths-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  put(root, 'a.test.ts', 'it("AC-0")\n');
  put(root, 'old.test.ts', 'it("AC-1")\nit("AC-2")\nit("AC-3")\nit("AC-4")\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'start');
  return { root, commit: git(root, 'rev-parse', 'HEAD') };
}

const USER_SETTINGS: ReadonlyArray<readonly [string, (root: string) => void]> = [
  ['the defaults', () => {}],
  ['diff.noprefix', (root) => git(root, 'config', 'diff.noprefix', 'true')],
  ['diff.mnemonicPrefix', (root) => git(root, 'config', 'diff.mnemonicPrefix', 'true')],
  ['color.diff=always', (root) => git(root, 'config', 'color.diff', 'always')],
  ['color.ui=always', (root) => git(root, 'config', 'color.ui', 'always')],
  ['diff.colorMoved', (root) => git(root, 'config', 'diff.colorMoved', 'zebra')],
  ['diff.renames=false', (root) => git(root, 'config', 'diff.renames', 'false')],
  ['diff.submodule=log', (root) => git(root, 'config', 'diff.submodule', 'log')],
  [
    'diff.external',
    (root) => {
      const script = join(root, '..', `${root.split('/').pop()}-external.sh`);
      writeFileSync(script, '#!/bin/sh\necho nothing a parser can read\n');
      chmodSync(script, 0o755);
      roots.push(script);
      git(root, 'config', 'diff.external', script);
    },
  ],
  [
    'a textconv driver',
    (root) => {
      git(root, 'config', 'diff.shout.textconv', 'tr a-z A-Z <');
      put(root, '.git/info/attributes', '*.ts diff=shout\n');
    },
  ],
];

describe('the added lines ignore the git settings of whoever runs them', () => {
  it.each(USER_SETTINGS)('reads a tracked edit under %s', (_name, configure) => {
    const { root, commit } = repo();
    configure(root);
    put(root, 'a.test.ts', 'it("AC-0")\nit("AC-9")\n');
    expect(addedLinesSince(root, { commit, worktree: null })).toEqual({
      'a.test.ts': 'it("AC-9")',
    });
  });

  it.each(USER_SETTINGS)(
    'the duplication ranges read the same under %s',
    async (_name, configure) => {
      const { root } = repo();
      configure(root);
      put(root, 'a.test.ts', 'it("AC-0")\nit("AC-9")\n');
      const ranges = await collectAddedRanges({ projectRoot: root, changedFiles: ['a.test.ts'] });
      expect(ranges).toEqual([{ file: 'a.test.ts', ranges: [{ start: 2, end: 2 }] }]);
    },
  );

  it.each(USER_SETTINGS)('the fix protocol reads the same under %s', (_name, configure) => {
    const { root } = repo();
    configure(root);
    put(root, 'a.test.ts', 'it("AC-0")\nit("AC-9")\n');
    const file = readChangeDiff(root)?.files.find((entry) => entry.path === 'a.test.ts');
    expect(file?.added_lines).toEqual(['it("AC-9")']);
  });
});

describe('a moved file brings no added lines', () => {
  it('counts nothing for a git mv, even with diff.renames off', () => {
    const { root, commit } = repo();
    git(root, 'config', 'diff.renames', 'false');
    git(root, 'mv', 'old.test.ts', 'new.test.ts');
    expect(addedLinesSince(root, { commit, worktree: null })).toEqual({});
  });

  it('counts nothing for a plain mv that was never staged', () => {
    const { root, commit } = repo();
    renameSync(join(root, 'old.test.ts'), join(root, 'new.test.ts'));
    expect(addedLinesSince(root, { commit, worktree: null })).toEqual({});
  });

  it('counts only the new line of a moved file that was also edited', () => {
    const { root, commit } = repo();
    renameSync(join(root, 'old.test.ts'), join(root, 'new.test.ts'));
    put(root, 'new.test.ts', 'it("AC-1")\nit("AC-2")\nit("AC-3")\nit("AC-4")\nit("AC-9")\n');
    expect(addedLinesSince(root, { commit, worktree: null })).toEqual({
      'new.test.ts': 'it("AC-9")',
    });
  });

  it('still counts a new untracked test whole, and leaves the real index alone', () => {
    const { root, commit } = repo();
    put(root, 'dir name/fresh.test.ts', 'it("AC-5")\nit("AC-6")\n');
    expect(addedLinesSince(root, { commit, worktree: null })).toEqual({
      'dir name/fresh.test.ts': 'it("AC-5")\nit("AC-6")',
    });
    expect(git(root, 'status', '--porcelain')).toBe('?? "dir name/"');
    expect(git(root, 'ls-files')).not.toContain('fresh');
  });

  it('leaves no temp index behind', () => {
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('paqad-index-')).length;
    const { root, commit } = repo();
    put(root, 'fresh.test.ts', 'it("AC-5")\n');
    addedLinesSince(root, { commit, worktree: null });
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('paqad-index-')).length;
    expect(after).toBeLessThanOrEqual(before);
  });
});
