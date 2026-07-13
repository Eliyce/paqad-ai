import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isTestFile, resolveEntryPoints } from '@/code-knowledge/entry-points.js';

describe('isTestFile', () => {
  it.each([
    ['tests/foo.ts', true],
    ['src/foo.test.ts', true],
    ['src/foo.spec.tsx', true],
    ['pkg/__tests__/foo.ts', true],
    ['src/foo.ts', false],
    ['src/cli/index.ts', false],
  ])('%s -> %s', (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });
});

describe('resolveEntryPoints', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-entry-points-'));
    mkdirSync(join(root, 'src', 'cli'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'src', 'cli', 'index.ts'), '// bin');
    writeFileSync(join(root, 'src', 'lib.ts'), '// plain');
    writeFileSync(join(root, 'tests', 'lib.test.ts'), '// test');
    writeFileSync(join(root, 'src', 'entry.ts'), '// package main');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ main: './src/entry.ts', bin: { tool: 'src/cli/index.ts' } }),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('includes the static convention globs', () => {
    const { globs } = resolveEntryPoints(root);
    expect(globs).toContain('src/cli/**');
    expect(globs).toContain('runtime/hooks/**');
  });

  it('matches the CLI bin entry (AC-4: src/cli/index.ts is not orphan)', () => {
    const { files } = resolveEntryPoints(root);
    expect(files.has('src/cli/index.ts')).toBe(true);
  });

  it('matches test files and the package "main" entry, but not a plain source file', () => {
    const { files } = resolveEntryPoints(root);
    expect(files.has('tests/lib.test.ts')).toBe(true);
    expect(files.has('src/entry.ts')).toBe(true);
    expect(files.has('src/lib.ts')).toBe(false);
  });

  it('tolerates a missing package.json', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-entry-bare-'));
    try {
      mkdirSync(join(bare, 'src', 'cli'), { recursive: true });
      writeFileSync(join(bare, 'src', 'cli', 'run.ts'), '// x');
      const { files } = resolveEntryPoints(bare);
      expect(files.has('src/cli/run.ts')).toBe(true);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('tolerates a malformed package.json', () => {
    writeFileSync(join(root, 'package.json'), '{ not json');
    expect(() => resolveEntryPoints(root)).not.toThrow();
  });
});
