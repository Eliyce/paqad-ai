import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The hook keeps its logic in `__test` so each branch is exercised without touching the real home.
import { __test } from '../../../runtime/hooks/plugin-session-start.mjs';

const { compareVersions, readPackageVersion, repointFrameworkLink, ensureBinOnPath } = __test;

let root: string;

function makeRuntime(dir: string, version: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }), 'utf8');
  const runtime = join(dir, 'runtime');
  mkdirSync(runtime, { recursive: true });
  return runtime;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-plugin-session-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('compareVersions', () => {
  it('orders semantic versions and treats unparseable parts as 0', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.95.1', '1.95')).toBe(1);
  });
});

describe('readPackageVersion', () => {
  it('reads the version or returns null when absent/malformed', () => {
    const dir = join(root, 'pkg');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.1.4' }), 'utf8');
    expect(readPackageVersion(dir)).toBe('3.1.4');
    expect(readPackageVersion(join(root, 'nope'))).toBeNull();
  });
});

describe('repointFrameworkLink (issue #616, Part 4)', () => {
  function env(home: string): NodeJS.ProcessEnv {
    return { PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv;
  }

  it('creates the link when it is missing', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('re-points a dangling link', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    symlinkSync(join(root, 'gone', 'runtime'), home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('takes over from an OLDER npm copy', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const npmRuntime = makeRuntime(join(root, 'npm'), '1.0.0');
    const home = join(root, 'current');
    symlinkSync(npmRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('leaves a NEWER npm copy in place', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const npmRuntime = makeRuntime(join(root, 'npm'), '3.0.0');
    const home = join(root, 'current');
    symlinkSync(npmRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(npmRuntime);
  });

  it('leaves a link already pointing at the plugin runtime', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    symlinkSync(pluginRuntime, home);
    repointFrameworkLink(pluginRuntime, env(home));
    expect(readlinkSync(home)).toBe(pluginRuntime);
  });

  it('never replaces a real directory', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const home = join(root, 'current');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'keep.txt'), 'mine', 'utf8');
    repointFrameworkLink(pluginRuntime, env(home));
    expect(lstatSync(home).isDirectory()).toBe(true);
    expect(lstatSync(home).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(home, 'keep.txt'), 'utf8')).toBe('mine');
  });
});

describe('ensureBinOnPath (issue #616, Part 5)', () => {
  it('chmods the launcher and prepends its dir to CLAUDE_ENV_FILE PATH', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
    mkdirSync(binDir, { recursive: true });
    const launcher = join(binDir, 'paqad-ai');
    writeFileSync(launcher, '#!/bin/sh\n', { mode: 0o644 });
    const envFile = join(root, 'env');
    writeFileSync(envFile, '', 'utf8');

    ensureBinOnPath(pluginRuntime, {
      CLAUDE_ENV_FILE: envFile,
      PATH: '/usr/bin',
    } as NodeJS.ProcessEnv);

    const line = readFileSync(envFile, 'utf8');
    expect(line).toContain(`PATH=${binDir}`);
    expect(line).toContain('/usr/bin');
    expect(line.startsWith('export ')).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(launcher).mode & 0o777).toBe(0o755);
    }
  });

  it('does nothing harmful when CLAUDE_ENV_FILE is unset', () => {
    const pluginRuntime = makeRuntime(join(root, 'plugin'), '2.0.0');
    const binDir = join(pluginRuntime, 'claude-plugin', 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'paqad-ai'), '#!/bin/sh\n', { mode: 0o644 });
    expect(() =>
      ensureBinOnPath(pluginRuntime, { PATH: '/usr/bin' } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
