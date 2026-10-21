import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SimilarityResolver } from '@/graph/similarity';

const NODES = new Map([
  ['module:m', { id: 'module:m', type: 'module', parent_id: null }],
  ['module:empty', { id: 'module:empty', type: 'module', parent_id: null }],
  ['file:a', { id: 'file:a', type: 'file', parent_id: 'module:m' }],
  ['chunk:a#0', { id: 'chunk:a#0', type: 'chunk', parent_id: 'file:a' }],
  ['chunk:a#1', { id: 'chunk:a#1', type: 'chunk', parent_id: 'file:a' }],
  ['chunk:a#2', { id: 'chunk:a#2', type: 'chunk', parent_id: 'file:a' }],
]);
const CHILDREN = new Map([
  ['module:m', ['file:a', 'file:ghost']],
  ['file:a', ['chunk:a#0', 'chunk:a#1', 'chunk:a#2']],
]);

describe('SimilarityResolver edge building', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-sim-edges-'));
    mkdirSync(join(root, '.paqad/vectors'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function resolver(items: unknown, cacheSize?: number): SimilarityResolver {
    writeFileSync(join(root, '.paqad/vectors/index.json'), JSON.stringify(items));
    return new SimilarityResolver({
      projectRoot: root,
      vectorIdToNodeId: new Map([
        ['v0', 'chunk:a#0'],
        ['v0-copy', 'chunk:a#0'],
        ['v1', 'chunk:a#1'],
        ['v2', 'chunk:a#2'],
      ]),
      nodesById: NODES,
      childrenIndex: CHILDREN,
      ...(cacheSize !== undefined ? { cacheSize } : {}),
    });
  }

  const SAME = [1, 0];
  const items = {
    items: [
      { id: 'v0', vector: SAME },
      { id: 'v0-copy', vector: SAME },
      { id: 'v1', vector: SAME },
      { id: 'v2', vector: SAME },
      { id: 'unmapped', vector: SAME },
    ],
  };

  it('reads a vector file with no items as no edges', async () => {
    const response = await resolver({}).resolve({ threshold: 0, scope: { type: 'all' } });
    expect(response.edges).toEqual([]);
  });

  it('builds each pair once, skips unmapped vectors and caps at max_edges', async () => {
    const all = await resolver(items).resolve({ threshold: 0.5, scope: { type: 'all' } });
    expect(all.edges.map((edge) => edge.id).sort()).toEqual([
      'e:similar:chunk:a#0->chunk:a#0',
      'e:similar:chunk:a#0->chunk:a#1',
      'e:similar:chunk:a#0->chunk:a#2',
      'e:similar:chunk:a#1->chunk:a#2',
    ]);
    expect(all.capped).toBe(false);

    const capped = await resolver(items).resolve({
      threshold: 0.5,
      scope: { type: 'all' },
      max_edges: 1,
    });
    expect(capped).toMatchObject({ capped: true, edges: [expect.anything()] });
  });

  it('anchors a chunk scope, skipping its own copies and capping at max_edges', async () => {
    const anchored = await resolver(items).resolve({
      threshold: 0.5,
      scope: { type: 'chunk', id: 'chunk:a#1' },
    });
    expect(anchored.edges.map((edge) => edge.id).sort()).toEqual([
      'e:similar:chunk:a#0->chunk:a#1',
      'e:similar:chunk:a#1->chunk:a#2',
    ]);

    const capped = await resolver(items).resolve({
      threshold: 0.5,
      scope: { type: 'chunk', id: 'chunk:a#2' },
      max_edges: 1,
    });
    expect(capped.capped).toBe(true);

    const missing = await resolver(items).resolve({
      threshold: 0.5,
      scope: { type: 'chunk', id: 'chunk:nowhere' },
    });
    expect(missing.edges).toEqual([]);
  });

  it('drops pairs below the threshold', async () => {
    const response = await resolver({
      items: [
        { id: 'v0', vector: [1, 0] },
        { id: 'v1', vector: [0, 1] },
      ],
    }).resolve({ threshold: 0.9, scope: { type: 'chunk', id: 'chunk:a#0' } });
    expect(response.edges).toEqual([]);
  });

  it('resolves module and unknown scopes through their descendant chunks', async () => {
    const r = resolver(items);
    const module = await r.resolve({ threshold: 0.5, scope: { type: 'module', id: 'module:m' } });
    expect(module.edges.length).toBeGreaterThan(0);
    const empty = await r.resolve({
      threshold: 0.5,
      scope: { type: 'module', id: 'module:empty' },
    });
    expect(empty.edges).toEqual([]);
    const unknown = await r.resolve({ threshold: 0.5, scope: { type: 'file', id: 'file:none' } });
    expect(unknown.edges).toEqual([]);
  });

  it('evicts the oldest cached response once the cache is full', async () => {
    const r = resolver(items, 1);
    const first = await r.resolve({ threshold: 0.5, scope: { type: 'all' } });
    await r.resolve({ threshold: 0.6, scope: { type: 'all' } });
    const again = await r.resolve({ threshold: 0.5, scope: { type: 'all' } });
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});
