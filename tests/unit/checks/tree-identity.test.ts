import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TREE_IDENTITY_EXCLUDED_DIRS,
  computeTreeIdentity,
  computeTreeIdentityResult,
} from '@/checks/tree-identity.js';

import { commitAll, git, initGitRepo, writeRepoFile } from '../_helpers/git-repo.js';
import { useTempRoots } from '../_helpers/temp-roots.js';

const NOW = () => '2026-10-30T00:00:00.000Z';

describe('computeTreeIdentity', () => {
  const makeRoot = useTempRoots('paqad-tid-');

  function fakeGit(line: string): string {
    const dir = makeRoot();
    writeRepoFile(dir, 'fake-git.sh', `#!/bin/sh\n${line}\nexec git "$@"\n`);
    chmodSync(join(dir, 'fake-git.sh'), 0o755);
    return join(dir, 'fake-git.sh');
  }

  function repo(): string {
    const root = makeRoot();
    initGitRepo(root, {
      'src/a.ts': 'export const a = 1;\n',
      '.gitignore': 'ignored/\n',
      '.paqad/scripts/run.sh': 'echo hi\n',
      '.paqad/configs/x.yaml': 'a: 1\n',
      '.paqad/decisions/resolved/D-1.json': '{}\n',
    });
    commitAll(root);
    return root;
  }

  it('returns the same digest for the same tree and stamps the head commit', () => {
    const root = repo();
    const first = computeTreeIdentity(root, { now: NOW });
    const second = computeTreeIdentity(root, { now: NOW });
    expect(first?.digest).toMatch(/^[0-9a-f]{40,64}$/);
    expect(second?.digest).toBe(first?.digest);
    expect(first?.head_commit).toBe(git(root, ['rev-parse', 'HEAD']).trim());
    expect(first?.computed_at).toBe('2026-10-30T00:00:00.000Z');
  });

  it('AC-2: changes when a tracked file changes, an untracked file is added or a tracked file is deleted', () => {
    const root = repo();
    const base = computeTreeIdentity(root)!.digest;
    writeRepoFile(root, 'src/a.ts', 'export const a = 2;\n');
    const edited = computeTreeIdentity(root)!.digest;
    expect(edited).not.toBe(base);
    writeRepoFile(root, 'src/a.ts', 'export const a = 1;\n');
    expect(computeTreeIdentity(root)!.digest).toBe(base);
    writeRepoFile(root, 'src/new.ts', 'x\n');
    expect(computeTreeIdentity(root)!.digest).not.toBe(base);
    rmSync(join(root, 'src/new.ts'));
    rmSync(join(root, 'src/a.ts'));
    expect(computeTreeIdentity(root)!.digest).not.toBe(base);
  });

  it('AC-3: ignores git-ignored files and the four paqad record folders', () => {
    const root = repo();
    const base = computeTreeIdentity(root)!.digest;
    writeRepoFile(root, 'ignored/out.txt', 'x\n');
    for (const dir of TREE_IDENTITY_EXCLUDED_DIRS) writeRepoFile(root, `${dir}/extra.json`, '{}\n');
    writeRepoFile(root, '.paqad/decisions/resolved/D-1.json', '{"changed":true}\n');
    expect(computeTreeIdentity(root)!.digest).toBe(base);
  });

  it('AC-3: keeps the rest of .paqad and look-alike folder names in the identity', () => {
    const root = repo();
    const base = computeTreeIdentity(root)!.digest;
    writeRepoFile(root, '.paqad/scripts/run.sh', 'echo changed\n');
    const scripts = computeTreeIdentity(root)!.digest;
    expect(scripts).not.toBe(base);
    writeRepoFile(root, '.paqad/configs/x.yaml', 'a: 2\n');
    expect(computeTreeIdentity(root)!.digest).not.toBe(scripts);
    const before = computeTreeIdentity(root)!.digest;
    writeRepoFile(root, 'docs/.paqad/checks/x.json', '{}\n');
    writeRepoFile(root, '.paqad/checks-notes.md', 'x\n');
    expect(computeTreeIdentity(root)!.digest).not.toBe(before);
  });

  it('AC-11: never writes the real index and leaves no temp folder behind', () => {
    const root = repo();
    writeRepoFile(root, 'src/a.ts', 'export const a = 3;\n');
    writeRepoFile(root, 'src/untracked.ts', 'u\n');
    const indexPath = join(root, '.git/index');
    const bytes = readFileSync(indexPath);
    const mtime = statSync(indexPath).mtimeMs;
    const staged = git(root, ['diff', '--cached', '--name-only']);
    const temp = makeRoot();
    expect(computeTreeIdentity(root, { tempRoot: temp })).not.toBeNull();
    expect(readFileSync(indexPath).equals(bytes)).toBe(true);
    expect(statSync(indexPath).mtimeMs).toBe(mtime);
    expect(git(root, ['diff', '--cached', '--name-only'])).toBe(staged);
    expect(readdirSync(temp)).toEqual([]);
    expect(process.env.GIT_INDEX_FILE).toBeUndefined();
  });

  it('sees a same-size edit that the index stat cache would call clean', () => {
    const root = repo();
    git(root, ['config', 'core.trustctime', 'false']);
    git(root, ['config', 'core.checkStat', 'minimal']);
    const file = join(root, 'src/a.ts');
    const past = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(file, past, past);
    git(root, ['add', '-A']);
    const base = computeTreeIdentity(root)!.digest;
    writeRepoFile(root, 'src/a.ts', 'export const a = 9;\n');
    utimesSync(file, past, past);
    utimesSync(join(root, '.git/index'), past, past);
    expect(computeTreeIdentity(root)!.digest).not.toBe(base);
  });

  it('does not depend on what is staged', () => {
    const root = repo();
    writeRepoFile(root, 'src/a.ts', 'export const a = 4;\n');
    const unstaged = computeTreeIdentity(root)!.digest;
    git(root, ['add', 'src/a.ts']);
    expect(computeTreeIdentity(root)!.digest).toBe(unstaged);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-11: returns null when git write-tree fails, without touching the real index or leaving temp files',
    () => {
      const root = repo();
      const fake = fakeGit('if [ "$1" = "write-tree" ]; then echo "boom" >&2; exit 1; fi');
      const indexPath = join(root, '.git/index');
      const bytes = readFileSync(indexPath);
      const temp = makeRoot();
      const result = computeTreeIdentityResult(root, { gitBinary: fake, tempRoot: temp });
      expect(result.identity).toBeNull();
      expect(result.reason).toContain('git write-tree failed: boom');
      expect(readFileSync(indexPath).equals(bytes)).toBe(true);
      expect(readdirSync(temp)).toEqual([]);
    },
  );

  it('AC-11: works inside a linked git worktree', () => {
    const root = repo();
    const worktree = join(makeRoot(), 'wt');
    git(root, ['worktree', 'add', '-q', worktree]);
    const identity = computeTreeIdentity(worktree);
    expect(identity?.digest).toBe(computeTreeIdentity(root)?.digest);
    writeRepoFile(worktree, 'src/a.ts', 'changed\n');
    expect(computeTreeIdentity(worktree)?.digest).not.toBe(identity?.digest);
  });

  it('returns a digest with a null head on an unborn branch of a repo that has commits', () => {
    const root = repo();
    git(root, ['checkout', '-q', '--orphan', 'fresh']);
    const identity = computeTreeIdentity(root);
    expect(identity?.digest).toMatch(/^[0-9a-f]+$/);
    expect(identity?.head_commit).toBeNull();
  });

  it('AC-11: returns null for a repo with no commits, a non-git folder and a missing git binary', () => {
    const empty = makeRoot();
    initGitRepo(empty, { 'a.txt': 'a\n' });
    expect(computeTreeIdentityResult(empty)).toEqual({
      identity: null,
      reason: 'the repository has no commits',
    });
    expect(computeTreeIdentityResult(makeRoot())).toEqual({
      identity: null,
      reason: 'not a git repository',
    });
    expect(computeTreeIdentityResult(repo(), { gitBinary: 'paqad-no-such-git' })).toEqual({
      identity: null,
      reason: 'git is not installed',
    });
  });

  it('returns null when the time limit is spent before or between git steps', () => {
    const root = repo();
    const scripted = (values: number[]) => () => values.shift() ?? 1e12;
    const expected = { identity: null, reason: 'the tree identity ran past its time limit' };
    expect(computeTreeIdentityResult(root, { nowMs: scripted([0, 1e9]) })).toEqual(expected);
    expect(computeTreeIdentityResult(root, { nowMs: scripted([0, 0, 1e9]) })).toEqual(expected);
  });

  it.skipIf(process.platform === 'win32')(
    'returns null when a git step is killed at the time limit',
    () => {
      const root = repo();
      const fake = fakeGit('if [ "$1" = "add" ]; then exec sleep 5; fi');
      expect(computeTreeIdentityResult(root, { gitBinary: fake, timeoutMs: 1_000 })).toEqual({
        identity: null,
        reason: 'the tree identity ran past its time limit',
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'names the failing git step even when git prints nothing',
    () => {
      const root = repo();
      const fake = fakeGit('if [ "$1" = "add" ]; then exit 1; fi');
      expect(computeTreeIdentityResult(root, { gitBinary: fake }).reason).toBe('git add failed');
    },
  );

  it.each([
    ['assume-unchanged', ['update-index', '--assume-unchanged', 'src/a.ts']],
    ['skip-worktree', ['update-index', '--skip-worktree', 'src/a.ts']],
  ])(
    'AC-11: returns null when a tracked file is marked %s, since its edits are hidden',
    (_, args) => {
      const root = repo();
      git(root, args);
      writeRepoFile(root, 'src/a.ts', 'export const a = 7;\n');
      expect(computeTreeIdentityResult(root)).toEqual({
        identity: null,
        reason: 'src/a.ts is marked assume-unchanged or skip-worktree, so its edits cannot be seen',
      });
    },
  );

  it('AC-11: returns null with a nested repository, committed as a submodule or not yet added', () => {
    const root = repo();
    const nested = join(root, 'vendor/lib');
    mkdirSync(nested, { recursive: true });
    initGitRepo(nested, { 'x.ts': 'x\n' });
    commitAll(nested);
    const expected = {
      identity: null,
      reason: 'vendor/lib is a submodule or nested repository, so edits inside it cannot be seen',
    };
    expect(computeTreeIdentityResult(root)).toEqual(expected);
    git(root, ['add', 'vendor/lib']);
    git(root, ['commit', '-q', '-m', 'gitlink']);
    writeRepoFile(nested, 'x.ts', 'changed\n');
    expect(computeTreeIdentityResult(root)).toEqual(expected);
  });

  it('returns null when the index file is missing', () => {
    const root = repo();
    rmSync(join(root, '.git/index'));
    expect(computeTreeIdentityResult(root).reason).toBe('the git index does not exist');
  });

  it('keeps a symlink as a link in the identity', () => {
    const root = repo();
    const base = computeTreeIdentity(root)!.digest;
    symlinkSync('src/a.ts', join(root, 'link.ts'));
    expect(computeTreeIdentity(root)!.digest).not.toBe(base);
  });
});
