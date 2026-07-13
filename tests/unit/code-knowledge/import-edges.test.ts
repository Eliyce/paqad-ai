import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEdges, parseImportedNames } from '@/code-knowledge/import-edges.js';

describe('parseImportedNames', () => {
  it('captures named imports, including the original name before "as"', () => {
    const names = parseImportedNames('import { foo, bar as baz } from "./x";');
    expect([...names].sort()).toEqual(['bar', 'foo']);
  });

  it('captures type-only members and re-exported names', () => {
    const names = parseImportedNames(
      'import { type T, val } from "./a";\nexport { reExported } from "./b";',
    );
    expect([...names].sort()).toEqual(['reExported', 'T', 'val'].sort());
  });

  it('ignores default and namespace imports (no named symbol to match)', () => {
    expect(parseImportedNames('import def from "./x";').size).toBe(0);
    expect(parseImportedNames('import * as ns from "./x";').size).toBe(0);
  });

  it('skips empty members left by a trailing comma', () => {
    const names = parseImportedNames('import { foo, } from "./x";');
    expect([...names]).toEqual(['foo']);
  });
});

describe('buildEdges', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-import-edges-'));
    mkdirSync(join(root, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function run(files: Record<string, string>) {
    const contentByFile = new Map<string, string>();
    for (const [rel, body] of Object.entries(files)) {
      writeFileSync(join(root, rel), body);
      contentByFile.set(rel, body);
    }
    return { contentByFile, rels: Object.keys(files) };
  }

  it('resolves file-to-file import edges and file-to-symbol reference edges', async () => {
    const files = {
      'src/lib.ts': 'export function foo(): void {}\nexport const bar = 1;\n',
      'src/app.ts': 'import { foo } from "./lib.js";\nfoo();\n',
    };
    const { contentByFile, rels } = await run(files);
    const exportsByFile = new Map([['src/lib.ts', new Set(['foo', 'bar'])]]);

    const result = await buildEdges(root, rels, contentByFile, exportsByFile);

    expect(result.importEdges).toEqual([{ from: 'src/app.ts', to: 'src/lib.ts' }]);
    expect(result.referenceEdges).toEqual([
      { from: 'src/app.ts', to: 'src/lib.ts', symbol: 'foo' },
    ]);
  });

  it('emits no reference edge for an imported name the target does not export', async () => {
    const files = {
      'src/lib.ts': 'export function foo(): void {}\n',
      'src/app.ts': 'import { missing } from "./lib.js";\n',
    };
    const { contentByFile, rels } = await run(files);
    const exportsByFile = new Map([['src/lib.ts', new Set(['foo'])]]);

    const result = await buildEdges(root, rels, contentByFile, exportsByFile);
    expect(result.importEdges).toHaveLength(1);
    expect(result.referenceEdges).toHaveLength(0);
  });

  it('skips reference resolution when the target file has no known exports', async () => {
    const files = {
      'src/lib.ts': 'export function foo(): void {}\n',
      'src/app.ts': 'import { foo } from "./lib.js";\n',
    };
    const { contentByFile, rels } = await run(files);
    const result = await buildEdges(root, rels, contentByFile, new Map());
    expect(result.referenceEdges).toHaveLength(0);
  });

  it('treats a from-file absent from the content map as importing nothing', async () => {
    const files = {
      'src/lib.ts': 'export function foo(): void {}\n',
      'src/app.ts': 'import { foo } from "./lib.js";\n',
    };
    // Write both files (so scanImports resolves the edge) but omit app.ts from the
    // content map, exercising the `?? ''` fallback -> no imported names -> no ref edge.
    await run(files);
    const rels = Object.keys(files);
    const result = await buildEdges(
      root,
      rels,
      new Map(),
      new Map([['src/lib.ts', new Set(['foo'])]]),
    );
    expect(result.importEdges).toEqual([{ from: 'src/app.ts', to: 'src/lib.ts' }]);
    expect(result.referenceEdges).toHaveLength(0);
  });

  it('reuses the cached imported-name set when a file has multiple out-edges', async () => {
    const files = {
      'src/a.ts': 'export const A = 1;\n',
      'src/b.ts': 'export const B = 2;\n',
      'src/app.ts': 'import { A } from "./a.js";\nimport { B } from "./b.js";\n',
    };
    const { contentByFile, rels } = await run(files);
    const exportsByFile = new Map([
      ['src/a.ts', new Set(['A'])],
      ['src/b.ts', new Set(['B'])],
    ]);
    const result = await buildEdges(root, rels, contentByFile, exportsByFile);
    expect(result.referenceEdges).toEqual([
      { from: 'src/app.ts', to: 'src/a.ts', symbol: 'A' },
      { from: 'src/app.ts', to: 'src/b.ts', symbol: 'B' },
    ]);
  });
});
