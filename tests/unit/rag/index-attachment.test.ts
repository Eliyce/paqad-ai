import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import {
  clearEphemeralCollection,
  indexAttachment,
  isIndexAttachmentFailure,
} from '@/rag/attachment-indexer.js';
import { getCollectionId } from '@/rag/attachment-registry.js';
import { readAttachmentEvents } from '@/rag/attachment-events.js';
import type { EmbeddingProvider, ProviderFactory } from '@/rag/types.js';
import { EmbeddingProviderError } from '@/rag/types.js';

const INTELLIGENCE: IntelligenceConfig = {
  rag_enabled: true,
  embedding_provider: 'local',
  embedding_model: 'fake-local',
  rag_similarity_threshold: 0.75,
  rag_top_n: 20,
};

const PDF_HEADER = Buffer.from('%PDF-1.7\n');
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

/** A provider whose embed returns a fixed 2-D vector per text, with a call spy. */
function spyProvider(): { provider: EmbeddingProvider; embed: ReturnType<typeof vi.fn> } {
  const embed = vi.fn(async (input: string | string[]) => {
    const batch = Array.isArray(input) ? input : [input];
    return batch.map(() => [0.5, 0.5]);
  });
  return {
    embed,
    provider: { name: 'local', model: 'fake-local', async validate() {}, embed },
  };
}

function factoryFor(provider: EmbeddingProvider): ProviderFactory {
  return async () => provider;
}

describe('indexAttachment', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-index-attach-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function write(name: string, body: Buffer | string): string {
    const path = join(root, name);
    writeFileSync(path, body);
    return path;
  }

  const projectIndexPath = (): string => join(root, PATHS.VECTOR_INDEX);
  const sessionIndexPath = (id: string): string =>
    join(root, PATHS.SESSION_ATTACHMENT_COLLECTIONS_DIR, id, 'index.json');

  it('indexes a text file into the project collection and emits attachment.indexed', async () => {
    const { provider } = spyProvider();
    const file = write('spec.txt', 'project attachment body');

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj-session',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(false);
    if (isIndexAttachmentFailure(outcome)) throw new Error('unexpected failure');
    expect(outcome.collectionScope).toBe('project');
    expect(outcome.deduped).toBe(false);
    expect(outcome.chunkCount).toBeGreaterThan(0);
    expect(outcome.provider).toBe('local');
    expect(existsSync(projectIndexPath())).toBe(true);

    const events = readAttachmentEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'attachment.indexed',
      file_name: 'spec.txt',
      collection_scope: 'project',
      provider: 'local',
      chunk_count: outcome.chunkCount,
    });
  });

  it('indexes into an ephemeral session collection without touching the project index', async () => {
    const { provider } = spyProvider();
    const file = write('notes.txt', 'ephemeral attachment body');

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'session-a',
      sessionKind: 'ephemeral',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(false);
    if (isIndexAttachmentFailure(outcome)) throw new Error('unexpected failure');
    expect(outcome.collectionScope).toBe('session');
    expect(existsSync(sessionIndexPath('session-a'))).toBe(true);
    expect(existsSync(projectIndexPath())).toBe(false);
    expect(await getCollectionId(root, 'session-a')).toBe('session-a');

    const events = readAttachmentEvents(root);
    expect(events[0]).toMatchObject({
      collection_scope: 'session',
      session_id: 'session-a',
    });
  });

  it('is a no-op when the identical file is indexed twice in one session', async () => {
    const { provider, embed } = spyProvider();
    const file = write('dup.txt', 'same content');
    const params = {
      filePath: file,
      sessionId: 'session-dup',
      sessionKind: 'ephemeral' as const,
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    };

    const first = await indexAttachment(root, params);
    const callsAfterFirst = embed.mock.calls.length;
    const second = await indexAttachment(root, params);

    if (isIndexAttachmentFailure(first) || isIndexAttachmentFailure(second)) {
      throw new Error('unexpected failure');
    }
    expect(second.deduped).toBe(true);
    expect(second.chunkCount).toBe(first.chunkCount);
    // No second round of embedding.
    expect(embed.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-indexes when the same path has changed content', async () => {
    const { provider, embed } = spyProvider();
    const file = write('evolving.txt', 'version one');
    const base = {
      filePath: file,
      sessionId: 'session-evolve',
      sessionKind: 'ephemeral' as const,
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    };

    await indexAttachment(root, base);
    const callsAfterFirst = embed.mock.calls.length;
    writeFileSync(file, 'version two is longer than one');
    const second = await indexAttachment(root, base);

    if (isIndexAttachmentFailure(second)) throw new Error('unexpected failure');
    expect(second.deduped).toBe(false);
    expect(embed.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('keeps chunks from a previously-indexed different file (merge)', async () => {
    const { provider } = spyProvider();
    const a = write('a.txt', 'alpha attachment');
    const b = write('b.txt', 'beta attachment');
    const shared = {
      sessionId: 'proj',
      sessionKind: 'project' as const,
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    };

    await indexAttachment(root, { ...shared, filePath: a });
    await indexAttachment(root, { ...shared, filePath: b });

    const payload = JSON.parse(readFileSync(projectIndexPath(), 'utf8'));
    const sources = new Set(payload.items.map((item: { source_file: string }) => item.source_file));
    expect(sources.has(a)).toBe(true);
    expect(sources.has(b)).toBe(true);
  });

  it('fails a corrupted/binary file without embedding and emits attachment.index_failed', async () => {
    const factory = vi.fn();
    const file = write('blob.bin', Buffer.from([0x00, 0x01, 0x02]));

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'session-bin',
      sessionKind: 'ephemeral',
      intelligence: INTELLIGENCE,
      providerFactory: factory as unknown as ProviderFactory,
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(true);
    if (!isIndexAttachmentFailure(outcome)) throw new Error('expected failure');
    expect(outcome).toMatchObject({ outcome: 'index_failed', reason: 'mime-unrecognised' });
    expect(factory).not.toHaveBeenCalled();
    expect(existsSync(sessionIndexPath('session-bin'))).toBe(false);
    expect(readAttachmentEvents(root)[0]).toMatchObject({ kind: 'attachment.index_failed' });
  });

  it('rejects a PDF with no extractor as attachment.format_rejected', async () => {
    const { provider } = spyProvider();
    const file = write('doc.pdf', PDF_HEADER);

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'session-pdf',
      sessionKind: 'ephemeral',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(true);
    expect(readAttachmentEvents(root)[0]).toMatchObject({
      kind: 'attachment.format_rejected',
      reason: 'unsupported-format',
    });
  });

  it('indexes a valid PDF via an injected extractor', async () => {
    const { provider } = spyProvider();
    const file = write('doc.pdf', PDF_HEADER);

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      parse: { pdfExtractor: async () => ({ text: 'real pdf body text', pageCount: 3 }) },
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(false);
    if (isIndexAttachmentFailure(outcome)) throw new Error('unexpected failure');
    expect(outcome.chunkCount).toBeGreaterThan(0);
    expect(readAttachmentEvents(root)[0]).toMatchObject({ kind: 'attachment.indexed' });
  });

  it('rejects an encrypted PDF as index_failed/encrypted-pdf', async () => {
    const { provider } = spyProvider();
    const file = write('locked.pdf', PDF_HEADER);

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      parse: { pdfExtractor: async () => ({ text: '', pageCount: 0, encrypted: true }) },
    });

    expect(outcome).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'encrypted-pdf' });
  });

  it('rejects a PDF beyond 2,000 pages as format_rejected/page-cap', async () => {
    const { provider } = spyProvider();
    const file = write('huge.pdf', PDF_HEADER);

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      parse: { pdfExtractor: async () => ({ text: 'x', pageCount: 2001 }) },
    });

    expect(outcome).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'page-cap' });
  });

  it('rejects a zip-bomb as format_rejected/zip-bomb', async () => {
    const { provider } = spyProvider();
    const file = write('bomb.zip', ZIP_HEADER);

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      parse: { archiveInspector: async () => ({ decompressedBytes: 600 * 1024 * 1024 }) },
    });

    expect(outcome).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'zip-bomb' });
  });

  it('retries a rate-limited remote provider within the budget and then succeeds', async () => {
    let calls = 0;
    const embed = vi.fn(async (input: string | string[]) => {
      calls += 1;
      if (calls === 1) {
        throw new EmbeddingProviderError('openai', 'rate_limited', 'rate limit reached');
      }
      const batch = Array.isArray(input) ? input : [input];
      return batch.map(() => [0.5, 0.5]);
    });
    const provider: EmbeddingProvider = { name: 'openai', model: 'm', async validate() {}, embed };
    const file = write('rl.txt', 'rate limited then ok');

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      retryBudgetMs: 10_000,
      retryDelayMs: 0,
    });

    expect(isIndexAttachmentFailure(outcome)).toBe(false);
    expect(embed.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('fails with index_failed when the rate-limit retry budget is exhausted', async () => {
    const embed = vi.fn(async () => {
      throw new EmbeddingProviderError('openai', 'rate_limited', 'rate limit reached');
    });
    const provider: EmbeddingProvider = { name: 'openai', model: 'm', async validate() {}, embed };
    const file = write('rl.txt', 'always rate limited');

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      retryBudgetMs: 0,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({ ok: false, outcome: 'index_failed' });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(readAttachmentEvents(root)[0]).toMatchObject({ kind: 'attachment.index_failed' });
  });

  it('fails immediately on a non-rate-limit embedding error', async () => {
    const embed = vi.fn(async () => {
      throw new EmbeddingProviderError('openai', 'provider_error', 'boom');
    });
    const provider: EmbeddingProvider = { name: 'openai', model: 'm', async validate() {}, embed };
    const file = write('err.txt', 'boom body');

    const outcome = await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
    });

    expect(outcome).toMatchObject({ ok: false, outcome: 'index_failed' });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('forwards each event to an onEvent sink', async () => {
    const { provider } = spyProvider();
    const file = write('sink.txt', 'sink body');
    const received: string[] = [];

    await indexAttachment(root, {
      filePath: file,
      sessionId: 'proj',
      sessionKind: 'project',
      intelligence: INTELLIGENCE,
      providerFactory: factoryFor(provider),
      onEvent: (event) => received.push(event.kind),
    });

    expect(received).toEqual(['attachment.indexed']);
  });

  it('throws CancelledError when the signal is already aborted', async () => {
    const { provider, embed } = spyProvider();
    const controller = new AbortController();
    controller.abort();
    const file = write('cancel.txt', 'cancel body');

    await expect(
      indexAttachment(root, {
        filePath: file,
        sessionId: 'proj',
        sessionKind: 'project',
        intelligence: INTELLIGENCE,
        providerFactory: factoryFor(provider),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });
    expect(embed).not.toHaveBeenCalled();
  });

  it('aborts during a rate-limit backoff wait', async () => {
    const controller = new AbortController();
    const embed = vi.fn(async () => {
      // Abort on the next tick — while the backoff sleep is pending.
      setTimeout(() => controller.abort(), 0);
      throw new EmbeddingProviderError('openai', 'rate_limited', 'rate limit reached');
    });
    const provider: EmbeddingProvider = { name: 'openai', model: 'm', async validate() {}, embed };
    const file = write('wait.txt', 'wait body');

    await expect(
      indexAttachment(root, {
        filePath: file,
        sessionId: 'proj',
        sessionKind: 'project',
        intelligence: INTELLIGENCE,
        providerFactory: factoryFor(provider),
        retryBudgetMs: 10_000,
        retryDelayMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED_BY_CONSUMER' });
  });

  it('rejects a traversal session id on the ephemeral path', async () => {
    const { provider } = spyProvider();
    const file = write('x.txt', 'body');
    await expect(
      indexAttachment(root, {
        filePath: file,
        sessionId: '../escape',
        sessionKind: 'ephemeral',
        intelligence: INTELLIGENCE,
        providerFactory: factoryFor(provider),
      }),
    ).rejects.toThrow();
  });

  describe('clearEphemeralCollection', () => {
    it('removes a session collection directory and its registry row', async () => {
      const { provider } = spyProvider();
      const file = write('keep.txt', 'keep body');
      await indexAttachment(root, {
        filePath: file,
        sessionId: 'session-clear',
        sessionKind: 'ephemeral',
        intelligence: INTELLIGENCE,
        providerFactory: factoryFor(provider),
      });
      expect(existsSync(sessionIndexPath('session-clear'))).toBe(true);

      await clearEphemeralCollection(root, 'session-clear');

      expect(
        existsSync(join(root, PATHS.SESSION_ATTACHMENT_COLLECTIONS_DIR, 'session-clear')),
      ).toBe(false);
      expect(await getCollectionId(root, 'session-clear')).toBeNull();
    });

    it('is a safe no-op for an unknown or unsafe session id', async () => {
      await expect(clearEphemeralCollection(root, 'never')).resolves.toBeUndefined();
      await expect(clearEphemeralCollection(root, '../escape')).resolves.toBeUndefined();
    });
  });
});
