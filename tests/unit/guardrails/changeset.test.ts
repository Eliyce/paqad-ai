import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();
const CHANGESET_BIN = join(REPO, 'node_modules/@changesets/cli/bin.js');

function mergeBase(): string | null {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function commitsSince(cwd: string, base: string): number {
  return Number(
    execFileSync('git', ['rev-list', '--count', `${base}..HEAD`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
  );
}

const BASE = mergeBase();
const NO_BASE =
  'local-only check: CI clones have no origin/main, so there is no base to compare against';
const NO_CHANGE =
  'nothing has changed since origin/main, so there is no unreleased change to check';

interface ChangesetStatus {
  changesets: Array<{ id: string }>;
  releases: Array<{ name: string; type: string }>;
}

describe('the release changeset', { timeout: 60_000 }, () => {
  it('AC-70, AC-51: changeset status passes and releases paqad-ai', (ctx) => {
    if (!BASE) return ctx.skip(NO_BASE);
    if (commitsSince(REPO, BASE) === 0) return ctx.skip(NO_CHANGE);
    const dir = mkdtempSync(join(tmpdir(), 'paqad-changeset-status-'));
    try {
      const output = join(dir, 'status.json');
      const result = spawnSync(
        process.execPath,
        [CHANGESET_BIN, 'status', `--since=${BASE}`, `--output=${output}`],
        { cwd: REPO, encoding: 'utf8' },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const status = JSON.parse(readFileSync(output, 'utf8')) as ChangesetStatus;
      if (status.changesets.length === 0 && status.releases.length === 0) {
        return ctx.skip(NO_CHANGE);
      }
      expect(status.releases).toContainEqual(expect.objectContaining({ name: 'paqad-ai' }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function repoAt(commits: number): { dir: string; base: string } {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-changeset-base-'));
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    git(['init', '--quiet']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    writeFileSync(join(dir, 'file.txt'), 'one');
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'base']);
    const base = git(['rev-parse', 'HEAD']);
    for (let i = 0; i < commits; i += 1) {
      writeFileSync(join(dir, 'file.txt'), `change ${i}`);
      git(['commit', '--quiet', '-am', `change ${i}`]);
    }
    writeFileSync(join(dir, 'file.txt'), 'dirty after the build');
    return { dir, base };
  }

  it('AC-1: a checkout with no commits since the base and a dirty tracked file has nothing to check', () => {
    const { dir, base } = repoAt(0);
    try {
      expect(commitsSince(dir, base)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-2: a branch with a commit since the base is still checked', () => {
    const { dir, base } = repoAt(1);
    try {
      expect(commitsSince(dir, base)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
