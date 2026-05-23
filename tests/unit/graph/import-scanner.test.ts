import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractImportSpecifiers, scanImports } from '@/graph/import-scanner';

function write(root: string, rel: string, content: string): void {
  const target = join(root, rel);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

describe('extractImportSpecifiers', () => {
  it('captures static, dynamic, require, and re-export specifiers', () => {
    const src = `
      import a from "./a.js";
      import type { B } from './b';
      import 'side-effect';
      import('./dyn.js');
      const c = require('./c');
      export { d } from './d.js';
      export * from './e';
    `;
    expect(extractImportSpecifiers(src).sort()).toEqual(
      ['./a.js', './b', 'side-effect', './dyn.js', './c', './d.js', './e'].sort(),
    );
  });
});

describe('scanImports', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-imports-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves relative + alias paths and ignores bare and unresolved specifiers', async () => {
    write(
      root,
      'src/a.ts',
      `
      import './b.js';
      import './sub';
      import '@/util/c.js';
      import 'left-pad';
      import 'node:fs';
    `,
    );
    write(root, 'src/b.ts', 'export const b = 1;');
    write(root, 'src/sub/index.ts', 'export const s = 1;');
    write(root, 'src/util/c.ts', 'export const c = 1;');

    const edges = await scanImports({
      projectRoot: root,
      files: ['src/a.ts', 'src/b.ts', 'src/sub/index.ts', 'src/util/c.ts'],
      aliases: { '@/': 'src/' },
    });

    const targets = edges
      .filter((e) => e.from === 'src/a.ts')
      .map((e) => e.to)
      .sort();
    expect(targets).toEqual(['src/b.ts', 'src/sub/index.ts', 'src/util/c.ts']);
  });

  it('deduplicates and skips self-edges', async () => {
    write(
      root,
      'src/a.ts',
      `
      import './b.js';
      import './b';
    `,
    );
    write(root, 'src/b.ts', '');
    const edges = await scanImports({
      projectRoot: root,
      files: ['src/a.ts', 'src/b.ts'],
    });
    expect(edges.filter((e) => e.from === 'src/a.ts').length).toBe(1);
  });
});
