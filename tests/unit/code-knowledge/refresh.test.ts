import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { refreshCodeKnowledgeIndex } from '@/code-knowledge/refresh.js';
import { readCodeKnowledgeIndex, writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { PATHS } from '@/core/constants/paths.js';

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

const C1 = { branch: 'main', head_commit: 'c1' };

describe('refreshCodeKnowledgeIndex', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ck-refresh-'));
    write(root, PATHS.MODULE_MAP, ['modules:', '  - slug: core', '    sources: [src]'].join('\n'));
    write(root, 'package.json', JSON.stringify({ dependencies: { chalk: '^5.0.0' } }));
    write(root, 'src/lib.ts', 'export function a(): void {}\n');
    write(root, 'src/app.ts', 'import { a } from "./lib.js";\na();\n');
    const initial = await buildCodeKnowledgeIndex(root, {
      now: () => '2026-01-01T00:00:00.000Z',
      gitState: C1,
    });
    writeCodeKnowledgeIndex(root, initial);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('re-parses only the changed file and updates generated_at (AC-5)', async () => {
    write(root, 'src/lib.ts', 'export function a(): void {}\nexport function b(): void {}\n');
    const result = await refreshCodeKnowledgeIndex(root, {
      changedFiles: ['src/lib.ts'],
      gitState: C1,
      now: () => '2026-02-02T00:00:00.000Z',
    });

    expect(result).toMatchObject({
      refreshed: true,
      reason: 'incremental',
      reparsed: ['src/lib.ts'],
    });
    const index = readCodeKnowledgeIndex(root)!;
    expect(index.header.generated_at).toBe('2026-02-02T00:00:00.000Z');
    expect(index.symbols.map((s) => s.name).sort()).toEqual(['a', 'b']);
    // The unchanged app.ts edge is preserved, so a() still has its caller.
    expect(index.symbols.find((s) => s.name === 'a')?.caller_count).toBe(1);
  });

  it('forces a full rebuild when the branch/head_commit changed', async () => {
    const result = await refreshCodeKnowledgeIndex(root, {
      gitState: { branch: 'feat/x', head_commit: 'c2' },
      now: () => '2026-03-03T00:00:00.000Z',
    });
    expect(result.reason).toBe('full-rebuild');
    expect(result.refreshed).toBe(true);
    const index = readCodeKnowledgeIndex(root)!;
    expect(index.header.branch).toBe('feat/x');
    expect(index.header.head_commit).toBe('c2');
  });

  it('drops a deleted file, so its former callee loses that caller', async () => {
    rmSync(join(root, 'src/app.ts'));
    const result = await refreshCodeKnowledgeIndex(root, {
      changedFiles: ['src/app.ts'],
      gitState: C1,
      now: () => '2026-04-04T00:00:00.000Z',
    });
    expect(result.reason).toBe('incremental');
    const index = readCodeKnowledgeIndex(root)!;
    expect(index.files.some((f) => f.path === 'src/app.ts')).toBe(false);
    // a() was only used by app.ts -> now orphan (src is not an entry point here).
    expect(index.symbols.find((s) => s.name === 'a')).toMatchObject({
      caller_count: 0,
      orphan: true,
    });
  });

  it('is a no-op when no source files changed (change evidence empty)', async () => {
    const result = await refreshCodeKnowledgeIndex(root, { gitState: C1 });
    expect(result).toMatchObject({ refreshed: false, reason: 'up-to-date' });
  });

  it('ignores changes to non-source files', async () => {
    write(root, 'README.md', 'edited');
    const result = await refreshCodeKnowledgeIndex(root, {
      changedFiles: ['README.md'],
      gitState: C1,
    });
    expect(result.reason).toBe('up-to-date');
    expect(result.refreshed).toBe(false);
  });

  it('skips entirely when no index exists (initial build stays explicit)', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-ck-refresh-bare-'));
    try {
      const result = await refreshCodeKnowledgeIndex(bare, { gitState: C1 });
      expect(result).toEqual({ refreshed: false, reason: 'no-index', reparsed: [] });
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('defaults to readGitState and normalises absent branch/commit to null', async () => {
    // Rebuild the stored index with null git (as a non-git checkout would have), then
    // refresh WITHOUT injecting gitState: readGitState on this non-git temp dir yields
    // {}, which normalises to null and matches the stored header -> incremental.
    const nullGit = await buildCodeKnowledgeIndex(root, { now: () => 't0', gitState: {} });
    writeCodeKnowledgeIndex(root, nullGit);
    write(root, 'src/lib.ts', 'export function a(): void {}\nexport function c(): void {}\n');

    const result = await refreshCodeKnowledgeIndex(root, {
      changedFiles: ['src/lib.ts'],
      now: () => 't1',
    });

    expect(result.reason).toBe('incremental');
    const index = readCodeKnowledgeIndex(root)!;
    expect(index.header.branch).toBeNull();
    expect(index.header.head_commit).toBeNull();
    expect(index.symbols.map((s) => s.name)).toContain('c');
  });

  it('recomputes dependency usage when the existing index recorded none', async () => {
    const existing = readCodeKnowledgeIndex(root)!;
    writeCodeKnowledgeIndex(root, { ...existing, dependencies: [] });
    write(root, 'src/lib.ts', 'import chalk from "chalk";\nexport function a(): void {}\n');
    const result = await refreshCodeKnowledgeIndex(root, {
      changedFiles: ['src/lib.ts'],
      gitState: C1,
    });
    expect(result.reason).toBe('incremental');
    const index = readCodeKnowledgeIndex(root)!;
    expect(index.dependencies.find((d) => d.name === 'chalk')?.imported).toBe(true);
  });
});
