import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: Step[];
};

const PLUGIN_URL = 'github.com/Eliyce/paqad-claude-plugin.git';
const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const release = workflow.jobs.release!;
const publish = workflow.jobs['publish-plugin']!;
const tokenStep = publish.steps.find((step) => step.id === 'token')!;
const pushStep = publish.steps.at(-1)!;
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, text = 'x'): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function builtWorkspace(version: string): string {
  const root = tempDir('paqad-release-ws-');
  write(root, 'package.json', JSON.stringify({ name: 'paqad-ai', version }));
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'paqad', version }));
  write(root, 'dist/cli/index.js', `export const v = '${version}';`);
  write(root, 'runtime/claude-plugin/hooks.json', '{}');
  write(root, 'README.md');
  write(root, 'LICENSE');
  cpSync(resolve('scripts/assemble-plugin.mjs'), join(root, 'scripts/assemble-plugin.mjs'));
  return root;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runPush(workspace: string, remote: string, token = 'a-token') {
  return spawnSync('bash', ['-c', pushStep.run!], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: workspace,
      PAQAD_PLUGIN_PUSH_TOKEN: token,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://x-access-token:${token}@${PLUGIN_URL}`,
    },
  });
}

function runTokenCheck(token: string) {
  return spawnSync('bash', ['-c', tokenStep.run!], {
    env: { PATH: process.env.PATH, PAQAD_PLUGIN_PUSH_TOKEN: token },
    encoding: 'utf8',
  });
}

describe('the release workflow publishes the plugin', () => {
  it('runs publish-plugin only after npm publish succeeds', () => {
    expect(release.outputs?.published).toBe('${{ steps.changesets.outputs.published }}');
    expect(publish.needs).toBe('release');
    expect(publish.if).toBe("needs.release.outputs.published == 'true'");
    expect(publish.permissions).toEqual({ contents: 'read' });
  });

  it.skipIf(process.platform === 'win32')(
    'fails the job with an error naming the plugin repo when PAQAD_PLUGIN_PUSH_TOKEN is empty',
    () => {
      const empty = runTokenCheck('');
      expect(empty.status).toBe(1);
      expect(empty.stdout).toContain('::error::PAQAD_PLUGIN_PUSH_TOKEN is not set.');
      expect(empty.stdout).toContain('Eliyce/paqad-claude-plugin');
      const set = runTokenCheck('a-token');
      expect(set.status).toBe(0);
      expect(set.stdout).toBe('');
    },
  );

  it('never skips a later step and reads the token only from the secret', () => {
    for (const step of publish.steps) {
      expect(step.if).toBeUndefined();
      expect(step.run ?? '').not.toContain('secrets.');
      expect(step.run ?? '').not.toMatch(/echo[^\n]*\$\{?PAQAD_PLUGIN_PUSH_TOKEN/);
      if (step.env?.PAQAD_PLUGIN_PUSH_TOKEN !== undefined) {
        expect(step.env.PAQAD_PLUGIN_PUSH_TOKEN).toBe('${{ secrets.PAQAD_PLUGIN_PUSH_TOKEN }}');
      }
    }
  });

  it('assembles the tree with the script and pushes it and a version tag to Eliyce/paqad-claude-plugin', () => {
    const push = pushStep.run!;
    expect(pushStep.name).toBe('Push the plugin to Eliyce/paqad-claude-plugin');
    expect(push).toContain('node scripts/assemble-plugin.mjs plugin-repo');
    expect(push).toContain(PLUGIN_URL);
    expect(push).toContain('git tag "v${VERSION}"');
    expect(push).toContain('git push --quiet origin "refs/tags/v${VERSION}"');
  });

  it.skipIf(process.platform === 'win32')(
    'creates main and the tag on an empty repo, then commits nothing when the tree is unchanged',
    () => {
      const remote = join(tempDir('paqad-release-remote-'), 'plugin.git');
      git(dirname(remote), ['init', '--quiet', '--bare', remote]);
      const workspace = builtWorkspace('1.2.3');

      const first = runPush(workspace, remote);
      expect(first.status, first.stderr).toBe(0);
      expect(git(remote, ['for-each-ref', '--format=%(refname)'])).toBe(
        ['refs/heads/main', 'refs/tags/v1.2.3'].join('\n'),
      );
      expect(git(remote, ['rev-list', '--count', 'main'])).toBe('1');
      const marketplace = JSON.parse(
        git(remote, ['show', 'main:.claude-plugin/marketplace.json']),
      ) as { name: string; plugins: { name: string; source: string }[] };
      expect(marketplace.name).toBe('eliyce');
      expect(marketplace.plugins.map((plugin) => [plugin.name, plugin.source])).toEqual([
        ['paqad', './'],
      ]);

      rmSync(join(workspace, 'plugin-repo'), { recursive: true, force: true });
      const again = runPush(workspace, remote);
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain('The plugin tree is unchanged at v1.2.3; nothing to commit.');
      expect(again.stdout).toContain('Tag v1.2.3 already exists on Eliyce/paqad-claude-plugin.');
      expect(git(remote, ['rev-list', '--count', 'main'])).toBe('1');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'fails the job when the push cannot reach the repo',
    () => {
      const missing = join(tempDir('paqad-release-missing-'), 'absent.git');
      const result = runPush(builtWorkspace('1.2.3'), missing);
      expect(result.status).not.toBe(0);
    },
  );
});
