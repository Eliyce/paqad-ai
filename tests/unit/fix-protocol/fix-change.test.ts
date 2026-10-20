import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  changeAffectsBehaviour,
  gitOutput,
  parseChangedLines,
  readChangeDiff,
} from '@/fix-protocol/fix-change.js';

const DIFF = [
  'diff --git a/src/login.ts b/src/login.ts',
  '--- a/src/login.ts',
  '+++ b/src/login.ts',
  '@@ -3 +3 @@',
  '-  if (password) {',
  '+  if (password.length > 0) {',
  'diff --git a/src/old.ts b/src/old.ts',
  'deleted file mode 100644',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-export const x = 1;',
  'diff --git a/tests/login.test.ts b/tests/login.test.ts',
  '--- a/tests/login.test.ts',
  '+++ b/tests/login.test.ts',
  '@@ -0,0 +1 @@',
  "+it('rejects', () => {});",
].join('\n');

describe('parseChangedLines', () => {
  it('collects added and removed lines per file, deleted files included', () => {
    expect(parseChangedLines(DIFF)).toEqual([
      {
        path: 'src/login.ts',
        added_lines: ['  if (password.length > 0) {'],
        removed_lines: ['  if (password) {'],
      },
      { path: 'src/old.ts', added_lines: [], removed_lines: ['export const x = 1;'] },
      { path: 'tests/login.test.ts', added_lines: ["it('rejects', () => {});"], removed_lines: [] },
    ]);
  });
});

it('merges repeated sections, reads new files and skips a section with no path', () => {
  const diff = [
    'diff --git a/src/new.ts b/src/new.ts',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1 @@',
    '+export const n = 1;',
    'diff --git a/src/new.ts b/src/new.ts',
    '--- a/src/new.ts',
    '+++ b/src/new.ts',
    '@@ -1 +1 @@',
    '-export const n = 1;',
    'diff --git a/x b/x',
    '--- /dev/null',
    '+++ /dev/null',
    '@@ -0,0 +1 @@',
    '+ignored',
  ].join('\n');
  expect(parseChangedLines(diff)).toEqual([
    {
      path: 'src/new.ts',
      added_lines: ['export const n = 1;'],
      removed_lines: ['export const n = 1;'],
    },
  ]);
});

describe('changeAffectsBehaviour', () => {
  it('reads a source change as behaviour-changing', () => {
    expect(changeAffectsBehaviour({ files: parseChangedLines(DIFF) }).affects).toBe(true);
  });

  it('reads tests, docs and paqad records only as not behaviour-changing', () => {
    const verdict = changeAffectsBehaviour({
      files: [
        { path: 'tests/a.test.ts', added_lines: ['x()'], removed_lines: [] },
        { path: 'docs/a.md', added_lines: ['x'], removed_lines: [] },
        { path: '.paqad/ledger/x.json', added_lines: ['{}'], removed_lines: [] },
      ],
    });
    expect(verdict.affects).toBe(false);
  });

  it('reads a comment-only source edit as not behaviour-changing', () => {
    const verdict = changeAffectsBehaviour({
      files: [{ path: 'src/a.ts', added_lines: ['// note'], removed_lines: [] }],
    });
    expect(verdict.affects).toBe(false);
  });
});

describe('readChangeDiff', () => {
  let root: string;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fix-change-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null outside a git repository', () => {
    expect(readChangeDiff(root)).toBeNull();
    expect(gitOutput(root, ['ls-files'])).toBeNull();
  });

  function seedRepo(): void {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  }

  it('returns null when the diff cannot be read and skips untracked files it cannot read', () => {
    seedRepo();
    expect(readChangeDiff(root, (_root, args) => (args[0] === 'diff' ? null : ''))).toBeNull();
    const change = readChangeDiff(root, (_root, args) =>
      args[0] === 'diff' ? '' : args[0] === 'ls-files' ? 'gone.ts\n' : null,
    );
    expect(change).toEqual({ files: [] });
    expect(readChangeDiff(root, (_root, args) => (args[0] === 'diff' ? '' : null))).toEqual({
      files: [],
    });
  });

  it('diffs a feature branch against its base, committed work included', () => {
    seedRepo();
    git('checkout', '-q', '-b', 'feat/x');
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 3;\n');
    git('commit', '-q', '-am', 'change');
    const change = readChangeDiff(root);
    expect(change?.files.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('reads tracked edits and untracked files of the working tree', () => {
    seedRepo();
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 1;\n');
    const change = readChangeDiff(root);
    expect(change?.files.map((file) => file.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(change?.files.find((file) => file.path === 'src/a.ts')).toMatchObject({
      added_lines: ['export const a = 2;'],
      removed_lines: ['export const a = 1;'],
    });
  });
});
