import { useEffect, useMemo, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { Graph as GraphData, GraphNode } from '../lib/types';
import { useAppStore, type LayerVisibility } from '../lib/store';
import {
  colorForNodeWithOverlay,
  computeOverlayMetrics,
  type OverlayMetrics,
} from '../lib/overlay';
import type { LayoutRequest, LayoutResponse } from '../lib/layout.worker';

function sizeForNode(type: GraphNode['type']): number {
  switch (type) {
    case 'module':
      return 12;
    case 'file':
      return 5;
    case 'chunk':
      return 2;
    default:
      return 3;
  }
}

/**
 * Module nodes are sized by importance (issue #162): the more files a module
 * holds, the bigger and more prominent it reads on the default map.
 */
function moduleSize(fileCount: number): number {
  return 10 + Math.min(26, Math.sqrt(fileCount) * 4);
}

/**
 * Semantic-zoom level derived from the camera ratio (issue #162). Zoomed out
 * (level 0) shows modules only; zooming in reveals files (1), then chunks and
 * symbols (2). Sigma's ratio shrinks as you zoom in.
 */
function levelForRatio(ratio: number): 0 | 1 | 2 {
  if (ratio <= 0.22) return 2;
  if (ratio <= 0.55) return 1;
  return 0;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function seedPosition(id: string): { x: number; y: number } {
  const h = hash(id);
  return {
    x: ((h & 0xffff) / 0xffff - 0.5) * 100,
    y: (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 100,
  };
}

/**
 * Effective node visibility = the engineer layer toggle OR the semantic-zoom
 * reveal level. Modules are always governed by their toggle; deeper layers
 * appear once the viewer zooms in even if the toggle is off.
 */
function effectiveShowNode(
  type: GraphNode['type'],
  layers: LayerVisibility,
  level: number,
): boolean {
  switch (type) {
    case 'module':
      return layers.modules;
    case 'file':
      return layers.files || level >= 1;
    case 'chunk':
      return layers.chunks || level >= 2;
    case 'symbol':
      return layers.symbols || level >= 2;
    default:
      return true;
  }
}

function effectiveShowEdge(type: string, layers: LayerVisibility, level: number): boolean {
  if (type === 'contains') return layers.contains || level >= 1;
  if (type === 'imports') return layers.imports || level >= 1;
  if (type === 'similar') return layers.similar;
  if (type === 'defines') return layers.symbols || level >= 2;
  return true;
}

/**
 * Reapply node and edge visibility for the current layer toggles and zoom
 * level. Edges only show when both endpoints are visible, so revealing files
 * by zoom also reveals the contains/imports edges between them.
 */
function applyVisibility(g: Graph, layers: LayerVisibility, level: number): void {
  g.forEachNode((id, attrs) => {
    g.setNodeAttribute(id, 'hidden', !effectiveShowNode(attrs.nodeType, layers, level));
  });
  g.forEachEdge((id, attrs, _s, _t, sourceAttrs, targetAttrs) => {
    const endpointsVisible = !sourceAttrs.hidden && !targetAttrs.hidden;
    g.setEdgeAttribute(
      id,
      'hidden',
      !endpointsVisible || !effectiveShowEdge(attrs.edgeType as string, layers, level),
    );
  });
}

function dim(hex: string): string {
  // Sigma WebGL renderer doesn't honor rgba alpha on node fills, so we
  // desaturate by lerping toward a neutral gray and lighten instead.
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#cbd5e1';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const target = 220; // light gray
  const blend = (c: number) => Math.round(c * 0.25 + target * 0.75);
  const out = (blend(r) << 16) | (blend(g) << 8) | blend(b);
  return '#' + out.toString(16).padStart(6, '0');
}

export function GraphCanvas({ data }: { data: GraphData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const selectNode = useAppStore((s) => s.selectNode);
  const layers = useAppStore((s) => s.layers);
  const search = useAppStore((s) => s.search);
  const selected = useAppStore((s) => s.selectedNode);
  const similarEdges = useAppStore((s) => s.similarity.edges);
  const overlay = useAppStore((s) => s.overlay);
  const metrics = useMemo<OverlayMetrics>(() => computeOverlayMetrics(data), [data]);
  const zoomLevelRef = useRef<0 | 1 | 2>(0);
  const lastCameraKey = useRef<string>('');
  const preservedCameraRef = useRef<{ x: number; y: number; ratio: number; angle: number } | null>(
    null,
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const g = new Graph({ multi: true, type: 'mixed' });
    const nodeById = new Map<string, GraphNode>();
    // Module importance = how many files it holds, for size-by-importance.
    const fileCount = new Map<string, number>();
    for (const node of data.nodes) {
      if (node.type === 'file' && node.parent_id) {
        fileCount.set(node.parent_id, (fileCount.get(node.parent_id) ?? 0) + 1);
      }
    }
    for (const node of data.nodes) {
      nodeById.set(node.id, node);
      const pos = seedPosition(node.id);
      const baseColor = colorForNodeWithOverlay(node, overlay, metrics);
      g.addNode(node.id, {
        x: pos.x,
        y: pos.y,
        size:
          node.type === 'module' ? moduleSize(fileCount.get(node.id) ?? 0) : sizeForNode(node.type),
        label: node.label,
        color: baseColor,
        baseColor,
        nodeType: node.type,
        hidden: false,
      });
    }
    for (const edge of data.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      const color =
        edge.type === 'contains'
          ? '#cbd5e1'
          : edge.type === 'imports'
            ? '#6366f1'
            : edge.type === 'similar'
              ? '#f97316'
              : edge.type === 'defines'
                ? '#a78bfa'
                : '#a3a3a3';
      g.addEdgeWithKey(edge.id, edge.source, edge.target, {
        size: edge.type === 'contains' ? 0.4 : 0.8,
        color,
        baseColor: color,
        edgeType: edge.type,
        hidden: true,
      });
    }
    // Initial visibility for the current toggles at the starting zoom level.
    applyVisibility(g, layers, zoomLevelRef.current);
    graphRef.current = g;

    const sigma = new Sigma(g, containerRef.current, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      defaultEdgeColor: '#cbd5e1',
      defaultNodeColor: '#64748b',
      labelDensity: 0.5,
      labelGridCellSize: 100,
      labelRenderedSizeThreshold: 6,
      minCameraRatio: 0.02,
      maxCameraRatio: 50,
    });
    const resizeObserver = new ResizeObserver(() => sigma.resize());
    resizeObserver.observe(containerRef.current);
    sigmaRef.current = sigma;
    sigma.on('clickNode', ({ node }) => {
      const n = nodeById.get(node);
      if (n) selectNode(n);
    });
    sigma.on('clickStage', () => selectNode(null));

    // Semantic zoom: as the camera zooms in, reveal files then chunks/symbols
    // on top of whatever the engineer toggles allow. Reads layers live so it
    // never fights the Advanced controls.
    const camera = sigma.getCamera();
    const onCameraUpdate = (): void => {
      const level = levelForRatio(camera.getState().ratio);
      if (level === zoomLevelRef.current) return;
      zoomLevelRef.current = level;
      const gg = graphRef.current;
      if (!gg) return;
      applyVisibility(gg, useAppStore.getState().layers, level);
      sigmaRef.current?.refresh();
    };
    camera.on('updated', onCameraUpdate);

    // Kick off layout in worker.
    const worker = new Worker(new URL('../lib/layout.worker.ts', import.meta.url), {
      type: 'module',
    });
    const seedNodes = data.nodes.map((n) => ({ id: n.id, ...seedPosition(n.id) }));
    const layoutEdges = data.edges.map((e) => ({ source: e.source, target: e.target }));
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
      const positions = event.data.positions;
      const gg = graphRef.current;
      if (!gg) return;
      gg.forEachNode((id) => {
        const p = positions[id];
        if (p) {
          gg.setNodeAttribute(id, 'x', p.x);
          gg.setNodeAttribute(id, 'y', p.y);
        }
      });
      sigmaRef.current?.refresh();
      // Restore preserved camera (from a previous reload) once layout settles.
      if (preservedCameraRef.current && sigmaRef.current) {
        const cs = preservedCameraRef.current;
        sigmaRef.current.getCamera().setState(cs);
        preservedCameraRef.current = null;
      }
      worker.terminate();
    };
    const request: LayoutRequest = {
      nodes: seedNodes,
      edges: layoutEdges,
      iterations: Math.min(
        300,
        Math.max(50, Math.round(20000 / Math.max(1, data.nodes.length / 100))),
      ),
    };
    worker.postMessage(request);

    return () => {
      // Capture camera so the next mount can restore it (live-reload preserves viewport).
      try {
        const cs = sigma.getCamera().getState();
        preservedCameraRef.current = {
          x: cs.x,
          y: cs.y,
          ratio: cs.ratio,
          angle: cs.angle,
        };
      } catch {
        preservedCameraRef.current = null;
      }
      camera.off('updated', onCameraUpdate);
      resizeObserver.disconnect();
      worker.terminate();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // overlay/metrics are intentionally NOT in deps — recolouring happens in
    // the dedicated effect below so the layout worker isn't rerun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selectNode]);

  // Recolour nodes when overlay changes without rebuilding the graphology
  // instance — keeps layout stable.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    for (const node of data.nodes) {
      if (!g.hasNode(node.id)) continue;
      const c = colorForNodeWithOverlay(node, overlay, metrics);
      g.setNodeAttribute(node.id, 'baseColor', c);
      g.setNodeAttribute(node.id, 'color', c);
    }
    sigmaRef.current?.refresh();
  }, [overlay, metrics, data]);

  // Reapply visibility when the engineer toggles change, combined with the
  // current semantic-zoom level.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    applyVisibility(g, layers, zoomLevelRef.current);
    sigmaRef.current?.refresh();
  }, [layers]);

  // Merge similarity edges into the graphology instance whenever the
  // resolver returns a new edge set. Previously-merged similar edges are
  // cleared so threshold changes are non-additive.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const toDrop: string[] = [];
    g.forEachEdge((id, attrs) => {
      if ((attrs.edgeType as string) === 'similar') toDrop.push(id);
    });
    for (const id of toDrop) g.dropEdge(id);
    for (const edge of similarEdges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      if (g.hasEdge(edge.id)) continue;
      const color = '#f97316';
      g.addEdgeWithKey(edge.id, edge.source, edge.target, {
        size: 0.8,
        color,
        baseColor: color,
        edgeType: 'similar',
        hidden: !layers.similar,
      });
    }
    sigmaRef.current?.refresh();
  }, [similarEdges, layers.similar]);

  // Selection & search highlight.
  useEffect(() => {
    const g = graphRef.current;
    const sig = sigmaRef.current;
    if (!g || !sig) return;
    const matchSet = new Set(search.query.trim() ? search.matches : []);
    const dimMode = matchSet.size > 0 || Boolean(selected);
    g.forEachNode((id, attrs) => {
      const base = (attrs.baseColor as string) ?? (attrs.color as string);
      const isMatch = matchSet.has(id);
      const isSelected = selected?.id === id;
      if (!dimMode) {
        g.setNodeAttribute(id, 'color', base);
        g.setNodeAttribute(id, 'highlighted', false);
      } else if (isSelected || isMatch) {
        g.setNodeAttribute(id, 'color', base);
        g.setNodeAttribute(id, 'highlighted', true);
      } else {
        g.setNodeAttribute(id, 'color', dim(base));
        g.setNodeAttribute(id, 'highlighted', false);
      }
    });
    g.forEachEdge((id, attrs) => {
      const base = (attrs.baseColor as string) ?? (attrs.color as string);
      if (!dimMode) {
        g.setEdgeAttribute(id, 'color', base);
      } else {
        g.setEdgeAttribute(id, 'color', dim(base));
      }
    });
    sig.refresh();

    // Camera pan to current match (only when index/query actually changes).
    if (search.matches.length > 0) {
      const targetId = search.matches[search.index % search.matches.length];
      const key = `${search.query}|${search.index}|${targetId}`;
      if (targetId && g.hasNode(targetId) && key !== lastCameraKey.current) {
        lastCameraKey.current = key;
        // sigma normalizes graph coords; query post-normalization position.
        const display = sig.getNodeDisplayData(targetId);
        if (display) {
          sig.getCamera().animate({ x: display.x, y: display.y, ratio: 0.5 }, { duration: 350 });
        }
      }
    } else if (!search.query) {
      // Reset camera when search is cleared.
      if (lastCameraKey.current) {
        lastCameraKey.current = '';
        sig.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 300 });
      }
    }
  }, [search, selected]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, width: '100vw', height: '100vh' }}
    />
  );
}
