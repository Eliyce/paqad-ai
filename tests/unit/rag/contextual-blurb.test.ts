import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { Chunk } from '@/context/types.js';
import {
  buildContextualBlurb,
  buildModuleRoleResolver,
  contextualizeChunkText,
} from '@/rag/contextual-blurb.js';

function chunk(partial: Partial<Chunk> & { source_file: string }): Chunk {
  return {
    id: 'id',
    ast_node_type: 'function',
    ast_node_path: 'doThing',
    exported_symbols: [],
    content: 'const x = 1;',
    char_count: 10,
    content_hash: 'h',
    ...partial,
  };
}

describe('buildContextualBlurb', () => {
  it('includes path, enclosing signature, exported symbols, and module role', () => {
    const blurb = buildContextualBlurb(
      chunk({
        source_file: 'src/auth/login.ts',
        ast_node_path: 'login',
        exported_symbols: ['login'],
      }),
      { moduleRole: 'Auth' },
    );
    expect(blurb).toContain('src/auth/login.ts');
    expect(blurb).toContain('› login');
    expect(blurb).toContain('exports login');
    expect(blurb).toContain('module: Auth');
  });

  it('omits empty parts (path-only for a bare fallback chunk)', () => {
    const blurb = buildContextualBlurb(
      chunk({ source_file: 'README.md', ast_node_path: 'full', exported_symbols: [] }),
    );
    expect(blurb).toBe('[README.md]');
  });

  it('is deterministic for the same input', () => {
    const c = chunk({ source_file: 'src/a.ts' });
    expect(buildContextualBlurb(c)).toBe(buildContextualBlurb(c));
  });
});

describe('contextualizeChunkText', () => {
  it('prepends the blurb to the content (content kept intact below it)', () => {
    const text = contextualizeChunkText(
      { source_file: 'src/a.ts', ast_node_path: 'fn', exported_symbols: [], content: 'BODY' },
      { moduleRole: 'Core' },
    );
    expect(text.startsWith('[src/a.ts · › fn · module: Core]\n')).toBe(true);
    expect(text.endsWith('BODY')).toBe(true);
  });
});

describe('buildModuleRoleResolver', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-blurb-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeMap(yaml: string): void {
    const target = join(projectRoot, PATHS.MODULE_MAP);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, yaml);
  }

  it('returns undefined everywhere when no module map exists', () => {
    const resolve = buildModuleRoleResolver(projectRoot);
    expect(resolve('src/anything.ts')).toBeUndefined();
  });

  it('resolves a file to the module whose sources prefix-match it', () => {
    writeMap(
      [
        'modules:',
        '  - slug: auth',
        '    name: Authentication',
        '    sources:',
        '      - src/auth',
        '  - slug: rag',
        '    name: Hybrid RAG Runtime',
        '    sources:',
        '      - src/rag/**',
        '',
      ].join('\n'),
    );
    const resolve = buildModuleRoleResolver(projectRoot);
    expect(resolve('src/auth/login.ts')).toBe('Authentication');
    expect(resolve('src/rag/service.ts')).toBe('Hybrid RAG Runtime');
    expect(resolve('src/other/x.ts')).toBeUndefined();
  });

  it('prefers the longest matching prefix (nested module beats parent)', () => {
    writeMap(
      [
        'modules:',
        '  - slug: src',
        '    name: Everything',
        '    sources:',
        '      - src',
        '  - slug: rag',
        '    name: RAG',
        '    sources:',
        '      - src/rag',
        '',
      ].join('\n'),
    );
    const resolve = buildModuleRoleResolver(projectRoot);
    expect(resolve('src/rag/service.ts')).toBe('RAG');
    expect(resolve('src/cli/x.ts')).toBe('Everything');
  });
});
