import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refreshRuleContext } from '@/context/rule-context.js';
import {
  MAX_RETRIEVAL_SLICES,
  MAX_SLICE_CHARS,
  applyPrecisionFloor,
  composeRetrievalSection,
  deriveScopeFromWorkingSet,
  filterToScope,
  gatherWorkingSetSlices,
  isDocScopedPath,
  scopeForWorkflow,
  type RetrievalSlice,
  type RetrievalSource,
} from '@/context/retrieval-context.js';
import { PATHS } from '@/core/constants/paths.js';
import type { CompiledRule, CompiledRulesStore } from '@/core/types/planning.js';
import type { RagRetrievalResult } from '@/rag/types.js';

function slice(partial: Partial<RetrievalSlice> & { source_file: string }): RetrievalSlice {
  return { content: 'chunk body', ...partial };
}

function emptyResult(): RagRetrievalResult {
  return {
    vector_scores: new Map(),
    chunks_retrieved: 0,
    retrieved_chunk_ids: [],
    retrieved_source_files: [],
    retrieved_chunks: [],
  };
}

describe('composeRetrievalSection', () => {
  it('emits nothing when there are no slices (disabled/cold-start == today)', () => {
    expect(composeRetrievalSection([])).toBe('');
  });

  it('renders each slice as a labelled fenced block with an advisory note', () => {
    const md = composeRetrievalSection([
      slice({ source_file: 'src/a.ts', content: 'export const A = 1;' }),
    ]);
    expect(md).toContain('## Retrieved context — 1 slice relevant to the files in play');
    expect(md).toContain('Advisory');
    expect(md).toContain('### src/a.ts');
    expect(md).toContain('export const A = 1;');
  });

  it('caps the injected slices at MAX_RETRIEVAL_SLICES', () => {
    const many = Array.from({ length: MAX_RETRIEVAL_SLICES + 4 }, (_unused, index) =>
      slice({ source_file: `src/file-${index}.ts`, content: `body ${index}` }),
    );
    const md = composeRetrievalSection(many);
    expect(md).toContain(`## Retrieved context — ${MAX_RETRIEVAL_SLICES} slices`);
    expect(md).toContain('src/file-0.ts');
    expect(md).not.toContain(`src/file-${MAX_RETRIEVAL_SLICES + 1}.ts`);
  });

  it('truncates an oversized slice body (token guard)', () => {
    const big = 'x'.repeat(MAX_SLICE_CHARS + 500);
    const md = composeRetrievalSection([slice({ source_file: 'src/big.ts', content: big })]);
    expect(md).toContain('slice truncated at');
    expect(md.length).toBeLessThan(big.length);
  });

  it('dedupes identical slices so the same chunk is never injected twice (#345)', () => {
    const md = composeRetrievalSection([
      slice({ source_file: 'src/a.ts', content: 'export const A = 1;' }),
      slice({ source_file: 'src/a.ts', content: 'export const A = 1;' }),
      slice({ source_file: 'src/b.ts', content: 'export const B = 2;' }),
    ]);
    expect(md).toContain('## Retrieved context — 2 slices relevant to the files in play');
    // The duplicated body appears exactly once.
    expect(md.split('export const A = 1;').length - 1).toBe(1);
    expect(md).toContain('export const B = 2;');
  });

  it('annotates each slice with its calibrated match strength (F12)', () => {
    const md = composeRetrievalSection([slice({ source_file: 'src/a.ts', score: 0.912 })]);
    expect(md).toContain('### src/a.ts · match 91%');
  });

  it('omits the match annotation when a slice has no score', () => {
    const md = composeRetrievalSection([slice({ source_file: 'src/a.ts' })]);
    const heading = md.split('\n').find((line) => line.startsWith('### '));
    expect(heading).toBe('### src/a.ts');
  });
});

describe('applyPrecisionFloor (F12)', () => {
  it('keeps slices at or above the floor', () => {
    const kept = applyPrecisionFloor(
      [slice({ source_file: 'a', score: 0.8 }), slice({ source_file: 'b', score: 0.75 })],
      0.75,
    );
    expect(kept.map((s) => s.source_file)).toEqual(['a', 'b']);
  });

  it('drops slices below the floor (confident-but-wrong is worse than grep)', () => {
    const kept = applyPrecisionFloor([slice({ source_file: 'low', score: 0.6 })], 0.75);
    expect(kept).toEqual([]);
  });

  it('drops slices with no score (never inject what we cannot vouch for)', () => {
    const kept = applyPrecisionFloor([slice({ source_file: 'unscored' })], 0.75);
    expect(kept).toEqual([]);
  });
});

describe('scope routing (F13)', () => {
  it('classifies docs/instructions, docs/modules, and the module-map as doc-scoped', () => {
    expect(isDocScopedPath('docs/instructions/rules/coding.md')).toBe(true);
    expect(isDocScopedPath('docs/modules/hybrid-rag/index/summary.md')).toBe(true);
    expect(isDocScopedPath('./docs/instructions/rules/module-map.yml')).toBe(true);
    expect(isDocScopedPath('src/context/retrieval-context.ts')).toBe(false);
    expect(isDocScopedPath('docs/architecture/notes.md')).toBe(false);
  });

  it('routes code-changing workflows to all, others to docs (F19)', () => {
    expect(scopeForWorkflow('feature-development')).toBe('all');
    expect(scopeForWorkflow('bug-fix')).toBe('all');
    expect(scopeForWorkflow('refactor')).toBe('all');
    expect(scopeForWorkflow('documentation-update')).toBe('docs');
    expect(scopeForWorkflow('writing')).toBe('docs');
    expect(scopeForWorkflow(null)).toBe('docs');
    expect(scopeForWorkflow(undefined)).toBe('docs');
  });

  it('docs scope keeps only doc slices; code scope keeps only code slices', () => {
    const slices = [
      slice({ source_file: 'docs/instructions/rules/a.md' }),
      slice({ source_file: 'src/app.ts' }),
    ];
    expect(filterToScope(slices, 'docs').map((s) => s.source_file)).toEqual([
      'docs/instructions/rules/a.md',
    ]);
    expect(filterToScope(slices, 'code').map((s) => s.source_file)).toEqual(['src/app.ts']);
    expect(filterToScope(slices, 'all')).toHaveLength(2);
  });
});

describe('deriveScopeFromWorkingSet (F14)', () => {
  it('maps working-set breadth to a classification scope', () => {
    expect(deriveScopeFromWorkingSet([])).toBe('single-file');
    expect(deriveScopeFromWorkingSet(['src/a.ts'])).toBe('single-file');
    expect(deriveScopeFromWorkingSet(['src/context/a.ts', 'src/context/b.ts'])).toBe(
      'single-module',
    );
    expect(deriveScopeFromWorkingSet(['src/context/a.ts', 'src/rag/b.ts'])).toBe('multi-module');
    expect(
      deriveScopeFromWorkingSet(['src/a/x.ts', 'src/b/x.ts', 'src/c/x.ts', 'src/d/x.ts']),
    ).toBe('system-wide');
  });
});

describe('gatherWorkingSetSlices', () => {
  function source(result: RagRetrievalResult): RetrievalSource {
    return { retrieveForEval: async () => result };
  }

  it('skips retrieval entirely for a self-contained stage (F14, no query)', async () => {
    let called = false;
    const service: RetrievalSource = {
      retrieveForEval: async () => {
        called = true;
        return emptyResult();
      },
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service,
      changedPaths: ['src/app.ts'],
      routing: { workflow: 'investigation', complexity: 'trivial' },
    });
    expect(slices).toEqual([]);
    expect(called).toBe(false);
  });

  it('defaults to docs scope: a code slice is dropped (F13, code deferred to F19)', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.95]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['src/app.ts'],
      retrieved_chunks: [{ id: 'c1', source_file: 'src/app.ts', content: 'code chunk' }],
    };
    const docsDefault = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
    });
    expect(docsDefault).toEqual([]);
    // Explicit scope:'all' lets the same code slice through.
    const all = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
      scope: 'all',
    });
    expect(all).toHaveLength(1);
  });

  it('a feature-dev workflow routes to code slices (F19)', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.95]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['src/app.ts'],
      retrieved_chunks: [{ id: 'c1', source_file: 'src/app.ts', content: 'function f() {}' }],
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
      routing: { workflow: 'feature-development' },
    });
    expect(slices).toHaveLength(1);
    expect(slices[0].source_file).toBe('src/app.ts');
  });

  it('returns the retrieved chunks as slices, scored', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.91]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['docs/instructions/a.md'],
      retrieved_chunks: [{ id: 'c1', source_file: 'docs/instructions/a.md', content: 'doc slice' }],
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
    });
    expect(slices).toEqual([
      { source_file: 'docs/instructions/a.md', content: 'doc slice', score: 0.91 },
    ]);
  });

  it('returns [] when nothing is in play (no working set)', async () => {
    let called = false;
    const service: RetrievalSource = {
      retrieveForEval: async () => {
        called = true;
        return emptyResult();
      },
    };
    const slices = await gatherWorkingSetSlices('/proj', { service, changedPaths: [] });
    expect(slices).toEqual([]);
    expect(called).toBe(false);
  });

  it('retrieves from a prompt seed even with an empty working set (#336)', async () => {
    // A question has no changed files; the prompt-driven query still retrieves.
    const captured: { input?: { taskDescription?: string; keywords: string[] } } = {};
    const service: RetrievalSource = {
      retrieveForEval: async (input) => {
        captured.input = input;
        return {
          vector_scores: new Map([['c1', 0.91]]),
          chunks_retrieved: 1,
          retrieved_chunk_ids: ['c1'],
          retrieved_source_files: ['docs/instructions/a.md'],
          retrieved_chunks: [
            { id: 'c1', source_file: 'docs/instructions/a.md', content: 'doc slice' },
          ],
        };
      },
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service,
      changedPaths: [],
      query: 'how does the router work',
    });
    expect(slices).toHaveLength(1);
    // The prompt is the retrieval query (not a working-set-derived description).
    expect(captured.input?.taskDescription).toBe('how does the router work');
  });

  it('returns [] when retrieval falls back (empty result)', async () => {
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(emptyResult()),
      changedPaths: ['src/app.ts'],
    });
    expect(slices).toEqual([]);
  });

  it('returns [] when retrieval throws (accelerator never blocks)', async () => {
    const service: RetrievalSource = {
      retrieveForEval: async () => {
        throw new Error('provider down');
      },
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service,
      changedPaths: ['src/app.ts'],
    });
    expect(slices).toEqual([]);
  });

  it('drops a below-floor slice at the consumer boundary (F12)', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.6]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['docs/instructions/a.md'],
      retrieved_chunks: [
        { id: 'c1', source_file: 'docs/instructions/a.md', content: 'weak match' },
      ],
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
      precisionFloor: 0.75,
    });
    expect(slices).toEqual([]);
  });

  it('keeps an above-floor slice (F12)', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.9]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['docs/instructions/a.md'],
      retrieved_chunks: [
        { id: 'c1', source_file: 'docs/instructions/a.md', content: 'strong match' },
      ],
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
      precisionFloor: 0.75,
    });
    expect(slices).toHaveLength(1);
    expect(slices[0].source_file).toBe('docs/instructions/a.md');
  });

  it('forwards the topN cap to the retrieval source', async () => {
    let seenTopN: number | undefined;
    const service: RetrievalSource = {
      retrieveForEval: async (_input, topN) => {
        seenTopN = topN;
        return emptyResult();
      },
    };
    await gatherWorkingSetSlices('/proj', { service, changedPaths: ['src/a.ts'], topN: 3 });
    expect(seenTopN).toBe(3);
  });
});

describe('writeRuleContext + retrieval section (artifact integration)', () => {
  let projectRoot: string;

  function rule(partial: Partial<CompiledRule> & { rule_id: string }): CompiledRule {
    return {
      title: 'A Rule',
      source_path: 'docs/instructions/rules/coding/a.md',
      trigger_patterns: ['**'],
      severity: 'should',
      summary: 'Summary.',
      raw_text: 'RULE FULL TEXT',
      ...partial,
    };
  }

  function store(rules: CompiledRule[]): CompiledRulesStore {
    return { schema_version: 1, generated_at: 'now', source_hash: 'sha256:x', rules };
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-retrievalctx-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('appends the retrieval section after the rule slice in the single artifact', async () => {
    writeFileSync(
      join(projectRoot, PATHS.COMPILED_RULES),
      JSON.stringify(store([rule({ rule_id: 'ALWAYS' })])),
    );
    const retrievalSection = composeRetrievalSection([
      slice({ source_file: 'docs/x.md', content: 'RETRIEVED SLICE' }),
    ]);
    const target = await refreshRuleContext(projectRoot, { retrievalSection });
    const written = readFileSync(target as string, 'utf8');
    expect(written).toContain('paqad rule manifest');
    expect(written).toContain('RULE FULL TEXT');
    expect(written).toContain('## Retrieved context');
    expect(written).toContain('RETRIEVED SLICE');
    // Rule slice precedes retrieval slice.
    expect(written.indexOf('RULE FULL TEXT')).toBeLessThan(written.indexOf('RETRIEVED SLICE'));
  });

  it('an empty retrieval section leaves the artifact rule-only (today-equivalent)', async () => {
    writeFileSync(
      join(projectRoot, PATHS.COMPILED_RULES),
      JSON.stringify(store([rule({ rule_id: 'ALWAYS' })])),
    );
    await refreshRuleContext(projectRoot, { retrievalSection: composeRetrievalSection([]) });
    const written = readFileSync(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT), 'utf8');
    expect(written).toContain('paqad rule manifest');
    expect(written).not.toContain('## Retrieved context');
  });

  it('writes a retrieval-only artifact when there are no compiled rules', async () => {
    const retrievalSection = composeRetrievalSection([
      slice({ source_file: 'docs/x.md', content: 'RETRIEVED SLICE' }),
    ]);
    const target = await refreshRuleContext(projectRoot, { retrievalSection });
    expect(target).toBe(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT));
    const written = readFileSync(target as string, 'utf8');
    expect(written).toContain('## Retrieved context');
    expect(written).not.toContain('paqad rule manifest');
  });
});
