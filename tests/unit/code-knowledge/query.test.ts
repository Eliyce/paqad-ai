import { describe, expect, it } from 'vitest';

import { queryCodeKnowledge } from '@/code-knowledge/query.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';

function index(): CodeKnowledgeIndex {
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: 't',
      branch: null,
      head_commit: null,
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: [],
    },
    symbols: [
      {
        name: 'foo',
        kind: 'function',
        file: 'src/lib.ts',
        line: 3,
        signature: 'foo(): void',
        exported: true,
        module_slug: 'core',
        extraction_tier: 'regex',
        caller_count: 2,
        orphan: false,
      },
      {
        name: 'lonely',
        kind: 'const',
        file: 'src/lib.ts',
        line: 9,
        signature: 'lonely = 1',
        exported: true,
        module_slug: 'core',
        extraction_tier: 'regex',
        caller_count: 0,
        orphan: true,
      },
    ],
    files: [
      { path: 'src/lib.ts', caller_count: 2, orphan: false, entry_point: false },
      { path: 'src/cli/index.ts', caller_count: 0, orphan: false, entry_point: true },
    ],
    import_edges: [
      { from: 'src/a.ts', to: 'src/lib.ts' },
      { from: 'src/b.ts', to: 'src/lib.ts' },
    ],
    reference_edges: [
      { from: 'src/a.ts', to: 'src/lib.ts', symbol: 'foo' },
      { from: 'src/b.ts', to: 'src/lib.ts', symbol: 'foo' },
    ],
    dependencies: [],
  };
}

describe('queryCodeKnowledge', () => {
  it('returns a symbol card with signature, location, callers and top callers', () => {
    const result = queryCodeKnowledge(index(), 'foo');
    expect(result.matches).toHaveLength(1);
    const card = result.matches[0]!;
    expect(card).toMatchObject({
      kind: 'symbol',
      name: 'foo',
      file: 'src/lib.ts',
      line: 3,
      signature: 'foo(): void',
      caller_count: 2,
      module_slug: 'core',
      top_callers: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('marks an unreferenced symbol as orphan with no top callers', () => {
    const card = queryCodeKnowledge(index(), 'lonely').matches[0]!;
    expect(card).toMatchObject({ kind: 'symbol', orphan: true, top_callers: [] });
  });

  it('falls back to a file card when the term is a file path', () => {
    const card = queryCodeKnowledge(index(), 'src/lib.ts').matches[0]!;
    expect(card).toMatchObject({
      kind: 'file',
      path: 'src/lib.ts',
      caller_count: 2,
      importers: ['src/a.ts', 'src/b.ts'],
    });
    expect(card.kind === 'file' && card.symbols.map((s) => s.name)).toEqual(['foo', 'lonely']);
  });

  it('marks an entry-point file card and reports no importers', () => {
    const card = queryCodeKnowledge(index(), 'src/cli/index.ts').matches[0]!;
    expect(card).toMatchObject({ kind: 'file', entry_point: true, importers: [] });
  });

  it('returns no matches for an unknown term', () => {
    expect(queryCodeKnowledge(index(), 'nope').matches).toEqual([]);
  });
});
