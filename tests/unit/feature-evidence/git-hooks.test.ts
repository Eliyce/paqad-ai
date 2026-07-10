import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('is a no-op on a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-not-git-'));
    roots.push(dir);
    const result = installGitHooks(dir);
    expect(result.notAGitRepo).toBe(true);
    expect(result.installed).toEqual([]);
  });
});
