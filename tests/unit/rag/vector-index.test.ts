import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoredVectorChunk } from '@/rag/types.js';
import { FileVectorIndex } from '@/rag/vector-index.js';

function item(id: string, vector: number[], source = 'src/a.ts'): StoredVectorChunk {
  return {
    id,
    vector,
    source_file: source,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: [],
    content: id,
    char_count: id.length,
    content_hash: `${id}-hash`,
  };
}

describe('FileVectorIndex', () => {
  let projectRoot: string;
  let index: FileVectorIndex;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-vector-index-'));
    index = new FileVectorIndex();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stores vectors and returns ranked cosine matches', async () => {
    await index.replaceAll(projectRoot, [item('auth', [1, 0]), item('billing', [0, 1])], {
      provider: 'local',
      model: 'fake',
    });

    const results = await index.query(projectRoot, [0.9, 0.1], 2);
    expect(results[0]?.item.id).toBe('auth');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('reports status and clears persisted files', async () => {
    await index.replaceAll(projectRoot, [item('auth', [1, 0])], {
      provider: 'local',
      model: 'fake',
    });

    const status = await index.status(projectRoot);
    expect(status.present).toBe(true);
    expect(status.meta?.chunk_count).toBe(1);

    await index.clear(projectRoot);
    await expect(index.load(projectRoot)).resolves.toBeNull();
    expect(existsSync(join(projectRoot, '.paqad', 'vectors'))).toBe(false);
  });

  it('flags corrupt vector payloads in status checks', async () => {
    await index.replaceAll(projectRoot, [item('auth', [1, 0])], {
      provider: 'local',
      model: 'fake',
    });

    writeFileSync(join(projectRoot, '.paqad', 'vectors', 'index.json'), '{corrupt');

    const status = await index.status(projectRoot);
    expect(status.present).toBe(true);
    expect(status.corrupt).toBe(true);
    expect(status.reason).toBe('vector index payload is unreadable');
  });

  it('flags missing metadata in status checks', async () => {
    await index.replaceAll(projectRoot, [item('auth', [1, 0])], {
      provider: 'local',
      model: 'fake',
    });

    rmSync(join(projectRoot, '.paqad', 'vectors', 'meta.json'), { force: true });

    const status = await index.status(projectRoot);
    expect(status.present).toBe(true);
    expect(status.corrupt).toBe(true);
    expect(status.reason).toBe('vector metadata is missing');
  });

  it('returns no results when the vector index is absent', async () => {
    await expect(index.query(projectRoot, [1, 0], 5)).resolves.toEqual([]);
  });

  it('reads legacy index.bin payloads for backwards compatibility', async () => {
    await index.replaceAll(projectRoot, [item('auth', [1, 0])], {
      provider: 'local',
      model: 'fake',
    });

    const currentPath = join(projectRoot, '.paqad', 'vectors', 'index.json');
    const legacyPath = join(projectRoot, '.paqad', 'vectors', 'index.bin');
    writeFileSync(legacyPath, readFileSync(currentPath, 'utf8'));
    rmSync(currentPath, { force: true });

    const results = await index.query(projectRoot, [1, 0], 1);
    expect(results[0]?.item.id).toBe('auth');
  });

  it('removes a legacy index.bin when saving the current json index', async () => {
    const legacyPath = join(projectRoot, '.paqad', 'vectors', 'index.bin');
    mkdirSync(join(projectRoot, '.paqad', 'vectors'), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ version: 1, dimensions: 2, items: [] }));

    await index.replaceAll(projectRoot, [item('auth', [1, 0])], {
      provider: 'local',
      model: 'fake',
    });

    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad', 'vectors', 'index.json'))).toBe(true);
  });
});
