import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readGitState, readHeadRef } from '@/rag/git-state.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

describe('readGitState', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-gitstate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function initRepo(): void {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.txt'), 'one');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');
  }

  it('records branch, head, base branch and merge-base on a feature branch', () => {
    initRepo();
    const baseSha = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '-b', 'feat/x');
    writeFileSync(join(root, 'b.txt'), 'two');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'second');
    const headSha = git(root, 'rev-parse', 'HEAD');

    const state = readGitState(root);
    expect(state.branch).toBe('feat/x');
    expect(state.head_commit).toBe(headSha);
    expect(state.base_branch).toBe('main');
    expect(state.base_commit).toBe(baseSha);
  });

  it('auto-detects master when main is absent', () => {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'checkout', '-q', '-b', 'master');
    writeFileSync(join(root, 'a.txt'), 'one');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');

    const state = readGitState(root);
    expect(state.base_branch).toBe('master');
  });

  it('honours an explicit base branch override', () => {
    initRepo();
    git(root, 'checkout', '-q', '-b', 'release/1.x');
    writeFileSync(join(root, 'r.txt'), 'r');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'rel');
    git(root, 'checkout', '-q', '-b', 'feat/y');

    const state = readGitState(root, { baseBranch: 'release/1.x' });
    expect(state.base_branch).toBe('release/1.x');
    expect(state.base_commit).toBe(git(root, 'rev-parse', 'release/1.x'));
  });

  it('degrades to all-undefined in a non-git directory', () => {
    mkdirSync(join(root, 'plain'));
    const state = readGitState(join(root, 'plain'));
    expect(state).toEqual({});
  });

  it('leaves base fields undefined when no base branch exists', () => {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'checkout', '-q', '-b', 'solo');
    writeFileSync(join(root, 'a.txt'), 'one');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');

    const state = readGitState(root);
    expect(state.branch).toBe('solo');
    expect(state.head_commit).toBeDefined();
    expect(state.base_branch).toBeUndefined();
    expect(state.base_commit).toBeUndefined();
  });
});

describe('readHeadRef', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-headref-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function initRepo(): void {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 't@example.com');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'checkout', '-q', '-b', 'main');
    writeFileSync(join(root, 'a.txt'), 'one');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');
  }

  it('reads the checked-out branch from a subdirectory without running git', () => {
    initRepo();
    git(root, 'checkout', '-q', '-b', 'feat/head');
    mkdirSync(join(root, 'nested', 'deeper'), { recursive: true });
    expect(readHeadRef(join(root, 'nested', 'deeper'))).toEqual({
      repo: true,
      branch: 'feat/head',
      detached: false,
    });
  });

  it('reports a detached HEAD', () => {
    initRepo();
    git(root, 'checkout', '-q', '--detach');
    expect(readHeadRef(root)).toEqual({ repo: true, branch: null, detached: true });
  });

  it('follows a worktree gitdir pointer, relative or absolute', () => {
    const gitDir = join(root, 'real-git');
    mkdirSync(gitDir);
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/wt\n');
    const absolute = join(root, 'abs');
    mkdirSync(absolute);
    writeFileSync(join(absolute, '.git'), `gitdir: ${gitDir}\n`);
    const relative = join(root, 'rel');
    mkdirSync(relative);
    writeFileSync(join(relative, '.git'), 'gitdir: ../real-git\n');
    expect(readHeadRef(absolute).branch).toBe('wt');
    expect(readHeadRef(relative).branch).toBe('wt');
  });

  it('reads no repo for a broken pointer, a missing HEAD or a plain directory', () => {
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, '.git'), 'not a pointer\n');
    const headless = join(root, 'headless');
    mkdirSync(join(headless, '.git'), { recursive: true });
    const none = { repo: false, branch: null, detached: false };
    expect(readHeadRef(broken)).toEqual(none);
    expect(readHeadRef(headless)).toEqual(none);
    expect(readHeadRef(root)).toEqual(none);
  });
});
