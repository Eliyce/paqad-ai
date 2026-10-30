import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, git, fixture, tagPlugin, run } from './release-sync-harness.js';

afterEach(cleanTempDirs);

describe.skipIf(process.platform === 'win32')('release-sync tags', () => {
  it('AC-4: tags each published version after the newest tag on its release commit, once', () => {
    const f = fixture(['0.9.0', '1.0.0', '1.1.0', '1.2.0']);
    git(f.repo, ['push', '--quiet', 'origin', `${f.commits['1.0.0']}:refs/tags/v1.0.0`]);
    writeFileSync(f.releases, JSON.stringify([{ tag: 'v1.0.0' }]));
    const env = { FAKE_NPM_VERSIONS: '0.9.0,1.0.0,1.1.0,1.2.0' };

    const first = run(f, 'tags', env);

    expect(first.status, first.stdout + first.stderr).toBe(0);
    expect(
      git(f.origin, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/tags']),
    ).toBe(
      [
        `v1.0.0 ${f.commits['1.0.0']}`,
        `v1.1.0 ${f.commits['1.1.0']}`,
        `v1.2.0 ${f.commits['1.2.0']}`,
      ].join('\n'),
    );
    const releases = JSON.parse(readFileSync(f.releases, 'utf8'));
    expect(releases.slice(1)).toEqual([
      { tag: 'v1.1.0', latest: '--latest=false', notes: '- Notes for 1.1.0.', generated: false },
      { tag: 'v1.2.0', latest: '--latest=true', notes: '- Notes for 1.2.0.', generated: false },
    ]);

    const again = run(f, 'tags', env);

    expect(again.status).toBe(0);
    expect(again.stdout).toContain('Every published version has its tag and GitHub Release.');
    expect(JSON.parse(readFileSync(f.releases, 'utf8'))).toHaveLength(3);
  });

  it('skips a version npm does not have', () => {
    const f = fixture(['0.9.0', '1.0.0', '1.1.0']);
    git(f.repo, ['push', '--quiet', 'origin', `${f.commits['0.9.0']}:refs/tags/v0.9.0`]);
    writeFileSync(f.releases, JSON.stringify([{ tag: 'v0.9.0' }]));

    const result = run(f, 'tags', { FAKE_NPM_VERSIONS: '0.9.0,1.1.0' });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(git(f.origin, ['tag', '--list'])).toBe('v0.9.0\nv1.1.0');
  });

  it('waits for npm to list the current version, then tags it', () => {
    const f = fixture(['1.0.0']);
    const calls = join(f.repo, '..', 'npm-calls');

    const result = run(f, 'tags', {
      FAKE_NPM_VERSIONS: '1.0.0',
      FAKE_NPM_CALLS: calls,
      FAKE_NPM_LISTED_AFTER: '3',
    });

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(calls, 'utf8')).toBe('4');
    expect(result.stdout).toContain('npm lists paqad-ai@1.0.0 after ');
    expect(git(f.origin, ['tag', '--list'])).toBe('v1.0.0');
  });

  it('fails red and tags nothing when npm never lists the current version', () => {
    const f = fixture(['1.0.0']);

    const result = run(f, 'tags', { RELEASE_SYNC_NPM_ATTEMPTS: '3' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::npm does not list paqad-ai@1.0.0, so its tag and GitHub Release wait for the next run.',
    );
    expect(git(f.origin, ['tag', '--list'])).toBe('');
  });
});

describe.skipIf(process.platform === 'win32')('release-sync check', () => {
  it('AC-5: fails red when npm latest is ahead of the newest plugin tag', () => {
    const f = fixture(['1.0.0']);
    tagPlugin(f, '1.0.0');

    const result = run(f, 'check', { FAKE_NPM_LATEST: '1.1.0' });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::The Claude Code plugin is behind npm: npm latest is 1.1.0, the newest tag in Eliyce/paqad-claude-plugin is 1.0.0.',
    );
  });

  it('passes when the plugin matches npm latest', () => {
    const f = fixture(['1.0.0']);
    tagPlugin(f, '0.9.0');
    tagPlugin(f, '1.0.0');

    const result = run(f, 'check', { FAKE_NPM_LATEST: '1.0.0' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('The plugin is at 1.0.0, matching npm latest 1.0.0.');
  });

  it('rejects an unknown command', () => {
    const f = fixture(['1.0.0']);

    const result = run(f, 'publish');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Usage: node scripts/release-sync.mjs <state|tags|check|ci-green|prepublish|scope>',
    );
  });
});
