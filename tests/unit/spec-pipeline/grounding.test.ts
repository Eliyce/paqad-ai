import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RetrievalSource } from '@/context/retrieval-context.js';
import type { RagRetrievalResult } from '@/rag/types.js';
import { groundArea, groundAreaAsync } from '@/spec-pipeline/grounding.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-ground-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeDoc(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}

/** Recursively list every file path under a root, relative + sorted (for the AC-4 snapshot). */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(relative(root, abs));
    }
  };
  walk(root);
  return out.sort();
}

/** A stub retrieval seam returning fixed chunks, so the RAG path runs without a real index. */
function stubRetrieval(
  chunks: Array<{ id: string; source_file: string; content: string }>,
): RetrievalSource {
  return {
    retrieveForEval: async (): Promise<RagRetrievalResult> => ({
      vector_scores: new Map(chunks.map((c) => [c.id, 0.9])),
      chunks_retrieved: chunks.length,
      retrieved_chunk_ids: chunks.map((c) => c.id),
      retrieved_source_files: chunks.map((c) => c.source_file),
      retrieved_chunks: chunks,
      best_score: chunks.length > 0 ? 0.9 : undefined,
    }),
  };
}

/** A business.md fixture with two glossary entries, two roles, one flow, and junk to filter. */
const VOCAB_FIXTURE = [
  '# Billing',
  '## Overview',
  'An overview paragraph.',
  '## Purpose',
  'Why billing exists.',
  '## Glossary',
  '- **Issued invoice**: an invoice that can no longer change',
  '- **Draft invoice** — an invoice still being edited',
  '- Define terms a stakeholder might not know',
  '## User Roles',
  '- **Customer** owns invoices and downloads them',
  '- **Support agent** issues refunds',
  '## User Flows',
  '- **Invoices page** where a customer downloads invoices',
  '## Notes',
  '**ab**',
  '**this bold span is deliberately far longer than sixty characters so it is dropped as junk**',
  '**a bold that starts here',
  'and runs onto the next line**',
  '',
].join('\n');

describe('vocabulary extraction (issue #558, FR-3)', () => {
  it('extracts glossary, role, and flow entries and skips the scaffold line (AC-6)', () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/billing/features/invoices/business.md', VOCAB_FIXTURE);
    const g = groundArea(root, { modules: ['billing'] });
    const vocab = g.vocabulary ?? [];
    const source = 'docs/modules/billing/features/invoices/business.md';
    expect(vocab).toEqual([
      { term: 'Issued invoice', definition: 'an invoice that can no longer change', kind: 'glossary', source },
      { term: 'Draft invoice', definition: 'an invoice still being edited', kind: 'glossary', source },
      { term: 'Customer', kind: 'role', source },
      { term: 'Support agent', kind: 'role', source },
      { term: 'Invoices page', kind: 'flow', source },
    ]);
  });

  it('drops scaffold headings and malformed bold spans from terms (AC-6)', () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/billing/features/invoices/business.md', VOCAB_FIXTURE);
    const g = groundArea(root, { modules: ['billing'] });
    expect(g.terms).not.toContain('Overview');
    expect(g.terms).not.toContain('Purpose');
    expect(g.terms).not.toContain('ab');
    for (const term of g.terms) {
      expect(term).not.toContain('\n');
      expect(term.length).toBeLessThanOrEqual(60);
    }
  });

  it('reads .paqad/glossary.md bold entries when present (FR-3.2)', () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/billing/business.md', '## Glossary\n- **Issued invoice**: locked\n');
    writeDoc(root, '.paqad/glossary.md', '# Glossary\n\n**Chargeback**: a reversed payment\n');
    const g = groundArea(root, { modules: ['billing'] });
    const vocab = g.vocabulary ?? [];
    expect(vocab).toContainEqual({ term: 'Chargeback', kind: 'glossary', source: '.paqad/glossary.md' });
    expect(g.references).toContainEqual({ kind: 'glossary', ref: '.paqad/glossary.md' });
  });

  it('extracts technical names from technical.md sections (FR-3.2)', () => {
    const root = tempRoot();
    writeDoc(
      root,
      'docs/modules/billing/features/invoices/technical.md',
      '## Database Schema\n- `invoices` table holds issued invoices\n## Configuration\n- **filesystems.disks.exports** the export disk\n## Ignored\n`not_extracted`\n',
    );
    const g = groundArea(root, { modules: ['billing'] });
    const vocab = g.vocabulary ?? [];
    const terms = vocab.filter((v) => v.kind === 'technical').map((v) => v.term);
    expect(terms).toContain('invoices');
    expect(terms).toContain('filesystems.disks.exports');
    expect(terms).not.toContain('not_extracted');
  });
});

describe('groundArea', () => {
  it('collects terms and references from module docs (FR-2.2)', () => {
    const root = tempRoot();
    writeDoc(
      root,
      'docs/modules/export/business.md',
      '# Report export\n## Clean export\nAn export excludes **hidden columns** and **archived invoices**.\n',
    );
    const g = groundArea(root, { modules: ['export'] });
    expect(g.references).toEqual([{ kind: 'doc', ref: 'docs/modules/export/business.md' }]);
    expect(g.terms).toContain('Clean export');
    expect(g.terms).toContain('hidden columns');
    expect(g.sparse).toBe(false);
    expect(g.path).toBe('docs-fallback');
  });

  it('succeeds and marks sparse for an undocumented area (FR-2.3)', () => {
    const g = groundArea(tempRoot(), { modules: ['nope'] });
    expect(g.references).toEqual([]);
    expect(g.terms).toEqual([]);
    expect(g.sparse).toBe(true);
    expect(g.path).toBe('docs-fallback');
  });

  it('is deterministic (sorted references and terms)', () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/a/business.md', '## Beta\n## Alpha\n');
    expect(groundArea(root)).toEqual(groundArea(root));
  });
});

describe('groundAreaAsync', () => {
  it('draws terms and references from semantic retrieval when RAG is on (AC-1, AC-5)', async () => {
    const root = tempRoot();
    const service = stubRetrieval([
      {
        id: 'c1',
        source_file: 'docs/modules/export/business.md',
        content:
          '# Report export\nAn export excludes **hidden columns** and **archived invoices**.\n',
      },
    ]);
    const g = await groundAreaAsync(root, { ragEnabled: true, modules: ['export'], service });
    expect(g.path).toBe('rag');
    expect(g.references).toEqual([{ kind: 'doc', ref: 'docs/modules/export/business.md' }]);
    expect(g.terms).toContain('Report export');
    expect(g.terms).toContain('hidden columns');
    expect(g.sparse).toBe(false);
  });

  it('records a rule reference for a rules-path slice (FR-2.2)', async () => {
    const root = tempRoot();
    const service = stubRetrieval([
      {
        id: 'r1',
        source_file: 'docs/instructions/rules/security.md',
        content: '## Auth\n**deny by default**\n',
      },
    ]);
    const g = await groundAreaAsync(root, { ragEnabled: true, query: 'auth', service });
    expect(g.path).toBe('rag');
    expect(g.references).toEqual([{ kind: 'rule', ref: 'docs/instructions/rules/security.md' }]);
  });

  it('falls back to docs/modules when RAG is on but retrieval is empty (AC-2, AC-3)', async () => {
    const root = tempRoot();
    writeDoc(
      root,
      'docs/modules/export/business.md',
      '# Report export\n## Clean export\nExcludes **hidden columns**.\n',
    );
    const g = await groundAreaAsync(root, {
      ragEnabled: true,
      modules: ['export'],
      service: stubRetrieval([]),
    });
    expect(g.path).toBe('docs-fallback');
    expect(g.references).toEqual([{ kind: 'doc', ref: 'docs/modules/export/business.md' }]);
    expect(g.terms).toContain('Clean export');
  });

  it('uses the docs-glob fallback when RAG is off (AC-2)', async () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/export/business.md', '## Clean export\n**hidden columns**\n');
    // The stub would supply terms if consulted; RAG off means it must NOT be.
    const g = await groundAreaAsync(root, {
      ragEnabled: false,
      modules: ['export'],
      service: stubRetrieval([
        { id: 'x', source_file: 'docs/modules/export/other.md', content: '**should-not-appear**' },
      ]),
    });
    expect(g.path).toBe('docs-fallback');
    expect(g.terms).not.toContain('should-not-appear');
    expect(g.terms).toContain('Clean export');
  });

  it('still succeeds and is marked sparse for an undocumented area (FR-2.3)', async () => {
    const g = await groundAreaAsync(tempRoot(), { ragEnabled: true, service: stubRetrieval([]) });
    expect(g.references).toEqual([]);
    expect(g.terms).toEqual([]);
    expect(g.sparse).toBe(true);
    expect(g.path).toBe('docs-fallback');
  });

  it('runs the same vocabulary extraction on the rag path (issue #558, AC-6 parity)', async () => {
    const root = tempRoot();
    const body = VOCAB_FIXTURE;
    writeDoc(root, 'docs/modules/billing/features/invoices/business.md', body);
    const viaDocs = groundArea(root, { modules: ['billing'] });
    const viaRag = await groundAreaAsync(root, {
      ragEnabled: true,
      modules: ['billing'],
      service: stubRetrieval([
        { id: 'c1', source_file: 'docs/modules/billing/features/invoices/business.md', content: body },
      ]),
    });
    expect(viaRag.path).toBe('rag');
    expect(viaDocs.path).toBe('docs-fallback');
    expect(viaRag.vocabulary).toEqual(viaDocs.vocabulary);
  });

  it('creates no pipeline-owned cache or index files during grounding (AC-4 / FR-8.5)', async () => {
    const root = tempRoot();
    writeDoc(root, 'docs/modules/export/business.md', '## Clean export\n**hidden columns**\n');
    const before = listFiles(root);
    await groundAreaAsync(root, {
      ragEnabled: true,
      modules: ['export'],
      service: stubRetrieval([
        {
          id: 'c1',
          source_file: 'docs/modules/export/business.md',
          content: '## Clean export\n**hidden columns**\n',
        },
      ]),
    });
    expect(listFiles(root)).toEqual(before);
  });
});
