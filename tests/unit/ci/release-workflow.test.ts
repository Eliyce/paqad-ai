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
  with?: Record<string, string | number>;
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
const inSync = workflow.jobs['plugin-in-sync']!;
const versionStep = publish.steps.find(
  (step) => step.name === 'Check the checkout is the released version',
)!;
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
  write(
    root,
    'package.json',
    JSON.stringify({
      name: 'paqad-ai',
      version,
      exports: { './cli': { import: './dist/cli/index.js', types: './dist/cli/index.d.ts' } },
    }),
  );
  write(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'paqad', version }));
  write(root, 'dist/cli/index.js', `export const v = '${version}';`);
  for (const name of ['@huggingface/transformers', 'openai']) {
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
  }
  write(root, 'runtime/claude-plugin/hooks.json', '{}');
  write(root, 'README.md');
  write(root, 'LICENSE');
  write(root, 'SECURITY.md');
  write(root, 'assets/icon.png');
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
  it('AC-6: decides publish-plugin from npm and the plugin repo, never from changesets output', () => {
    expect(release.outputs).toEqual({
      published: '${{ steps.published.outputs.plugin_needed }}',
      version: '${{ steps.published.outputs.version }}',
      sha: '${{ steps.published.outputs.sha }}',
    });
    const ids = release.steps.map((step) => step.id);
    expect(ids.indexOf('published')).toBeGreaterThan(ids.indexOf('changesets'));
    expect(release.steps.find((step) => step.id === 'published')?.run).toBe(
      'node scripts/release-sync.mjs state',
    );
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).not.toContain(
      'steps.changesets.outputs',
    );
    expect(publish.needs).toBe('release');
    expect(publish.if).toBe("needs.release.outputs.published == 'true'");
    expect(publish.permissions).toEqual({ contents: 'read' });
  });

  it('AC-17: proves CI is green on this tree right before the changesets step, with read-only check access', () => {
    const ids = release.steps.map((step) => step.id ?? step.name);
    const proof = release.steps[ids.indexOf('changesets') - 1]!;
    expect(proof.name).toBe('Prove CI is green on this tree');
    expect(proof.run).toBe('node scripts/release-sync.mjs ci-green');
    expect(proof.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
    expect(release.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
      'id-token': 'write',
      checks: 'read',
      actions: 'read',
    });
  });

  it('AC-17: runs the prepublish check instead of the whole suite when npm publishes', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.prepublishOnly).toBe('node scripts/release-sync.mjs prepublish');
  });

  it('AC-17: tags and releases every published version in its own job, so the plugin push never waits for npm', () => {
    const tagsJob = workflow.jobs.tags!;
    expect(tagsJob.needs).toBe('release');
    expect(tagsJob.if).toBeUndefined();
    expect(tagsJob.permissions).toEqual({ contents: 'read' });
    const tags = tagsJob.steps.at(-1)!;
    expect(tags.run).toBe('node scripts/release-sync.mjs tags');
    expect(tags.env).toEqual({ GH_TOKEN: '${{ secrets.GH_RELEASE_TOKEN }}' });
    expect(tagsJob.steps[0]!.with).toEqual({
      'fetch-depth': 0,
      token: '${{ secrets.GH_RELEASE_TOKEN }}',
    });
    expect(tagsJob.steps.find((step) => step.uses?.startsWith('actions/setup-node'))?.with).toEqual(
      {
        'node-version': 22,
      },
    );
    expect(release.steps.map((step) => step.run ?? '')).not.toContain(
      'node scripts/release-sync.mjs tags',
    );
    expect(release.steps.at(-1)!.id).toBe('published');
    expect(publish.needs).toBe('release');
    expect(release.steps[0]!.with).toEqual({
      'fetch-depth': 0,
      token: '${{ secrets.GH_RELEASE_TOKEN }}',
    });
  });

  it('AC-17: builds once, inside pnpm run release, and the plugin job keeps its own build', () => {
    expect(release.steps.map((step) => step.name)).not.toContain('Build');
    expect(release.steps.map((step) => step.run ?? '').join('\n')).not.toContain('pnpm run build');
    const changesets = release.steps.find((step) => step.id === 'changesets')!;
    expect(changesets.with?.publish).toBe('pnpm run release');
    expect(changesets.env?.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.release).toBe('pnpm run build && changeset publish');
    expect(publish.steps.find((step) => step.name === 'Build')?.run).toBe('pnpm run build');
  });

  it('builds the plugin from the released commit', () => {
    const checkout = publish.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with).toEqual({ ref: '${{ needs.release.outputs.sha }}' });
    expect(publish.steps.indexOf(versionStep)).toBe(publish.steps.indexOf(checkout!) + 1);
    expect(versionStep.env).toEqual({ RELEASED_VERSION: '${{ needs.release.outputs.version }}' });
  });

  it('fails red, never skips, when the plugin is behind npm', () => {
    expect(inSync.needs).toEqual(['release', 'publish-plugin', 'publish-discovery-plugin', 'tags']);
    expect(inSync.if).toBe("always() && needs.release.result == 'success'");
    expect(inSync.steps.map((step) => step.run)).toContain('node scripts/release-sync.mjs check');
    expect(inSync.steps.at(-1)?.run).toBe('node scripts/release-sync.mjs discovery-check');
    const daily = parse(readFileSync('.github/workflows/plugin-sync-check.yml', 'utf8')) as {
      on: { schedule: { cron: string }[] };
      jobs: Record<string, Job>;
    };
    expect(daily.on.schedule).toEqual([{ cron: '0 6 * * *' }]);
    expect(daily.jobs.check!.steps.at(-1)?.run).toBe('node scripts/release-sync.mjs check');
  });

  describe('AC-3: the discovery check runs only when the discovery job ran', () => {
    const results = (discovery: string) => ({
      release: 'success',
      'publish-plugin': discovery,
      'publish-discovery-plugin': discovery,
      tags: discovery,
    });
    const evaluate = (expression: string, needs: Record<string, string>): boolean =>
      expression.split('&&').every((part) => {
        const term = part.trim();
        if (term === 'always()') return true;
        const match = /^needs\.([\w-]+)\.result (==|!=) '(\w+)'$/.exec(term);
        if (!match) throw new Error(`unsupported expression: ${term}`);
        const equal = needs[match[1]!] === match[3];
        return match[2] === '==' ? equal : !equal;
      });
    const discoveryStep = () =>
      inSync.steps.find((step) => step.run === 'node scripts/release-sync.mjs discovery-check')!;

    it('AC-3: a release run that publishes nothing stays green and skips the discovery check', () => {
      const needs = results('skipped');
      expect(evaluate(inSync.if!, needs)).toBe(true);
      expect(evaluate(discoveryStep().if!, needs)).toBe(false);
      const check = inSync.steps.find(
        (step) => step.run === 'node scripts/release-sync.mjs check',
      )!;
      expect(check.if).toBeUndefined();
    });

    it('AC-3: a release run that published runs the discovery check, even when the push failed', () => {
      for (const outcome of ['success', 'failure']) {
        const needs = results(outcome);
        expect(evaluate(inSync.if!, needs)).toBe(true);
        expect(evaluate(discoveryStep().if!, needs)).toBe(true);
      }
    });
  });

  it.skipIf(process.platform === 'win32')(
    'fails the version check when the checkout is not the released version',
    () => {
      const run = (released: string) =>
        spawnSync('bash', ['-c', versionStep.run!], {
          cwd: builtWorkspace('1.2.3'),
          encoding: 'utf8',
          env: { PATH: process.env.PATH, RELEASED_VERSION: released },
        });
      const mismatch = run('1.2.4');
      expect(mismatch.status).toBe(1);
      expect(mismatch.stdout).toContain(
        '::error::package.json at the released commit is 1.2.3, but npm published 1.2.4.',
      );
      expect(run('1.2.3').status).toBe(0);
    },
  );

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

  it('AC-39: installs from the frozen lockfile, then assembles under set -eu before any git add', () => {
    const job = workflow.jobs['publish-plugin']!;
    const names = job.steps.map((step) => step.run ?? '');
    const install = names.indexOf('pnpm install --frozen-lockfile');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(job.steps.indexOf(pushStep));
    const push = pushStep.run!;
    expect(push.indexOf('set -eu')).toBeGreaterThan(-1);
    expect(push.indexOf('set -eu')).toBeLessThan(
      push.indexOf('node scripts/assemble-plugin.mjs plugin-repo'),
    );
    expect(push.indexOf('node scripts/assemble-plugin.mjs plugin-repo')).toBeLessThan(
      push.indexOf('git add'),
    );
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

const DISCOVERY_URL = 'github.com/Eliyce/paqad-product-discovery-plugin.git';
const DISCOVERY_MESSAGE =
  'PAQAD_PLUGIN_PUSH_TOKEN is not set or cannot push to Eliyce/paqad-product-discovery-plugin. Give it write access, then re-run this job.';
const discovery = workflow.jobs['publish-discovery-plugin']!;
const discoveryToken = discovery.steps.find((step) => step.id === 'token')!;
const discoveryPush = discovery.steps.at(-1)!;

function discoveryWorkspace(version: string): string {
  const root = tempDir('paqad-discovery-ws-');
  write(root, 'package.json', JSON.stringify({ name: 'paqad-ai', version }));
  for (const part of ['build', 'skills', 'shared', 'publish']) {
    cpSync(resolve('plugins/discovery', part), join(root, 'plugins/discovery', part), {
      recursive: true,
      filter: (source) => !source.includes('__pycache__'),
    });
  }
  return root;
}

function runDiscoveryPush(workspace: string, remote: string, token = 'a-token') {
  return spawnSync('bash', ['-c', discoveryPush.run!], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: workspace,
      RUNNER_TEMP: tempDir('paqad-runner-'),
      PYTHONDONTWRITEBYTECODE: '1',
      PAQAD_PLUGIN_PUSH_TOKEN: token,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://x-access-token:${token}@${DISCOVERY_URL}`,
    },
  });
}

describe('the release workflow publishes the discovery plugin', () => {
  it('AC-1: runs after release with the publish-plugin guards and the released checkout', () => {
    expect(discovery.needs).toBe('release');
    expect(discovery.if).toBe("needs.release.outputs.published == 'true'");
    expect(discovery.permissions).toEqual({ contents: 'read' });
    const checkout = discovery.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with).toEqual({ ref: '${{ needs.release.outputs.sha }}' });
    const version = discovery.steps[discovery.steps.indexOf(checkout!) + 1]!;
    expect(version.run).toBe(versionStep.run);
    expect(version.env).toEqual({ RELEASED_VERSION: '${{ needs.release.outputs.version }}' });
    const python = discovery.steps.find((step) => step.uses?.startsWith('actions/setup-python'));
    expect(python?.with).toEqual({ 'python-version': '3.9' });
    expect(discovery.steps.indexOf(discoveryToken)).toBe(0);
    for (const step of discovery.steps) {
      expect(step.if).toBeUndefined();
      expect(step.run ?? '').not.toContain('secrets.');
      if (step.env?.PAQAD_PLUGIN_PUSH_TOKEN !== undefined) {
        expect(step.env.PAQAD_PLUGIN_PUSH_TOKEN).toBe('${{ secrets.PAQAD_PLUGIN_PUSH_TOKEN }}');
      }
    }
  });

  it('AC-13: checks write access before cloning and names the token and the repo in one sentence', () => {
    const check = discoveryToken.run!;
    expect(check).toContain(DISCOVERY_MESSAGE);
    expect(check).toContain('.permissions.push');
    expect(check).not.toContain('git clone');
    expect(discoveryPush.run!).toContain(DISCOVERY_MESSAGE);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-13: an empty token fails the job with exactly the sentence',
    () => {
      const empty = spawnSync('bash', ['-c', discoveryToken.run!], {
        env: { PATH: process.env.PATH, PAQAD_PLUGIN_PUSH_TOKEN: '' },
        encoding: 'utf8',
      });
      expect(empty.status).toBe(1);
      expect(empty.stdout).toBe(`::error::${DISCOVERY_MESSAGE}\n`);
    },
  );

  it('AC-14: builds the discovery target, pushes the dist root without hosts and never force-pushes', () => {
    const push = discoveryPush.run!;
    expect(push).toContain(
      'python3 plugins/discovery/build/build.py --version "$VERSION" --target discovery --dist "$DIST"',
    );
    expect(push).toContain('rm -rf discovery-repo/hosts');
    expect(push).toContain(DISCOVERY_URL);
    expect(push).toContain('git commit --quiet -m "paqad-product-discovery v${VERSION}"');
    expect(push).not.toMatch(/--force|push -f|\+refs/);
    expect(push.indexOf('set -eu')).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'AC-15: creates main and the tag on an empty repo, then commits nothing on a re-run',
    () => {
      const remote = join(tempDir('paqad-discovery-remote-'), 'discovery.git');
      git(dirname(remote), ['init', '--quiet', '--bare', remote]);
      const workspace = discoveryWorkspace('1.2.3');

      const first = runDiscoveryPush(workspace, remote);
      expect(first.status, first.stdout + first.stderr).toBe(0);
      expect(git(remote, ['for-each-ref', '--format=%(refname)'])).toBe(
        ['refs/heads/main', 'refs/tags/v1.2.3'].join('\n'),
      );
      const files = git(remote, ['ls-tree', '-r', '--name-only', 'main']).split('\n');
      expect(files.some((file) => file.startsWith('hosts/'))).toBe(false);
      for (const file of [
        'README.md',
        '.claude-plugin/marketplace.json',
        '.agents/plugins/marketplace.json',
        'plugins/paqad-product-discovery/.claude-plugin/plugin.json',
        'plugins/paqad-product-discovery/plugin.json',
      ]) {
        expect(files).toContain(file);
      }
      for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
        const marketplace = JSON.parse(git(remote, ['show', `main:${file}`])) as {
          plugins: { version: string }[];
        };
        expect(marketplace.plugins[0]!.version).toBe('1.2.3');
      }
      expect(git(remote, ['log', '-1', '--format=%s', 'main'])).toBe(
        'paqad-product-discovery v1.2.3',
      );

      rmSync(join(workspace, 'discovery-repo'), { recursive: true, force: true });
      const again = runDiscoveryPush(workspace, remote);
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain(
        'The discovery plugin tree is unchanged at v1.2.3; nothing to commit.',
      );
      expect(again.stdout).toContain(
        'Tag v1.2.3 already exists on Eliyce/paqad-product-discovery-plugin.',
      );
      expect(git(remote, ['rev-list', '--count', 'main'])).toBe('1');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'AC-13: a clone that cannot reach the repo prints the same sentence',
    () => {
      const missing = join(tempDir('paqad-discovery-missing-'), 'absent.git');
      const result = runDiscoveryPush(discoveryWorkspace('1.2.3'), missing);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`::error::${DISCOVERY_MESSAGE}`);
    },
  );
});
