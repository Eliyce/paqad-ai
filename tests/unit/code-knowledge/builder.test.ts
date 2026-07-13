import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeKnowledgeIndex, readSourceFiles } from '@/code-knowledge/builder.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import { PATHS } from '@/core/constants/paths.js';

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('buildCodeKnowledgeIndex', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ck-builder-'));
    write(
      root,
      PATHS.MODULE_MAP,
      ['version: 2', 'modules:', '  - slug: core', '    sources: [src/core]'].join('\n'),
    );
    write(
      root,
      'package.json',
      JSON.stringify({
        main: 'src/cli/index.ts',
        dependencies: { chalk: '^5.0.0' },
        devDependencies: { unused: '^1.0.0' },
      }),
    );
    write(
      root,
      'src/core/lib.ts',
      'export function used(): void {}\nexport function dead(): void {}\n',
    );
    write(
      root,
      'src/core/consumer.ts',
      'import { used } from "./lib.js";\nimport chalk from "chalk";\nused();\nchalk.red("x");\n',
    );
    write(root, 'src/cli/index.ts', 'export function main(): void {}\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function build() {
    return buildCodeKnowledgeIndex(root, {
      now: () => '2026-07-13T00:00:00.000Z',
      gitState: { branch: 'feat/x', head_commit: 'deadbeef' },
    });
  }

  it('produces a schema-valid index with a stamped freshness header (AC-1)', async () => {
    const index = await build();
    expect(validateCodeKnowledgeIndex(index).valid).toBe(true);
    expect(index.header).toMatchObject({
      generated_at: '2026-07-13T00:00:00.000Z',
      branch: 'feat/x',
      head_commit: 'deadbeef',
      schema_version: 1,
    });
    expect(index.header.entry_point_globs).toContain('src/cli/**');
    expect(index.symbols.length).toBeGreaterThan(0);
    expect(index.symbols.some((s) => s.caller_count > 0)).toBe(true);
  });

  it('populates symbols with module_slug, signature, and caller_count', async () => {
    const index = await build();
    const used = index.symbols.find((s) => s.name === 'used');
    expect(used).toMatchObject({
      kind: 'function',
      file: 'src/core/lib.ts',
      module_slug: 'core',
      caller_count: 1,
      orphan: false,
      extraction_tier: 'regex',
    });
    expect(used!.signature).toBe('used(): void');
  });

  it('flags an unreferenced non-entry export as orphan, but spares an entry-point file (AC-4)', async () => {
    const index = await build();
    expect(index.symbols.find((s) => s.name === 'dead')).toMatchObject({
      caller_count: 0,
      orphan: true,
    });
    // main() has no callers, but src/cli/index.ts is a bin entry -> not orphan.
    expect(index.symbols.find((s) => s.name === 'main')).toMatchObject({
      caller_count: 0,
      orphan: false,
    });
    const cliFile = index.files.find((f) => f.path === 'src/cli/index.ts');
    expect(cliFile).toMatchObject({ entry_point: true, orphan: false });
  });

  it('records file and reference edges', async () => {
    const index = await build();
    expect(index.import_edges).toContainEqual({
      from: 'src/core/consumer.ts',
      to: 'src/core/lib.ts',
    });
    expect(index.reference_edges).toContainEqual({
      from: 'src/core/consumer.ts',
      to: 'src/core/lib.ts',
      symbol: 'used',
    });
  });

  it('marks a declared-but-unused dependency imported:false and a used one true (AC-3)', async () => {
    const index = await build();
    const byName = new Map(index.dependencies.map((d) => [d.name, d]));
    expect(byName.get('chalk')?.imported).toBe(true);
    expect(byName.get('unused')?.imported).toBe(false);
  });

  it('defaults the clock and git state when not injected (non-git temp dir -> null)', async () => {
    const index = await buildCodeKnowledgeIndex(root);
    expect(typeof index.header.generated_at).toBe('string');
    expect(index.header.generated_at.length).toBeGreaterThan(0);
    expect(index.header.branch).toBeNull();
    expect(index.header.head_commit).toBeNull();
  });
});

describe('readSourceFiles', () => {
  it('reads present files and skips ones that cannot be read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-read-src-'));
    try {
      write(dir, 'a.ts', 'export const A = 1;');
      const map = await readSourceFiles(dir, ['a.ts', 'gone.ts']);
      expect(map.get('a.ts')).toContain('export const A');
      expect(map.has('gone.ts')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
