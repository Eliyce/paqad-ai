import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findPackageRoot,
  getPackageRoot,
  getRuntimeRoot,
  getRuntimeTemplatesRoot,
} from '@/core/runtime-paths.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function writePkg(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), body);
}

describe('findPackageRoot (issue #579)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-pkg-root-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the same root from a depth-one and a depth-two bundle folder', () => {
    const pkg = join(root, 'node_modules', 'paqad-ai');
    writePkg(pkg, JSON.stringify({ name: 'paqad-ai' }));
    mkdirSync(join(pkg, 'dist', 'cli'), { recursive: true });

    expect(findPackageRoot(join(pkg, 'dist'))).toBe(pkg);
    expect(findPackageRoot(join(pkg, 'dist', 'cli'))).toBe(pkg);
  });

  it('never returns a host project package.json with another name above a vendored install', () => {
    writePkg(root, JSON.stringify({ name: 'host-app' }));
    const pkg = join(root, 'vendor', 'paqad-ai');
    writePkg(pkg, JSON.stringify({ name: 'paqad-ai' }));
    const nested = join(pkg, 'dist', 'kernel');
    writePkg(nested, JSON.stringify({ name: 'nested-thing' }));

    expect(findPackageRoot(nested)).toBe(pkg);
  });

  it('keeps walking past an unreadable, unparseable or nameless package.json', () => {
    const pkg = join(root, 'paqad');
    writePkg(pkg, JSON.stringify({ name: 'paqad-ai' }));
    const unparseable = join(pkg, 'a');
    writePkg(unparseable, '{ not json');
    const nullBody = join(unparseable, 'b');
    writePkg(nullBody, 'null');
    const unreadable = join(nullBody, 'c');
    // A directory named package.json makes readFileSync throw on every platform.
    mkdirSync(join(unreadable, 'package.json'), { recursive: true });

    expect(findPackageRoot(unreadable)).toBe(pkg);
  });

  it('throws a named error when no paqad-ai package.json sits above the start folder', () => {
    const start = join(root, 'nowhere', 'deep');
    mkdirSync(start, { recursive: true });
    writePkg(root, JSON.stringify({ name: 'someone-else' }));

    expect(() => findPackageRoot(start)).toThrow(
      `paqad-ai: could not find the package root above ${start}`,
    );
  });
});

describe('getPackageRoot', () => {
  it('resolves the repo root from the src tree and memoizes it', () => {
    const first = getPackageRoot();
    expect(first).toBe(REPO_ROOT);
    expect(getPackageRoot()).toBe(first);
  });

  it('derives an on-disk runtime root and templates root from it', () => {
    expect(getRuntimeRoot()).toBe(join(REPO_ROOT, 'runtime'));
    expect(existsSync(getRuntimeRoot())).toBe(true);
    expect(getRuntimeTemplatesRoot()).toBe(join(REPO_ROOT, 'runtime', 'templates'));
  });
});
