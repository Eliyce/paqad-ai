import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { queryCodeKnowledge } from '@/code-knowledge/query.js';
import { validateCodeKnowledgeIndex } from '@/code-knowledge/schema.js';

// Real-repo integration: build the code-knowledge index against THIS repository and
// assert the acceptance criteria against real files (AC-1, AC-2). This is the
// truthful smoke test the issue calls for — no fixtures, the actual source tree.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('code-knowledge index over the paqad-ai repo', () => {
  it('builds a schema-valid index with exported symbols and caller counts (AC-1)', async () => {
    const start = Date.now();
    const index = await buildCodeKnowledgeIndex(repoRoot);
    const durationMs = Date.now() - start;

    expect(validateCodeKnowledgeIndex(index).valid).toBe(true);
    expect(index.symbols.length).toBeGreaterThan(0);
    // caller_count is populated (some symbol in this repo is referenced by name).
    expect(index.symbols.some((symbol) => symbol.caller_count > 0)).toBe(true);
    // Performance budget: a full build of this repo stays well under 30s.
    expect(durationMs).toBeLessThan(30_000);
  }, 30_000);

  it('queries buildProjectRepoMap and finds its first production caller (AC-2)', async () => {
    const index = await buildCodeKnowledgeIndex(repoRoot);
    const result = queryCodeKnowledge(index, 'buildProjectRepoMap');

    expect(result.matches.length).toBeGreaterThan(0);
    const card = result.matches[0]!;
    expect(card.kind).toBe('symbol');
    if (card.kind === 'symbol') {
      expect(card.file).toBe('src/rag/repo-map.ts');
      expect(card.line).toBeGreaterThan(0);
      expect(card.signature.length).toBeGreaterThan(0);
      // #353 recorded the repo-map as finished-but-unwired (0 production callers). Issue
      // #356 wired it into the existing-surface planning digest — its first live consumer
      // (AC-5), so it now has a production caller and is no longer dead code.
      expect(card.caller_count).toBeGreaterThan(0);
      expect(card.top_callers).toContain('src/context/existing-surface.ts');
    }
  }, 30_000);
});
