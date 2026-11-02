import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  GIT_HOOK_MARKER,
  GIT_WORKFLOW_HOOK_MARKER,
  installGitHooks,
  resolveHooksDir,
  workflowHooksInstalled,
} from '@/feature-evidence/git-hooks.js';

import { ticketRef } from '../../shared/ticket-ref.js';

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
    expect(result.installed.sort()).toEqual([
      'commit-msg',
      'post-commit',
      'post-merge',
      'pre-push',
    ]);
    const dir = resolveHooksDir(root)!;
    for (const hook of ['post-commit', 'post-merge']) {
      const body = readFileSync(join(dir, hook), 'utf8');
      expect(body).toContain(GIT_HOOK_MARKER);
      expect(body).toContain('paqad-ai delivery-link');
      expect(body).toContain('command -v paqad-ai');
      expect(body).toContain('command -v node');
      expect(body).toContain('dist/cli/index.js');
    }
  });

  it('AC-9: the post-merge hook can never fail a git pull', () => {
    const root = tempRepo();
    installGitHooks(root);
    const body = readFileSync(join(resolveHooksDir(root)!, 'post-merge'), 'utf8');
    const calls = body.split('\n').filter((line) => line.includes('delivery-link merge'));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((line) => line.includes('>/dev/null 2>&1 || true'))).toBe(true);
  });

  it('is idempotent — a second install skips both hooks', () => {
    const root = tempRepo();
    installGitHooks(root);
    const again = installGitHooks(root);
    expect(again.installed).toEqual([]);
    expect(again.skipped.sort()).toEqual(['commit-msg', 'post-commit', 'post-merge', 'pre-push']);
  });

  it('writes a marker line that carries no issue number', () => {
    const root = tempRepo();
    installGitHooks(root);
    const dir = resolveHooksDir(root)!;
    for (const hook of ['post-commit', 'post-merge']) {
      const lines = readFileSync(join(dir, hook), 'utf8').split('\n');
      expect(lines.filter((line) => line.startsWith(GIT_HOOK_MARKER))).toEqual([
        '# paqad-ai delivery-link',
      ]);
    }
  });

  it('finds a block an older version wrote with an issue number and adds no second block', () => {
    const root = tempRepo();
    const dir = resolveHooksDir(root)!;
    mkdirSync(dir, { recursive: true });
    const olderBlock = (verb: string): string =>
      '#!/bin/sh\n' +
      `# paqad-ai delivery-link (issue ${ticketRef(339)})\n` +
      `if command -v paqad-ai >/dev/null 2>&1; then paqad-ai delivery-link ${verb} >/dev/null 2>&1 || true; fi\n`;
    writeFileSync(join(dir, 'post-commit'), olderBlock('commit'));
    writeFileSync(join(dir, 'post-merge'), olderBlock('merge'));

    const result = installGitHooks(root);

    expect(result.installed).toEqual(['commit-msg', 'pre-push']);
    expect(result.skipped.sort()).toEqual(['post-commit', 'post-merge']);
    expect(readFileSync(join(dir, 'post-commit'), 'utf8')).toBe(olderBlock('commit'));
    expect(readFileSync(join(dir, 'post-merge'), 'utf8')).toBe(olderBlock('merge'));
  });

  it('chains an existing hook instead of clobbering it', () => {
    const root = tempRepo();
    const dir = resolveHooksDir(root)!;
    const original = '#!/bin/sh\necho "existing husky hook"\n';
    writeFileSync(join(dir, 'post-commit'), original);
    installGitHooks(root);
    const body = readFileSync(join(dir, 'post-commit'), 'utf8');
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

  it('does not write into a git-tracked hooks dir; reports the snippet instead', () => {
    const root = tempRepo();
    execFileSync('git', ['config', 'user.email', 'h@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Hooks'], { cwd: root });
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root });
    mkdirSync(join(root, '.githooks'), { recursive: true });
    const trackedHook = join(root, '.githooks', 'post-commit');
    writeFileSync(trackedHook, '#!/bin/sh\necho tracked\n');
    execFileSync('git', ['add', '.githooks/post-commit'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'ship hooks'], { cwd: root });

    const result = installGitHooks(root);

    expect(result.trackedHooksDir).toBe(true);
    expect(result.installed).toEqual([]);
    expect(result.snippet).toContain('paqad-ai delivery-link');
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

function people(root: string, value: string): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(join(root, PATHS.GIT_WORKFLOW_DIR, 'enforcement.yaml'), `people: ${value}\n`);
}

describe('installGitHooks: commit-msg and pre-push for people', () => {
  it('adds the two hook blocks when people is warn or block', () => {
    for (const value of ['warn', 'block']) {
      const root = tempRepo();
      people(root, value);
      installGitHooks(root);
      const dir = resolveHooksDir(root)!;
      expect(readFileSync(join(dir, 'commit-msg'), 'utf8')).toBe(
        '#!/bin/sh\n' +
          `${GIT_WORKFLOW_HOOK_MARKER}\n` +
          'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-commit "$1" || exit 1; fi\n',
      );
      expect(readFileSync(join(dir, 'pre-push'), 'utf8')).toContain(
        'if command -v paqad-ai >/dev/null 2>&1; then paqad-ai git-workflow check-push || exit 1; fi',
      );
      expect(workflowHooksInstalled(root)).toBe(true);
    }
  });

  it('installs neither when people is off', () => {
    const root = tempRepo();
    people(root, 'off');
    const result = installGitHooks(root);
    expect(result.installed.sort()).toEqual(['post-commit', 'post-merge']);
    expect(existsSync(join(resolveHooksDir(root)!, 'commit-msg'))).toBe(false);
  });

  it('switching to off removes only the two new blocks and keeps post-commit, post-merge and other hook lines', () => {
    const root = tempRepo();
    const dir = resolveHooksDir(root)!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pre-push'), '#!/bin/sh\necho "team pre-push"\n');
    installGitHooks(root);
    people(root, 'off');
    const result = installGitHooks(root);
    expect(result.removed?.sort()).toEqual(['commit-msg', 'pre-push']);
    expect(existsSync(join(dir, 'commit-msg'))).toBe(false);
    expect(readFileSync(join(dir, 'pre-push'), 'utf8')).toBe('#!/bin/sh\necho "team pre-push"\n');
    expect(readFileSync(join(dir, 'post-commit'), 'utf8')).toContain(GIT_HOOK_MARKER);
    expect(readFileSync(join(dir, 'post-merge'), 'utf8')).toContain(GIT_HOOK_MARKER);
    expect(workflowHooksInstalled(root)).toBe(false);
  });
});
