import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SimilarityResolver } from '@/graph/similarity';

function makeResolver(root: string) {
  // Build a tiny vector index: 3 chunks. A and B nearly identical, C orthogonal.
  const items = [
    { id: 'va', vector: [1, 0, 0] },
    { id: 'vb', vector: [0.98, 0.05, 0.05] },
    { id: 'vc', vector: [0, 1, 0] },
  ];
  mkdirSync(join(root, '.paqad/vectors'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/vectors/index.json'),
    JSON.stringify({ version: 1, dimensions: 3, items }),
  );
  const vectorIdToNodeId = new Map([
    ['va', 'chunk:src/a.ts#0'],
    ['vb', 'chunk:src/a.ts#1'],
    ['vc', 'chunk:src/b.ts#0'],
  ]);
  const nodes = new Map([
    ['module:m', { id: 'module:m', type: 'module', parent_id: null }],
    ['file:src/a.ts', { id: 'file:src/a.ts', type: 'file', parent_id: 'module:m' }],
    ['file:src/b.ts', { id: 'file:src/b.ts', type: 'file', parent_id: 'module:m' }],
    ['chunk:src/a.ts#0', { id: 'chunk:src/a.ts#0', type: 'chunk', parent_id: 'file:src/a.ts' }],
    ['chunk:src/a.ts#1', { id: 'chunk:src/a.ts#1', type: 'chunk', parent_id: 'file:src/a.ts' }],
    ['chunk:src/b.ts#0', { id: 'chunk:src/b.ts#0', type: 'chunk', parent_id: 'file:src/b.ts' }],
  ]);
  const children = new Map([
    ['module:m', ['file:src/a.ts', 'file:src/b.ts']],
    ['file:src/a.ts', ['chunk:src/a.ts#0', 'chunk:src/a.ts#1']],
    ['file:src/b.ts', ['chunk:src/b.ts#0']],
  ]);
  return new SimilarityResolver({
    projectRoot: root,
    vectorIdToNodeId,
    nodesById: nodes,
    childrenIndex: children,
  });
}

describe('SimilarityResolver', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sim-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports unavailable when vector store is missing', async () => {
    const r = new SimilarityResolver({
      projectRoot: root,
      vectorIdToNodeId: new Map(),
      nodesById: new Map(),
      childrenIndex: new Map(),
    });
    expect(r.isAvailable()).toBe(false);
    const res = await r.resolve({ threshold: 0.5, scope: { type: 'all', id: null } });
    expect(res.edges).toEqual([]);
    expect(res.capped).toBe(false);
  });

  it('returns the near-identical pair above the threshold and excludes the orthogonal one', async () => {
    const r = makeResolver(root);
    const res = await r.resolve({ threshold: 0.85, scope: { type: 'all', id: null } });
    expect(res.edges.map((e) => `${e.source}|${e.target}`).sort()).toEqual([
      'chunk:src/a.ts#0|chunk:src/a.ts#1',
    ]);
    expect(res.edges[0]!.weight).toBeGreaterThan(0.95);
  });

  it('honours module scope by only comparing chunks under that module', async () => {
    const r = makeResolver(root);
    const all = await r.resolve({ threshold: 0.0, scope: { type: 'all', id: null } });
    // 3 chunks ⇒ 3 unordered pairs
    expect(all.edges.length).toBe(3);
    const file = await r.resolve({ threshold: 0.0, scope: { type: 'file', id: 'file:src/a.ts' } });
    // 2 chunks in file:src/a.ts ⇒ 1 pair
    expect(file.edges.length).toBe(1);
  });

  it('caps results to max_edges', async () => {
    const r = makeResolver(root);
    const capped = await r.resolve({
      threshold: 0.0,
      scope: { type: 'all', id: null },
      max_edges: 1,
    });
    expect(capped.edges.length).toBe(1);
    expect(capped.capped).toBe(true);
  });

  it('uses anchor mode for chunk scope', async () => {
    const r = makeResolver(root);
    const res = await r.resolve({
      threshold: 0.0,
      scope: { type: 'chunk', id: 'chunk:src/a.ts#0' },
    });
    // anchor mode: edges from the anchor only
    for (const e of res.edges) {
      expect(e.source === 'chunk:src/a.ts#0' || e.target === 'chunk:src/a.ts#0').toBe(true);
    }
    expect(res.edges.length).toBe(2);
  });

  it('caches results keyed by (scope, threshold, mtime)', async () => {
    const r = makeResolver(root);
    const a = await r.resolve({ threshold: 0.5, scope: { type: 'all', id: null } });
    const b = await r.resolve({ threshold: 0.5, scope: { type: 'all', id: null } });
    // Returned object identity should match since the second call hit cache.
    expect(b).toBe(a);
  });

  it('higher thresholds return monotonically fewer edges', async () => {
    const r = makeResolver(root);
    const low = await r.resolve({ threshold: 0.0, scope: { type: 'all', id: null } });
    const high = await r.resolve({ threshold: 0.95, scope: { type: 'all', id: null } });
    expect(high.edges.length).toBeLessThanOrEqual(low.edges.length);
  });
});
