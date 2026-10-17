import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadOptionalPackage, resolveOptionalPackage } from '@/core/optional-package.js';

const FAKE = 'paqad-fake-engine';

let root: string;

// require.resolve returns the real (symlink-resolved) path, so assertions match on the suffix.
const FAKE_ENTRY_SUFFIX = join('node_modules', FAKE, 'index.cjs');

/** Write a minimal resolvable CJS package `paqad-fake-engine` into `<dir>/node_modules`. */
function seedFakePackage(dir: string): void {
  const pkgDir = join(dir, 'node_modules', FAKE);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name: FAKE, version: '1.0.0', main: 'index.cjs' }),
    'utf8',
  );
  writeFileSync(join(pkgDir, 'index.cjs'), 'module.exports = { answer: () => 42 };\n', 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-optional-pkg-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveOptionalPackage (issue #616, Part 2b)', () => {
  it('resolves a normally-installed dependency through hop 1', () => {
    // `execa` is a real runtime dependency, so hop 1 (next to this module) finds it.
    const resolved = resolveOptionalPackage('execa', {});
    expect(resolved).toContain('execa');
  });

  it('returns null when the package exists in none of the three locations', () => {
    expect(resolveOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: join(root, 'gone') })).toBeNull();
  });

  it('resolves from ${CLAUDE_PLUGIN_DATA}/node_modules (hop 2)', () => {
    seedFakePackage(root);
    const resolved = resolveOptionalPackage(FAKE, {
      CLAUDE_PLUGIN_DATA: root,
      PAQAD_FRAMEWORK_HOME: join(root, 'gone'),
    });
    expect(resolved?.endsWith(FAKE_ENTRY_SUFFIX)).toBe(true);
  });

  it('resolves from the npm copy one level above the framework link (hop 3a)', () => {
    // The link resolves to `<pkgRoot>/runtime`; the engine lives in `<pkgRoot>/node_modules`.
    const pkgRoot = join(root, 'npm-copy');
    seedFakePackage(pkgRoot);
    mkdirSync(join(pkgRoot, 'runtime'), { recursive: true });
    const link = join(root, 'current');
    symlinkSync(join(pkgRoot, 'runtime'), link);
    const resolved = resolveOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: link });
    expect(resolved?.endsWith(FAKE_ENTRY_SUFFIX)).toBe(true);
  });
});

describe('loadOptionalPackage (issue #616, Part 2b)', () => {
  it('loads a normally-installed dependency through the bare import (hop 1)', async () => {
    // `execa` resolves next to this module, so the bare dynamic import returns it directly.
    const mod = await loadOptionalPackage<{ execa: unknown }>('execa', {});
    expect(typeof mod.execa).toBe('function');
  });

  it('loads a resolved package with its named exports intact', async () => {
    seedFakePackage(root);
    const mod = await loadOptionalPackage<{ answer: () => number }>(FAKE, {
      CLAUDE_PLUGIN_DATA: root,
      PAQAD_FRAMEWORK_HOME: join(root, 'gone'),
    });
    expect(mod.answer()).toBe(42);
  });

  it('rejects when the package is installed nowhere', async () => {
    await expect(
      loadOptionalPackage(FAKE, { PAQAD_FRAMEWORK_HOME: join(root, 'gone') }),
    ).rejects.toThrow(/not installed/);
  });
});
