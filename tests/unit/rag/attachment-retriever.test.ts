import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { SessionAttachmentIndexer } from '@/rag/attachment-indexer.js';
import { deregisterCollection, resolveCollectionDir } from '@/rag/attachment-registry.js';
import { retrieveFromAttachments } from '@/rag/attachment-retriever.js';
import type { EmbeddingProvider, ProviderFactory } from '@/rag/types.js';

const INTELLIGENCE: IntelligenceConfig = {
  rag_enabled: true,
  embedding_provider: 'local',
  embedding_model: 'fake-local',
  rag_similarity_threshold: 0.75,
  rag_top_n: 20,
};

function fakeProviderFactory(): ProviderFactory {
  const provider: EmbeddingProvider = {
    name: 'local',
    model: 'fake-local',
    async validate() {
      return;
    },
    async embed(input: string | string[]) {
      const batch = Array.isArray(input) ? input : [input];
      return batch.map((text) => {
        const lower = text.toLowerCase();
        if (lower.includes('invoice')) return [1, 0];
        if (lower.includes('auth')) return [0, 1];
        return [0.5, 0.5];
      });
    },
  };
  return async () => provider;
}

describe('retrieveFromAttachments', () => {
  let projectRoot: string;
  let indexer: SessionAttachmentIndexer;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-attach-retrieve-'));
    mkdirSync(join(projectRoot, 'files'), { recursive: true });
    indexer = new SessionAttachmentIndexer(fakeProviderFactory());
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeAttachment(name: string, body: string): string {
    const path = join(projectRoot, 'files', name);
    writeFileSync(path, body);
    return path;
  }

  it('retrieves chunks only from the queried session, never another session', async () => {
    const invoice = writeAttachment('invoice.ts', 'export const invoice = "invoice total due";\n');
    const auth = writeAttachment('auth.ts', 'export const auth = "auth policy validation";\n');
    await indexer.index(projectRoot, 'session-a', [invoice], INTELLIGENCE);
    await indexer.index(projectRoot, 'session-b', [auth], INTELLIGENCE);

    const fromA = await retrieveFromAttachments(
      projectRoot,
      'session-a',
      'invoice',
      5,
      fakeProviderFactory(),
    );
    expect(fromA.chunks_retrieved).toBeGreaterThan(0);
    expect(fromA.retrieved_source_files.every((file) => file.endsWith('invoice.ts'))).toBe(true);
    expect(fromA.retrieved_source_files.some((file) => file.endsWith('auth.ts'))).toBe(false);

    const fromB = await retrieveFromAttachments(
      projectRoot,
      'session-b',
      'auth',
      5,
      fakeProviderFactory(),
    );
    expect(fromB.retrieved_source_files.every((file) => file.endsWith('auth.ts'))).toBe(true);
  });

  it('returns an empty result with no-attachment-collection when the session is unknown', async () => {
    const result = await retrieveFromAttachments(
      projectRoot,
      'unknown',
      'anything',
      5,
      fakeProviderFactory(),
    );
    expect(result.chunks_retrieved).toBe(0);
    expect(result.fallback_reason).toBe('no-attachment-collection');
  });

  it('returns no-attachment-collection after a session is deleted', async () => {
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');
    await indexer.index(projectRoot, 'session-a', [file], INTELLIGENCE);

    // Simulate the desktop deleting the session: drop the registry row and dir.
    await deregisterCollection(projectRoot, 'session-a');
    await rm(resolveCollectionDir(projectRoot, 'session-a'), { recursive: true, force: true });

    const result = await retrieveFromAttachments(
      projectRoot,
      'session-a',
      'invoice',
      5,
      fakeProviderFactory(),
    );
    expect(result.fallback_reason).toBe('no-attachment-collection');
  });

  it('reports attachment-index-unavailable when the index files are gone but the row remains', async () => {
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');
    await indexer.index(projectRoot, 'session-a', [file], INTELLIGENCE);

    // Remove only the on-disk collection, leaving the registry row dangling.
    await rm(resolveCollectionDir(projectRoot, 'session-a'), { recursive: true, force: true });

    const result = await retrieveFromAttachments(
      projectRoot,
      'session-a',
      'invoice',
      5,
      fakeProviderFactory(),
    );
    expect(result.fallback_reason).toBe('attachment-index-unavailable');
  });

  it('respects the topN cap', async () => {
    // Several distinct chunks so a small topN is observable.
    const body = Array.from(
      { length: 6 },
      (_unused, index) =>
        `export function fn${index}() {\n  const note${index} = 'invoice line ${index}';\n  return note${index};\n}`,
    ).join('\n\n');
    const file = writeAttachment('invoices.ts', `${body}\n`);
    await indexer.index(projectRoot, 'session-a', [file], INTELLIGENCE);

    const result = await retrieveFromAttachments(
      projectRoot,
      'session-a',
      'invoice',
      2,
      fakeProviderFactory(),
    );
    expect(result.chunks_retrieved).toBeLessThanOrEqual(2);
  });
});
