import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export const SCRIPT = resolve('scripts/release-sync.mjs');
export const PLUGIN_REMOTE = 'https://github.com/Eliyce/paqad-claude-plugin.git';
const dirs: string[] = [];

export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export const FAKE_NPM = `#!/usr/bin/env node
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

export const FAKE_GH = `#!/usr/bin/env node
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

export const FAKE_PNPM = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.FAKE_PNPM_LOG, process.argv.slice(2).join(' ') + '\\n');
process.exit(Number(process.env.FAKE_PNPM_EXIT || 0));
`;

export interface Fixture {
  repo: string;
  origin: string;
  plugin: string;
  bin: string;
  releases: string;
  commits: Record<string, string>;
}

export function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim();
}

export function gitEnv(): NodeJS.ProcessEnv {
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

export function commitVersion(repo: string, version: string, extra = ''): string {
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

export function commitsBefore(version: string): string[] {
  const order = ['0.9.0', '1.0.0', '1.1.0', '1.2.0'];
  return order.slice(0, order.indexOf(version));
}

export function fixture(versions: string[]): Fixture {
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

export function tagPlugin(f: Fixture, version: string): void {
  git(f.repo, ['push', '--quiet', f.plugin, `HEAD:refs/tags/v${version}`]);
}

export function run(f: Fixture, command: string, env: Record<string, string> = {}, cwd = f.repo) {
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

export const REPO = 'repos/Eliyce/paqad-ai';
export const PR_HEAD = 'a'.repeat(40);
export const CI_SUITE = 11;
export const REQUIRED = [
  'Node 22 / ubuntu-latest',
  'Node 24 / ubuntu-latest',
  'Node 22 / macos-latest',
  'Node 22 / windows-latest',
];

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  app: { slug: string };
  check_suite: { id: number };
}

export function checkRun(id: number, name: string, overrides: Partial<CheckRun> = {}): CheckRun {
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

export function greenRuns(): CheckRun[] {
  return REQUIRED.map((name, index) => checkRun(100 + index, name));
}

export interface ApiOptions {
  pulls?: unknown[];
  headTree?: string;
  behindBy?: number;
  checkPages?: CheckRun[][];
  fail?: string;
}

export function proveFixture(options: ApiOptions = {}) {
  const f = fixture(['1.0.0', '1.1.0']);
  const merge = f.commits['1.1.0']!;
  return { f, merge, ...writeProofApi(f, merge, options) };
}

export function writeProofApi(f: Fixture, merge: string, options: ApiOptions) {
  const base = git(f.repo, ['rev-parse', `${merge}^`]);
  const tree = git(f.repo, ['rev-parse', `${merge}^{tree}`]);
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
  return { tree };
}

export function writeFiles(repo: string, files: Record<string, string | null>): void {
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) rmSync(join(repo, rel), { force: true });
    else {
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text);
    }
  }
}

export function packageJson(version: string, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ name: 'paqad-ai', version, description: '', ...extra }, null, 2)}\n`;
}

export function scopeFixture(options: ApiOptions = {}) {
  const f = fixture(['0.9.0', '1.0.0']);
  writeFiles(f.repo, {
    '.changeset/brave-cat.md': "---\n'paqad-ai': patch\n---\n\nFaster.\n",
    '.changeset/config.json': '{}\n',
    '.changeset/README.md': '# Changesets\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  git(f.repo, ['add', '-A']);
  git(f.repo, ['commit', '--quiet', '-m', 'feat: a change with a changeset']);
  const base = git(f.repo, ['rev-parse', 'HEAD']);
  const { tree } = writeProofApi(f, base, options);
  git(f.repo, ['checkout', '--quiet', '-b', 'changeset-release/main']);
  return { f, base, tree };
}

export function versionPr(
  f: Fixture,
  base: string,
  edit: (repo: string) => void = (repo) =>
    writeFiles(repo, {
      'package.json': packageJson('1.1.0'),
      'CHANGELOG.md': '# paqad-ai\n\n## 1.1.0\n\n- Faster.\n',
      '.changeset/brave-cat.md': null,
    }),
  env: Record<string, string> = {},
) {
  edit(f.repo);
  git(f.repo, ['add', '-A']);
  git(f.repo, ['commit', '--quiet', '--allow-empty', '-m', 'chore(release): version packages']);
  const head = git(f.repo, ['rev-parse', 'HEAD']);
  git(f.repo, ['checkout', '--quiet', '--detach', base]);
  git(f.repo, ['merge', '--quiet', '--no-ff', '--no-edit', head]);
  const merge = git(f.repo, ['rev-parse', 'HEAD']);
  const eventPath = join(f.repo, '..', 'event.json');
  writeFileSync(
    eventPath,
    JSON.stringify({ pull_request: { base: { sha: STALE_BASE }, head: { sha: head } } }),
  );
  return run(f, 'scope', {
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_SHA: merge,
    ...env,
  });
}

export const STALE_BASE = 'f'.repeat(40);

export function cleanTempDirs(): void {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
}
