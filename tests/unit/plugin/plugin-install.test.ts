import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyFrameworkCopy,
  describeFrameworkLink,
  frameworkLinkHome,
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

describe('describeFrameworkLink (issue #616, Part 4.6)', () => {
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
    makeCopy(dir, '2.2.2'); // writes package.json one level above the dir's runtime
    const home = join(dir, 'runtime');
    const info = describeFrameworkLink({ PAQAD_FRAMEWORK_HOME: home } as NodeJS.ProcessEnv);
    expect(info.copy).toBe('directory');
    expect(info.targetExists).toBe(true);
    expect(info.version).toBe('2.2.2');
  });
});
