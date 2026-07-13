import { describe, expect, it } from 'vitest';

import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';

function validIndex(): CodeKnowledgeIndex {
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      head_commit: 'abc123',
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: ['src/cli/**'],
    },
    symbols: [
      {
        name: 'foo',
        kind: 'function',
        file: 'src/foo.ts',
        line: 1,
        signature: 'foo(): void',
        exported: true,
        module_slug: 'core',
        extraction_tier: 'regex',
        caller_count: 0,
        orphan: true,
      },
    ],
    files: [{ path: 'src/foo.ts', caller_count: 0, orphan: true, entry_point: false }],
    import_edges: [{ from: 'src/a.ts', to: 'src/foo.ts' }],
    reference_edges: [{ from: 'src/a.ts', to: 'src/foo.ts', symbol: 'foo' }],
    dependencies: [{ name: 'chalk', ecosystem: 'node', imported: true }],
  };
}

describe('validateCodeKnowledgeIndex', () => {
  it('accepts a well-formed index', () => {
    const result = validateCodeKnowledgeIndex(validIndex());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts nulls for the optional git freshness fields', () => {
    const index = validIndex();
    index.header.branch = null;
    index.header.head_commit = null;
    expect(validateCodeKnowledgeIndex(index).valid).toBe(true);
  });

  it('rejects a wrong schema_version', () => {
    const index = { ...validIndex(), schema_version: 99 };
    const result = validateCodeKnowledgeIndex(index);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an unknown symbol kind', () => {
    const index = validIndex();
    (index.symbols[0] as { kind: string }).kind = 'macro';
    expect(validateCodeKnowledgeIndex(index).valid).toBe(false);
  });

  it('rejects a missing required top-level section', () => {
    const index = validIndex() as Partial<CodeKnowledgeIndex>;
    delete index.dependencies;
    expect(validateCodeKnowledgeIndex(index).valid).toBe(false);
  });

  it('rejects an unexpected extra property (closed schema)', () => {
    const index = { ...validIndex(), surprise: true };
    expect(validateCodeKnowledgeIndex(index).valid).toBe(false);
  });

  it('reports errors as readable path + message lines', () => {
    const result = validateCodeKnowledgeIndex({ schema_version: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.every((line) => typeof line === 'string' && line.length > 0)).toBe(true);
  });
});
