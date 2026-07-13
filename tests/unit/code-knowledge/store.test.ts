import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  codeKnowledgeIndexPath,
  readCodeKnowledgeIndex,
  writeCodeKnowledgeIndex,
} from '@/code-knowledge/store.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';

function sampleIndex(): CodeKnowledgeIndex {
  return {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      head_commit: 'abc',
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: ['src/cli/**'],
    },
    symbols: [],
    files: [],
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
}

describe('code-knowledge store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ck-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips through write then read, creating the indexes dir', () => {
    const written = writeCodeKnowledgeIndex(root, sampleIndex());
    expect(written).toBe(codeKnowledgeIndexPath(root));
    expect(readCodeKnowledgeIndex(root)?.header.branch).toBe('main');
  });

  it('returns null when no index exists', () => {
    expect(readCodeKnowledgeIndex(root)).toBeNull();
  });

  it('returns null on corrupt JSON (never crashes)', () => {
    writeCodeKnowledgeIndex(root, sampleIndex());
    writeFileSync(codeKnowledgeIndexPath(root), '{ not json');
    expect(readCodeKnowledgeIndex(root)).toBeNull();
  });

  it('returns null on a schema-invalid index (never trusts a bad shape)', () => {
    writeCodeKnowledgeIndex(root, sampleIndex());
    writeFileSync(codeKnowledgeIndexPath(root), JSON.stringify({ schema_version: 99 }));
    expect(readCodeKnowledgeIndex(root)).toBeNull();
  });
});
