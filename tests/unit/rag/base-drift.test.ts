import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  composeBaseDriftSection,
  computeBaseDrift,
  loadBaseDrift,
  refreshBaseDrift,
  type BaseDriftSnapshot,
} from '@/rag/base-drift.js';

describe('composeBaseDriftSection', () => {
  function snapshot(ahead: number): BaseDriftSnapshot {
    return {
      base_branch: 'main',
      remote_ref: 'origin/main',
      ahead,
      checked_at: '2026-06-27T00:00:00.000Z',
    };
  }

  it('returns empty string when there is no drift', () => {
    expect(composeBaseDriftSection(null)).toBe('');
    expect(composeBaseDriftSection(snapshot(0))).toBe('');
  });

  it('renders a singular/plural heads-up when ahead', () => {
    expect(composeBaseDriftSection(snapshot(1))).toContain('1 commit ahead');
    const many = composeBaseDriftSection(snapshot(4));
    expect(many).toContain('## Base drift');
    expect(many).toContain('`origin/main` is 4 commits ahead');
    expect(many).toContain('Pull or rebase');
  });
});

describe('computeBaseDrift / refreshBaseDrift (real git)', () => {
  let projectRoot: string;
  let remoteRoot: string;

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

  beforeEach(() => {
    remoteRoot = mkdtempSync(join(tmpdir(), 'paqad-drift-remote-'));
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-drift-'));

    // Bare-ish "remote": a normal repo we push/pull from on disk.
    git(remoteRoot, 'init', '-q');
    git(remoteRoot, 'config', 'user.email', 't@example.com');
    git(remoteRoot, 'config', 'user.name', 'Test');
    git(remoteRoot, 'checkout', '-q', '-b', 'main');
    execFileSync('bash', ['-c', 'echo a > a.txt'], { cwd: remoteRoot });
    git(remoteRoot, 'add', '-A');
    git(remoteRoot, 'commit', '-q', '-m', 'base');

    // Clone it, branch off main.
    git(projectRoot, 'init', '-q');
    git(projectRoot, 'config', 'user.email', 't@example.com');
    git(projectRoot, 'config', 'user.name', 'Test');
    git(projectRoot, 'remote', 'add', 'origin', remoteRoot);
    git(projectRoot, 'fetch', '-q', 'origin');
    git(projectRoot, 'checkout', '-q', '-b', 'main', 'origin/main');
    git(projectRoot, 'checkout', '-q', '-b', 'feat/x');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(remoteRoot, { recursive: true, force: true });
  });

  it('reports zero drift when origin/main has not moved', () => {
    const drift = computeBaseDrift(projectRoot, { baseBranch: 'main' });
    expect(drift).not.toBeNull();
    expect(drift?.base_branch).toBe('main');
    expect(drift?.remote_ref).toBe('origin/main');
    expect(drift?.ahead).toBe(0);
  });

  it('detects commits the remote base gained after a fetch (via refreshBaseDrift)', async () => {
    // The remote advances main by two commits.
    execFileSync('bash', ['-c', 'echo b > b.txt'], { cwd: remoteRoot });
    git(remoteRoot, 'add', '-A');
    git(remoteRoot, 'commit', '-q', '-m', 'b');
    execFileSync('bash', ['-c', 'echo c > c.txt'], { cwd: remoteRoot });
    git(remoteRoot, 'add', '-A');
    git(remoteRoot, 'commit', '-q', '-m', 'c');

    const result = await refreshBaseDrift(projectRoot, { baseBranch: 'main', minIntervalMs: 0 });
    expect(result).toEqual({ refreshed: true });

    const snapshot = loadBaseDrift(projectRoot);
    expect(snapshot?.ahead).toBe(2);
    expect(existsSync(join(projectRoot, PATHS.BASE_DRIFT_STATE))).toBe(true);
  });

  it('debounces a second refresh within the interval (no per-prompt work)', async () => {
    expect(await refreshBaseDrift(projectRoot, { baseBranch: 'main' })).toEqual({
      refreshed: true,
    });
    expect(await refreshBaseDrift(projectRoot, { baseBranch: 'main' })).toEqual({
      refreshed: false,
      reason: 'debounced',
    });
  });

  it('returns null compute / no snapshot for a non-git directory (fail-silent)', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'paqad-drift-plain-'));
    try {
      expect(computeBaseDrift(plain)).toBeNull();
      const result = await refreshBaseDrift(plain, { minIntervalMs: 0 });
      expect(result.refreshed).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('loadBaseDrift', () => {
  it('returns null when no snapshot exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-drift-load-'));
    try {
      expect(loadBaseDrift(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
