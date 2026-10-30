import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, tempDir, Fixture, git, fixture, run } from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync prepublish', () => {
  function pnpmCalls(f: Fixture): string {
    const log = join(f.repo, '..', 'pnpm-calls');
    return existsSync(log) ? readFileSync(log, 'utf8') : '';
  }

  it('AC-11: skips the suite only for the verified tree inside Actions', () => {
    const f = fixture(['1.0.0']);
    const tree = git(f.repo, ['rev-parse', 'HEAD^{tree}']);

    const result = run(f, 'prepublish', {
      GITHUB_ACTIONS: 'true',
      PAQAD_RELEASE_VERIFIED_TREE: tree,
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `Not running pnpm run ci again: HEAD tree ${tree} is the tree CI proved green.`,
    );
    expect(pnpmCalls(f)).toBe('');
  });

  it.each([
    ['the verified tree is empty', { GITHUB_ACTIONS: 'true', PAQAD_RELEASE_VERIFIED_TREE: '' }],
    [
      'the verified tree differs',
      { GITHUB_ACTIONS: 'true', PAQAD_RELEASE_VERIFIED_TREE: 'e'.repeat(40) },
    ],
    [
      'the verified tree is not an object id',
      { GITHUB_ACTIONS: 'true', PAQAD_RELEASE_VERIFIED_TREE: 'HEAD' },
    ],
  ])('AC-11: runs pnpm run ci when %s', (_case, env) => {
    const f = fixture(['1.0.0']);

    const result = run(f, 'prepublish', env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running pnpm run ci before publishing:');
    expect(pnpmCalls(f)).toBe('run ci\n');
  });

  it('AC-11: runs pnpm run ci outside Actions even on the verified tree', () => {
    const f = fixture(['1.0.0']);
    const tree = git(f.repo, ['rev-parse', 'HEAD^{tree}']);

    const result = run(f, 'prepublish', { PAQAD_RELEASE_VERIFIED_TREE: tree });

    expect(result.stdout).toContain('not running in GitHub Actions');
    expect(pnpmCalls(f)).toBe('run ci\n');
  });

  it('AC-11: runs pnpm run ci when git rev-parse fails', () => {
    const f = fixture(['1.0.0']);
    const tree = git(f.repo, ['rev-parse', 'HEAD^{tree}']);

    const result = run(
      f,
      'prepublish',
      { GITHUB_ACTIONS: 'true', PAQAD_RELEASE_VERIFIED_TREE: tree },
      tempDir('paqad-not-a-repo-'),
    );

    expect(result.stdout).toContain('git rev-parse HEAD^{tree} failed');
    expect(pnpmCalls(f)).toBe('run ci\n');
  });

  it('AC-11: returns the exit code of pnpm run ci', () => {
    const f = fixture(['1.0.0']);

    const result = run(f, 'prepublish', { FAKE_PNPM_EXIT: '3' });

    expect(result.status).toBe(3);
    expect(pnpmCalls(f)).toBe('run ci\n');
  });
});
