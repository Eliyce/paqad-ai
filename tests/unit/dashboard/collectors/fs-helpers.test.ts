import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileMtime, scanDirectory } from '@/dashboard/collectors/fs-helpers.js';

describe('scanDirectory', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fs-helpers-'));
    mkdirSync(join(root, 'nested', 'deep'), { recursive: true });
    writeFileSync(join(root, 'a.ts'), 'a');
    writeFileSync(join(root, 'b.md'), 'b');
    writeFileSync(join(root, 'nested', 'c.ts'), 'c');
    writeFileSync(join(root, 'nested', 'deep', 'd.ts'), 'd');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('recursively lists files with relative + absolute paths and stats', () => {
    const entries = scanDirectory(root);
    const rels = entries.map((e) => e.relPath).sort();
    expect(rels).toEqual(['a.ts', 'b.md', 'nested/c.ts', 'nested/deep/d.ts']);
    const a = entries.find((e) => e.relPath === 'a.ts')!;
    expect(a.absPath).toBe(join(root, 'a.ts'));
    expect(a.sizeBytes).toBeGreaterThan(0);
    expect(a.mtimeMs).toBeGreaterThan(0);
  });

  it('applies the file filter to names', () => {
    const tsOnly = scanDirectory(root, { fileFilter: (name) => name.endsWith('.ts') });
    expect(tsOnly.every((e) => e.relPath.endsWith('.ts'))).toBe(true);
    expect(tsOnly.some((e) => e.relPath === 'b.md')).toBe(false);
  });

  it('respects maxDepth (does not descend past the limit)', () => {
    const shallow = scanDirectory(root, { maxDepth: 0 })
      .map((e) => e.relPath)
      .sort();
    expect(shallow).toEqual(['a.ts', 'b.md']);
    const oneDeep = scanDirectory(root, { maxDepth: 1 })
      .map((e) => e.relPath)
      .sort();
    expect(oneDeep).toEqual(['a.ts', 'b.md', 'nested/c.ts']);
  });

  it('returns [] for a missing root', () => {
    expect(scanDirectory(join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('fileMtime', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-fs-helpers-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns the mtime in ms for an existing file', () => {
    const file = join(root, 'x.txt');
    writeFileSync(file, 'x');
    expect(fileMtime(file)).toBeGreaterThan(0);
  });

  it('returns null for a missing file', () => {
    expect(fileMtime(join(root, 'missing.txt'))).toBeNull();
  });
});
