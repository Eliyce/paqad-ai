import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gitPendingPaths, isGitIgnored, isGitTracked } from '@/core/fs/git-tracked.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-git-tracked-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

describe('git tracked helpers', () => {
  it('report tracked, ignored and pending paths in a repo', () => {
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'tracked.txt'), 'a');
    writeFileSync(join(root, 'ignored.txt'), 'b');
    writeFileSync(join(root, 'new.txt'), 'c');
    git('add', 'tracked.txt', '.gitignore');
    git(
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'x',
    );

    expect(isGitTracked(root, 'tracked.txt')).toBe(true);
    expect(isGitTracked(root, 'new.txt')).toBe(false);
    expect(isGitIgnored(root, 'ignored.txt')).toBe(true);
    expect(isGitIgnored(root, 'tracked.txt')).toBe(false);
    expect(isGitIgnored(root, 'new.txt')).toBe(false);

    writeFileSync(join(root, 'tracked.txt'), 'changed');
    expect(gitPendingPaths(root, ['tracked.txt', 'new.txt', 'ignored.txt'])).toEqual([
      'new.txt',
      'tracked.txt',
    ]);
    expect(gitPendingPaths(root, [])).toEqual([]);
  });

  it('answers null outside a repo', () => {
    expect(gitPendingPaths(root, ['x'])).toBeNull();
    expect(isGitTracked(root, 'x')).toBe(false);
  });
});
