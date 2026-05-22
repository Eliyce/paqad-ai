/// <reference lib="webworker" />
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

export interface LayoutRequest {
  nodes: { id: string; x: number; y: number }[];
  edges: { source: string; target: string }[];
  iterations: number;
}

export interface LayoutResponse {
  positions: Record<string, { x: number; y: number }>;
}

self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { nodes, edges, iterations } = event.data;
  const g = new Graph({ multi: true });
  for (const n of nodes) {
    g.addNode(n.id, { x: n.x, y: n.y, size: 1 });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.addEdge(e.source, e.target);
    }
  }
  const settings = forceAtlas2.inferSettings(g);
  forceAtlas2.assign(g, { iterations, settings });
  const positions: Record<string, { x: number; y: number }> = {};
  g.forEachNode((id, attrs) => {
    positions[id] = { x: attrs.x as number, y: attrs.y as number };
  });
  const response: LayoutResponse = { positions };
  (self as unknown as Worker).postMessage(response);
};
