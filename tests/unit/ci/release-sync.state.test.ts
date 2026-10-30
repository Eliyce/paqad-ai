import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { npmAttempts } from '../../../scripts/release-sync.mjs';

import {
  cleanTempDirs,
  git,
  commitVersion,
  fixture,
  tagPlugin,
  run,
} from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync state', () => {
  it('AC-1: needs the plugin when npm has the version and the plugin repo lacks its tag', () => {
    const f = fixture(['1.0.0', '1.1.0']);
    commitVersion(f.repo, '1.1.0', ' with a later edit');
    tagPlugin(f, '1.0.0');

    const result = run(f, 'state', { FAKE_NPM_VERSIONS: '1.0.0,1.1.0' });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs).toEqual({
      version: '1.1.0',
      sha: f.commits['1.1.0'],
      plugin_needed: 'true',
    });
  });

  it('AC-2: does not need the plugin when its tag already exists', () => {
    const f = fixture(['1.0.0']);
    tagPlugin(f, '1.0.0');

    const result = run(f, 'state', { FAKE_NPM_VERSIONS: '1.0.0' });

    expect(result.status).toBe(0);
    expect(result.outputs.plugin_needed).toBe('false');
  });

  it('AC-3: does not need the plugin when npm does not have the version', () => {
    const f = fixture(['1.0.0', '1.1.0']);

    const result = run(f, 'state', { FAKE_NPM_VERSIONS: '1.0.0' });

    expect(result.status).toBe(0);
    expect(result.outputs.plugin_needed).toBe('false');
    expect(result.stdout).toContain('not on npm');
  });

  it.each([3, 10])('needs the plugin when npm lists the version only after %i misses', (misses) => {
    const f = fixture(['1.0.0']);
    const calls = join(f.repo, '..', 'npm-calls');

    const result = run(f, 'state', {
      FAKE_NPM_VERSIONS: '1.0.0',
      FAKE_NPM_CALLS: calls,
      FAKE_NPM_LISTED_AFTER: String(misses),
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.plugin_needed).toBe('true');
    expect(readFileSync(calls, 'utf8')).toBe(String(misses + 1));
    expect(result.stdout).toContain('Waiting for npm to list paqad-ai@1.0.0 (up to ');
    expect(result.stdout).toContain('npm lists paqad-ai@1.0.0 after ');
  });

  it('asks npm as many times as RELEASE_SYNC_NPM_ATTEMPTS says', () => {
    const f = fixture(['1.0.0']);
    const calls = join(f.repo, '..', 'npm-calls');

    const result = run(f, 'state', {
      FAKE_NPM_CALLS: calls,
      RELEASE_SYNC_NPM_ATTEMPTS: '4',
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.plugin_needed).toBe('false');
    expect(readFileSync(calls, 'utf8')).toBe('4');
  });

  it.each([undefined, '', 'many', '0', '-3', '2.5'])(
    'asks npm 90 times when RELEASE_SYNC_NPM_ATTEMPTS is %j',
    (value) => {
      expect(npmAttempts(value)).toBe(90);
    },
  );

  it('reads the version at GITHUB_SHA, not a release branch the changesets step left checked out', () => {
    const f = fixture(['1.0.0', '1.1.0']);
    commitVersion(f.repo, '1.2.0');

    const result = run(f, 'state', {
      FAKE_NPM_VERSIONS: '1.0.0,1.1.0',
      GITHUB_SHA: f.commits['1.1.0']!,
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs).toEqual({
      version: '1.1.0',
      sha: f.commits['1.1.0'],
      plugin_needed: 'true',
    });
  });

  it('AC-16: reports the version published with no npm call when the release tag is on the release commit', () => {
    const f = fixture(['1.0.0']);
    git(f.repo, ['tag', 'v1.0.0']);
    const calls = join(f.repo, '..', 'npm-calls');

    const result = run(f, 'state', {
      FAKE_NPM_CALLS: calls,
      FAKE_NPM_ARGS: join(f.repo, '..', 'npm-args'),
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('Release tag v1.0.0 is on the release commit, so npm has it.');
    expect(result.outputs.plugin_needed).toBe('true');
    expect(existsSync(calls)).toBe(false);
    expect(existsSync(join(f.repo, '..', 'npm-args'))).toBe(false);
  });

  it('does not trust a release tag on another commit', () => {
    const f = fixture(['1.0.0', '1.1.0']);
    git(f.repo, ['tag', 'v1.1.0', f.commits['1.0.0']!]);

    const result = run(f, 'state', { FAKE_NPM_VERSIONS: '1.0.0' });

    expect(result.status).toBe(0);
    expect(result.outputs.plugin_needed).toBe('false');
    expect(result.stdout).toContain('not on npm');
  });

  it('AC-15: polls npm with --prefer-online on every call when there is no release tag', () => {
    const f = fixture(['1.0.0']);
    const args = join(f.repo, '..', 'npm-args');

    const result = run(f, 'state', {
      FAKE_NPM_VERSIONS: '1.0.0',
      FAKE_NPM_CALLS: join(f.repo, '..', 'npm-calls'),
      FAKE_NPM_LISTED_AFTER: '2',
      FAKE_NPM_ARGS: args,
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.plugin_needed).toBe('true');
    const lines = readFileSync(args, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toBe('view paqad-ai@1.0.0 version --prefer-online');
  });

  it('passes --prefer-online to the versions and latest lookups too', () => {
    const f = fixture(['1.0.0']);
    const args = join(f.repo, '..', 'npm-args');
    git(f.repo, ['push', '--quiet', 'origin', `${f.commits['1.0.0']}:refs/tags/v1.0.0`]);
    writeFileSync(f.releases, JSON.stringify([{ tag: 'v1.0.0' }]));
    tagPlugin(f, '1.0.0');

    run(f, 'tags', { FAKE_NPM_VERSIONS: '1.0.0', FAKE_NPM_ARGS: args });
    run(f, 'check', { FAKE_NPM_LATEST: '1.0.0', FAKE_NPM_ARGS: args });

    expect(readFileSync(args, 'utf8').trim().split('\n')).toEqual([
      'view paqad-ai@1.0.0 version --prefer-online',
      'view paqad-ai versions --json --prefer-online',
      'view paqad-ai dist-tags.latest --prefer-online',
    ]);
  });

  it('fails instead of guessing when npm cannot be reached', () => {
    const f = fixture(['1.0.0']);

    const result = run(f, 'state', { FAKE_NPM_FAIL: '1' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::npm view paqad-ai@1.0.0 failed');
    expect(result.outputs).toEqual({});
  });

  it('fails instead of guessing when the plugin repo cannot be reached', () => {
    const f = fixture(['1.0.0']);
    rmSync(f.plugin, { recursive: true, force: true });

    const result = run(f, 'state', { FAKE_NPM_VERSIONS: '1.0.0' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::Could not read tags from');
  });
});
