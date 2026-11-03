import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  GIT_WORKFLOW_HOOK_MARKER,
  installGitHooks,
  peopleSetting,
  resolveHooksDir,
  workflowHookBlock,
  workflowHooksInstalled,
} from '@/feature-evidence/git-hooks.js';

const roots: string[] = [];
function temp(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-hook-paths-'));
  roots.push(r);
  return r;
}
function tempRepo(): string {
  const r = temp();
  execFileSync('git', ['init', '-q'], { cwd: r });
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('git hooks: paths and settings', () => {
  it('gives only the marker for a hook it does not know', () => {
    expect(workflowHookBlock('post-rewrite')).toBe(`${GIT_WORKFLOW_HOOK_MARKER}\n`);
  });

  it('says the workflow hooks are not installed outside a git repository', () => {
    expect(workflowHooksInstalled(temp())).toBe(false);
  });

  it('installs into an absolute hooks path outside the repository', () => {
    const root = tempRepo();
    const outside = temp();
    execFileSync('git', ['config', 'core.hooksPath', outside], { cwd: root });
    expect(resolveHooksDir(root)).toBe(outside);
    const result = installGitHooks(root);
    expect(result.trackedHooksDir).toBeUndefined();
    expect(result.installed).toContain('post-commit');
    expect(workflowHooksInstalled(root)).toBe(true);
  });

  it('adds its block on a new line after a hook with no final newline', () => {
    const root = tempRepo();
    const dir = resolveHooksDir(root)!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'post-commit'), '#!/bin/sh\necho done');
    installGitHooks(root);
    expect(readFileSync(join(dir, 'post-commit'), 'utf8')).toMatch(
      /^#!\/bin\/sh\necho done\n# paqad-ai delivery-link\n/,
    );
  });

  it('reads people as off when the workflow rules are turned off', () => {
    const root = temp();
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'),
      'enabled: false\npeople: block\n',
    );
    expect(peopleSetting(root)).toBe('off');
  });
});
