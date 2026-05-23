import { describe, expect, it } from 'vitest';

import { buildNodeDetail } from '@/graph/detail';
import type { Graph } from '@/graph/types';

function makeGraph(): {
  graph: Graph;
  chunkContents: Map<
    string,
    { chunkId: string; fileRelPath: string; fileId: string; chunkIndex: number; content: string }
  >;
} {
  const graph: Graph = {
    meta: {
      project_root: '/tmp/x',
      extracted_at: '',
      paqad_version: '0.0',
      counts: { modules: 1, files: 2, chunks: 1, symbols: 1, imports: 1 },
      similarity_edges_available: false,
      overlays_available: {
        health: false,
        defects: false,
        risk_floor: false,
        complexity_correction: false,
      },
      degraded_reasons: [],
    },
    nodes: [
      { id: 'module:cli', type: 'module', label: 'cli', parent_id: null, attributes: {} },
      {
        id: 'file:src/cli/a.ts',
        type: 'file',
        label: 'src/cli/a.ts',
        parent_id: 'module:cli',
        attributes: {},
      },
      {
        id: 'file:src/cli/b.ts',
        type: 'file',
        label: 'src/cli/b.ts',
        parent_id: 'module:cli',
        attributes: {},
      },
      {
        id: 'chunk:src/cli/a.ts#0',
        type: 'chunk',
        label: 'src/cli/a.ts#0',
        parent_id: 'file:src/cli/a.ts',
        attributes: {},
      },
      {
        id: 'symbol:src/cli/a.ts#run',
        type: 'symbol',
        label: 'run',
        parent_id: 'file:src/cli/a.ts',
        attributes: { exported: true },
      },
    ],
    edges: [
      {
        id: 'e1',
        type: 'contains',
        source: 'module:cli',
        target: 'file:src/cli/a.ts',
        weight: null,
        attributes: {},
      },
      {
        id: 'e2',
        type: 'contains',
        source: 'module:cli',
        target: 'file:src/cli/b.ts',
        weight: null,
        attributes: {},
      },
      {
        id: 'e3',
        type: 'contains',
        source: 'file:src/cli/a.ts',
        target: 'chunk:src/cli/a.ts#0',
        weight: null,
        attributes: {},
      },
      {
        id: 'e4',
        type: 'defines',
        source: 'file:src/cli/a.ts',
        target: 'symbol:src/cli/a.ts#run',
        weight: null,
        attributes: {},
      },
      {
        id: 'e5',
        type: 'imports',
        source: 'file:src/cli/a.ts',
        target: 'file:src/cli/b.ts',
        weight: null,
        attributes: {},
      },
    ],
  };
  const chunkContents = new Map([
    [
      'chunk:src/cli/a.ts#0',
      {
        chunkId: 'chunk:src/cli/a.ts#0',
        fileRelPath: 'src/cli/a.ts',
        fileId: 'file:src/cli/a.ts',
        chunkIndex: 0,
        content: 'x'.repeat(700),
      },
    ],
  ]);
  return { graph, chunkContents };
}

describe('buildNodeDetail', () => {
  it('returns null for unknown ids', () => {
    const { graph } = makeGraph();
    expect(buildNodeDetail(graph, 'nope')).toBeNull();
  });

  it('returns children and parent for a module', () => {
    const { graph } = makeGraph();
    const d = buildNodeDetail(graph, 'module:cli')!;
    expect(d.parent).toBeNull();
    expect(d.children.map((c) => c.id).sort()).toEqual(['file:src/cli/a.ts', 'file:src/cli/b.ts']);
    expect(d.health_history).toEqual([]);
  });

  it('returns imports_in and imports_out for a file', () => {
    const { graph } = makeGraph();
    const a = buildNodeDetail(graph, 'file:src/cli/a.ts')!;
    expect(a.imports_out).toEqual([{ file_id: 'file:src/cli/b.ts', module_id: 'module:cli' }]);
    expect(a.imports_in).toEqual([]);
    const b = buildNodeDetail(graph, 'file:src/cli/b.ts')!;
    expect(b.imports_in).toEqual([{ file_id: 'file:src/cli/a.ts', module_id: 'module:cli' }]);
    expect(b.imports_out).toEqual([]);
  });

  it('clips chunk preview to 500 chars and flags truncation', () => {
    const { graph, chunkContents } = makeGraph();
    const d = buildNodeDetail(graph, 'chunk:src/cli/a.ts#0', { chunkContents })!;
    expect(d.chunk_truncated).toBe(true);
    expect(d.chunk_content_preview?.length).toBe(500);
  });
});
