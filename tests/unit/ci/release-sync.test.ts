import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { npmAttempts } from '../../../scripts/release-sync.mjs';

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
if (process.env.FAKE_NPM_ARGS) require('node:fs').appendFileSync(process.env.FAKE_NPM_ARGS, args.join(' ') + '\\n');
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
if (args[0] === 'api') {
  const path = args[args.indexOf('--paginate') + 1];
  const jq = args[args.indexOf('--jq') + 1];
  const api = JSON.parse(fs.readFileSync(process.env.FAKE_GH_API, 'utf8'));
  const pages = api[path];
  if (!pages || pages.fail) {
    console.error(pages ? pages.fail : 'HTTP 404: Not Found (' + path + ')');
    process.exit(1);
  }
  for (const page of pages) {
    process.stdout.write(
      require('node:child_process').execFileSync('jq', ['-r', jq], { input: JSON.stringify(page) }),
    );
  }
  process.exit(0);
}
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

const FAKE_PNPM = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_PNPM_LOG, process.argv.slice(2).join(' ') + '\\n');
process.exit(Number(process.env.FAKE_PNPM_EXIT || 0));
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
    ['pnpm', FAKE_PNPM],
  ] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  return { repo, origin, plugin, bin, releases: join(root, 'releases.json'), commits };
}

function tagPlugin(f: Fixture, version: string): void {
  git(f.repo, ['push', '--quiet', f.plugin, `HEAD:refs/tags/v${version}`]);
}

function run(f: Fixture, command: string, env: Record<string, string> = {}, cwd = f.repo) {
  const outputFile = join(f.repo, '..', 'github-output');
  const envFile = join(f.repo, '..', 'github-env');
  writeFileSync(outputFile, '');
  writeFileSync(envFile, '');
  const result = spawnSync('node', [SCRIPT, command], {
    cwd,
    encoding: 'utf8',
    env: {
      ...gitEnv(),
      PATH: `${f.bin}${delimiter}${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      GITHUB_ENV: envFile,
      FAKE_GH_API: join(f.repo, '..', 'gh-api.json'),
      FAKE_PNPM_LOG: join(f.repo, '..', 'pnpm-calls'),
      RELEASE_SYNC_NPM_WAIT_SECONDS: '0',
      RELEASE_SYNC_NPM_ATTEMPTS: '12',
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
  return { ...result, outputs, githubEnv: readFileSync(envFile, 'utf8') };
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

const REPO = 'repos/Eliyce/paqad-ai';
const PR_HEAD = 'a'.repeat(40);
const CI_SUITE = 11;
const REQUIRED = [
  'Node 22 / ubuntu-latest',
  'Node 24 / ubuntu-latest',
  'Node 22 / macos-latest',
  'Node 22 / windows-latest',
];

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  app: { slug: string };
  check_suite: { id: number };
}

function checkRun(id: number, name: string, overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id,
    name,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/Eliyce/paqad-ai/runs/${id}`,
    app: { slug: 'github-actions' },
    check_suite: { id: CI_SUITE },
    ...overrides,
  };
}

function greenRuns(): CheckRun[] {
  return REQUIRED.map((name, index) => checkRun(100 + index, name));
}

interface ApiOptions {
  pulls?: unknown[];
  headTree?: string;
  behindBy?: number;
  checkPages?: CheckRun[][];
  fail?: string;
}

function proveFixture(options: ApiOptions = {}) {
  const f = fixture(['1.0.0', '1.1.0']);
  const merge = f.commits['1.1.0']!;
  const base = f.commits['1.0.0']!;
  const tree = git(f.repo, ['rev-parse', 'HEAD^{tree}']);
  const api: Record<string, unknown> = {
    [`${REPO}/commits/${merge}/pulls?per_page=100`]: [
      options.pulls ?? [
        {
          number: 6,
          html_url: 'https://pr/6',
          merged_at: null,
          merge_commit_sha: merge,
          head: { sha: 'b'.repeat(40) },
        },
        {
          number: 7,
          html_url: 'https://pr/7',
          merged_at: '2026-10-30T00:00:00Z',
          merge_commit_sha: merge,
          head: { sha: PR_HEAD },
        },
      ],
    ],
    [`${REPO}/git/commits/${PR_HEAD}`]: [{ tree: { sha: options.headTree ?? tree } }],
    [`${REPO}/compare/${base}...${PR_HEAD}`]: [{ behind_by: options.behindBy ?? 0 }],
    [`${REPO}/actions/runs?head_sha=${PR_HEAD}&per_page=100`]: [
      {
        workflow_runs: [
          { path: '.github/workflows/ci.yml', check_suite_id: CI_SUITE },
          { path: '.github/workflows/codeql.yml', check_suite_id: 12 },
        ],
      },
    ],
    [`${REPO}/commits/${PR_HEAD}/check-runs?filter=all&per_page=100`]: (
      options.checkPages ?? [greenRuns()]
    ).map((runs) => ({ check_runs: runs })),
  };
  if (options.fail) api[options.fail] = { fail: 'HTTP 403: rate limit exceeded' };
  writeFileSync(join(f.repo, '..', 'gh-api.json'), JSON.stringify(api));
  return { f, tree, merge };
}

describe.skipIf(process.platform === 'win32')('release-sync ci-green', () => {
  it('AC-10: writes only the verified tree when all 4 checks are green on a head with the same tree', () => {
    const { f, tree } = proveFixture();

    const result = run(f, 'ci-green');

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.githubEnv).toBe(`PAQAD_RELEASE_VERIFIED_TREE=${tree}\n`);
    expect(result.stdout).toContain(
      `Pull request 7 (https://pr/7), head ${PR_HEAD}, tree ${tree}.`,
    );
    for (const [index, name] of REQUIRED.entries()) {
      expect(result.stdout).toContain(
        `${name}: success https://github.com/Eliyce/paqad-ai/runs/${100 + index}`,
      );
    }
  });

  it('judges the newest attempt per name across every result page and logs earlier failures', () => {
    const [first, ...rest] = greenRuns();
    const failedEarlier = checkRun(50, first!.name, { conclusion: 'failure' });
    const { f } = proveFixture({ checkPages: [[failedEarlier, ...rest], [first!]] });

    const result = run(f, 'ci-green');

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `earlier attempt of ${first!.name} was failure: https://github.com/Eliyce/paqad-ai/runs/50`,
    );
  });

  it.each([
    ['failure', { conclusion: 'failure' }],
    ['neutral', { conclusion: 'neutral' }],
    ['skipped', { conclusion: 'skipped' }],
    ['cancelled', { conclusion: 'cancelled' }],
    ['in_progress', { status: 'in_progress', conclusion: null }],
  ] as const)('AC-9 AC-21: refuses when the newest attempt is %s', (result, overrides) => {
    const runs = greenRuns();
    const older = { ...runs[2]!, id: 10 };
    runs[2] = checkRun(200, runs[2]!.name, overrides);
    const { f } = proveFixture({ checkPages: [[older, ...runs]] });

    const outcome = run(f, 'ci-green');

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(`::error::Nothing is published: CI is not proven green on `);
    expect(outcome.stdout).toContain(`required check "${REQUIRED[2]}" is ${result} on ${PR_HEAD}`);
    expect(outcome.githubEnv).toBe('');
  });

  it.each([
    ['is missing', (runs: CheckRun[]) => runs.slice(1)],
    [
      'comes from another workflow',
      (runs: CheckRun[]) => [
        checkRun(100, REQUIRED[0]!, { check_suite: { id: 12 } }),
        ...runs.slice(1),
      ],
    ],
    [
      'comes from another app',
      (runs: CheckRun[]) => [
        checkRun(100, REQUIRED[0]!, { app: { slug: 'some-app' } }),
        ...runs.slice(1),
      ],
    ],
  ])('AC-9: refuses when a required check %s', (_case, edit) => {
    const { f } = proveFixture({ checkPages: [edit(greenRuns())] });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`required check "${REQUIRED[0]}" is missing`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses when no merged pull request has the commit as its merge commit', () => {
    const { f, merge } = proveFixture({
      pulls: [
        {
          number: 8,
          html_url: 'https://pr/8',
          merged_at: '2026-10-30T00:00:00Z',
          merge_commit_sha: 'c'.repeat(40),
          head: { sha: PR_HEAD },
        },
      ],
    });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`no merged pull request has ${merge} as its merge commit`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses on a tree mismatch', () => {
    const { f } = proveFixture({ headTree: 'd'.repeat(40) });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `tree mismatch: pull request 7 head ${PR_HEAD} has tree ${'d'.repeat(40)}`,
    );
    expect(result.githubEnv).toBe('');
  });

  it('AC-18: refuses when the pull request head does not contain the base it merged into', () => {
    const { f } = proveFixture({ behindBy: 2 });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`pull request 7 head ${PR_HEAD} does not contain the base`);
    expect(result.githubEnv).toBe('');
  });

  it('refuses at once, publishing nothing, when the lookup fails', () => {
    const { f } = proveFixture({
      fail: `${REPO}/commits/${PR_HEAD}/check-runs?filter=all&per_page=100`,
    });

    const result = run(f, 'ci-green');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::Nothing is published: the CI lookup for HEAD failed:',
    );
    expect(result.stdout).toContain('rate limit exceeded');
    expect(result.githubEnv).toBe('');
  });
});

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
      'Usage: node scripts/release-sync.mjs <state|tags|check|ci-green|prepublish>',
    );
  });
});
