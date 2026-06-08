import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { AttachmentPathError } from '@/rag/attachment-registry.js';
import { SessionAttachmentIndexer } from '@/rag/attachment-indexer.js';
import { getCollectionId } from '@/rag/attachment-registry.js';
import { isAttachmentIndexingDegraded } from '@/rag/attachment-types.js';
import type { EmbeddingProvider, ProviderFactory } from '@/rag/types.js';

const INTELLIGENCE: IntelligenceConfig = {
  rag_enabled: true,
  embedding_provider: 'local',
  embedding_model: 'fake-local',
  rag_similarity_threshold: 0.75,
  rag_top_n: 20,
};

// Deterministic 2-D embedding keyed on a marker word.
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

function collectionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.paqad/attachments', sessionId);
}

describe('SessionAttachmentIndexer', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-attach-indexer-'));
    mkdirSync(join(projectRoot, 'files'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function writeAttachment(name: string, body: string): string {
    const path = join(projectRoot, 'files', name);
    writeFileSync(path, body);
    return path;
  }

  it('indexes attachments into a session-bound collection and never touches the project vectors', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice total due";\n');

    const outcome = await indexer.index(projectRoot, 'session-a', [file], INTELLIGENCE);

    expect(isAttachmentIndexingDegraded(outcome)).toBe(false);
    if (isAttachmentIndexingDegraded(outcome)) throw new Error('unexpected degrade');
    expect(outcome.collectionId).toBe('session-a');
    expect(outcome.chunkCount).toBeGreaterThan(0);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);

    expect(existsSync(join(collectionDir(projectRoot, 'session-a'), 'index.json'))).toBe(true);
    expect(existsSync(join(collectionDir(projectRoot, 'session-a'), 'meta.json'))).toBe(true);
    // The project RAG index is never written by attachment indexing.
    expect(existsSync(join(projectRoot, '.paqad/vectors/index.json'))).toBe(false);
    expect(await getCollectionId(projectRoot, 'session-a')).toBe('session-a');
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'rag-attachment-index-completed',
    );
  });

  it('keeps two sessions isolated in separate collection directories', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    const invoice = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');
    const auth = writeAttachment('auth.ts', 'export const auth = "auth policy";\n');

    await indexer.index(projectRoot, 'session-a', [invoice], INTELLIGENCE);
    await indexer.index(projectRoot, 'session-b', [auth], INTELLIGENCE);

    expect(existsSync(join(collectionDir(projectRoot, 'session-a'), 'index.json'))).toBe(true);
    expect(existsSync(join(collectionDir(projectRoot, 'session-b'), 'index.json'))).toBe(true);
  });

  it('reindexes into a fresh collection on branch while leaving the original intact', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    const file = writeAttachment('notes.ts', 'export const notes = "auth notes";\n');

    await indexer.index(projectRoot, 'session-a', [file], INTELLIGENCE);
    const originalBytes = readFileSync(join(collectionDir(projectRoot, 'session-a'), 'index.json'));

    await indexer.index(projectRoot, 'session-a-branch', [file], INTELLIGENCE);

    expect(existsSync(join(collectionDir(projectRoot, 'session-a-branch'), 'index.json'))).toBe(
      true,
    );
    expect(readFileSync(join(collectionDir(projectRoot, 'session-a'), 'index.json'))).toEqual(
      originalBytes,
    );
  });

  it('produces an empty collection (no embedding) when no listed file exists', async () => {
    const embed = vi.fn();
    const factory: ProviderFactory = async () => ({
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    });
    const indexer = new SessionAttachmentIndexer(factory);

    const outcome = await indexer.index(
      projectRoot,
      'session-empty',
      [join(projectRoot, 'files/does-not-exist.ts')],
      INTELLIGENCE,
    );

    expect(isAttachmentIndexingDegraded(outcome)).toBe(false);
    if (isAttachmentIndexingDegraded(outcome)) throw new Error('unexpected degrade');
    expect(outcome.chunkCount).toBe(0);
    expect(embed).not.toHaveBeenCalled();
  });

  it('skips a path that exists but cannot be read as a file', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    // A directory path: existsSync is true but readFile throws EISDIR → skipped.
    const dirPath = join(projectRoot, 'files');
    const outcome = await indexer.index(projectRoot, 'session-dir', [dirPath], INTELLIGENCE);
    expect(isAttachmentIndexingDegraded(outcome)).toBe(false);
  });

  it('degrades after the initial attempt plus two retries when the provider is unreachable', async () => {
    const embed = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const factory: ProviderFactory = async () => ({
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    });
    // Zero-length backoff so the test does not wait the real 1 s / 2 s.
    const indexer = new SessionAttachmentIndexer(factory, [0, 0]);
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    const outcome = await indexer.index(projectRoot, 'session-degraded', [file], INTELLIGENCE);

    expect(isAttachmentIndexingDegraded(outcome)).toBe(true);
    if (!isAttachmentIndexingDegraded(outcome)) throw new Error('expected degrade');
    expect(outcome.kind).toBe('attachment_indexing_degraded');
    expect(outcome.sessionId).toBe('session-degraded');
    expect(outcome.retriesExhausted).toBe(true);
    expect(embed).toHaveBeenCalledTimes(3); // initial + 2 retries
    // No collection directory is created on a degrade.
    expect(existsSync(collectionDir(projectRoot, 'session-degraded'))).toBe(false);
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'rag-attachment-index-degraded',
    );
  });

  it('aborts mid-flight via the caller signal and purges the partial collection', async () => {
    const controller = new AbortController();
    const provider: EmbeddingProvider = {
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        controller.abort();
        const batch = Array.isArray(input) ? input : [input];
        return batch.map(() => [0.5, 0.5]);
      },
    };
    const indexer = new SessionAttachmentIndexer(async () => provider);
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    await expect(
      indexer.index(
        projectRoot,
        'session-abort',
        [file],
        INTELLIGENCE,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });

    expect(existsSync(collectionDir(projectRoot, 'session-abort'))).toBe(false);
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'rag-attachment-index-cancelled',
    );
  });

  it('returns immediately without embedding when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const embed = vi.fn();
    const indexer = new SessionAttachmentIndexer(async () => ({
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    }));
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    await expect(
      indexer.index(projectRoot, 'session-pre', [file], INTELLIGENCE, undefined, controller.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });
    expect(embed).not.toHaveBeenCalled();
    expect(existsSync(collectionDir(projectRoot, 'session-pre'))).toBe(false);
  });

  it('cancel() aborts an in-flight indexer and purges its partial collection', async () => {
    const ref: { indexer?: SessionAttachmentIndexer } = {};
    const provider: EmbeddingProvider = {
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        // Simulate the session being deleted while indexing is in flight.
        await ref.indexer?.cancel(projectRoot, 'session-cancel');
        const batch = Array.isArray(input) ? input : [input];
        return batch.map(() => [0.5, 0.5]);
      },
    };
    const indexer = new SessionAttachmentIndexer(async () => provider);
    ref.indexer = indexer;
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    await expect(
      indexer.index(projectRoot, 'session-cancel', [file], INTELLIGENCE),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });
    expect(existsSync(collectionDir(projectRoot, 'session-cancel'))).toBe(false);
  });

  it('cancel() on an unknown or unsafe session id is a safe no-op', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    await expect(indexer.cancel(projectRoot, 'never-ran')).resolves.toBeUndefined();
    await expect(indexer.cancel(projectRoot, '../escape')).resolves.toBeUndefined();
  });

  it('rejects a traversal session id before writing anything', async () => {
    const indexer = new SessionAttachmentIndexer(fakeProviderFactory());
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    await expect(
      indexer.index(projectRoot, '../escape', [file], INTELLIGENCE),
    ).rejects.toBeInstanceOf(AttachmentPathError);
  });

  it('aborts during a retry backoff wait', async () => {
    const controller = new AbortController();
    let firstCall = true;
    const provider: EmbeddingProvider = {
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed() {
        if (firstCall) {
          firstCall = false;
          // Abort on the next tick — during the backoff sleep, not before it.
          setTimeout(() => controller.abort(), 0);
          throw new Error('ETIMEDOUT');
        }
        return [[0.5, 0.5]];
      },
    };
    const indexer = new SessionAttachmentIndexer(async () => provider, [50]);
    const file = writeAttachment('invoice.ts', 'export const invoice = "invoice";\n');

    await expect(
      indexer.index(
        projectRoot,
        'session-wait',
        [file],
        INTELLIGENCE,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });
    expect(existsSync(collectionDir(projectRoot, 'session-wait'))).toBe(false);
  });
});
