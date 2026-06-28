import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gatherWorkingSetSlices, type RetrievalSource } from '@/context/retrieval-context.js';
import type { RagRetrievalResult } from '@/rag/types.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

function resultWith(files: string[]): RagRetrievalResult {
  const chunks = files.map((file, i) => ({
    id: `c${i}`,
    source_file: file,
    ast_node_type: 'function' as const,
    ast_node_path: 'fn',
    exported_symbols: [],
    content: 'body',
    char_count: 4,
    content_hash: `h${i}`,
  }));
  const scores = new Map(chunks.map((c) => [c.id, 0.95]));
  return {
    retrieved_chunks: chunks,
    vector_scores: scores,
    lexical_scores: new Map(),
    routing: { workflow: null, scope: 'single-file', depth: 'standard' },
  } as unknown as RagRetrievalResult;
}

describe('called retrieval seam (#249 P2)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-called-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('records a `called` event when recordEvidence is set and a query is issued', async () => {
    const service: RetrievalSource = {
      retrieveForEval: async () => resultWith(['docs/instructions/a.md', 'docs/instructions/b.md']),
    };
    await gatherWorkingSetSlices(root, {
      service,
      changedPaths: ['docs/instructions/a.md'],
      scope: 'docs',
      recordEvidence: { sessionId: 'ses_called', adapter: 'engine' },
    });

    const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_called');
    const called = rows.find((r) => r.kind === 'called');
    expect(called).toMatchObject({ query_scope: 'docs', candidates: 2 });
  });

  it('does not record when recordEvidence is absent (evals/tests stay silent)', async () => {
    const service: RetrievalSource = {
      retrieveForEval: async () => resultWith(['docs/instructions/a.md']),
    };
    await gatherWorkingSetSlices(root, {
      service,
      changedPaths: ['docs/instructions/a.md'],
      scope: 'docs',
    });
    expect(readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_called')).toEqual([]);
  });
});
