import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { refreshRuleContext } from '@/context/rule-context.js';
import {
  MAX_RETRIEVAL_SLICES,
  MAX_SLICE_CHARS,
  composeRetrievalSection,
  gatherWorkingSetSlices,
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
});

describe('gatherWorkingSetSlices', () => {
  function source(result: RagRetrievalResult): RetrievalSource {
    return { retrieveForEval: async () => result };
  }

  it('returns the retrieved chunks as slices, scored', async () => {
    const result: RagRetrievalResult = {
      vector_scores: new Map([['c1', 0.91]]),
      chunks_retrieved: 1,
      retrieved_chunk_ids: ['c1'],
      retrieved_source_files: ['docs/a.md'],
      retrieved_chunks: [{ id: 'c1', source_file: 'docs/a.md', content: 'doc slice' }],
    };
    const slices = await gatherWorkingSetSlices('/proj', {
      service: source(result),
      changedPaths: ['src/app.ts'],
    });
    expect(slices).toEqual([{ source_file: 'docs/a.md', content: 'doc slice', score: 0.91 }]);
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
