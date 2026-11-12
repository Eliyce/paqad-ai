import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, fixture, git, run, tempDir } from './release-sync-harness.js';

afterEach(cleanTempDirs);

const DISCOVERY_REMOTE = 'https://github.com/Eliyce/paqad-product-discovery-plugin.git';
const MARKETPLACES = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json'];

function discoveryRepo(version: string, extra: Record<string, string> = {}, versions = {}) {
  const root = tempDir('paqad-discovery-sync-');
  const remote = join(root, 'discovery.git');
  const work = join(root, 'work');
  git(root, ['init', '--quiet', '--bare', remote]);
  mkdirSync(work);
  git(work, ['init', '--quiet', '-b', 'main']);
  const files: Record<string, string> = { 'README.md': 'x', ...extra };
  for (const rel of MARKETPLACES) {
    const found = (versions as Record<string, string>)[rel] ?? version;
    files[rel] = JSON.stringify({ plugins: [{ name: 'paqad-product-discovery', version: found }] });
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(work, rel, '..'), { recursive: true });
    writeFileSync(join(work, rel), text);
  }
  git(work, ['add', '-A']);
  git(work, ['commit', '--quiet', '-m', 'tree']);
  git(work, ['push', '--quiet', remote, 'HEAD:refs/heads/main']);
  git(work, ['push', '--quiet', remote, `HEAD:refs/tags/v${version}`]);
  return remote;
}

function check(remote: string, latest = '1.0.0') {
  const f = fixture(['1.0.0']);
  return run(f, 'discovery-check', {
    FAKE_NPM_LATEST: latest,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.file://${remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: DISCOVERY_REMOTE,
  });
}

describe.skipIf(process.platform === 'win32')('release-sync discovery-check', () => {
  it('AC-1: passes when the discovery repo has the tag and both marketplaces carry the version', () => {
    const result = check(discoveryRepo('1.0.0'));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('The discovery plugin is at v1.0.0, matching npm latest.');
  });

  it('AC-1: fails naming the repo when the tag is missing', () => {
    const result = check(discoveryRepo('0.9.0'));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '::error::Eliyce/paqad-product-discovery-plugin has no tag v1.0.0.',
    );
  });

  it('AC-1: fails naming the marketplace file whose version differs', () => {
    const remote = discoveryRepo('1.0.0', {}, { '.agents/plugins/marketplace.json': '0.9.0' });
    const result = check(remote);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      '.agents/plugins/marketplace.json at v1.0.0 carries version 0.9.0, not 1.0.0.',
    );
    expect(result.stdout).not.toContain('.claude-plugin/marketplace.json at');
  });

  it('AC-3: fails naming each hooks, agents, bin, commands or MCP file in the published tree', () => {
    const remote = discoveryRepo('1.0.0', {
      'hooks/hooks.json': '{}',
      'agents/a.md': 'x',
      'bin/run': 'x',
      'plugins/paqad-product-discovery/commands/c.md': 'x',
      '.mcp.json': '{}',
    });
    const result = check(remote);
    expect(result.status).toBe(1);
    for (const file of [
      'hooks/hooks.json',
      'agents/a.md',
      'bin/run',
      'plugins/paqad-product-discovery/commands/c.md',
      '.mcp.json',
    ]) {
      expect(result.stdout).toContain(`ships ${file}; the discovery plugin is skills only.`);
    }
  });

  it('AC-1: a missing marketplace file fails as carrying no version', () => {
    const remote = discoveryRepo('1.0.0', {}, { '.claude-plugin/marketplace.json': '' });
    const result = check(remote);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('.claude-plugin/marketplace.json at v1.0.0 carries version');
  });
});
