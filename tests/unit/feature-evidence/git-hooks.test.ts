import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GIT_HOOK_MARKER, installGitHooks, resolveHooksDir } from '@/feature-evidence/git-hooks.js';

const roots: string[] = [];
function tempRepo(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-hooks-'));
  roots.push(r);
  execFileSync('git', ['init', '-q'], { cwd: r });
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('installGitHooks', () => {
  it('installs post-commit + post-merge with the paqad marker', () => {
    const root = tempRepo();
    const result = installGitHooks(root);
    expect(result.installed.sort()).toEqual(['post-commit', 'post-merge']);
    const dir = resolveHooksDir(root)!;
    for (const hook of ['post-commit', 'post-merge']) {
      const body = readFileSync(join(dir, hook), 'utf8');
      expect(body).toContain(GIT_HOOK_MARKER);
      expect(body).toContain('paqad-ai delivery-link');
    }
  });

  it('is idempotent — a second install skips both hooks', () => {
    const root = tempRepo();
    installGitHooks(root);
    const again = installGitHooks(root);
    expect(again.installed).toEqual([]);
    expect(again.skipped.sort()).toEqual(['post-commit', 'post-merge']);
  });

  it('chains an existing hook instead of clobbering it', () => {
    const root = tempRepo();
    const dir = resolveHooksDir(root)!;
    const original = '#!/bin/sh\necho "existing husky hook"\n';
    writeFileSync(join(dir, 'post-commit'), original);
    installGitHooks(root);
    const body = readFileSync(join(dir, 'post-commit'), 'utf8');
    // The original content is preserved AND our block is appended.
    expect(body).toContain('existing husky hook');
    expect(body).toContain(GIT_HOOK_MARKER);
    expect(body.indexOf('existing husky hook')).toBeLessThan(body.indexOf(GIT_HOOK_MARKER));
  });

  it('respects a core.hooksPath redirect (husky/lefthook)', () => {
    const root = tempRepo();
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: root });
    installGitHooks(root);
    expect(existsSync(join(root, '.husky', 'post-commit'))).toBe(true);
  });

  // Issue #576 (Finding 9) — a `core.hooksPath` redirect to a git-TRACKED dir must not be written
  // into (that is a tracked diff, and husky v9 drops the block on reinstall). Report the snippet.
  it('does not write into a git-tracked hooks dir; reports the snippet instead', () => {
    const root = tempRepo();
    execFileSync('git', ['config', 'user.email', 'h@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Hooks'], { cwd: root });
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
    // A tracked, committed hooks dir (as a repo that ships its own hooks would have).
    mkdirSync(join(root, '.githooks'), { recursive: true });
    const trackedHook = join(root, '.githooks', 'post-commit');
    writeFileSync(trackedHook, '#!/bin/sh\necho tracked\n');
    execFileSync('git', ['add', '.githooks/post-commit'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'ship hooks'], { cwd: root });

    const result = installGitHooks(root);

    expect(result.trackedHooksDir).toBe(true);
    expect(result.installed).toEqual([]);
    expect(result.snippet).toContain('paqad-ai delivery-link');
    // The tracked hook file was left byte-for-byte unchanged.
    expect(readFileSync(trackedHook, 'utf8')).toBe('#!/bin/sh\necho tracked\n');
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe(
      '',
    );
  });

  it('is a no-op on a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-not-git-'));
    roots.push(dir);
    const result = installGitHooks(dir);
    expect(result.notAGitRepo).toBe(true);
    expect(result.installed).toEqual([]);
  });
});
