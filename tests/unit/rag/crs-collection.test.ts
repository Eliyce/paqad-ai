import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { CrsBacklogQueue, DEFAULT_CRS_BACKLOG_CAP } from '@/rag/crs-backlog.js';
import {
  crsCollectionDir,
  crsCollectionLayout,
  crsCollectionPaths,
  escapeCollectionId,
} from '@/rag/crs-paths.js';
import { RagService } from '@/rag/service.js';
import type { CrsChunkInput, EmbeddingProvider, ProviderFactory } from '@/rag/types.js';
import {
  EmbeddingBacklogOverflow,
  EmbeddingProviderError,
  isEmbeddingBacklogOverflow,
  toCrsCollectionId,
} from '@/rag/types.js';
import { CorruptVectorIndexError, FileVectorIndex } from '@/rag/vector-index.js';

// ── Deterministic embedding fixtures ───────────────────────────────────────────
// A text embeds to a 2-D unit-ish vector so cosine similarity against a [1,0]
// query is controllable: 'orthogonal' → 0 (below 0.5), 'half' → ~0.707, else 1.0.
function vectorFor(text: string): number[] {
  if (text.includes('orthogonal')) return [0, 1];
  if (text.includes('half')) return [1, 1];
  return [1, 0];
}

function makeProvider(opts?: {
  isOffline?: () => boolean;
  embedSpy?: (input: string | string[]) => void;
}): EmbeddingProvider {
  return {
    name: 'local',
    model: 'fake-local',
    async validate() {},
    async embed(input: string | string[]): Promise<number[][]> {
      opts?.embedSpy?.(input);
      if (opts?.isOffline?.()) {
        throw new EmbeddingProviderError('local', 'provider_error', 'provider offline');
      }
      const batch = Array.isArray(input) ? input : [input];
      return batch.map(vectorFor);
    },
  };
}

function factoryFor(provider: EmbeddingProvider): ProviderFactory {
  return async () => provider;
}

function input(id: string, content: string, overrides: Partial<CrsChunkInput> = {}): CrsChunkInput {
  return {
    id,
    content,
    source_session_id: 'S1',
    source_workspace_id: 'W1',
    created_at: '2026-01-01T00:00:00Z',
    project_id: 'P1',
    ...overrides,
  };
}

describe('CRS collection — crs-paths', () => {
  it('passes a filesystem-safe id through unchanged', () => {
    expect(escapeCollectionId(toCrsCollectionId('projectA'))).toBe('projectA');
    expect(escapeCollectionId(toCrsCollectionId('proj.A_1-2'))).toBe('proj.A_1-2');
  });

  it('escapes illegal characters and appends a disambiguating hash', () => {
    const escaped = escapeCollectionId(toCrsCollectionId('project-A:crs'));
    expect(escaped).toMatch(/^project-A_crs-[0-9a-f]{8}$/);
  });

  it('collapses a `..` traversal sequence', () => {
    const escaped = escapeCollectionId(toCrsCollectionId('a..b'));
    expect(escaped).not.toContain('..');
    expect(escaped).toMatch(/^a_b-[0-9a-f]{8}$/);
  });

  it('rejects an id that escapes to nothing usable', () => {
    expect(() => escapeCollectionId(toCrsCollectionId('.'))).toThrow(/unusable/);
  });

  it('rejects an empty id at brand and escape time', () => {
    expect(() => toCrsCollectionId('')).toThrow(/non-empty/);
    expect(() => toCrsCollectionId('   ')).toThrow(/non-empty/);
    expect(() => escapeCollectionId('' as ReturnType<typeof toCrsCollectionId>)).toThrow(
      /non-empty/,
    );
  });

  it('computes consistent dir, paths, and layout', () => {
    const id = toCrsCollectionId('coll1');
    expect(crsCollectionDir('/root', id)).toBe(join('/root', PATHS.CRS_DIR, 'coll1'));
    expect(crsCollectionPaths(id)).toEqual({
      indexPath: join(PATHS.CRS_DIR, 'coll1', 'index.json'),
      metaPath: join(PATHS.CRS_DIR, 'coll1', 'meta.json'),
    });
    const layout = crsCollectionLayout('/root', id);
    expect(layout.escaped).toBe('coll1');
    expect(layout.absDir).toBe(join('/root', PATHS.CRS_DIR, 'coll1'));
    expect(layout.crsRootAbs).toBe(join('/root', PATHS.CRS_DIR));
    expect(layout.indexPath).toBe(join(PATHS.CRS_DIR, 'coll1', 'index.json'));
  });
});

describe('CRS collection — CrsBacklogQueue', () => {
  const c1 = toCrsCollectionId('c1');
  const c2 = toCrsCollectionId('c2');

  it('enqueues below the cap without throwing', () => {
    const q = new CrsBacklogQueue(5);
    q.enqueue([input('a', 'x'), input('b', 'y')], c1);
    expect(q.size).toBe(2);
  });

  it('drops the oldest and throws EmbeddingBacklogOverflow at the cap', () => {
    const q = new CrsBacklogQueue(3);
    let error: unknown;
    try {
      q.enqueue(
        [input('1', 'a'), input('2', 'b'), input('3', 'c'), input('4', 'd'), input('5', 'e')],
        c1,
      );
    } catch (caught) {
      error = caught;
    }
    expect(isEmbeddingBacklogOverflow(error)).toBe(true);
    expect((error as EmbeddingBacklogOverflow).dropped_count).toBe(2);
    expect(q.size).toBe(3);
  });

  it('drains oldest-first grouped by contiguous collection runs', async () => {
    const q = new CrsBacklogQueue();
    q.enqueue([input('a', 'x'), input('b', 'y')], c1);
    q.enqueue([input('c', 'z')], c2);
    q.enqueue([input('d', 'w')], c1);
    const calls: Array<{ id: string; ids: string[] }> = [];
    await q.drain(async (id, chunks) => {
      calls.push({ id: String(id), ids: chunks.map((chunk) => chunk.id) });
    });
    expect(calls).toEqual([
      { id: 'c1', ids: ['a', 'b'] },
      { id: 'c2', ids: ['c'] },
      { id: 'c1', ids: ['d'] },
    ]);
    expect(q.size).toBe(0);
  });

  it('retains the backlog when a drain persist throws', async () => {
    const q = new CrsBacklogQueue();
    q.enqueue([input('a', 'x')], c1);
    await expect(
      q.drain(async () => {
        throw new Error('persist failed');
      }),
    ).rejects.toThrow('persist failed');
    expect(q.size).toBe(1);
  });

  it('exposes the default cap', () => {
    expect(DEFAULT_CRS_BACKLOG_CAP).toBe(1000);
  });

  it('EmbeddingBacklogOverflow carries a custom message and the guard rejects others', () => {
    const error = new EmbeddingBacklogOverflow(5, 'custom message');
    expect(error.message).toBe('custom message');
    expect(error.dropped_count).toBe(5);
    expect(isEmbeddingBacklogOverflow(new Error('x'))).toBe(false);
  });
});

describe('CRS collection — RagService', () => {
  let root: string;
  const coll = toCrsCollectionId('project-A:crs');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-crs-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const collIndexFile = (): string => join(root, crsCollectionPaths(coll).indexPath);

  it('AC1: create is idempotent and never overwrites existing data', async () => {
    await FileVectorIndex.create(root, coll);
    expect(existsSync(collIndexFile())).toBe(true);
    expect(existsSync(join(root, crsCollectionPaths(coll).metaPath))).toBe(true);

    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match one')], coll);

    // A second create must not reset the populated index back to empty.
    await FileVectorIndex.create(root, coll);
    const payload = JSON.parse(readFileSync(collIndexFile(), 'utf8'));
    expect(payload.items).toHaveLength(1);
  });

  it('AC2: writeChunks persists metadata, emits crs.indexed_session, returns the event', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    const chunks = Array.from({ length: 10 }, (_, i) => input(`c${i}`, 'match'));
    const event = await service.writeChunks(chunks, coll);

    expect(event).toEqual({ session_id: 'S1', project_id: 'P1', chunk_count: 10 });

    const payload = JSON.parse(readFileSync(collIndexFile(), 'utf8'));
    expect(payload.items).toHaveLength(10);
    for (const item of payload.items) {
      expect(item.source_session_id).toBe('S1');
      expect(item.source_workspace_id).toBe('W1');
      expect(item.created_at).toBe('2026-01-01T00:00:00Z');
      expect(item.project_id).toBe('P1');
      expect(typeof item.vector_timestamp).toBe('string');
      expect(item.vector_timestamp.length).toBeGreaterThan(0);
    }

    const audit = readFileSync(join(root, PATHS.AUDIT_LOG), 'utf8');
    expect(audit).toContain('crs.indexed_session');
    expect(audit).toContain('chunk_count="10"');
  });

  it('appends across writes for the same collection', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match')], coll);
    await service.writeChunks([input('b', 'match')], coll);
    const payload = JSON.parse(readFileSync(collIndexFile(), 'utf8'));
    expect(payload.items.map((item: { id: string }) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('AC3: retrieveCrs returns only hits at/above the threshold, ranked desc, with provenance', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks(
      [
        input('full', 'match', { source_session_id: 'S-full' }),
        input('half', 'half match', { source_session_id: 'S-half' }),
        input('ortho', 'orthogonal', { source_session_id: 'S-ortho' }),
      ],
      coll,
    );

    const hits = await service.retrieveCrs('match', coll, 10, 0.5);
    expect(hits.map((hit) => hit.chunk.id)).toEqual(['full', 'half']);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    expect(hits[0].sourceSessionId).toBe('S-full');
    expect(hits[0].sourceWorkspaceId).toBe('W1');
  });

  it('retrieveCrs defaults the confidence threshold to 0.5', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('full', 'match'), input('ortho', 'orthogonal')], coll);
    const hits = await service.retrieveCrs('match', coll, 10);
    expect(hits.map((hit) => hit.chunk.id)).toEqual(['full']);
  });

  it('AC4: scoped destroy removes one session and returns the count', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks(
      [
        input('a', 'match', { source_session_id: 'S1' }),
        input('b', 'match', { source_session_id: 'S1' }),
        input('c', 'match', { source_session_id: 'S2' }),
      ],
      coll,
    );
    const removed = await FileVectorIndex.destroy(root, coll, { sourceSessionId: 'S1' });
    expect(removed).toBe(2);
    const hits = await service.retrieveCrs('match', coll, 10, 0);
    expect(hits.every((hit) => hit.sourceSessionId === 'S2')).toBe(true);
    expect(hits).toHaveLength(1);
  });

  it('AC4: scoped destroy of a nonexistent session returns 0', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match')], coll);
    expect(await FileVectorIndex.destroy(root, coll, { sourceSessionId: 'nope' })).toBe(0);
  });

  it('AC4: whole-collection destroy removes the directory and retrieve returns empty', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match'), input('b', 'match')], coll);
    const removed = await FileVectorIndex.destroy(root, coll);
    expect(removed).toBe(2);
    expect(existsSync(crsCollectionDir(root, coll))).toBe(false);
    await expect(service.retrieveCrs('match', coll, 10, 0)).resolves.toEqual([]);
  });

  it('destroy of an absent collection returns 0', async () => {
    expect(await FileVectorIndex.destroy(root, coll)).toBe(0);
    expect(await FileVectorIndex.destroy(root, coll, { sourceSessionId: 'S1' })).toBe(0);
  });

  it('AC7: a corrupt index raises CorruptVectorIndexError without crashing', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match')], coll);
    writeFileSync(collIndexFile(), '{ not valid json');
    let error: unknown;
    try {
      await service.retrieveCrs('match', coll, 10);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CorruptVectorIndexError);
    expect((error as CorruptVectorIndexError).kind).toBe('index');
    // A whole-collection destroy still purges the corrupt collection.
    expect(await FileVectorIndex.destroy(root, coll)).toBe(0);
  });

  it('AC6: backlog overflows offline, then drains when the provider recovers', async () => {
    let offline = true;
    const provider = makeProvider({ isOffline: () => offline });
    const backlog = new CrsBacklogQueue();
    const service = new RagService(root, factoryFor(provider), backlog);

    const many = Array.from({ length: 1100 }, (_, i) => input(`c${i}`, 'match'));
    let error: unknown;
    try {
      await service.writeChunks(many, coll);
    } catch (caught) {
      error = caught;
    }
    expect(isEmbeddingBacklogOverflow(error)).toBe(true);
    expect((error as EmbeddingBacklogOverflow).dropped_count).toBe(100);
    expect(backlog.size).toBe(1000);

    // Provider recovers — the next write drains the parked backlog first.
    offline = false;
    await service.writeChunks([], coll);
    expect(backlog.size).toBe(0);
    const hits = await service.retrieveCrs('match', coll, 2000, 0);
    expect(hits).toHaveLength(1000);
  });

  it('surfaces the provider error (deferred to backlog) below the cap', async () => {
    const provider = makeProvider({ isOffline: () => true });
    const backlog = new CrsBacklogQueue();
    const service = new RagService(root, factoryFor(provider), backlog);
    await expect(service.writeChunks([input('a', 'match')], coll)).rejects.toBeInstanceOf(
      EmbeddingProviderError,
    );
    expect(backlog.size).toBe(1);
  });

  it('AC5: reindex builds side-by-side, emits progress, swaps, and retains a .revert', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match'), input('b', 'half match')], coll);

    const events: Array<{ status_percent: number; current_collection: string; est_time: number }> =
      [];
    await service.reindex('local', 'fake-local-2', coll, (event) => events.push(event));

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1].status_percent).toBe(100);
    expect(events[0].current_collection).toContain('project-A');
    expect(typeof events[0].est_time).toBe('number');

    const layout = crsCollectionLayout(root, coll);
    const reverts = readdirSync(layout.crsRootAbs).filter((entry) =>
      entry.startsWith(`${layout.escaped}.revert.`),
    );
    expect(reverts).toHaveLength(1);

    // The swapped-in index still serves retrieval.
    const hits = await service.retrieveCrs('match', coll, 10, 0);
    expect(hits.map((hit) => hit.chunk.id).sort()).toEqual(['a', 'b']);
  });

  it('AC5: reindex of an empty collection still emits a 100% progress event', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await FileVectorIndex.create(root, coll);
    const events: number[] = [];
    await service.reindex('local', 'fake', coll, (event) => events.push(event.status_percent));
    expect(events).toEqual([100]);
  });

  it('AC5: reindex of a never-created collection creates it without a .revert', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    const fresh = toCrsCollectionId('untouched');
    const events: number[] = [];
    await service.reindex('local', 'fake', fresh, (event) => events.push(event.status_percent));
    expect(events).toEqual([100]);
    expect(existsSync(crsCollectionDir(root, fresh))).toBe(true);
    const layout = crsCollectionLayout(root, fresh);
    const reverts = readdirSync(layout.crsRootAbs).filter((entry) =>
      entry.startsWith(`${layout.escaped}.revert.`),
    );
    expect(reverts).toHaveLength(0);
  });

  it('reindex sweeps expired .revert directories but keeps fresh and unparseable ones', async () => {
    const service = new RagService(root, factoryFor(makeProvider()));
    await service.writeChunks([input('a', 'match')], coll);

    const layout = crsCollectionLayout(root, coll);
    const expired = join(
      layout.crsRootAbs,
      `${layout.escaped}.revert.${Date.now() - 25 * 3600_000}`,
    );
    const unparseable = join(layout.crsRootAbs, `${layout.escaped}.revert.not-a-number`);
    mkdirSync(expired, { recursive: true });
    mkdirSync(unparseable, { recursive: true });

    await service.reindex('local', 'fake', coll);

    expect(existsSync(expired)).toBe(false);
    expect(existsSync(unparseable)).toBe(true);
    const fresh = readdirSync(layout.crsRootAbs).filter(
      (entry) =>
        entry.startsWith(`${layout.escaped}.revert.`) &&
        entry !== `${layout.escaped}.revert.not-a-number`,
    );
    expect(fresh).toHaveLength(1);
  });

  it('AC3 perf: retrieveCrs over 100k chunks completes well under budget', async () => {
    const big = toCrsCollectionId('big');
    const { indexPath, metaPath } = crsCollectionPaths(big);
    const items = Array.from({ length: 100_000 }, (_, i) => ({
      id: String(i),
      vector: [(i % 7) / 7, 1 - (i % 7) / 7],
      content: '',
      source_session_id: 'S',
      source_workspace_id: 'W',
      created_at: '',
      project_id: 'P',
      vector_timestamp: '',
    }));
    mkdirSync(join(root, PATHS.CRS_DIR, 'big'), { recursive: true });
    writeFileSync(join(root, indexPath), JSON.stringify({ version: 1, dimensions: 2, items }));
    writeFileSync(
      join(root, metaPath),
      JSON.stringify({
        version: 1,
        provider: 'local',
        model: 'fake',
        built_at: '',
        chunk_count: items.length,
        embedding_dimensions: 2,
      }),
    );

    const service = new RagService(root, factoryFor(makeProvider()));
    // Warm the OS file cache, then time the scan over several runs.
    await service.retrieveCrs('match', big, 10, 0);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const hits = await service.retrieveCrs('match', big, 10, 0);
      best = Math.min(best, performance.now() - start);
      expect(hits).toHaveLength(10);
    }
    expect(best).toBeLessThan(200);
  });
});
