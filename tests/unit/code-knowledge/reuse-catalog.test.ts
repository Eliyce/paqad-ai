import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generateReuseCatalog,
  REUSE_CATALOG_TOP_N,
  writeReuseCatalog,
} from '@/code-knowledge/reuse-catalog.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CodeKnowledgeIndex, CodeKnowledgeSymbol } from '@/code-knowledge/types.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';

function symbol(overrides: Partial<CodeKnowledgeSymbol>): CodeKnowledgeSymbol {
  return {
    name: 'sym',
    kind: 'function',
    file: 'src/lib.ts',
    line: 1,
    signature: 'sym(): void',
    exported: true,
    module_slug: 'core',
    extraction_tier: 'regex',
    caller_count: 0,
    orphan: true,
    ...overrides,
  };
}

function indexWith(symbols: CodeKnowledgeSymbol[]): CodeKnowledgeIndex {
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: 't',
      branch: null,
      head_commit: null,
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: [],
    },
    symbols,
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
}

describe('generateReuseCatalog', () => {
  it('marks the file generated and groups symbols by module, most-reused first', () => {
    const md = generateReuseCatalog(
      indexWith([
        symbol({ name: 'low', caller_count: 1, module_slug: 'core' }),
        symbol({ name: 'high', caller_count: 9, module_slug: 'core' }),
        symbol({ name: 'apiThing', caller_count: 3, module_slug: 'api' }),
      ]),
    );
    expect(md).toContain('Do not edit by hand');
    expect(md).toContain('## api');
    expect(md).toContain('## core');
    // Within core, `high` (9 callers) sorts before `low` (1).
    expect(md.indexOf('| high |')).toBeLessThan(md.indexOf('| low |'));
  });

  it('sanitises pipes in a signature so the table stays valid', () => {
    const md = generateReuseCatalog(indexWith([symbol({ name: 'u', signature: 'u(): A | B' })]));
    expect(md).toContain('u(): A / B');
    expect(md).not.toContain('A | B');
  });

  it('lists symbols with no module under an (unattributed) section', () => {
    const md = generateReuseCatalog(indexWith([symbol({ name: 'loose', module_slug: null })]));
    expect(md).toContain('## (unattributed)');
    expect(md).toContain('| loose |');
  });

  it('caps each module at the top-N most-called symbols', () => {
    const many = Array.from({ length: REUSE_CATALOG_TOP_N + 5 }, (_, i) =>
      symbol({ name: `s${i}`, caller_count: i, module_slug: 'core' }),
    );
    const rows = generateReuseCatalog(indexWith(many))
      .split('\n')
      .filter((line) => line.startsWith('| s'));
    expect(rows).toHaveLength(REUSE_CATALOG_TOP_N);
  });
});

describe('writeReuseCatalog', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-reuse-catalog-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes docs/instructions/registries/reuse-catalog.md', () => {
    const written = writeReuseCatalog(root, indexWith([symbol({ name: 'x', caller_count: 2 })]));
    expect(written).toBe(join(root, PATHS.REGISTRIES_DIR, 'reuse-catalog.md'));
    expect(readFileSync(written, 'utf8')).toContain('# Reuse Catalog');
  });
});
