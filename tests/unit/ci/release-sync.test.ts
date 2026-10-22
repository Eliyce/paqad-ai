import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/release-sync.mjs');
const PLUGIN_REMOTE = 'https://github.com/Eliyce/paqad-claude-plugin.git';
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const FAKE_NPM = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (process.env.FAKE_NPM_FAIL) { console.error('npm error code ECONNRESET'); process.exit(1); }
const versions = (process.env.FAKE_NPM_VERSIONS || '').split(',').filter(Boolean);
const spec = args[1] || '';
if (spec.startsWith('paqad-ai@')) {
  const version = spec.slice('paqad-ai@'.length);
  const calls = process.env.FAKE_NPM_CALLS;
  if (calls) {
    const fs = require('node:fs');
    const count = (fs.existsSync(calls) ? Number(fs.readFileSync(calls, 'utf8')) : 0) + 1;
    fs.writeFileSync(calls, String(count));
    if (count <= Number(process.env.FAKE_NPM_LISTED_AFTER || 0)) {
      console.error('npm error code E404');
      process.exit(1);
    }
  }
  if (versions.includes(version)) { console.log(version); process.exit(0); }
  console.error('npm error code E404');
  process.exit(1);
}
if (args[2] === 'versions') { console.log(JSON.stringify(versions)); process.exit(0); }
if (args[2] === 'dist-tags.latest') { console.log(process.env.FAKE_NPM_LATEST || ''); process.exit(0); }
process.exit(1);
`;

const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const file = process.env.FAKE_GH_RELEASES;
const releases = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
if (args[0] === 'release' && args[1] === 'list') {
  console.log(JSON.stringify(releases.map((release) => ({ tagName: release.tag }))));
} else if (args[0] === 'release' && args[1] === 'create') {
  const notesAt = args.indexOf('--notes');
  releases.push({
    tag: args[2],
    latest: args.find((arg) => arg.startsWith('--latest=')),
    notes: notesAt === -1 ? null : args[notesAt + 1],
    generated: args.includes('--generate-notes'),
  });
  fs.writeFileSync(file, JSON.stringify(releases));
} else {
  process.exit(1);
}
`;

interface Fixture {
  repo: string;
  origin: string;
  plugin: string;
  bin: string;
  releases: string;
  commits: Record<string, string>;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim();
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
}

function commitVersion(repo: string, version: string, extra = ''): string {
  writeFileSync(
    join(repo, 'package.json'),
    `${JSON.stringify({ name: 'paqad-ai', version, description: extra }, null, 2)}\n`,
  );
  const changelog = ['# paqad-ai', ''];
  for (const v of ['1.2.0', '1.1.0', '1.0.0', '0.9.0']) {
    if (v === version || commitsBefore(version).includes(v)) {
      changelog.push(`## ${v}`, '', `- Notes for ${v}.`, '');
    }
  }
  writeFileSync(join(repo, 'CHANGELOG.md'), changelog.join('\n'));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', `chore(release): version packages ${version}${extra}`]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function commitsBefore(version: string): string[] {
  const order = ['0.9.0', '1.0.0', '1.1.0', '1.2.0'];
  return order.slice(0, order.indexOf(version));
}

function fixture(versions: string[]): Fixture {
  const root = tempDir('paqad-release-sync-');
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const plugin = join(root, 'plugin.git');
  const bin = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  git(root, ['init', '--quiet', '--bare', origin]);
  git(root, ['init', '--quiet', '--bare', plugin]);
  git(repo, ['init', '--quiet', '-b', 'main']);
  git(repo, ['remote', 'add', 'origin', origin]);
  const commits: Record<string, string> = {};
  for (const version of versions) commits[version] = commitVersion(repo, version);
  git(repo, ['push', '--quiet', 'origin', 'main']);
  for (const [name, body] of [
    ['npm', FAKE_NPM],
    ['gh', FAKE_GH],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  return { repo, origin, plugin, bin, releases: join(root, 'releases.json'), commits };
}

function tagPlugin(f: Fixture, version: string): void {
  git(f.repo, ['push', '--quiet', f.plugin, `HEAD:refs/tags/v${version}`]);
}

function run(f: Fixture, command: string, env: Record<string, string> = {}) {
  const outputFile = join(f.repo, '..', 'github-output');
  writeFileSync(outputFile, '');
  const result = spawnSync('node', [SCRIPT, command], {
    cwd: f.repo,
    encoding: 'utf8',
    env: {
      ...gitEnv(),
      PATH: `${f.bin}${delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      RELEASE_SYNC_NPM_WAIT_SECONDS: '0',
      FAKE_GH_RELEASES: f.releases,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${f.plugin}.insteadOf`,
      GIT_CONFIG_VALUE_0: PLUGIN_REMOTE,
      ...env,
    },
  });
  const outputs = Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('=') as [string, string]),
  );
  return { ...result, outputs };
}

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
    const f = fixture(['1.0.0', '1.1.0']);
    git(f.repo, ['push', '--quiet', 'origin', `${f.commits['1.0.0']}:refs/tags/v1.0.0`]);
    writeFileSync(f.releases, JSON.stringify([{ tag: 'v1.0.0' }]));

    const result = run(f, 'tags', { FAKE_NPM_VERSIONS: '1.0.0' });

    expect(result.status).toBe(0);
    expect(git(f.origin, ['tag', '--list'])).toBe('v1.0.0');
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
    expect(result.stderr).toContain('Usage: node scripts/release-sync.mjs <state|tags|check>');
  });
});
