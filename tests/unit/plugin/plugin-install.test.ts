import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyFrameworkCopy,
  describeFrameworkLink,
  frameworkLinkHome,
  isPluginInstalled,
  pluginLoadState,
  readPackageVersion,
} from '@/health/plugin-install.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-plugin-install-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeCopy(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }), 'utf8');
  const runtime = join(dir, 'runtime');
  mkdirSync(runtime, { recursive: true });
  return runtime;
}

describe('frameworkLinkHome', () => {
  it('honours PAQAD_FRAMEWORK_HOME, else ~/.paqad-ai/current', () => {
    expect(frameworkLinkHome({ PAQAD_FRAMEWORK_HOME: '/x/y' } as NodeJS.ProcessEnv)).toBe('/x/y');
    expect(frameworkLinkHome({} as NodeJS.ProcessEnv)).toMatch(/\.paqad-ai[/\\]current$/);
  });
});

describe('classifyFrameworkCopy', () => {
  it('reads plugin from a plugins cache path and npm from a node_modules path', () => {
    expect(classifyFrameworkCopy('/home/u/.claude/plugins/eliyce/paqad/runtime')).toBe('plugin');
    expect(classifyFrameworkCopy('C:\\Users\\u\\.claude\\plugins\\eliyce\\paqad\\runtime')).toBe(
      'plugin',
    );
    expect(classifyFrameworkCopy('/usr/lib/node_modules/paqad-ai/runtime')).toBe('npm');
    expect(classifyFrameworkCopy('/some/other/runtime')).toBe('unknown');
  });
});

describe('readPackageVersion', () => {
  it('reads version or null', () => {
    const dir = join(root, 'p');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.0.0' }), 'utf8');
    expect(readPackageVersion(dir)).toBe('9.0.0');
    expect(readPackageVersion(join(root, 'missing'))).toBeNull();
  });
});

describe('describeFrameworkLink', () => {
  it('reports an npm-copy link target and its version', () => {
    const npm = join(root, 'node_modules', 'paqad-ai');
    const runtime = makeCopy(npm, '1.95.1');
    const home = join(root, 'current');
    symlinkSync(runtime, home);
    const info = describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv);
    expect(info.copy).toBe('npm');
    expect(info.version).toBe('1.95.1');
    expect(info.targetExists).toBe(true);
  });

  it('reports a missing link', () => {
    const info = describeFrameworkLink({
      PAQAD_FRAMEWORK_HOME: join(root, 'nope'),
    } as NodeJS.ProcessEnv);
    expect(info.linkTarget).toBeNull();
    expect(info.targetExists).toBe(false);
    expect(info.copy).toBe('unknown');
  });

  it('reports a dangling link target', () => {
    const home = join(root, 'current');
    symlinkSync(join(root, 'gone', 'runtime'), home);
    const info = describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv);
    expect(info.linkTarget).not.toBeNull();
    expect(info.targetExists).toBe(false);
    expect(info.copy).toBe('unknown');
  });

  it('reports a real directory override', () => {
    const dir = join(root, 'realhome');
    makeCopy(dir, '2.2.2');
    const home = join(dir, 'runtime');
    const info = describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv);
    expect(info.copy).toBe('directory');
    expect(info.targetExists).toBe(true);
    expect(info.version).toBe('2.2.2');
  });
});

describe('isPluginInstalled', () => {
  it('is true when installed_plugins.json lists paqad@eliyce', () => {
    const path = join(root, 'installed_plugins.json');
    writeFileSync(path, JSON.stringify({ plugins: { 'paqad@eliyce': { enabled: true } } }));
    expect(isPluginInstalled(path)).toBe(true);
  });

  it('is false when the plugin is not listed', () => {
    const path = join(root, 'installed_plugins.json');
    writeFileSync(path, JSON.stringify({ plugins: { 'other@someone': {} } }));
    expect(isPluginInstalled(path)).toBe(false);
  });

  it('is false when the file is missing or unparseable', () => {
    expect(isPluginInstalled(join(root, 'nope.json'))).toBe(false);
    const bad = join(root, 'bad.json');
    writeFileSync(bad, 'not json');
    expect(isPluginInstalled(bad)).toBe(false);
  });
});

describe('AC-6: pluginLoadState reads whether the plugin loads for this repo', () => {
  function writePlugins(home: string, content: unknown): void {
    const dir = join(home, '.claude', 'plugins');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'installed_plugins.json'),
      typeof content === 'string' ? content : JSON.stringify(content),
    );
  }

  function entry(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const installPath = join(root, 'cache', 'paqad');
    mkdirSync(installPath, { recursive: true });
    return { scope: 'user', installPath, ...extra };
  }

  it('is live for a version 2 user-scope entry that is switched on', () => {
    writePlugins(root, { version: 2, plugins: { 'paqad@eliyce': [entry()] } });
    expect(pluginLoadState(join(root, 'repo'), { home: root, env: {} })).toBe('live');
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('live');
  });

  it('is absent when the plugin is switched off in user or project settings', () => {
    writePlugins(root, { version: 2, plugins: { 'paqad@eliyce': [entry()] } });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }),
    );
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('absent');
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeFileSync(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'paqad@eliyce': true } }),
    );
    expect(pluginLoadState(repo, { home: root, env: {} })).toBe('live');
  });

  it('is absent for a project-scope entry installed for another repo', () => {
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    writePlugins(root, {
      version: 2,
      plugins: { 'paqad@eliyce': [entry({ scope: 'project', projectPath: join(root, 'other') })] },
    });
    expect(pluginLoadState(repo, { home: root, env: {} })).toBe('absent');
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('absent');
  });

  it('is absent when the install path is gone, and unknown for version 1 or a broken file', () => {
    writePlugins(root, {
      version: 2,
      plugins: { 'paqad@eliyce': [{ scope: 'user', installPath: join(root, 'gone') }] },
    });
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('absent');
    writePlugins(root, { version: 1, plugins: { 'paqad@eliyce': [entry()] } });
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('unknown');
    writePlugins(root, 'not json');
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('unknown');
  });

  it('reads the plugin list from CLAUDE_CONFIG_DIR when it is set', () => {
    const config = join(root, 'config');
    mkdirSync(join(config, 'plugins'), { recursive: true });
    writeFileSync(
      join(config, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'paqad@eliyce': [entry()] } }),
    );
    expect(pluginLoadState(null, { home: root, env: {} })).toBe('unknown');
    expect(pluginLoadState(null, { home: root, env: { CLAUDE_CONFIG_DIR: config } })).toBe('live');
  });
});
